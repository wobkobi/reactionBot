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
 * Minimum gap between clips drawn from the same pool, and the default a trigger
 * takes when neither it nor the config names one. Long enough that a word said
 * on repeat earns one clip rather than a barrage.
 *
 * Per pool rather than per guild: two triggers pointing at different sounds are
 * different jokes, and one firing is no reason to swallow the other. Triggers
 * sharing a pool do share the gap, since they play the same clips and a
 * listener cannot tell which of them fired.
 */
export const POOL_CLIP_COOLDOWN_MS = 30_000;

/**
 * Shortest gap between any two clips in a guild, whatever pools they came from.
 * The per-pool gap alone would let a run of different triggers fire back to
 * back, which is the same barrage arriving from a different direction.
 */
export const GUILD_CLIP_FLOOR_MS = 5_000;

/** Stream type to declare for each container that plays without transcoding. */
const STREAM_TYPES: Record<OpusContainer, StreamType> = {
  "ogg/opus": StreamType.OggOpus,
  "webm/opus": StreamType.WebmOpus,
};

const players = new Map<string, AudioPlayer>();
const lastPoolClip = new Map<string, number>();
const lastGuildClip = new Map<string, number>();

/** Why a trigger did or did not earn a clip. */
export type ClipVerdict = "play" | "playing" | "pool-cooldown" | "guild-floor";

/**
 * Decides whether a trigger earns a clip right now, and names what stopped
 * it when it does not. All three refusals look the same from outside - no
 * sound - so a caller told only "no" can never say which gap swallowed a clip.
 * @param playing - Whether a clip is already playing in the guild.
 * @param sincePoolMs - Time since this pool's last clip.
 * @param sinceGuildMs - Time since any clip in the guild.
 * @param poolCooldownMs - Minimum gap for the pool.
 * @param guildFloorMs - Shortest gap between any two clips.
 * @returns `"play"` when the clip should play, otherwise the reason it did not.
 */
export function clipVerdict(
  playing: boolean,
  sincePoolMs: number,
  sinceGuildMs: number,
  poolCooldownMs: number,
  guildFloorMs: number,
): ClipVerdict {
  if (playing) return "playing";
  if (sincePoolMs < poolCooldownMs) return "pool-cooldown";
  if (sinceGuildMs < guildFloorMs) return "guild-floor";
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
 * @param pool - Key of the pool the trigger draws from.
 * @param poolCooldownMs - Minimum gap for that pool.
 * @returns The verdict from {@link clipVerdict}, with the milliseconds left on
 * whichever gap refused it; 0 for every other verdict.
 */
export function clipStatus(
  guildId: string,
  pool: string,
  poolCooldownMs: number,
): { verdict: ClipVerdict; remainingMs: number } {
  const now = Date.now();
  const sincePoolMs = now - (lastPoolClip.get(`${guildId}:${pool}`) ?? 0);
  const sinceGuildMs = now - (lastGuildClip.get(guildId) ?? 0);
  const verdict = clipVerdict(
    isPlaying(guildId),
    sincePoolMs,
    sinceGuildMs,
    poolCooldownMs,
    GUILD_CLIP_FLOOR_MS,
  );
  if (verdict === "pool-cooldown") return { verdict, remainingMs: poolCooldownMs - sincePoolMs };
  if (verdict === "guild-floor") {
    return { verdict, remainingMs: GUILD_CLIP_FLOOR_MS - sinceGuildMs };
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
 * Plays a clip fired by something someone said, and records it against its
 * pool's gap and the guild floor.
 * @param connection - The guild's live voice connection.
 * @param guildId - Discord guild (server) ID.
 * @param pool - Key of the pool it came from, which holds its own gap.
 * @param filePath - Absolute path of the clip to play.
 * @returns `true` when playback started.
 */
export async function playClip(
  connection: VoiceConnection,
  guildId: string,
  pool: string,
  filePath: string,
): Promise<boolean> {
  const started = await startPlayback(connection, guildId, filePath, TRIGGER_LUFS);
  if (!started) return false;
  const now = Date.now();
  lastPoolClip.set(`${guildId}:${pool}`, now);
  lastGuildClip.set(guildId, now);
  return true;
}

/**
 * Plays someone's entrance as they arrive. Loud as a trigger, since it is a
 * deliberate sound rather than atmosphere, but it leaves the cooldowns alone
 * like an ambient one: it fires at most once a day per person, so it cannot be
 * spammed, and letting it block the next real trigger for a whole cooldown
 * would punish the room for somebody else walking in.
 * @param connection - The guild's live voice connection.
 * @param guildId - Discord guild (server) ID.
 * @param filePath - Absolute path of the clip to play.
 * @returns `true` when playback started.
 */
export async function playEntrance(
  connection: VoiceConnection,
  guildId: string,
  filePath: string,
): Promise<boolean> {
  return startPlayback(connection, guildId, filePath, TRIGGER_LUFS);
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
