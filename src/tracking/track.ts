// src/tracking/track.ts

/**
 * @file Per-message processing of the unified word config: records swears,
 * slurs and called-names, fires the per-type configured replies
 * (responses.json), and adds the configured emoji reactions - all driven by
 * words.json (see {@link loadWords}).
 */

import { noteMessage } from "@/tracking/calm.js";
import { countMatches } from "@/tracking/detect.js";
import { respondToMessage } from "@/tracking/responses.js";
import { incrementCounts } from "@/tracking/store.js";
import { CALLED, SLURS, SWEARS } from "@/tracking/trackers.js";
import { loadWords, ReactionSpec } from "@/tracking/words.js";
import { createLogger } from "@/utils/log.js";
import { Message } from "discord.js";

const log = createLogger("tracking/track");

/** Discord's per-message reaction cap - a longer spell-out could not be shown in full. */
const MAX_REACTIONS = 20;

/**
 * Builds the keycap emoji for a digit: the digit itself, the variation selector
 * that forces emoji presentation, and the combining enclosing keycap.
 * @param digit - A single character, "0" to "9".
 * @returns The keycap emoji, e.g. "5️⃣".
 */
function digitToKeycap(digit: string): string {
  return `${digit}️⃣`;
}

/**
 * Converts a phrase to the emojis that spell it out, e.g. "nword" >
 * [🇳, 🇼, 🇴, 🇷, 🇩]. Letters become regional indicators, digits become
 * keycaps, and spaces are dropped - Discord has no blank reaction, so word gaps
 * simply close up. The whole phrase is rejected rather than partially spelled
 * when it cannot be shown faithfully: a repeated character (Discord refuses the
 * same reaction twice), an unsupported one, or more emojis than a message can
 * hold.
 * @param phrase - Letters, digits and spaces (case-insensitive).
 * @returns The emojis in order, or `null` when the phrase cannot be spelled out.
 */
export function phraseToEmojis(phrase: string): string[] | null {
  const base = 0x1f1e6; // 🇦
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ch of phrase.toLowerCase()) {
    if (ch === " ") continue;
    const isLetter = ch >= "a" && ch <= "z";
    const isDigit = ch >= "0" && ch <= "9";
    if ((!isLetter && !isDigit) || seen.has(ch)) return null;
    seen.add(ch);
    out.push(
      isLetter
        ? String.fromCodePoint(base + ch.charCodeAt(0) - "a".charCodeAt(0))
        : digitToKeycap(ch),
    );
  }
  return out.length > 0 && out.length <= MAX_REACTIONS ? out : null;
}

/**
 * Resolves which reactions actually fire: poolless specs all fire, specs
 * sharing a pool compete and one is picked at random (the original
 * girls-vs-british coin flip). Duplicate values fire once.
 * @param specs - Every matched {@link ReactionSpec}.
 * @returns The reaction values to send.
 */
export function resolveReactions(specs: ReactionSpec[]): string[] {
  const out: string[] = [];
  const pools = new Map<string, string[]>();
  for (const spec of specs) {
    if (spec.pool) {
      pools.set(spec.pool, [...(pools.get(spec.pool) ?? []), spec.value]);
    } else if (!out.includes(spec.value)) {
      out.push(spec.value);
    }
  }
  for (const values of pools.values()) {
    const unique = [...new Set(values)];
    out.push(unique[Math.floor(Math.random() * unique.length)]);
  }
  return [...new Set(out)];
}

/**
 * Reacts with a resolved reaction value: a phrase of letters, digits and spaces
 * is spelled out (see {@link phraseToEmojis}); anything else is treated as an
 * emoji and reacted directly. Emoji values never take the spell-out branch -
 * they are non-ASCII, so they cannot match the phrase test.
 * @param message - The message to react to.
 * @param value - The reaction value from the config.
 * @returns A promise that resolves once the reactions are added.
 */
async function reactWithValue(message: Message<true>, value: string): Promise<void> {
  if (/^[a-z0-9 ]+$/i.test(value)) {
    const emojis = phraseToEmojis(value);
    if (!emojis) {
      log.warn("spell-out reaction skipped: repeated or unsupported character", { value });
      return;
    }
    for (const emoji of emojis) {
      await message.react(emoji).catch(() => {});
    }
    return;
  }
  await message.react(value).catch(() => {});
}

/**
 * Resolves the members a message is aimed at: everyone mentioned plus the
 * author of the message being replied to. Bots and the author themselves are
 * excluded.
 * @param message - The guild message to inspect.
 * @returns A set of target user IDs.
 */
async function resolveTargets(message: Message<true>): Promise<Set<string>> {
  const authorId = message.author.id;
  const targets = new Set<string>();

  for (const u of message.mentions.users.values()) {
    if (!u.bot && u.id !== authorId) targets.add(u.id);
  }

  if (message.reference?.messageId) {
    const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (ref && !ref.author.bot && ref.author.id !== authorId) targets.add(ref.author.id);
  }

  return targets;
}

/**
 * Scans a guild message against the unified word config: records swears and
 * slurs against the author, called-names against the resolved targets, fires
 * the per-type configured replies, and adds configured reactions.
 * @param message - The message to scan. DMs and bot authors are ignored.
 * @returns A promise that resolves once tracking is complete or skipped.
 */
export async function trackMessage(message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot) return;
  if (!message.channel.isTextBased()) return;

  const guildId = message.guildId;
  const authorId = message.author.id;
  const content = message.content;
  if (!content) return;

  // Count this message against any active calm window's message limit
  // (before responding, so the message that starts calm isn't counted).
  noteMessage(guildId);

  const words = loadWords(guildId);

  // Author-attributed: swears.
  const swearCounts = countMatches(content, words.tracks.swears);
  if (swearCounts.size > 0) incrementCounts(guildId, SWEARS.storeFile, authorId, swearCounts);

  // Author-attributed: slurs.
  const slurCounts = countMatches(content, words.tracks.slurs);
  if (slurCounts.size > 0) {
    incrementCounts(guildId, SLURS.storeFile, authorId, slurCounts);
    log.info("slur detected", { guildId, authorId, words: [...slurCounts.keys()] });
  }

  // Target-attributed: called-names.
  const insultCounts = countMatches(content, words.tracks.called);
  if (insultCounts.size > 0) {
    const targets = await resolveTargets(message);
    for (const targetId of targets) {
      incrementCounts(guildId, CALLED.storeFile, targetId, insultCounts);
    }
    if (targets.size > 0) {
      log.info("called-names recorded", {
        guildId,
        targets: [...targets],
        words: [...insultCounts.keys()],
      });
    }
  }

  // Configured replies (responses.json): at most one per message, after the
  // stores are updated so {count} reflects this message.
  await respondToMessage(message, words);

  // Reactions from the config: matched words plus type emoji triggers.
  const reactionHits = countMatches(content, words.reactionList);
  const specs = [...reactionHits.keys()].flatMap((w) => words.reactionSpecs.get(w) ?? []);
  for (const trigger of words.emojiTriggers) {
    if (content.includes(trigger.emoji)) specs.push(trigger.spec);
  }
  for (const value of resolveReactions(specs)) {
    await reactWithValue(message, value);
  }
}
