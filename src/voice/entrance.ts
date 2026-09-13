// src/voice/entrance.ts

// Someone's entrance: a clip played as they arrive, and a post dropped in a
// text channel. Both fire at most once a day per person, and they are counted
// separately because they hang off different moments.
//
// The post waits until the bot hears them speak. Joining a channel is cheap to
// fake and says nothing, whereas being heard means they turned up and started
// talking. The clip cannot wait for that - a sound played a minute after
// someone walked in is not an entrance - so it goes on the join itself.
//
// Either way the bot has to be connected to the channel: it neither hears nor
// plays anything in a call it is not in. A join into an empty channel is what
// brings it there, so that case is held as a pending clip and played once the
// connection is ready - see noteJoin and flushPendingEntrance.

import { isCalm } from "@/tracking/calm";
import { guildDataDir, loadData, saveData } from "@/utils/file";
import { createLogger } from "@/utils/log";
import { playEntrance } from "@/voice/playback";
// safeClipName does the same job here as it does for clips: a name out of a
// hand-edited config reaching the filesystem. Shared rather than copied, since
// a path-traversal guard is the last thing that should exist twice and drift.
import {
  loadSounds,
  pickOne,
  resolveClipPath,
  resolveClips,
  safeClipName,
  type EntrancesConfig,
} from "@/voice/sounds";
import type { VoiceConnection } from "@discordjs/voice";
import { ChannelType, PermissionFlagsBits, type Guild } from "discord.js";
import fs from "node:fs";
import path from "node:path";

const log = createLogger("voice/entrance");

/** Where the last day each person was announced is kept, per guild. */
export const ENTRANCE_STATE_FILE = "entrances_seen.json";

/** Folder holding entrance files, under a guild's data dir or the shared root. */
export const ENTRANCES_DIR = "entrances";

/** What someone's entrance consists of. At least one field is set. */
export interface EntrancePost {
  /** Text to send, if the entrance has any. */
  message?: string;
  /** File to attach, as named in the config, if the entrance has one. */
  file?: string;
  /** Clip pool to play on arrival, if the entrance has one. */
  pool?: string;
}

/** Which halves of someone's entrance have fired, and on what day. */
interface EntranceDays {
  /** Day the text post last went out. */
  post?: string;
  /** Day the clip last played. */
  sound?: string;
}

/** Which half fired. The two are counted apart because they fire on different moments. */
export type EntranceHalf = "post" | "sound";

/** What each user has had today, keyed by user ID. */
type EntranceState = Record<string, EntranceDays>;

/**
 * The day each user was last announced, per guild. Held in memory because the
 * check runs on every burst of speech from everyone in the call, and read back
 * from disk only the first time a guild is seen.
 */
const state = new Map<string, EntranceState>();

/**
 * The guild's entrances, which live inside its sounds config so voice has one
 * file rather than two. Cached and reloaded on edit by {@link loadSounds}.
 * @param guildId - Discord guild (server) ID.
 * @returns The entrances block, empty when the config has none.
 */
function entrancesOf(guildId: string): EntrancesConfig {
  return loadSounds(guildId).config.entrances ?? {};
}

/**
 * Names the local calendar day, which is what "once a day" is measured in.
 * Built from the local parts rather than `toISOString`, which would roll over
 * at UTC midnight and give a server in a different timezone its fresh day
 * somewhere in the middle of the evening.
 * @param now - The moment to name.
 * @returns The day as `YYYY-MM-DD`.
 */
