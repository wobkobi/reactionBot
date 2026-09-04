// src/voice/session.ts

// One capture session per guild: hold the connection, turn each speaker's Opus
// stream into utterances, transcribe them, and fire a clip when one matches.
//
// Utterance boundaries come from Discord's own silence detection rather than a
// voice activity detector: subscribing with AfterSilence ends the stream once
// someone stops talking, which is exactly the boundary a transcript wants.

import { isCalm } from "@/tracking/calm";
import { createLogger } from "@/utils/log";
import {
  concatFloat32,
  downsampleToMono16k,
  isSilenceFrame,
  MAX_UTTERANCE_SAMPLES,
  pcmToInt16,
  rms,
  utteranceVerdict,
} from "@/voice/audio";
import { loadOpusDecoder, type OpusDecoder } from "@/voice/opus";
import { clipAllowed, dropPlayer, getPlayer, playClip } from "@/voice/playback";
import {
  isIgnoredTranscript,
  loadSounds,
  matchTrigger,
  pickClip,
  resolveClipPath,
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

/** Silence that ends an utterance. Long enough to survive a pause mid-sentence. */
export const SILENCE_END_MS = 800;

/** How long to wait for a connection to become usable. */
const READY_TIMEOUT_MS = 20_000;

/** Speakers captured at once in one channel, so a busy call cannot swamp the queue. */
export const MAX_CAPTURED_SPEAKERS = 8;

/** Default gap between clips when the config does not say. */
const DEFAULT_GUILD_COOLDOWN_MS = 8_000;

/** A live capture session. */
interface Session {
  connection: VoiceConnection;
  channelId: string;
  decoder: OpusDecoder;
  capturing: Set<string>;
}

const sessions = new Map<string, Session>();

/**
 * Handles one finished utterance: transcribe it, match it, and play the clip.
 * @param guildId - Discord guild (server) ID.
 * @param userId - Who spoke.
 * @param samples - The utterance as mono 16kHz float samples.
 */
async function handleUtterance(
  guildId: string,
  userId: string,
  samples: Float32Array,
): Promise<void> {
  const verdict = utteranceVerdict(samples.length, rms(samples));
  if (verdict !== "keep") {
    log.debug("utterance dropped", { guildId, userId, verdict });
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

  const cooldownMs =
    match.cooldownMs ?? compiled.config.guildCooldownMs ?? DEFAULT_GUILD_COOLDOWN_MS;
  if (!clipAllowed(guildId, userId, cooldownMs)) {
    log.debug("clip on cooldown or already playing", { guildId, userId });
    return;
  }

  const name = pickClip(match.files, Math.floor(Math.random() * match.files.length));
  if (!name) return;
  const clipPath = resolveClipPath(guildId, name);
  if (!clipPath) {
    log.warn("configured clip is missing on disk", { guildId, clip: name });
    return;
  }

  const session = sessions.get(guildId);
  if (!session) return;
  await playClip(session.connection, guildId, userId, clipPath);
}

/**
 * Captures one speaker until they stop talking, then dispatches the utterance.
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

  /**
   * Sends what has been captured so far for transcription and resets the buffer.
   */
  const flush = (): void => {
    if (total === 0) return;
    const samples = concatFloat32(chunks, total);
    chunks = [];
    total = 0;
    void handleUtterance(guildId, userId, samples).catch((err: unknown) => {
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
      // Flush and keep listening rather than ending the stream: destroying it
      // would not re-fire speaking.start for someone still mid-sentence.
      if (total >= MAX_UTTERANCE_SAMPLES) flush();
    } catch (err) {
      log.debug("opus decode failed", {
        guildId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  stream.once("end", () => {
    session.capturing.delete(userId);
    flush();
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

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
  } catch {
    log.warn("voice connection never became ready", { guildId, channelId: channel.id });
    connection.destroy();
    return false;
  }

  const session: Session = { connection, channelId: channel.id, decoder, capturing: new Set() };
  sessions.set(guildId, session);
  connection.subscribe(getPlayer(guildId));

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    // A disconnect is often a region move rather than a real drop, so give the
    // connection a moment to re-establish before tearing the session down.
    void Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
      entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
    ]).catch(() => closeSession(guildId, "disconnected"));
  });

  connection.receiver.speaking.on("start", (userId: string) => {
    if (session.capturing.has(userId)) return;
    if (session.capturing.size >= MAX_CAPTURED_SPEAKERS) return;
    if (channel.client.users.cache.get(userId)?.bot) return;
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
  const session = sessions.get(guildId);
  if (!session) return;
  sessions.delete(guildId);
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
  for (const guildId of [...sessions.keys()]) closeSession(guildId, reason);
}
