// src/voice/playback.ts

// Clip playback: one audio player per guild, plus the cooldowns that decide
// whether a trigger actually earns a sound.
//
// A trigger that fires while a clip is already playing is dropped rather than
// queued. The joke is time-relative, so a clip that arrives after the moment
// has passed is worse than no clip, and a queue would be a second unbounded
// buffer to police.

import { createLogger } from "@/utils/log";
import { ensurePlayableOgg } from "@/voice/transcode";
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import fs from "node:fs";

const log = createLogger("voice/playback");

/** Minimum gap between clips in one guild. */
export const GUILD_CLIP_COOLDOWN_MS = 8_000;

/** Minimum gap between clips triggered by the same speaker. */
export const USER_CLIP_COOLDOWN_MS = 20_000;

const players = new Map<string, AudioPlayer>();
const lastGuildClip = new Map<string, number>();
const lastUserClip = new Map<string, number>();

/**
 * Decides whether a trigger earns a clip right now.
 * @param playing - Whether a clip is already playing in the guild.
 * @param sinceGuildMs - Time since the guild's last clip.
 * @param sinceUserMs - Time since this speaker's last clip.
 * @param guildCooldownMs - Minimum gap for the guild.
 * @param userCooldownMs - Minimum gap for the speaker.
 * @returns `true` when the clip should play.
 */
export function shouldPlay(
  playing: boolean,
  sinceGuildMs: number,
  sinceUserMs: number,
  guildCooldownMs: number,
  userCooldownMs: number,
): boolean {
  if (playing) return false;
  if (sinceGuildMs < guildCooldownMs) return false;
  if (sinceUserMs < userCooldownMs) return false;
  return true;
}

/**
 * Returns the guild's audio player, creating it on first use.
 * @param guildId - Discord guild (server) ID.
 * @returns The player for that guild.
 */
export function getPlayer(guildId: string): AudioPlayer {
  const existing = players.get(guildId);
  if (existing) return existing;
  const player = createAudioPlayer({
    // Stop rather than buffer when nobody is listening: the bot is alone in the
    // channel at that point and the clip is already pointless.
    behaviors: { noSubscriber: NoSubscriberBehavior.Stop },
  });
  player.on("error", (err) => {
    log.warn("audio player error", { guildId, error: err.message });
  });
  players.set(guildId, player);
  return player;
}

/**
 * Whether a clip is currently playing in a guild.
 * @param guildId - Discord guild (server) ID.
 * @returns `true` while a clip is playing or buffering.
 */
export function isPlaying(guildId: string): boolean {
  const player = players.get(guildId);
  if (!player) return false;
  return player.state.status !== AudioPlayerStatus.Idle;
}

/**
 * Applies both cooldowns and the busy check for a would-be trigger.
 * @param guildId - Discord guild (server) ID.
 * @param userId - Speaker who said the trigger.
 * @param guildCooldownMs - Minimum gap for the guild.
 * @returns `true` when a clip may play now.
 */
export function clipAllowed(guildId: string, userId: string, guildCooldownMs: number): boolean {
  const now = Date.now();
  return shouldPlay(
    isPlaying(guildId),
    now - (lastGuildClip.get(guildId) ?? 0),
    now - (lastUserClip.get(`${guildId}:${userId}`) ?? 0),
    guildCooldownMs,
    USER_CLIP_COOLDOWN_MS,
  );
}

/**
 * Plays one clip into a connection.
 * @param connection - The guild's live voice connection.
 * @param guildId - Discord guild (server) ID.
 * @param userId - Speaker who triggered it, for the per-user cooldown.
 * @param filePath - Absolute path of the clip to play.
 * @returns `true` when playback started.
 */
export async function playClip(
  connection: VoiceConnection,
  guildId: string,
  userId: string,
  filePath: string,
): Promise<boolean> {
  const playable = await ensurePlayableOgg(filePath).catch((err: unknown) => {
    log.warn("could not prepare clip", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  if (!playable) return false;

  try {
    const player = getPlayer(guildId);
    connection.subscribe(player);
    // Ogg Opus passes straight through, so playback needs no encoder and no
    // inline volume (which would force a PCM transcode); clip loudness is
    // normalised at conversion time instead.
    player.play(
      createAudioResource(fs.createReadStream(playable), { inputType: StreamType.OggOpus }),
    );
    const now = Date.now();
    lastGuildClip.set(guildId, now);
    lastUserClip.set(`${guildId}:${userId}`, now);
    log.info("playing clip", { guildId, userId, clip: filePath });
    return true;
  } catch (err) {
    log.warn("failed to start playback", {
      guildId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Forgets a guild's player, used when its session closes.
 * @param guildId - Discord guild (server) ID.
 */
export function dropPlayer(guildId: string): void {
  const player = players.get(guildId);
  player?.stop(true);
  players.delete(guildId);
}
