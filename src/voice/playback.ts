// src/voice/playback.ts

// Clip playback: one audio player per guild, plus the cooldowns that decide
// whether a trigger actually earns a sound.
//
// A trigger that fires while a clip is already playing is dropped rather than
// queued. The joke is time-relative, so a clip that arrives after the moment
// has passed is worse than no clip, and a queue would be a second unbounded
// buffer to police.

import { createLogger } from "@/utils/log";
import { AMBIENT_LUFS, ensurePlayable, TRIGGER_LUFS, type OpusContainer } from "@/voice/transcode";
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

/**
 * Minimum gap between clips in one guild, and the default a trigger takes when
 * neither it nor the config names one. Long enough that a word said on repeat
 * earns one clip rather than a barrage, which is the whole point of having it:
 * the gap is what stops a trigger being worth spamming.
 */
export const GUILD_CLIP_COOLDOWN_MS = 30_000;

/** Minimum gap between clips triggered by the same speaker. */
export const USER_CLIP_COOLDOWN_MS = 20_000;

/** Stream type to declare for each container that plays without transcoding. */
const STREAM_TYPES: Record<OpusContainer, StreamType> = {
  "ogg/opus": StreamType.OggOpus,
  "webm/opus": StreamType.WebmOpus,
};

const players = new Map<string, AudioPlayer>();
const lastGuildClip = new Map<string, number>();
const lastUserClip = new Map<string, number>();

/** Why a trigger did or did not earn a clip. */
export type ClipVerdict = "play" | "playing" | "guild-cooldown" | "user-cooldown";

/**
 * Decides whether a trigger earns a clip right now, and names what stopped
 * it when it does not. All three refusals look the same from outside - no
 * sound - so a caller told only "no" can never say which gap swallowed a clip.
 * @param playing - Whether a clip is already playing in the guild.
 * @param sinceGuildMs - Time since the guild's last clip.
 * @param sinceUserMs - Time since this speaker's last clip.
 * @param guildCooldownMs - Minimum gap for the guild.
 * @param userCooldownMs - Minimum gap for the speaker.
 * @returns `"play"` when the clip should play, otherwise the reason it did not.
 */
export function clipVerdict(
  playing: boolean,
  sinceGuildMs: number,
  sinceUserMs: number,
  guildCooldownMs: number,
  userCooldownMs: number,
): ClipVerdict {
  if (playing) return "playing";
  if (sinceGuildMs < guildCooldownMs) return "guild-cooldown";
  if (sinceUserMs < userCooldownMs) return "user-cooldown";
  return "play";
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
 * Applies both cooldowns and the busy check for a would-be trigger, and says
 * how much of a cooldown is left, so a refusal in the log reads as a gap with
 * a length rather than as the bot ignoring someone.
 * @param guildId - Discord guild (server) ID.
 * @param userId - Speaker who said the trigger.
 * @param guildCooldownMs - Minimum gap for the guild.
 * @returns The verdict from {@link clipVerdict}, with the milliseconds left on
 * whichever cooldown refused it; 0 for every other verdict.
 */
export function clipStatus(
  guildId: string,
  userId: string,
  guildCooldownMs: number,
): { verdict: ClipVerdict; remainingMs: number } {
  const now = Date.now();
  const sinceGuildMs = now - (lastGuildClip.get(guildId) ?? 0);
  const sinceUserMs = now - (lastUserClip.get(`${guildId}:${userId}`) ?? 0);
  const verdict = clipVerdict(
    isPlaying(guildId),
    sinceGuildMs,
    sinceUserMs,
    guildCooldownMs,
    USER_CLIP_COOLDOWN_MS,
  );
  if (verdict === "guild-cooldown") return { verdict, remainingMs: guildCooldownMs - sinceGuildMs };
  if (verdict === "user-cooldown") {
    return { verdict, remainingMs: USER_CLIP_COOLDOWN_MS - sinceUserMs };
  }
  return { verdict, remainingMs: 0 };
}

/**
 * Starts a file playing, with none of the bookkeeping that decides whether it
 * should have been allowed to.
 * @param connection - The guild's live voice connection.
 * @param guildId - Discord guild (server) ID.
 * @param filePath - Absolute path of the clip to play.
 * @param targetLufs - Integrated loudness to normalise it to, in LUFS.
 * @returns `true` when playback started.
 */
async function startPlayback(
  connection: VoiceConnection,
  guildId: string,
  filePath: string,
  targetLufs: number,
): Promise<boolean> {
  const playable = await ensurePlayable(filePath, targetLufs).catch((err: unknown) => {
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
    // Both containers demux straight to Opus packets, so playback needs no
    // encoder and no inline volume, which would force a PCM transcode on every
    // play. Loudness is normalised into the cached file instead, so levelling a
    // clip costs one conversion rather than one decode per play.
    player.play(
      createAudioResource(fs.createReadStream(playable.path), {
        inputType: STREAM_TYPES[playable.container],
      }),
    );
    log.info("playing clip", { guildId, clip: filePath, container: playable.container });
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

/**
 * Plays a clip fired by something someone said, and records it against both
 * cooldowns.
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
  const started = await startPlayback(connection, guildId, filePath, TRIGGER_LUFS);
  if (!started) return false;
  const now = Date.now();
  lastGuildClip.set(guildId, now);
  lastUserClip.set(`${guildId}:${userId}`, now);
  return true;
}

/**
 * Plays an unprompted ambient sound. Deliberately leaves the cooldowns alone:
 * they exist to stop people spamming triggers, and an ambient sound blocking
 * the next real trigger for the whole cooldown would be the wrong trade.
 * @param connection - The guild's live voice connection.
 * @param guildId - Discord guild (server) ID.
 * @param filePath - Absolute path of the clip to play.
 * @returns `true` when playback started.
 */
export async function playAmbient(
  connection: VoiceConnection,
  guildId: string,
  filePath: string,
): Promise<boolean> {
  return startPlayback(connection, guildId, filePath, AMBIENT_LUFS);
}
