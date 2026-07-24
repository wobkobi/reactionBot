// src/tracking/words.ts

/**
 * @file The single word-list config: data/global/words.json (a per-guild
 * words.json overrides it wholesale). Types define behaviour once - which
 * counter they feed, their default reaction, competition pool, matching mode -
 * and the words are listed per type. An entry-level `reaction` overrides the
 * type default. A word may appear under several types.
 *
 * ```json
 * {
 *   "types": {
 *     "swear":   { "track": "swears" },
 *     "slur":    { "track": "slurs", "fuzzy": true },
 *     "insult":  { "track": "called" },
 *     "british": { "reaction": "🇬🇧", "pool": "slang", "fuzzy": true }
 *   },
 *   "words": {
 *     "british": ["cheeky", "bender"],
 *     "insult": ["bender"],
 *     "slur": [{ "word": "...", "category": "black", "reaction": "nword" }]
 *   }
 * }
 * ```
 */

import { CompileItem, compileItems, DetectList, normalise } from "@/tracking/detect.js";
import { dataFilePath } from "@/utils/file.js";
import { createLogger } from "@/utils/log.js";
import fs from "fs";

const log = createLogger("tracking/words");

/** Filename of the unified word config. */
export const WORDS_FILE = "words.json";

/** The counters a type can feed. */
export type TrackKey = "swears" | "slurs" | "called";

/** Behaviour of one word type, defined once in the config's `types` map. */
export interface TypeDef {
  /** Counter this type feeds; omit for react-only types. */
  track?: TrackKey;
  /** Default reaction for words of this type: an emoji, or a word to spell. */
  reaction?: string;
  /** Reactions sharing a pool compete - one random pick per message. */
  pool?: string;
  /** Match with the obfuscation-tolerant fuzzy patterns. */
  fuzzy?: boolean;
  /** Also fire this type's reaction when the message contains this emoji. */
  triggerEmoji?: string;
}

/** One entry in a type's word list: the word, or an object with extras. */
export type WordItem =
  | string
  | {
      word: string;
      /** Category for the group breakdowns (e.g. /slurgroups). */
      category?: string;
      /** Overrides the type-default reaction for this entry only. */
      reaction?: string;
      /** Overrides the type-default pool when `reaction` is set. */
      pool?: string;
    };

/** Shape of words.json: type definitions plus per-type word lists. */
export interface WordsConfig {
  types?: Record<string, TypeDef>;
  words?: Record<string, WordItem[]>;
}

/** A reaction to fire: the emoji-or-word plus its competition pool. */
export interface ReactionSpec {
  value: string;
  pool?: string;
}

/** The compiled config, ready for matching. */
export interface CompiledWords {
  /** One detect list per counter. */
  tracks: Record<TrackKey, DetectList>;
  /** One detect list per type name, for the per-type reply pools. */
  typeLists: Map<string, { def: TypeDef; list: DetectList }>;
  /** Matcher over every word that carries a reaction. */
  reactionList: DetectList;
  /** Canonical word > reactions to fire when it matches. */
  reactionSpecs: Map<string, ReactionSpec[]>;
  /** Type-level emoji triggers (e.g. a 🦙 in the message fires the 🦙). */
  emojiTriggers: Array<{ emoji: string; spec: ReactionSpec }>;
}

/**
 * Parses JSON that may contain JSONC-style comments and trailing commas.
 * words.json is hand-edited, so both are tolerated: line (`//`) and block
 * comments are stripped (string contents are preserved - a "//" inside a
 * quoted value is untouched), then trailing commas before `}`/`]` dropped.
 * @param raw - Raw file contents.
 * @returns The parsed value.
 */
export function parseJsonc<T>(raw: string): T {
  let stripped = "";
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      stripped += ch;
      if (ch === "\\") {
        stripped += raw[++i] ?? "";
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      stripped += ch;
      continue;
    }
    if (ch === "/" && raw[i + 1] === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      stripped += "\n";
      continue;
    }
    if (ch === "/" && raw[i + 1] === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
      i++;
      continue;
    }
    stripped += ch;
  }

  // Drop trailing commas (string-aware: quoted commas stay).
  let out = "";
  inString = false;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += stripped[++i] ?? "";
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ",") {
      let j = i + 1;
      while (j < stripped.length && /\s/.test(stripped[j])) j++;
      if (stripped[j] === "}" || stripped[j] === "]") continue;
    }
    out += ch;
  }
  return JSON.parse(out) as T;
}

/**
 * Reads and parses a words.json (with comment/trailing-comma tolerance).
 * @param guildId - Discord guild ID or "global".
 * @returns The parsed {@link WordsConfig}, or `null` when missing/broken.
 */
function readWordsFile(guildId: string): WordsConfig | null {
  const filePath = dataFilePath(guildId, WORDS_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    return parseJsonc<WordsConfig>(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    log.error("failed to parse words config", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Loads and compiles the guild's word config (guild words.json wholesale
 * overrides the global one).
 * @param guildId - Discord guild ID.
 * @returns The {@link CompiledWords} for matching and reacting.
 */
export function loadWords(guildId: string): CompiledWords {
  const guildCfg = readWordsFile(guildId);
  const cfg =
    guildCfg?.words && Object.keys(guildCfg.words).length > 0
      ? guildCfg
      : (readWordsFile("global") ?? {});

  const types = cfg.types ?? {};

  const trackItems: Record<TrackKey, CompileItem[]> = { swears: [], slurs: [], called: [] };
  const typeItems = new Map<string, CompileItem[]>();
  const reactionItems: CompileItem[] = [];
  const reactionSpecs = new Map<string, ReactionSpec[]>();
  const seenReactionWords = new Set<string>();

  for (const [typeName, items] of Object.entries(cfg.words ?? {})) {
    const def = types[typeName];
    if (!def) {
      log.warn("word list for unknown type", { type: typeName });
      continue;
    }
    for (const raw of items ?? []) {
      const item = typeof raw === "string" ? { word: raw } : raw;
      if (!item?.word) continue;

      const compileItem: CompileItem = {
        word: item.word,
        fuzzy: def.fuzzy,
        category: item.category,
      };
      typeItems.set(typeName, [...(typeItems.get(typeName) ?? []), compileItem]);

      if (def.track) {
        trackItems[def.track].push(compileItem);
      }

      // Entry-level reaction overrides this type's default.
      const spec: ReactionSpec | null = item.reaction
        ? { value: item.reaction, pool: item.pool }
        : def.reaction
          ? { value: def.reaction, pool: def.pool }
          : null;
      if (spec) {
        const canonical = normalise(item.word);
        if (canonical) {
          if (!seenReactionWords.has(canonical)) {
            seenReactionWords.add(canonical);
            reactionItems.push({ word: item.word, fuzzy: def.fuzzy });
          }
          reactionSpecs.set(canonical, [...(reactionSpecs.get(canonical) ?? []), spec]);
        }
      }
    }
  }

  const emojiTriggers = Object.values(types)
    .filter((t) => t.triggerEmoji && t.reaction)
    .map((t) => ({ emoji: t.triggerEmoji!, spec: { value: t.reaction!, pool: t.pool } }));

  const typeLists = new Map<string, { def: TypeDef; list: DetectList }>();
  for (const [typeName, items] of typeItems) {
    typeLists.set(typeName, { def: types[typeName], list: compileItems(items) });
  }

  return {
    tracks: {
      swears: compileItems(trackItems.swears),
      slurs: compileItems(trackItems.slurs),
      called: compileItems(trackItems.called),
    },
    typeLists,
    reactionList: compileItems(reactionItems),
    reactionSpecs,
    emojiTriggers,
  };
}
