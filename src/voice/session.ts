// src/voice/session.ts

// One capture session per guild: hold the connection, turn each speaker's Opus
// stream into utterances, transcribe them, and fire a clip when one matches.
//
// Utterance boundaries come from Discord's own silence detection rather than a
// voice activity detector: subscribing with AfterSilence ends the stream once
// someone stops talking, which is exactly the boundary a transcript wants.
// Long speech is not held until then, though: it is cut into overlapping
// chunks as it arrives (CHUNK_SAMPLES in audio.ts), so a trigger word inside a
// sentence fires about a chunk after it is said rather than after the sentence.

import { isCalm } from "@/tracking/calm";
import { createLogger, seconds, type LogFields } from "@/utils/log";
import { startAmbient, stopAmbient } from "@/voice/ambient";
import {
  CHUNK_OVERLAP_SAMPLES,
  CHUNK_SAMPLES,
  concatFloat32,
  downsampleToMono16k,
  isSilenceFrame,
  loudestWindowRms,
  pcmToInt16,
  TARGET_RATE,
  utteranceVerdict,
} from "@/voice/audio";
import {
  announceEntrance,
  displayName,
  flushPendingEntrance,
  forgetPendingEntrance,
} from "@/voice/entrance";
import { loadOpusDecoder, type OpusDecoder } from "@/voice/opus";
import {
  clipStatus,
  dropPlayer,
  getPlayer,
  playClip,
  POOL_CLIP_COOLDOWN_MS,
  type ClipVerdict,
  type TriggerSpeaker,
} from "@/voice/playback";
import {
  isIgnoredTranscript,
  loadSounds,
  matchedWords,
  matchTriggers,
  pickOne,
  poolKey,
  resolveClipPath,
  resolveClips,
  type CompiledTrigger,
} from "@/voice/sounds";
import { matchConfidence, startStt, transcribe } from "@/voice/stt";
import type { HeardWord } from "@/voice/sttTypes";
import { recordTrigger, type TriggerOutcome } from "@/voice/triggerLog";
import {
  EndBehaviorType,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
  type VoiceConnection,
} from "@discordjs/voice";
import type { Client, Guild, VoiceBasedChannel, VoiceState } from "discord.js";

const log = createLogger("voice/session");

/**
 * Silence that ends an utterance, and for a word said on its own the largest
 * single part of the wait between it and its clip: nothing is transcribed
 * until Discord has heard this much quiet, unless the speech runs long enough
 * to be cut into chunks first (CHUNK_SAMPLES).
 *
 * Short enough to keep the whole wait under a second, and still above the
 * gaps between words in fluent speech, which run nearer 200ms. What it costs
 * is split utterances: a pause longer than this inside a phrase ends the
 * capture, and "bad to the bone" heard as two halves matches neither.
 */
export const SILENCE_END_MS = 350;

/** How long to wait for a connection to become usable. */
const READY_TIMEOUT_MS = 20_000;

/** Speakers captured at once in one channel, so a busy call cannot swamp the queue. */
export const MAX_CAPTURED_SPEAKERS = 8;

/** A live capture session. */
interface Session {
  connection: VoiceConnection;
  channelId: string;
  guild: Guild;
  decoder: OpusDecoder;
  capturing: Set<string>;
}

const sessions = new Map<string, Session>();

/**
 * Set once {@link closeAllSessions} has run. Shutdown then waits on Discord to
 * confirm the leaves, and a member moving channels in that window would
 * otherwise have the reconcile join the bot straight back in.
 */
let closedForShutdown = false;

/** A join still waiting for its connection to become ready. */
interface PendingJoin {
  channelId: string;
  connection: VoiceConnection;
  abort: AbortController;
}

/**
 * Joins in flight, per guild. A session only registers once the connection is
 * ready, and a kick or disable in that window must not be lost - see
 * {@link closeSession}.
 */
const pending = new Map<string, PendingJoin>();

/** Why a pool could not play: every verdict but "play". */
type Refusal = Exclude<ClipVerdict, "play">;

