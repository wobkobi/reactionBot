// src/tracking/responses.ts

/**
 * @file Configurable replies to detected words, per type from words.json: a
 * random GIF/text from the type's pool, escalating to its "enough" reply when
 * a user spams that type in quick succession, rate-limited per user and
 * silenced entirely while calm mode is on. The legacy slur_responses.json is
 * still read as a slur-only pool when no responses.json exists.
 */

import { getAutoCalm, isCalm, startCalm } from "@/tracking/calm.js";
import { countMatches } from "@/tracking/detect.js";
import { getUserTotal } from "@/tracking/store.js";
import { SLURS, SWEARS } from "@/tracking/trackers.js";
import { CompiledWords } from "@/tracking/words.js";
import { loadData } from "@/utils/file.js";
import { createLogger } from "@/utils/log.js";
import { recordReply } from "@/utils/replyStore.js";
import { Message } from "discord.js";

const log = createLogger("tracking/responses");

/**
 * A reply entry: a plain string (a "generic" reply used for every word of the
 * type), or `{ content, categories }` listing which word categories it applies
 * to. Use "generic" in `categories` to also include it for every word.
 *
 * Entries added through `/gif` also carry `id`, `addedBy` and `addedAt`.
 * Hand-written entries have none, which is what keeps them out of reach of
 * `/gif remove`.
 */
export type ResponseReply =
  | string
  | {
      /** The GIF link or text to reply with. */
      content: string;
      /** Word categories this reply applies to; "generic" means all of them. */
      categories?: string[];
      /** Short unique id, present only on entries added through `/gif`. */
      id?: string;
      /** Discord ID of whoever added it through `/gif`. */
      addedBy?: string;
      /** ISO timestamp of when it was added through `/gif`. */
      addedAt?: string;
    };

/** Reply config for one word type. */
export interface TypeResponses {
  /** Reply pool; each entry is generic or tagged with the categories it applies to. */
  responses: ResponseReply[];
  /** Reply used when a user is spamming this type; omit for no escalation. */
  spam?: string;
}

/** Shape of responses.json: reply pools keyed by words.json type name. */
export interface ResponsesConfig {
  types: Record<string, TypeResponses>;
}

/** Config filename for the per-type reply pools. */
export const RESPONSES_FILE = "responses.json";

/** Legacy slur-only config filename, read when no responses.json exists. */
export const LEGACY_SLUR_FILE = "slur_responses.json";

/** Minimum gap between replies to one user for one type (anti-spam). */
export const RESPONSE_COOLDOWN_MS = 10_000;
/** Window over which rapid hits (from any user) count toward "spam". */
export const RESPONSE_SPAM_WINDOW_MS = 30_000;
/** Hits within the window, across all users, that escalate to "enough". */
export const RESPONSE_SPAM_THRESHOLD = 5;

/**
 * Built-in default used when no config file is present at all. Supports {user}
 * (the author mention) and {count} placeholders.
 */
const DEFAULT_CONFIG: ResponsesConfig = {
  types: {
    slur: {
      responses: ["🚨 {user} said a slur. That's slur #{count} for them. Shame."],
      spam: "Alright {user}, that's enough.",
    },
  },
};

/**
 * Substitutes {user} and {count} placeholders in a response string.
 * @param text - The response template.
 * @param mention - The author mention to insert for {user}.
 * @param count - The count to insert for {count}.
 * @returns The filled string.
 */
export function fillPlaceholders(text: string, mention: string, count: number): string {
  return text.replaceAll("{user}", mention).replaceAll("{count}", String(count));
}

// Per guild:user:type last reply time (the per-user cooldown).
const lastReply = new Map<string, number>();
// Per guild:type hit timestamps across ALL users (the spam window). Reset
// once the spam reply fires so it only sends once per episode.
const spamHits = new Map<string, number[]>();

/**
 * Reads a config file that may hold the legacy slur-only shape, mapping it to
 * the per-type shape under "slur".
 * @param guildId - Discord guild (server) ID or "global".
 * @returns The config, or null when neither file exists.
 */
function readConfig(guildId: string): ResponsesConfig | null {
  const cfg = loadData<Partial<ResponsesConfig> | null>(guildId, RESPONSES_FILE, { soft: true });
  if (cfg?.types && Object.keys(cfg.types).length > 0) return { types: cfg.types };

  const legacy = loadData<Partial<TypeResponses> | null>(guildId, LEGACY_SLUR_FILE, { soft: true });
  if (legacy?.responses?.length) {
    return { types: { slur: { responses: legacy.responses, spam: legacy.spam } } };
  }
  return null;
}

/**
 * Loads the reply config for a guild: guild responses.json, then global, then
 * the legacy slur_responses.json (guild then global), then built-in defaults.
 * @param guildId - Discord guild (server) ID.
 * @returns The resolved {@link ResponsesConfig}.
 */
function loadResponses(guildId: string): ResponsesConfig {
  return readConfig(guildId) ?? readConfig("global") ?? DEFAULT_CONFIG;
}

