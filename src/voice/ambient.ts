// src/voice/ambient.ts

// Occasional unprompted sounds while the bot is sitting in a voice channel.
//
// The gap is re-rolled from the configured range after every play rather than
// set once, so the timing never settles into a rhythm someone can anticipate.
// The timer lives as long as the session does and is unref'd, so an idle bot
// waiting out a twenty minute gap never keeps the process alive on its own.

import { isCalm } from "@/tracking/calm";
import { createLogger } from "@/utils/log";
import { isPlaying, playAmbient } from "@/voice/playback";
import {
  loadSounds,
  nextAmbientDelay,
  pickClip,
  resolveClipPath,
  resolveClips,
} from "@/voice/sounds";
import type { VoiceConnection } from "@discordjs/voice";

const log = createLogger("voice/ambient");

/** The pending timer per guild, so a session can cancel its own. */
const timers = new Map<string, NodeJS.Timeout>();

/**
 * Guilds whose ambient loop should keep going. Separate from the timer map
 * because there is no timer pending while a sound is playing, and stopping
 * during one has to be noticed when the loop comes to re-arm itself.
 */
const active = new Set<string>();

/**
 * Schedules the next ambient sound for a guild, replacing any timer already
 * pending.
 * @param guildId - Discord guild (server) ID.
 * @param connection - The guild's live voice connection.
 */
function arm(guildId: string, connection: VoiceConnection): void {
  if (!active.has(guildId)) return;

  // Read the config each time rather than closing over it, so editing the
  // range or the pool takes effect from the next sound without a restart.
  const ambient = loadSounds(guildId).ambient;
  if (!ambient) {
    stopAmbient(guildId);
    return;
  }

  const delay = nextAmbientDelay(ambient.minMs, ambient.maxMs, Math.random());
  const timer = setTimeout(() => {
    timers.delete(guildId);
    void fire(guildId, connection).finally(() => arm(guildId, connection));
  }, delay);
  timer.unref();
  timers.set(guildId, timer);
  log.debug("ambient armed", { guildId, delayMs: delay });
}

/**
 * Plays one ambient sound, unless something says not to right now.
 * @param guildId - Discord guild (server) ID.
 * @param connection - The guild's live voice connection.
 */
async function fire(guildId: string, connection: VoiceConnection): Promise<void> {
  const ambient = loadSounds(guildId).ambient;
  if (!ambient) return;

  // Calm mode silences everything the bot says; an ambient sound is the least
  // defensible thing to keep making during it.
  if (isCalm(guildId)) {
    log.debug("ambient skipped, calm mode", { guildId });
    return;
  }

  // Never stack on a clip already playing. A trigger someone earned matters
  // more than the timer, and the gap is long enough that skipping costs little.
  if (isPlaying(guildId)) {
    log.debug("ambient skipped, already playing", { guildId });
    return;
  }

  const clips = resolveClips(guildId, ambient.source);
  if (clips.length === 0) {
    log.warn("ambient pool holds no clips", { guildId });
    return;
  }
  const name = pickClip(clips, Math.floor(Math.random() * clips.length));
  if (!name) return;
  const clipPath = resolveClipPath(guildId, name);
  if (!clipPath) {
    log.warn("ambient clip is missing on disk", { guildId, clip: name });
    return;
  }

  await playAmbient(connection, guildId, clipPath);
}

/**
 * Starts ambient playback for a guild. A no-op when the guild has no ambient
 * block configured.
 * @param guildId - Discord guild (server) ID.
 * @param connection - The guild's live voice connection.
 */
export function startAmbient(guildId: string, connection: VoiceConnection): void {
  stopAmbient(guildId);
  const ambient = loadSounds(guildId).ambient;
  if (!ambient) return;
  active.add(guildId);
  log.info("ambient sounds on", {
    guildId,
    clips: resolveClips(guildId, ambient.source).length,
    everyMs: `${ambient.minMs}-${ambient.maxMs}`,
  });
  arm(guildId, connection);
}

/**
 * Stops ambient playback for a guild.
 * @param guildId - Discord guild (server) ID.
 */
export function stopAmbient(guildId: string): void {
  active.delete(guildId);
  const timer = timers.get(guildId);
  if (!timer) return;
  clearTimeout(timer);
  timers.delete(guildId);
}

/**
 * Whether a guild currently has an ambient sound scheduled.
 * @param guildId - Discord guild (server) ID.
 * @returns `true` while a timer is pending.
 */
export function ambientRunning(guildId: string): boolean {
  return active.has(guildId);
}