export function localDay(now: Date): string {
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Finds the entrance configured for one person.
 * @param config - The guild's entrances config.
 * @param userId - Who was heard.
 * @returns What to post, or null when they have no entrance. An entry with
 * neither text nor file is treated as having none, so emptying both switches
 * one off without deleting who it was for.
 */
export function entranceFor(config: EntrancesConfig, userId: string): EntrancePost | null {
  const entry = (config.list ?? []).find((e) => (e.users ?? []).includes(userId));
  if (!entry) return null;
  const message = entry.message?.trim();
  const file = entry.file?.trim();
  const pool = entry.pool?.trim();
  if (!message && !file && !pool) return null;
  const post: EntrancePost = {};
  if (message) post.message = message;
  if (file) post.file = file;
  if (pool) post.pool = pool;
  return post;
}

/**
 * Resolves an entrance file to a path on disk, preferring a guild's own copy
 * over the shared folder so one server can swap a file without touching the
 * rest.
 * @param guildId - Discord guild (server) ID.
 * @param name - File name from the config.
 * @returns An absolute path to an existing file, or null.
 */
export function resolveEntranceFile(guildId: string, name: string): string | null {
  const safe = safeClipName(name);
  if (!safe) return null;
  const candidates = [
    path.join(guildDataDir(guildId), ENTRANCES_DIR, safe),
    path.join(guildDataDir(ENTRANCES_DIR), safe),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * Reads a guild's announcement state, pulling it off disk the first time.
 * @param guildId - Discord guild (server) ID.
 * @returns The day each user was last announced.
 */
function stateFor(guildId: string): EntranceState {
  const held = state.get(guildId);
  if (held) return held;
  const loaded = loadData<Record<string, EntranceDays | string>>(guildId, ENTRANCE_STATE_FILE, {
    soft: true,
    defaultValue: {},
  });
  // An earlier build stored a bare day string per user, when the post was the
  // only half there was. Read as the post's day rather than discarded, so an
  // upgrade cannot hand everyone a second entrance on the day it lands.
  const normalised: EntranceState = {};
  for (const [id, value] of Object.entries(loaded)) {
    normalised[id] = typeof value === "string" ? { post: value } : value;
  }
  state.set(guildId, normalised);
  return normalised;
}

/**
 * Claims today's entrance for one person, so the same speech burst - or the
 * next word they say a second later - cannot post it twice. Claiming and
 * checking are one step on purpose: the send is awaited, and anything that
 * checked first and recorded afterwards would let every burst in that window
 * through.
 * @param guildId - Discord guild (server) ID.
 * @param userId - Who was heard.
 * @param day - Today, from {@link localDay}.
 * @param half - Which half is being claimed.
 * @returns `true` when the caller has today's slot and should go ahead.
 */
function claimToday(guildId: string, userId: string, day: string, half: EntranceHalf): boolean {
  const seen = stateFor(guildId);
  const days = seen[userId] ?? {};
  if (days[half] === day) return false;
  days[half] = day;
  seen[userId] = days;
  // Only today's entries are worth keeping; anything older has served its
  // purpose and would otherwise grow a file that is never read again.
  for (const [id, entry] of Object.entries(seen)) {
    if (entry.post !== day && entry.sound !== day) delete seen[id];
  }
  saveData<EntranceState>(guildId, ENTRANCE_STATE_FILE, seen);
  return true;
}

/**
 * Releases today's claim after a failed send, so the entrance is not silently
 * spent on a post that never landed.
 * @param guildId - Discord guild (server) ID.
 * @param userId - Who was heard.
 * @param half - Which half to hand back; the other one keeps its claim.
 */
function releaseToday(guildId: string, userId: string, half: EntranceHalf): void {
  const seen = stateFor(guildId);
  const days = seen[userId];
  if (!days) return;
  delete days[half];
  if (!days.post && !days.sound) delete seen[userId];
  saveData<EntranceState>(guildId, ENTRANCE_STATE_FILE, seen);
}

/**
 * Posts someone's entrance, if they have one and have not had it today.
 *
 * Never throws: it is called from a voice receiver event, where a rejection
 * would reach the client's "error" event with nothing listening for it.
 * @param guild - The guild they are speaking in.
 * @param userId - Who was heard.
 */
export async function announceEntrance(guild: Guild, userId: string): Promise<void> {
  const config = entrancesOf(guild.id);
  const post = entranceFor(config, userId);
  if (!post) return;

  const channelId = config.channelId;
  if (!channelId) {
    log.warn("entrance configured with no channel to post it in", { guildId: guild.id, userId });
    return;
  }

  // Resolved before the day is claimed: a file named in the config but not on
  // disk is a typo to fix, not an entrance to spend, and it would otherwise be
  // found only after the claim had already been made and released.
  let filePath: string | null = null;
  if (post.file) {
    filePath = resolveEntranceFile(guild.id, post.file);
    if (!filePath) {
      log.warn("entrance file is not on disk", { guildId: guild.id, userId, file: post.file });
      return;
    }
  }

  // Calm mode silences replies across the bot, and an entrance is a reply to
  // someone turning up, so it keeps the same quiet.
  if (isCalm(guild.id)) {
    log.debug("entrance suppressed by calm mode", { guildId: guild.id, userId });
    return;
  }

  if (!claimToday(guild.id, userId, localDay(new Date()), "post")) return;

  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || channel.type === ChannelType.GuildStageVoice) {
      log.warn("entrance channel is not one the bot can post in", {
        guildId: guild.id,
        channelId,
      });
      releaseToday(guild.id, userId, "post");
      return;
    }
    // Checked rather than left to the send: losing access to the channel is
    // the failure that otherwise spends someone's entrance on nothing, once a
    // day, with only a warning to show for it.
    const me = guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (
      !perms?.has(PermissionFlagsBits.ViewChannel) ||
      !perms.has(PermissionFlagsBits.SendMessages)
    ) {
      log.warn("missing permission to post an entrance", { guildId: guild.id, channelId });
      releaseToday(guild.id, userId, "post");
      return;
    }

    // Nothing here is a reply to a message, so mentions are suppressed outright
    // rather than narrowed: an entrance naming a role should not ping it.
    await channel.send({
      ...(post.message ? { content: post.message } : {}),
      ...(filePath ? { files: [filePath] } : {}),
      allowedMentions: { parse: [] },
    });
    log.info("posted entrance", { guildId: guild.id, userId, channelId, file: post.file });
  } catch (err) {
    // The size is logged with the failure because an upload over the server's
    // limit is the likeliest way this fails, and Discord's own wording for it
    // says nothing about which file or how big.
    const size = filePath ? fs.statSync(filePath, { throwIfNoEntry: false })?.size : undefined;
    log.warn("failed to post entrance", {
      guildId: guild.id,
      userId,
      file: post.file,
      bytes: size,
      error: err instanceof Error ? err.message : String(err),
    });
    releaseToday(guild.id, userId, "post");
  }
}

/**
 * How long a pending clip is worth playing. Someone's arrival is what brings
 * the bot into an empty channel, and the connect takes a couple of seconds,
 * but a clip that has waited longer than this is answering an arrival nobody
 * remembers - the connection struggled, or they left again.
 */
export const PENDING_ENTRANCE_MS = 30_000;

/** An arrival waiting for the bot to finish connecting. */
interface PendingEntrance {
  userId: string;
  channelId: string;
  at: number;
}

/**
 * The arrival each guild owes a clip to, if any. One slot rather than a queue:
 * when several people pile into an empty channel at once the bot plays for the
 * last of them, instead of stacking clips nobody can tell apart.
 */
const pendingEntrances = new Map<string, PendingEntrance>();

/**
 * Picks a clip from someone's pool.
 * @param guildId - Discord guild (server) ID.
 * @param pool - Pool name from the config.
 * @returns An absolute path to play, or null when the pool holds nothing usable.
 */
function pickEntranceClip(guildId: string, pool: string): string | null {
  const clips = resolveClips(guildId, { kind: "folder", name: pool });
  if (clips.length === 0) {
    log.warn("entrance pool holds no clips", { guildId, pool });
    return null;
  }
  const name = pickOne(clips, Math.floor(Math.random() * clips.length));
  if (!name) return null;
  const clipPath = resolveClipPath(guildId, name);
  if (!clipPath) log.warn("entrance clip is missing on disk", { guildId, pool, clip: name });
  return clipPath;
}

/**
 * Plays someone's entrance clip, if they have one and have not had it today.
 *
 * Never throws: every caller is an event handler where a rejection would reach
 * the client's "error" event with nothing listening for it.
 * @param guild - The guild they arrived in.
 * @param userId - Who arrived.
 * @param connection - The guild's live voice connection, in their channel.
 */
export async function playEntranceSound(
  guild: Guild,
  userId: string,
  connection: VoiceConnection,
): Promise<void> {
  const post = entranceFor(entrancesOf(guild.id), userId);
  if (!post?.pool) return;

  // Calm mode silences replies across the bot, and a clip everyone in the call
  // has to hear is the loudest reply it makes.
  if (isCalm(guild.id)) {
    log.debug("entrance clip suppressed by calm mode", { guildId: guild.id, userId });
    return;
  }

  // Resolved before the day is claimed, so an empty or misspelled pool is a
  // config error to fix rather than an entrance quietly spent on nothing.
  const clipPath = pickEntranceClip(guild.id, post.pool);
  if (!clipPath) return;

  if (!claimToday(guild.id, userId, localDay(new Date()), "sound")) return;

  const played = await playEntrance(connection, guild.id, clipPath).catch((err: unknown) => {
    log.warn("entrance clip failed to play", {
      guildId: guild.id,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  });
  if (!played) {
    releaseToday(guild.id, userId, "sound");
    return;
  }
  log.info("played entrance clip", { guildId: guild.id, userId, pool: post.pool });
}

/**
 * Reacts to someone arriving in a voice channel: plays their clip when the bot
 * is already in there with them, and otherwise remembers them until it is.
 * @param guild - The guild they arrived in.
 * @param userId - Who arrived.
 * @param channelId - The channel they arrived in.
 * @param connection - The guild's connection when the bot is already in that
 * same channel, otherwise null.
 */
export async function noteJoin(
  guild: Guild,
  userId: string,
  channelId: string,
  connection: VoiceConnection | null,
): Promise<void> {
  // Nothing is remembered for someone with no clip configured, so a busy
  // server does not keep a slot per arrival for entrances that do not exist.
  if (!entranceFor(entrancesOf(guild.id), userId)?.pool) return;

  if (connection) {
    await playEntranceSound(guild, userId, connection);
    return;
  }
  pendingEntrances.set(guild.id, { userId, channelId, at: Date.now() });
  log.debug("entrance held until the bot is connected", { guildId: guild.id, userId, channelId });
}

/**
 * Plays the clip owed to whoever's arrival brought the bot into this channel.
 * Called once a session is live, which is the first moment there is anything
 * to play through.
 * @param guild - The guild that just connected.
 * @param channelId - The channel the session is in.
 * @param connection - That session's connection.
 */
export async function flushPendingEntrance(
  guild: Guild,
  channelId: string,
  connection: VoiceConnection,
): Promise<void> {
  const pending = pendingEntrances.get(guild.id);
  if (!pending) return;
  pendingEntrances.delete(guild.id);
  // The bot can land in a different channel than the one that woke it, and a
  // slow connect can outlive the arrival entirely.
  if (pending.channelId !== channelId) return;
  if (Date.now() - pending.at > PENDING_ENTRANCE_MS) {
    log.debug("pending entrance expired before the bot connected", {
      guildId: guild.id,
      userId: pending.userId,
    });
    return;
  }
  await playEntranceSound(guild, pending.userId, connection);
}

/**
 * Drops a guild's pending arrival, so a clip cannot fire into a call that has
 * since been left or kicked from.
 * @param guildId - Discord guild (server) ID.
 */
export function forgetPendingEntrance(guildId: string): void {
  pendingEntrances.delete(guildId);
}