/** Each refusal as the "trigger not played" line says it; the trigger log keeps the codes. */
const REFUSAL_TEXT: Record<Refusal, string> = {
  "pool-cooldown": "pool on cooldown",
  "guild-floor": "a clip just played",
  playing: "a clip is still playing",
};

/** A pool ready to play, or the gap that stopped every candidate. */
type PoolChoice =
  | { trigger: CompiledTrigger; pool: string }
  | { pool: string; name: string; verdict: Refusal; remainingMs: number };

/** What became of a matched transcript, for the trigger log. */
interface MatchResult {
  outcome: TriggerOutcome;
  /** Pool name as written in the config, empty when none was reached. */
  pool: string;
  clip: string;
}

/**
 * Names a trigger's pool the way the config does, for the trigger log.
 * @param trigger - A compiled trigger.
 * @returns The pool name, or "(inline)" for clips listed on the trigger.
 */
function poolName(trigger: CompiledTrigger): string {
  return trigger.trigger.pool ?? "(inline)";
}

/** A matched trigger, the words that fired it, and how surely they were heard. */
export interface WeighedMatch {
  trigger: CompiledTrigger;
  matched: string[];
  confidence: number | null;
}

/**
 * Splits matched triggers by their own `minConfidence`: the ones heard surely
 * enough to play, and the ones that fell short. A match with no confidence to
 * go on is kept, since the floor is for doubtful hearings and a missing figure
 * says nothing either way.
 * @param text - The transcript.
 * @param matches - Every trigger it fired.
 * @param words - The transcript's words with their confidence.
 * @returns The sure and unsure matches, each in the order given.
 */
export function weighMatches(
  text: string,
  matches: CompiledTrigger[],
  words: HeardWord[],
): { sure: WeighedMatch[]; unsure: WeighedMatch[] } {
  const sure: WeighedMatch[] = [];
  const unsure: WeighedMatch[] = [];
  for (const trigger of matches) {
    const matched = matchedWords(text, trigger);
    const confidence = matchConfidence(matched, words);
    const floor = trigger.minConfidence;
    const short = floor !== undefined && confidence !== null && confidence < floor;
    (short ? unsure : sure).push({ trigger, matched, confidence });
  }
  return { sure, unsure };
}

/**
 * Says at info that a match was heard and not answered, with what held it: a
 * word heard and not answered otherwise looks exactly like a word not heard.
 * @param guildId - Discord guild (server) ID.
 * @param speaker - Who spoke and how it went.
 * @param reason - What held it back, as the line says it.
 * @param [extra] - Further context: the pool, and how long until it frees up.
 */
function heldBack(
  guildId: string,
  speaker: TriggerSpeaker,
  reason: string,
  extra: LogFields = {},
): void {
  log.info(
    "trigger not played",
    {
      guildId,
      user: speaker.userName,
      matched: speaker.matched,
      confidence: speaker.confidence,
      reason,
      ...extra,
    },
    { userId: speaker.userId },
  );
}

/**
 * Chooses which pool a word plays from when it fires several, with even odds
 * across the ones that are free right now.
 *
 * Gated pools drop out before the roll rather than after it, so a word that
 * fires two pools plays the other one instead of going quiet while the first
 * cools off. When nothing is free the refusal that frees up soonest is the one
 * reported, since that is the gap someone in the call is actually waiting on.
 * @param guildId - Discord guild (server) ID.
 * @param matches - Every trigger the transcript fired.
 * @param guildCooldownMs - The guild's configured gap, if it set one.
 * @returns The pool to play from, or why none of them could.
 */
