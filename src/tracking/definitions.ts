// src/tracking/definitions.ts

// The "define your terms" prompt: a word with an innocent second meaning earns
// a button asking which one was meant, and the chosen meaning's definition is
// posted back. The word list lives only in definitions.json (guild, then
// global) - with no file the bot never asks. Independent of the responses.json
// replies, so a word can earn both.

import { requestChoice } from "@/media/approval";
import { loadSettings } from "@/media/settings";
import { GraceSetting } from "@/media/types";
import { isCalm } from "@/tracking/calm";
import { compileItems, countMatches, DetectList } from "@/tracking/detect";
import { RESPONSE_COOLDOWN_MS } from "@/tracking/responses";
import { configFingerprint, loadData } from "@/utils/file";
import { createLogger } from "@/utils/log";
import { recordReply } from "@/utils/replyStore";
import { ButtonStyle, Message } from "discord.js";

const log = createLogger("tracking/definitions");

/** Config filename for the meanings on offer. */
export const DEFINITIONS_FILE = "definitions.json";

/** Discord's per-row button cap - extra options could not be shown. */
export const MAX_OPTIONS = 5;

/** Shortest window a question gets, however brisk `/setdelay` is. */
export const MIN_PROMPT_MS = 5 * 60_000;

/** Longest window short of `/setdelay disabled`, which never expires at all. */
export const MAX_PROMPT_MS = 60 * 60_000;

/** How much longer a question runs than the link prompt `/setdelay` sizes. */
export const PROMPT_GRACE_MULTIPLIER = 10;

/**
 * Sizes the question's window from the guild's `/setdelay` grace. A link
 * prompt is a reflex - yes or no about something already typed, with the
 * author still looking at the channel - while this asks them to own a meaning,
 * which they may not come back to for a while. So the setting is followed in
 * spirit rather than to the second: scaled up, then held between
 * {@link MIN_PROMPT_MS} and {@link MAX_PROMPT_MS}.
 *
 * "disabled" is the one value taken literally - a question that never expires
 * is exactly a question that has to be answered. "instant" cannot be: there is
 * nothing to go ahead and do without an answer, so it takes the floor instead
 * of skipping the question.
 * @param grace - The guild's configured `/setdelay` value.
 * @returns The window in milliseconds, or "disabled" to never expire.
 */
export function promptWindow(grace: GraceSetting | undefined): number | "disabled" {
  if (grace === "disabled") return "disabled";
  if (typeof grace !== "number" || !Number.isFinite(grace) || grace < 0) return MIN_PROMPT_MS;
  return Math.min(MAX_PROMPT_MS, Math.max(MIN_PROMPT_MS, grace * PROMPT_GRACE_MULTIPLIER));
}

/** One meaning on offer: the button that picks it and what gets posted. */
export interface DefinitionOption {
  /** Button custom ID, unique within the entry. */
  id: string;
  /** Text on the button. */
  label: string;
  /** Emoji shown before the label. */
  emoji?: string;
  /** Posted when this meaning is picked; {user} is the author mention. */
  reply: string;
}

/** One word worth asking about, with the meanings it could have had. */
export interface DefinitionEntry {
  /** Spellings that trigger the prompt; matched leniently, so write them plainly. */
  words: string[];
  /** The question put to the author; {user} is their mention. */
  prompt: string;
  /** The meanings on offer, in button order. */
  options: DefinitionOption[];
}

/** Shape of definitions.json. */
export interface DefinitionsConfig {
  entries: DefinitionEntry[];
}

/** The off state: no file anywhere means no word ever earns a prompt. */
const NO_DEFINITIONS: DefinitionsConfig = { entries: [] };

/** One entry with its words compiled for matching. */
export interface CompiledEntry {
  entry: DefinitionEntry;
  list: DetectList;
}

/**
 * Reads one scope's definitions.json. An `entries` array is what makes the
 * file count, empty or not - that is how a server turns prompts off without
 * the global file answering for it.
 * @param scope - Discord guild (server) ID or "global".
 * @returns The config, or null when this scope has no usable file.
 */
export function readDefinitions(scope: string): DefinitionsConfig | null {
  const cfg = loadData<Partial<DefinitionsConfig> | null>(scope, DEFINITIONS_FILE, { soft: true });
  if (!Array.isArray(cfg?.entries)) return null;
  return { entries: cfg.entries };
}

/**
 * Compiles each entry's words into a matcher, dropping entries that could
 * never produce a usable prompt: no words, or no meanings to offer. Options
 * past Discord's row cap are dropped rather than the whole entry, so an
 * overlong list still asks the question. Words are always matched fuzzily -
 * these are exactly the words people obfuscate.
 * @param config - The loaded {@link DefinitionsConfig}.
 * @returns The usable entries, each with its {@link DetectList}.
 */
