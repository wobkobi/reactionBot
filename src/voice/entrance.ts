// src/voice/entrance.ts

// Posts someone's entrance the first time the bot hears them speak each day.
//
// Hung off the voice receiver rather than off voice state updates: joining a
// channel is cheap to fake and says nothing, whereas being heard means they
// turned up and started talking, which is the moment the gag is about. It does
// mean the bot has to be sitting in the channel already - it hears nothing from
// a call it is not in.

import { isCalm } from "@/tracking/calm";
import { configFingerprint, loadData, readIfPresent, resolveScoped, saveData } from "@/utils/file";
import { createLogger } from "@/utils/log";
import { ChannelType, PermissionFlagsBits, type Guild } from "discord.js";

const log = createLogger("voice/entrance");

/** Config file naming the channel and who gets an entrance. */
export const ENTRANCES_FILE = "entrances.json";

/** Where the last day each person was announced is kept, per guild. */
export const ENTRANCE_STATE_FILE = "entrances_seen.json";

/** One person's entrance, and what gets posted for it. */
export interface Entrance {
  /** Discord user IDs this applies to; several can share one entrance. */
  users: string[];
  /** What to post. A link on its own line embeds; any other text is sent as written. */
  message: string;
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
 * @returns What to post, or null when they have no entrance. An entry with no
 * message is treated as having none, so blanking the text switches one off
 * without deleting the entry.
 */
export function entranceFor(config: EntrancesConfig, userId: string): string | null {
  const entry = (config.entrances ?? []).find((e) => (e.users ?? []).includes(userId));
  const message = entry?.message?.trim();
  return message ? message : null;
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
  const message = entranceFor(config, userId);
  if (!message) return;

  const channelId = config.channelId;
  if (!channelId) {
    log.warn("entrance configured with no channel to post it in", { guildId: guild.id, userId });
    return;
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
    await channel.send({ content: message, allowedMentions: { parse: [] } });
    log.info("posted entrance", { guildId: guild.id, userId, channelId });
  } catch (err) {
    log.warn("failed to post entrance", {
      guildId: guild.id,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    releaseToday(guild.id, userId);
  }
}
