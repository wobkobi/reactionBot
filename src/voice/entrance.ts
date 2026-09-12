// src/voice/entrance.ts

// Posts someone's entrance the first time the bot hears them speak each day.
//
// Hung off the voice receiver rather than off voice state updates: joining a
// channel is cheap to fake and says nothing, whereas being heard means they
// turned up and started talking, which is the moment the gag is about. It does
// mean the bot has to be sitting in the channel already - it hears nothing from
// a call it is not in.

import { isCalm } from "@/tracking/calm";
import {
  configFingerprint,
  guildDataDir,
  loadData,
  readIfPresent,
  resolveScoped,
  saveData,
} from "@/utils/file";
import { createLogger } from "@/utils/log";
// Same job as it does for clips: a name out of a hand-edited config reaching
// the filesystem. Shared rather than copied, since a path-traversal guard is
// the last thing that should exist twice and drift.
import { safeClipName } from "@/voice/sounds";
import { ChannelType, PermissionFlagsBits, type Guild } from "discord.js";
import fs from "node:fs";
import path from "node:path";

const log = createLogger("voice/entrance");

/** Config file naming the channel and who gets an entrance. */
export const ENTRANCES_FILE = "entrances.json";

/** Where the last day each person was announced is kept, per guild. */
export const ENTRANCE_STATE_FILE = "entrances_seen.json";

/** Folder holding entrance files, under a guild's data dir or the shared root. */
export const ENTRANCES_DIR = "entrances";

/** One person's entrance, and what gets posted for it. */
export interface Entrance {
  /** Discord user IDs this applies to; several can share one entrance. */
  users: string[];
  /** Text to post. A link on its own line embeds; anything else is sent as written. */
  message?: string;
  /**
   * A file to attach, named relative to the entrances folder. Preferred over a
   * link for anything that has to keep working: a Discord CDN URL is signed and
   * dies after 24 hours, and any other host can go away on its own schedule.
   */
  file?: string;
}

/** What to post for someone. At least one of the two is set. */
export interface EntrancePost {
  /** Text to send, if the entrance has any. */
  message?: string;
  /** File to attach, as named in the config, if the entrance has one. */
  file?: string;
}

/** Parsed entrances.json. */
export interface EntrancesConfig {
  /** Text channel the entrances are posted in. Nothing posts without one. */
  channelId?: string;
  /** Who gets an entrance, and what. */
  entrances?: Entrance[];
}

/** The last day each user was announced, keyed by user ID. */
type EntranceState = Record<string, string>;

/** Config per guild, keyed by the {@link configFingerprint} it came from. */
const cache = new Map<string, { fingerprint: string; config: EntrancesConfig }>();

/**
 * The day each user was last announced, per guild. Held in memory because the
 * check runs on every burst of speech from everyone in the call, and read back
 * from disk only the first time a guild is seen.
 */
const state = new Map<string, EntranceState>();

/**
 * Reads one scope's entrances config.
 * @param scope - Discord guild ID or "global".
 * @returns The parsed config, or null when the file is absent or unreadable.
 */
function readEntrances(scope: string): EntrancesConfig | null {
  return readIfPresent<EntrancesConfig>(scope, ENTRANCES_FILE);
}

/**
 * Loads a guild's entrances config, reusing the last read while both files are
 * unchanged so a hand edit applies without a restart.
 * @param guildId - Discord guild (server) ID.
 * @returns The config, empty when neither scope has one.
 */
export function loadEntrances(guildId: string): EntrancesConfig {
  const current = configFingerprint(guildId, ENTRANCES_FILE);
  const cached = cache.get(guildId);
  if (cached?.fingerprint === current) return cached.config;

  const config = resolveScoped(guildId, readEntrances) ?? {};
  cache.set(guildId, { fingerprint: current, config });
  return config;
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
  const entry = (config.entrances ?? []).find((e) => (e.users ?? []).includes(userId));
  if (!entry) return null;
  const message = entry.message?.trim();
  const file = entry.file?.trim();
  if (!message && !file) return null;
  const post: EntrancePost = {};
  if (message) post.message = message;
  if (file) post.file = file;
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
  const loaded = loadData<EntranceState>(guildId, ENTRANCE_STATE_FILE, {
    soft: true,
    defaultValue: {},
  });
  state.set(guildId, loaded);
  return loaded;
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
 * @returns `true` when the caller has today's slot and should post.
 */
function claimToday(guildId: string, userId: string, day: string): boolean {
  const seen = stateFor(guildId);
  if (seen[userId] === day) return false;
  seen[userId] = day;
  // Only today's entries are worth keeping; anything older has served its
  // purpose and would otherwise grow a file that is never read again.
  for (const [id, on] of Object.entries(seen)) {
    if (on !== day) delete seen[id];
  }
  saveData<EntranceState>(guildId, ENTRANCE_STATE_FILE, seen);
  return true;
}

/**
 * Releases today's claim after a failed send, so the entrance is not silently
 * spent on a post that never landed.
 * @param guildId - Discord guild (server) ID.
 * @param userId - Who was heard.
 */
function releaseToday(guildId: string, userId: string): void {
  const seen = stateFor(guildId);
  delete seen[userId];
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
  const config = loadEntrances(guild.id);
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

  if (!claimToday(guild.id, userId, localDay(new Date()))) return;

  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || channel.type === ChannelType.GuildStageVoice) {
      log.warn("entrance channel is not one the bot can post in", {
        guildId: guild.id,
        channelId,
      });
      releaseToday(guild.id, userId);
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
      releaseToday(guild.id, userId);
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
    releaseToday(guild.id, userId);
  }
}