function pickFreePool(
  guildId: string,
  matches: CompiledTrigger[],
  guildCooldownMs: number | undefined,
): PoolChoice {
  const free: { trigger: CompiledTrigger; pool: string }[] = [];
  let refused: { pool: string; name: string; verdict: Refusal; remainingMs: number } | null = null;

  for (const trigger of matches) {
    const pool = poolKey(trigger.source);
    const gapMs = trigger.cooldownMs ?? guildCooldownMs ?? POOL_CLIP_COOLDOWN_MS;
    const gate = clipStatus(guildId, pool, gapMs);
    if (gate.verdict === "play") {
      free.push({ trigger, pool });
    } else if (!refused || gate.remainingMs < refused.remainingMs) {
      refused = {
        pool,
        name: poolName(trigger),
        verdict: gate.verdict,
        remainingMs: gate.remainingMs,
      };
    }
  }

  const choice = pickOne(free, Math.floor(Math.random() * free.length));
  if (choice) return choice;
  // Unreachable with a non-empty match list, since every candidate either went
  // into `free` or set `refused`; typed out rather than asserted.
  return refused ?? { pool: "(none)", name: "", verdict: "playing", remainingMs: 0 };
}

/**
 * Plays a clip for a transcript that matched, unless something stops it. A
 * match that is held back says so at info, with what held it and for how
 * long.
 * @param guildId - Discord guild (server) ID.
 * @param speaker - Who spoke and how it went, for the log. `matched` names
 * every word that fired; the pool that plays narrows it to its own.
 * @param text - What they said, to name the words that fired the pool played.
 * @param matches - Every trigger the transcript fired.
 * @param guildCooldownMs - The guild's configured gap, if it set one.
 * @returns What happened, with the pool and clip it got as far as.
 */
async function playMatch(
  guildId: string,
  speaker: TriggerSpeaker,
  text: string,
  matches: CompiledTrigger[],
  guildCooldownMs: number | undefined,
): Promise<MatchResult> {
  // Calm mode silences replies across the bot; a sound bite is a reply that
  // everyone in the call has to hear, so it obeys the same window.
  if (isCalm(guildId)) {
    heldBack(guildId, speaker, "calm mode");
    return { outcome: "calm", pool: "", clip: "" };
  }

  const choice = pickFreePool(guildId, matches, guildCooldownMs);
  if ("verdict" in choice) {
    heldBack(guildId, speaker, REFUSAL_TEXT[choice.verdict], {
      pool: choice.name,
      readyIn: choice.remainingMs ? seconds(choice.remainingMs) : undefined,
    });
    return { outcome: choice.verdict, pool: choice.name, clip: "" };
  }
  const { trigger: match, pool } = choice;
  const name = poolName(match);

  const clips = resolveClips(guildId, match.source);
  if (clips.length === 0) {
    log.warn("trigger matched but its pool holds no clips", { guildId, pool: name });
    return { outcome: "no-clips", pool: name, clip: "" };
  }
  const clip = pickOne(clips, Math.floor(Math.random() * clips.length));
  if (!clip) return { outcome: "no-clips", pool: name, clip: "" };
  const clipPath = resolveClipPath(guildId, clip);
  if (!clipPath) {
    log.warn("configured clip is missing on disk", { guildId, clip });
    return { outcome: "missing-file", pool: name, clip };
  }

  const session = sessions.get(guildId);
  if (!session) return { outcome: "not-played", pool: name, clip };
  const played = await playClip(session.connection, guildId, pool, clipPath, {
    ...speaker,
    matched: matchedWords(text, match),
  });
  return { outcome: played ? "played" : "not-played", pool: name, clip };
}

/**
 * Handles one finished utterance: transcribe it, match it, play the clip, and
 * write the match to the server's trigger log whatever became of it.
 * @param guild - The server the speaker is in.
 * @param userId - Who spoke.
 * @param samples - The utterance as mono 16kHz float samples.
 * @param spokeUntil - When the speaker stopped, epoch ms, for timing the wait.
 */
