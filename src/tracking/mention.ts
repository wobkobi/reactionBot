// src/tracking/mention.ts

// Playground-grade comeback when someone @s the bot, drawn from insults.json
// (guild, then global). The pool lives only in that file - with no file the
// bot stays quiet. Shares the word replies' cooldown, spam escalation and
// calm-mode silence, so pinging the bot cannot be used to talk over them.

import { getAutoCalm, isCalm, startCalm } from "@/tracking/calm";
import {
  chooseReply,
  fillPlaceholders,
  RESPONSE_SPAM_THRESHOLD,
  RESPONSE_SPAM_WINDOW_MS,
} from "@/tracking/responses";
import { getUserTotal, incrementCounts } from "@/tracking/store";
import { loadData } from "@/utils/file";
import { createLogger } from "@/utils/log";
import { recordReply } from "@/utils/replyStore";
import { Message } from "discord.js";

const log = createLogger("tracking/mention");

/** Config filename for the mention comeback pool. */
export const INSULTS_FILE = "insults.json";

/** Count-store filename; {count} is how many times the user has pinged the bot. */
export const MENTION_STORE = "mention_counts.json";

/** Single key in {@link MENTION_STORE} - there is only one thing being counted. */
const MENTION_KEY = "mention";

/** Shape of insults.json. */
export interface InsultsConfig {
  /** Comeback pool; text or a GIF/image link, with {user} and {count} substituted. */
  insults: string[];
  /** Sent instead when the bot is being ping-spammed; omit for no escalation. */
  spam?: string;
}

/** The off state: no file anywhere means the bot takes the ping in silence. */
const NO_INSULTS: InsultsConfig = { insults: [] };

// Per guild:user last comeback time (the per-user cooldown).
const lastReply = new Map<string, number>();
// Per guild ping timestamps across ALL users (the spam window). Reset once the
// spam reply fires so it only sends once per episode.
const spamHits = new Map<string, number[]>();

/**
 * Reads one scope's insults.json. An `insults` array is what makes the file
 * count, empty or not - that is how a server turns comebacks off, or keeps
 * only the spam line, without the next scope answering for it.
 * @param scope - Discord guild (server) ID or "global".
 * @returns The config, or null when this scope has no usable file.
 */
export function readInsults(scope: string): InsultsConfig | null {
  const cfg = loadData<Partial<InsultsConfig> | null>(scope, INSULTS_FILE, { soft: true });
  if (!Array.isArray(cfg?.insults)) return null;
  return { insults: cfg.insults, spam: cfg.spam };
}

/**
 * Loads the comeback pool for a guild: guild insults.json, then global. There
 * is no built-in pool - with neither file the bot simply says nothing.
 * @param guildId - Discord guild (server) ID.
 * @returns The resolved {@link InsultsConfig}.
 */
function loadInsults(guildId: string): InsultsConfig {
  return readInsults(guildId) ?? readInsults("global") ?? NO_INSULTS;
}

/**
 * Decides whether a message is aimed at the bot. Only a direct mention counts:
 * a role the bot happens to hold, an everyone ping, and the implicit ping a
 * reply carries are all somebody talking to the channel, not to the bot.
 * @param message - The message to test.
 * @returns `true` when the author mentioned the bot on purpose.
 */
export function mentionsBot(message: Message<true>): boolean {
  return message.mentions.has(message.client.user, {
    ignoreRoles: true,
    ignoreEveryone: true,
    ignoreRepliedUser: true,
  });
}

/**
 * Fires back at whoever mentioned the bot. Silent during calm mode, within the
 * author's cooldown, or when no insults.json configures a pool; the spam
 * window is guild-wide, and tripping it sends the "enough" line once and starts
 * calm mode - the same shape as the word replies. Best-effort.
 * @param message - The guild message to consider.
 * @returns A promise resolving to `true` when a comeback was sent.
 */
export async function respondToMention(message: Message<true>): Promise<boolean> {
  if (!mentionsBot(message)) return false;
  if (isCalm(message.guildId)) return false;

  const guildId = message.guildId;
  const authorId = message.author.id;
  const config = loadInsults(guildId);
  // Nothing configured at all: don't count the ping or hold a spam window for
  // a feature that has no way to answer.
  if (config.insults.length === 0 && !config.spam) return false;
  const now = Date.now();

  // Counted before the cooldown check so {count} stays honest: every ping is a
  // ping, whether or not it earned an answer.
  incrementCounts(guildId, MENTION_STORE, authorId, new Map([[MENTION_KEY, 1]]));

  const times = (spamHits.get(guildId) ?? []).filter((t) => now - t < RESPONSE_SPAM_WINDOW_MS);
  times.push(now);
  spamHits.set(guildId, times);

  const userKey = `${guildId}:${authorId}`;
  const randomIndex = Math.floor(Math.random() * Math.max(1, config.insults.length));
  const chosen = chooseReply(
    times.length,
    now - (lastReply.get(userKey) ?? 0),
    config.insults,
    config.spam ?? "",
    randomIndex,
  );
  if (!chosen) return false;
  lastReply.set(userKey, now);

  // Spam escalation: the "enough" line is the last word - go calm so the ping
  // spam stops earning answers, and reset the window so it fires once per
  // episode.
  if (times.length >= RESPONSE_SPAM_THRESHOLD) {
    spamHits.set(guildId, []);
    const auto = getAutoCalm(guildId);
    startCalm(guildId, auto.ms, auto.messages);
  }

  log.info("mention comeback fired", { guildId, authorId });
  const filled = fillPlaceholders(
    chosen,
    `<@${authorId}>`,
    getUserTotal(guildId, MENTION_STORE, authorId),
  );
  const sent = await message
    .reply({ content: filled, allowedMentions: { users: [authorId], repliedUser: true } })
    .catch((err: unknown) => {
      log.warn("failed to send mention comeback", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
  if (!sent) return false;

  // Link the comeback to the ping so deleting the ping takes it down too.
  recordReply(guildId, message.id, { channelId: sent.channelId, messageId: sent.id });
  return true;
}