export function compileEntries(config: DefinitionsConfig): CompiledEntry[] {
  const out: CompiledEntry[] = [];
  for (const entry of config.entries ?? []) {
    const words = (entry?.words ?? []).filter((w) => typeof w === "string" && w.trim() !== "");
    const options = (entry?.options ?? []).filter((o) => o?.id && o.label && o.reply);
    if (words.length === 0 || options.length === 0) {
      log.warn("skipping unusable definition entry", { words: entry?.words });
      continue;
    }
    if (options.length > MAX_OPTIONS) {
      log.warn("definition entry has too many options; extras dropped", {
        words,
        dropped: options.length - MAX_OPTIONS,
      });
    }
    out.push({
      entry: { ...entry, words, options: options.slice(0, MAX_OPTIONS) },
      list: compileItems(words.map((word) => ({ word, fuzzy: true }))),
    });
  }
  return out;
}

/**
 * Finds the entry a message earns. Entries are tried in config order and the
 * first hit wins - one question per message, however many listed words were
 * used.
 * @param content - Raw message content.
 * @param compiled - The compiled entries to try.
 * @returns The matched entry, or null when nothing listed was said.
 */
export function matchEntry(content: string, compiled: CompiledEntry[]): DefinitionEntry | null {
  for (const { entry, list } of compiled) {
    if (countMatches(content, list).size > 0) return entry;
  }
  return null;
}

/** Compiled entries per guild, keyed by the {@link configFingerprint} they were built from. */
const cache = new Map<string, { fingerprint: string; compiled: CompiledEntry[] }>();

/**
 * Loads and compiles a guild's entries (guild definitions.json, then global),
 * reusing the last compile while the files are unchanged. Every message runs
 * this and a compile builds a regex per word, so the cache is what keeps that
 * work off the hot path.
 * @param guildId - Discord guild (server) ID.
 * @returns The compiled entries for matching.
 */
function loadEntries(guildId: string): CompiledEntry[] {
  const current = configFingerprint(guildId, DEFINITIONS_FILE);
  const cached = cache.get(guildId);
  if (cached?.fingerprint === current) return cached.compiled;
  const config = readDefinitions(guildId) ?? readDefinitions("global") ?? NO_DEFINITIONS;
  const compiled = compileEntries(config);
  cache.set(guildId, { fingerprint: current, compiled });
  return compiled;
}

// Per guild:user last prompt time, so the question cannot be farmed by
// repeating the word.
const lastPrompt = new Map<string, number>();

// Per guild:user questions still waiting on an answer. The question does not
// expire, and each one holds a live collector, so one person saying the word
// again must not stack a second: they answer the one they have.
const openPrompts = new Set<string>();

/**
 * Asks which meaning the author had in mind and posts the one they pick.
 * Silent during calm mode, within the author's cooldown, while they already
 * owe an answer, or when no definitions.json lists the word.
 *
 * Only the author's clicks count, and the window comes from the guild's
 * `/setdelay` by way of {@link promptWindow} - long enough that owning a
 * meaning is the way out, not waiting. An unanswered question is left standing
 * with its buttons stripped. Best-effort.
 * @param message - The guild message to consider.
 * @returns A promise resolving to `true` when a definition was posted.
 */
export async function offerDefinition(message: Message<true>): Promise<boolean> {
  if (isCalm(message.guildId)) return false;
  const content = message.content;
  if (!content) return false;

  const guildId = message.guildId;
  const authorId = message.author.id;
  const entry = matchEntry(content, loadEntries(guildId));
  if (!entry) return false;

  const userKey = `${guildId}:${authorId}`;
  const now = Date.now();
  if (openPrompts.has(userKey)) {
    log.debug("skipping prompt: the author already owes an answer", { guildId, authorId });
    return false;
  }
  if (now - (lastPrompt.get(userKey) ?? 0) < RESPONSE_COOLDOWN_MS) return false;
  lastPrompt.set(userKey, now);
  openPrompts.add(userKey);

  try {
    const mention = `<@${authorId}>`;
    log.info("definition prompt sent", { guildId, authorId, words: entry.words });
    const outcome = await requestChoice(
      message.channel,
      message.author,
      entry.options.map((o) => ({
        id: o.id,
        label: o.label,
        emoji: o.emoji,
        style: ButtonStyle.Secondary,
      })),
      {
        prompt: entry.prompt.replaceAll("{user}", mention),
        grace: promptWindow(loadSettings(guildId).grace),
        // The question is half the joke - leave it up whether or not it was
        // answered, with the buttons stripped once it closes.
        autoDelete: false,
      },
    );

    const option = entry.options.find((o) => o.id === outcome.choice);
    if (!option) return false;

    log.info("definition chosen", { guildId, authorId, choice: option.id });
    const sent = await message
      .reply({
        content: option.reply.replaceAll("{user}", mention),
        allowedMentions: { users: [authorId], repliedUser: true },
      })
      .catch((err: unknown) => {
        log.warn("failed to post definition", {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
    if (!sent) return false;

    // Link the definition to the message that earned it, so deleting that takes
    // the definition down too.
    recordReply(guildId, message.id, { channelId: sent.channelId, messageId: sent.id });
    return true;
  } finally {
    openPrompts.delete(userKey);
  }
}