async function handleUtterance(
  guild: Guild,
  userId: string,
  samples: Float32Array,
  spokeUntil: number,
): Promise<void> {
  const guildId = guild.id;
  const durationMs = Math.round((samples.length / TARGET_RATE) * 1000);
  const level = loudestWindowRms(samples);
  const verdict = utteranceVerdict(samples.length, level);
  if (verdict !== "keep") {
    // Logged with the length and level: a run of drops just under either floor
    // means it is eating words, and a run well under means it is doing its job.
    log.debug("utterance dropped", {
      guildId,
      userId,
      verdict,
      durationMs,
      level: Number(level.toFixed(4)),
    });
    return;
  }

  const transcript = await transcribe(samples);
  if (!transcript) return;
  const { text } = transcript;

  const compiled = loadSounds(guildId);
  if (compiled.config.logTranscripts) log.debug("heard", { guildId, userId, text });

  if (isIgnoredTranscript(text, compiled)) {
    log.debug("transcript ignored", { guildId, text });
    return;
  }

  const matches = matchTriggers(text, compiled);
  if (matches.length === 0) return;

  const heardAt = new Date();
  const userName = displayName(guild, userId);
  // A trigger heard less surely than its own floor drops out here. When every
  // one of them did, the row still names them, so the log shows what a floor
  // is holding back and whether it sits in the right place.
  const { sure, unsure } = weighMatches(text, matches, transcript.words);
  const named = sure.length > 0 ? sure : unsure;
  const matched = [...new Set(named.flatMap((match) => match.matched))];
  const confidence = matchConfidence(matched, transcript.words);
  const speaker: TriggerSpeaker = {
    userId,
    userName,
    matched,
    confidence,
    spokeUntil,
    transcribeMs: transcript.ms,
  };

  let result: MatchResult;
  if (sure.length > 0) {
    result = await playMatch(
      guildId,
      speaker,
      text,
      sure.map((match) => match.trigger),
      compiled.config.guildCooldownMs,
    );
  } else {
    const first = unsure[0]!.trigger;
    heldBack(guildId, speaker, "heard unsurely", {
      pool: poolName(first),
      needs: first.minConfidence,
    });
    result = { outcome: "low-confidence", pool: poolName(first), clip: "" };
  }
  void recordTrigger(guildId, {
    at: heardAt,
    userId,
    userName,
    heard: text,
    matched,
    confidence,
    ...result,
  });
}

/**
 * Captures one speaker until they stop talking, dispatching what has been
 * heard every {@link CHUNK_SAMPLES} along the way so a trigger inside a long
 * sentence fires while the sentence is still going.
 * @param session - The guild's live session.
 * @param guildId - Discord guild (server) ID.
 * @param userId - The speaker to capture.
 */