/**
 * Builds the reply pool for a hit: every "generic" reply plus those tagged
 * with one of the matched categories. A plain-string entry counts as
 * "generic".
 * @param config - The type's {@link TypeResponses}.
 * @param categories - Categories of the words detected in the message.
 * @returns The matching reply contents.
 */
export function poolFor(config: TypeResponses, categories: string[]): string[] {
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
 * spam reply when recent hits cross the threshold, otherwise a reply from the
 * pool. Pure, so the cooldown/spam logic is testable.
 * @param recentCount - Hits within the spam window, across all users.
 * @param sinceLastReplyMs - Milliseconds since the last reply to this user.
 * @param pool - The resolved reply pool for this hit's categories.
 * @param spam - The spam-escalation reply ("" when the type has none).
 * @param randomIndex - Index used to pick from the pool (caller supplies randomness).
 * @returns The reply to send, or null to stay silent.
 */
export function chooseReply(
  recentCount: number,
  sinceLastReplyMs: number,
  pool: string[],
  spam: string,
  randomIndex: number,
): string | null {
  if (sinceLastReplyMs < RESPONSE_COOLDOWN_MS) return null;
  if (recentCount >= RESPONSE_SPAM_THRESHOLD) return spam || null;
  if (pool.length === 0) return null;
  return pool[randomIndex % pool.length] ?? null;
}

/**
 * Replies to a message that matched configured word types. Each configured
 * type is tried in config order and at most one reply is sent per message.
 * The {count} placeholder is the author's running store total for
 * author-attributed tracks (swears, slurs), otherwise the hits in this
 * message. The spam window is guild-wide per type (any mix of users can trip
 * it); when it fires, the "enough" reply is sent once, the window resets, and
 * calm mode starts automatically. Best-effort.
 * @param message - The guild message to consider.
 * @param words - The compiled word config for this guild.
 * @returns A promise that resolves once any reply attempt completes.
 */
export async function respondToMessage(
  message: Message<true>,
  words: CompiledWords,
): Promise<void> {
  if (isCalm(message.guildId)) return;
  const content = message.content;
  if (!content) return;

  const config = loadResponses(message.guildId);
  const now = Date.now();

  for (const [typeName, typeConfig] of Object.entries(config.types)) {
    const compiled = words.typeLists.get(typeName);
    if (!compiled) continue;
    const hits = countMatches(content, compiled.list);
    if (hits.size === 0) continue;

    // Spam window is shared by every user in the guild for this type; the
    // reply cooldown stays per user.
    const spamKey = `${message.guildId}:${typeName}`;
    const userKey = `${message.guildId}:${message.author.id}:${typeName}`;
    const times = (spamHits.get(spamKey) ?? []).filter((t) => now - t < RESPONSE_SPAM_WINDOW_MS);
    times.push(now);
    spamHits.set(spamKey, times);

    const categories = [
      ...new Set(
        [...hits.keys()]
          .map((w) => compiled.list.category.get(w))
          .filter((c): c is string => Boolean(c)),
      ),
    ];
    const pool = poolFor(typeConfig, categories);
    const randomIndex = Math.floor(Math.random() * Math.max(1, pool.length));
    const chosen = chooseReply(
      times.length,
      now - (lastReply.get(userKey) ?? 0),
      pool,
      typeConfig.spam ?? "",
      randomIndex,
    );
    if (!chosen) continue;
    lastReply.set(userKey, now);

    // Spam escalation: the "enough" reply is the last word - go calm so the
    // channel isn't flooded with more replies while the spam continues (ends
    // after the time limit or the message limit, whichever comes first), and
    // reset the window so the spam reply fires once per episode.
    if (times.length >= RESPONSE_SPAM_THRESHOLD) {
      spamHits.set(spamKey, []);
      const auto = getAutoCalm(message.guildId);
      startCalm(message.guildId, auto.ms, auto.messages);
    }

    // {count}: running author total for author-attributed tracks, else the
    // hits in this message (called is target-attributed; react-only types
    // have no store at all).
    const track = compiled.def.track;
    const storeFile =
      track === "swears" ? SWEARS.storeFile : track === "slurs" ? SLURS.storeFile : null;
    const count = storeFile
      ? getUserTotal(message.guildId, storeFile, message.author.id)
      : [...hits.values()].reduce((a, b) => a + b, 0);

    log.info("response fired", { guildId: message.guildId, type: typeName, categories });
    const filled = fillPlaceholders(chosen, `<@${message.author.id}>`, count);
    const sent = await message
      .reply({
        content: filled,
        allowedMentions: { users: [message.author.id], repliedUser: true },
      })
      .catch((err: unknown) => {
        log.warn("failed to send reply", {
          type: typeName,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
    // Link the reply to the offending message so deleting that message (any
    // time, even after a restart) also deletes this reply.
    if (sent) {
      recordReply(message.guildId, message.id, { channelId: sent.channelId, messageId: sent.id });
    }
    return;
  }
}
