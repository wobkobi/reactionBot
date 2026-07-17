// src/tracking/slurResponse.ts

/**
 * @file Picks the reply to a detected slur: a random GIF from a configurable
 * pool, escalating to an "enough" GIF when a user spams slurs in quick
 * succession, and rate-limited per user so the channel is not flooded.
 */

import { loadData } from "@/utils/file.js";
import { createLogger } from "@/utils/log.js";
import { Message } from "discord.js";

const log = createLogger("tracking/slurResponse");

/**
 * A reply entry: a plain string (a "generic" reply used for every slur), or
 * `{ content, categories }` listing which slur categories it applies to. Use
 * "generic" in `categories` to also include it for every slur.
 */
export type SlurReply = string | { content: string; categories?: string[] };

/** Configurable slur replies (override in data/<guild|global>/slur_responses.json). */
export interface SlurResponses {
  /** Reply pool; each entry is generic or tagged with the categories it applies to. */
  responses: SlurReply[];
  /** Reply used when a user is spamming slurs. */
  spam: string;
}

/** Config filename for slur reply GIFs. */
export const RESPONSES_FILE = "slur_responses.json";

/** Minimum gap between GIF replies to one user (anti-spam). */
export const SLUR_COOLDOWN_MS = 10_000;
/** Window over which rapid slurs count toward "spam". */
export const SLUR_SPAM_WINDOW_MS = 20_000;
/** Slur messages within the window that escalate to the "enough" GIF. */
export const SLUR_SPAM_THRESHOLD = 3;

/**
 * Built-in defaults used when no config file is present. Supports {user} (the
 * author mention) and {count} (their running slur total) placeholders; the
 * committed data/global/slur_responses.json overrides these with GIFs.
 */
const DEFAULT_RESPONSES: SlurResponses = {
  responses: ["🚨 {user} said a slur. That's slur #{count} for them. Shame."],
  spam: "Alright {user}, that's enough.",
};

/**
 * Substitutes {user} and {count} placeholders in a response string.
 * @param text - The response template.
 * @param mention - The author mention to insert for {user}.
 * @param count - The running slur total to insert for {count}.
 * @returns The filled string.
 */
export function fillPlaceholders(text: string, mention: string, count: number): string {
  return text.replaceAll("{user}", mention).replaceAll("{count}", String(count));
}

// Per-user (guild-scoped) recent-slur timestamps and last reply time.
const recent = new Map<string, { times: number[]; lastReplyAt: number }>();

/**
 * Loads the slur reply config for a guild, falling back to global then the
 * built-in defaults.
 * @param guildId - Discord guild (server) ID.
 * @returns The resolved {@link SlurResponses}.
 */
function loadResponses(guildId: string): SlurResponses {
  const guildCfg = loadData<Partial<SlurResponses> | null>(guildId, RESPONSES_FILE, { soft: true });
  const globalCfg = loadData<Partial<SlurResponses>>("global", RESPONSES_FILE, { soft: true });
  const responses = guildCfg?.responses?.length
    ? guildCfg.responses
    : (globalCfg?.responses ?? DEFAULT_RESPONSES.responses);
  const spam = guildCfg?.spam ?? globalCfg?.spam ?? DEFAULT_RESPONSES.spam;
  return { responses, spam };
}

/**
 * Builds the reply pool for a slur: every "generic" reply plus those tagged with
 * one of the detected categories. A plain-string entry counts as "generic".
 * @param config - The resolved {@link SlurResponses}.
 * @param categories - Categories of the slurs detected in the message.
 * @returns The matching reply contents.
 */
export function poolFor(config: SlurResponses, categories: string[]): string[] {
  const want = new Set(["generic", ...categories]);
  const pool: string[] = [];
  for (const reply of config.responses) {
    const content = typeof reply === "string" ? reply : reply.content;
    const tags = typeof reply === "string" ? ["generic"] : (reply.categories ?? ["generic"]);
    if (tags.some((c) => want.has(c))) pool.push(content);
  }
  return pool;
}

/**
 * Decides which reply (if any) to send: nothing while within the cooldown, the
 * spam reply when recent slurs cross the threshold, otherwise a reply from the
 * pool. Pure, so the cooldown/spam logic is testable.
 * @param recentCount - Slur messages from this user within the spam window.
 * @param sinceLastReplyMs - Milliseconds since the last reply to this user.
 * @param pool - The resolved reply pool for this slur's categories.
 * @param spam - The spam-escalation reply.
 * @param randomIndex - Index used to pick from the pool (caller supplies randomness).
 * @returns The reply to send, or null to stay silent.
 */
export function chooseSlurGif(
  recentCount: number,
  sinceLastReplyMs: number,
  pool: string[],
  spam: string,
  randomIndex: number,
): string | null {
  if (sinceLastReplyMs < SLUR_COOLDOWN_MS) return null;
  if (recentCount >= SLUR_SPAM_THRESHOLD) return spam || null;
  if (pool.length === 0) return null;
  return pool[randomIndex % pool.length] ?? null;
}

/**
 * Replies to a slur message with the configured response (or default shame),
 * pooling the generic replies with any category-specific ones, and applying the
 * spam escalation and per-user cooldown. Best-effort.
 * @param message - The offending guild message.
 * @param total - The author's running slur total (for the {count} placeholder).
 * @param categories - Categories of the slurs detected in the message.
 * @returns A promise that resolves once the reply attempt completes.
 */
export async function respondToSlur(
  message: Message<true>,
  total: number,
  categories: string[],
): Promise<void> {
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const state = recent.get(key) ?? { times: [], lastReplyAt: 0 };
  state.times = state.times.filter((t) => now - t < SLUR_SPAM_WINDOW_MS);
  state.times.push(now);

  const config = loadResponses(message.guildId);
  const pool = poolFor(config, categories);
  const randomIndex = Math.floor(Math.random() * Math.max(1, pool.length));
  const chosen = chooseSlurGif(
    state.times.length,
    now - state.lastReplyAt,
    pool,
    config.spam,
    randomIndex,
  );
  if (chosen) state.lastReplyAt = now;
  recent.set(key, state);

  if (!chosen) return;
  const content = fillPlaceholders(chosen, `<@${message.author.id}>`, total);
  await message
    .reply({ content, allowedMentions: { users: [message.author.id], repliedUser: true } })
    .catch((err: unknown) => {
      log.warn("failed to send slur reply", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
}
