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
import { createLogger } from "@/utils/log";
import { startAmbient, stopAmbient } from "@/voice/ambient";
import {
  CHUNK_OVERLAP_SAMPLES,
  CHUNK_SAMPLES,
  concatFloat32,
  downsampleToMono16k,
  isSilenceFrame,
  pcmToInt16,
  rms,
  TARGET_RATE,
  utteranceVerdict,
} from "@/voice/audio";
import { announceEntrance } from "@/voice/entrance";
import { loadOpusDecoder, type OpusDecoder } from "@/voice/opus";
import {
  clipStatus,
  dropPlayer,
  getPlayer,
  playClip,
  POOL_CLIP_COOLDOWN_MS,
} from "@/voice/playback";
import {
  isIgnoredTranscript,
  loadSounds,
  matchTrigger,
  pickClip,
  poolKey,
  resolveClipPath,
  resolveClips,
} from "@/voice/sounds";
import { startStt, transcribe } from "@/voice/stt";
import {
  EndBehaviorType,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
  type VoiceConnection,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";

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
  decoder: OpusDecoder;
  capturing: Set<string>;
}

const sessions = new Map<string, Session>();

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

/**
 * Handles one finished utterance: transcribe it, match it, and play the clip.
 * @param guildId - Discord guild (server) ID.
 * @param userId - Who spoke.
 * @param samples - The utterance as mono 16kHz float samples.
 * @param spokeUntil - When the speaker stopped, epoch ms, for timing the wait.
 */
async function handleUtterance(
  guildId: string,
  userId: string,
  samples: Float32Array,
  spokeUntil: number,
): Promise<void> {
  const durationMs = Math.round((samples.length / TARGET_RATE) * 1000);
  const verdict = utteranceVerdict(samples.length, rms(samples));
  if (verdict !== "keep") {
    // Logged with the length: a run of drops just under the floor means the
    // floor is eating words, and a run well under it means it is doing its job.
    log.debug("utterance dropped", { guildId, userId, verdict, durationMs });
    return;
  }

  const text = await transcribe(samples);
  if (!text) return;

  const compiled = loadSounds(guildId);
  if (compiled.config.logTranscripts) log.debug("heard", { guildId, userId, text });

  if (isIgnoredTranscript(text, compiled)) {
    log.debug("transcript ignored", { guildId, text });
    return;
  }

  const match = matchTrigger(text, compiled);
  if (!match) return;

  // Calm mode silences replies across the bot; a sound bite is a reply that
  // everyone in the call has to hear, so it obeys the same window.
  if (isCalm(guildId)) {
    log.debug("clip suppressed by calm mode", { guildId });
    return;
  }

  const cooldownMs = match.cooldownMs ?? compiled.config.guildCooldownMs ?? POOL_CLIP_COOLDOWN_MS;
  const pool = poolKey(match.source);
  // Named rather than destructured: utteranceVerdict already owns `verdict`
  // in this scope.
  const gate = clipStatus(guildId, pool, cooldownMs);
  if (gate.verdict !== "play") {
    log.debug("clip not played", {
      guildId,
      userId,
      pool,
      verdict: gate.verdict,
      remainingMs: gate.remainingMs,
    });
    return;
  }

  const clips = resolveClips(guildId, match.source);
  if (clips.length === 0) {
    log.warn("trigger matched but its pool holds no clips", {
      guildId,
      pool: match.trigger.pool ?? "(inline)",
    });
    return;
  }
  const name = pickClip(clips, Math.floor(Math.random() * clips.length));
  if (!name) return;
  const clipPath = resolveClipPath(guildId, name);
  if (!clipPath) {
    log.warn("configured clip is missing on disk", { guildId, clip: name });
    return;
  }

  const session = sessions.get(guildId);
  if (!session) return;
  if (!(await playClip(session.connection, guildId, pool, clipPath))) return;
  // Timed from the last word rather than from the flush, so the number is the
  // one someone in the call actually waited through.
  log.debug("clip latency", {
    guildId,
    pool,
    durationMs,
    waitedMs: Date.now() - spokeUntil,
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
    void handleUtterance(guildId, userId, samples, spokeUntil).catch((err: unknown) => {
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
  if (sessions.has(guildId)) return true;

  const decoder = await loadOpusDecoder();
  if (!decoder) return false;

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
      log.info("join cancelled before ready", { guildId, channelId: channel.id });
    }
    return false;
  } finally {
    clearTimeout(timeout);
    pending.delete(guildId);
  }

  const session: Session = { connection, channelId: channel.id, decoder, capturing: new Set() };
  sessions.set(guildId, session);
  connection.subscribe(getPlayer(guildId));
  startAmbient(guildId, connection);

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

  log.info("listening", { guildId, channelId: channel.id });
  return true;
}

/**
 * Leaves a channel and tears the session down.
 * @param guildId - Discord guild (server) ID.
 * @param reason - Why the session ended, for the log.
 */
export function closeSession(guildId: string, reason: string): void {
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
    log.info("join cancelled", { guildId, channelId: joining.channelId, reason });
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
 * Closes every session, used on shutdown.
 * @param reason - Why they are closing, for the log.
 */
export function closeAllSessions(reason: string): void {
  for (const guildId of new Set([...sessions.keys(), ...pending.keys()])) {
    closeSession(guildId, reason);
  }
}