function captureSpeaker(session: Session, guildId: string, userId: string): void {
  const stream = session.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_END_MS },
  });

  let chunks: Float32Array[] = [];
  let total = 0;
  // Samples captured since the last cut. Anything else buffered is the overlap,
  // which the transcriber has already had, so a flush with nothing fresh would
  // be a repeat and is skipped.
  let fresh = 0;

  /**
   * Sends what has been captured so far for transcription and resets the buffer.
   * @param silenceMs - Quiet already waited out before this flush, backed out
   * of the timestamp so the wait is measured from the speaker's last word.
   * @param midSpeech - Whether the speaker is still going, in which case the
   * end of this chunk is carried into the next so a word on the cut is heard
   * whole.
   */
  const flush = (silenceMs: number, midSpeech: boolean): void => {
    if (fresh === 0) return;
    const samples = concatFloat32(chunks, total);
    // The buffer is handed to the worker outright, so the overlap has to be a
    // copy rather than a view of it.
    const tail = midSpeech ? samples.slice(-CHUNK_OVERLAP_SAMPLES) : null;
    chunks = tail ? [tail] : [];
    total = tail?.length ?? 0;
    fresh = 0;
    const spokeUntil = Date.now() - silenceMs;
    void handleUtterance(session.guild, userId, samples, spokeUntil).catch((err: unknown) => {
      log.warn("utterance handling failed", {
        guildId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  };

  stream.on("data", (packet: Buffer) => {
    if (isSilenceFrame(packet)) return;
    try {
      const pcm = session.decoder.decode(packet);
      const mono = downsampleToMono16k(pcmToInt16(pcm));
      chunks.push(mono);
      total += mono.length;
      fresh += mono.length;
      // Cut mid-speech rather than holding until silence: this is what lets a
      // word inside a sentence fire before the sentence ends. Flush and keep
      // listening rather than ending the stream, since destroying it would not
      // re-fire speaking.start for someone still talking. No silence has been
      // waited out at a cut.
      if (fresh >= CHUNK_SAMPLES) flush(0, true);
    } catch (err) {
      log.debug("opus decode failed", {
        guildId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  stream.once("end", () => {
    session.capturing.delete(userId);
    flush(SILENCE_END_MS, false);
  });

  stream.once("error", (err: Error) => {
    session.capturing.delete(userId);
    log.debug("receive stream error", { guildId, userId, error: err.message });
  });
}

/**
 * Joins a voice channel and starts listening.
 * @param channel - The channel to join.
 * @returns `true` when the session is live.
 */
export async function openSession(channel: VoiceBasedChannel): Promise<boolean> {
  const guildId = channel.guild.id;
  if (closedForShutdown) return false;
  if (sessions.has(guildId)) return true;

  const decoder = await loadOpusDecoder();
  // Checked again past the await, since shutdown can land while it loads.
  if (!decoder || closedForShutdown) return false;

  // Nothing arrives while deafened, and a server-deafened bot looks connected
  // and healthy while receiving silence, which is a miserable thing to debug.
  const self = channel.guild.members.me;
  if (self?.voice.serverDeaf) {
    log.warn("bot is server-deafened, cannot listen", { guildId, channelId: channel.id });
    return false;
  }

  startStt();

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  // The ready wait can be cut short: a kick or disable while connecting takes
  // effect at once instead of after a timeout that has the bot appear first.
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), READY_TIMEOUT_MS);
  pending.set(guildId, { channelId: channel.id, connection, abort });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, abort.signal);
  } catch {
    // Still pending means nothing else tore it down, so this was the timeout;
    // otherwise closeSession has already destroyed the connection.
    if (pending.has(guildId)) {
      log.warn("voice connection never became ready", { guildId, channelId: channel.id });
      connection.destroy();
    } else {
      log.info(
        "join cancelled before ready",
        { guildId, channel: channel.name },
        { channelId: channel.id },
      );
    }
    return false;
  } finally {
    clearTimeout(timeout);
    pending.delete(guildId);
  }

  const session: Session = {
    connection,
    channelId: channel.id,
    guild: channel.guild,
    decoder,
    capturing: new Set(),
  };
  sessions.set(guildId, session);
  connection.subscribe(getPlayer(guildId));
  startAmbient(guildId, connection);
  // Somebody's arrival is what brought the bot here, and this is the first
  // moment there is anything to play their clip through.
  void flushPendingEntrance(channel.guild, channel.id, connection);

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    // A disconnect is often a region move rather than a real drop, so give the
    // connection a moment to re-establish before tearing the session down.
    void Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
      entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
    ]).catch(() => closeSession(guildId, "disconnected"));
  });

  connection.receiver.speaking.on("start", (userId: string) => {
    if (channel.client.users.cache.get(userId)?.bot) return;
    // Ahead of the capture guards: someone's entrance should not depend on
    // whether there was room left to transcribe them, and announceEntrance
    // does nothing after the first time it fires for them today.
    void announceEntrance(channel.guild, userId);

    if (session.capturing.has(userId)) return;
    if (session.capturing.size >= MAX_CAPTURED_SPEAKERS) {
      log.debug("speaker not captured, already at the cap", {
        guildId,
        userId,
        capturing: session.capturing.size,
      });
      return;
    }
    session.capturing.add(userId);
    captureSpeaker(session, guildId, userId);
  });

  log.info("listening", { guildId, channel: channel.name }, { channelId: channel.id });
  return true;
}

/**
 * Leaves a channel and tears the session down.
 * @param guildId - Discord guild (server) ID.
 * @param reason - Why the session ended, for the log.
 */
export function closeSession(guildId: string, reason: string): void {
  // Whatever arrival was waiting on this connection is not getting its clip:
  // the call it was owed to is the one being left.
  forgetPendingEntrance(guildId);
  // A join in flight has no session yet, but the caller means it just the same.
  const joining = pending.get(guildId);
  if (joining) {
    pending.delete(guildId);
    joining.abort.abort();
    try {
      joining.connection.destroy();
    } catch {
      // Already destroyed; nothing to undo.
    }
    log.info("join cancelled", { guildId, reason }, { channelId: joining.channelId });
  }
  const session = sessions.get(guildId);
  if (!session) return;
  sessions.delete(guildId);
  stopAmbient(guildId);
  dropPlayer(guildId);
  try {
    session.connection.destroy();
  } catch {
    // Already destroyed; nothing to undo.
  }
  log.info("stopped listening", { guildId, reason });
}

/**
 * Reports which channel a guild's session is in.
 * @param guildId - Discord guild (server) ID.
 * @returns The channel ID, or null when there is no session.
 */
export function sessionChannelId(guildId: string): string | null {
  return sessions.get(guildId)?.channelId ?? null;
}

/**
 * Hands out a guild's live connection, so something outside this module can
 * play through it. Returned rather than the session itself: the capture state
 * is nobody else's business.
 * @param guildId - Discord guild (server) ID.
 * @returns The connection, or null when there is no live session.
 */
export function sessionConnection(guildId: string): VoiceConnection | null {
  return sessions.get(guildId)?.connection ?? null;
}

/**
 * Reports which channel a guild is connecting to, before the session exists.
 * @param guildId - Discord guild (server) ID.
 * @returns The channel ID, or null when no join is in flight.
 */
export function joiningChannelId(guildId: string): string | null {
  return pending.get(guildId)?.channelId ?? null;
}

/**
 * Counts live sessions across every guild.
 * @returns How many channels the bot is listening in.
 */
export function activeSessions(): number {
  return sessions.size;
}

/**
 * Closes every session and refuses new ones from then on, used on shutdown.
 * @param reason - Why they are closing, for the log.
 * @returns The guilds a leave was sent for, to wait on with
 * {@link waitForVoiceLeave}.
 */
export function closeAllSessions(reason: string): string[] {
  closedForShutdown = true;
  const guildIds = [...new Set([...sessions.keys(), ...pending.keys()])];
  for (const guildId of guildIds) closeSession(guildId, reason);
  return guildIds;
}

/**
 * Longest shutdown waits for Discord to confirm a voice leave. A confirmation
 * normally lands within a few hundred ms, and Docker allows 10s after SIGTERM
 * before it kills the process, so this leaves the rest of that for the gateway
 * to close cleanly.
 */
export const VOICE_LEAVE_TIMEOUT_MS = 3_000;

/**
 * Waits for Discord to confirm the bot has left voice in each guild given.
 *
 * Destroying a connection only queues the leave on the gateway: discord.js
 * sends a voice state update asynchronously, behind its send queue, so a
 * process that exits straight after never writes it, and Discord shows the bot
 * sitting in the channel until the session times out. Confirmation is the bot's
 * own voice state coming back with no channel.
 * @param client - The logged-in client.
 * @param guildIds - Guilds a leave was sent for.
 * @param timeoutMs - How long to wait before giving up on the rest.
 * @returns The guilds still showing the bot in voice when it gave up, empty
 * when every leave was confirmed.
 */
export function waitForVoiceLeave(
  client: Client,
  guildIds: string[],
  timeoutMs: number,
): Promise<string[]> {
  const stillIn = (guildId: string): boolean =>
    Boolean(client.guilds.cache.get(guildId)?.members.me?.voice.channelId);
  const waiting = new Set(guildIds.filter(stillIn));
  if (waiting.size === 0) return Promise.resolve([]);

  return new Promise((resolve) => {
    const settle = (): void => {
      clearTimeout(timer);
      client.off("voiceStateUpdate", onUpdate);
      resolve([...waiting]);
    };
    const onUpdate = (_old: VoiceState, next: VoiceState): void => {
      if (next.id !== client.user?.id || stillIn(next.guild.id)) return;
      waiting.delete(next.guild.id);
      if (waiting.size === 0) settle();
    };
    // Registered before anything can yield, so a confirmation that arrives
    // straight away is not missed.
    client.on("voiceStateUpdate", onUpdate);
    const timer = setTimeout(settle, timeoutMs);
  });
}
