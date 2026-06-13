// src/tracking/detect.ts

/**
 * @file Generic word/phrase detection shared by the swear, slur and
 * called-names trackers. Word lists live in `data/global/<list>.json` (or
 * per-guild overrides) and are never hard-coded here. Entries are plain strings
 * ("wanker") or `{ word, category }` objects, matched whole-word and leetspeak-
 * and diacritic-insensitive. Callers may opt into fuzzy matching, which compiles
 * each word into an obfuscation-tolerant regex (see {@link wordToPattern}).
 */

import { loadData } from "@/utils/file.js";

/** A word-list entry: a plain word/phrase, or an object with optional metadata. */
export type WordListEntry = string | { word: string; category?: string };

/** Configuration object for a word list. */
export interface WordListConfig {
  /** Words/phrases to detect (plain strings or objects). */
  words: WordListEntry[];
}

/** A compiled list ready for matching: literal phrases plus regex patterns. */
export interface DetectList {
  /** Normalised literal phrases, whole-word matched. */
  phrases: string[];
  /** Regex entries: the canonical word plus its boundary-wrapped matcher. */
  patterns: Array<{ word: string; re: RegExp }>;
  /** Normalised word > category, for entries that declared one. */
  category: Map<string, string>;
}

/** Map for replacing common leetspeak characters with their alphabetic equivalents. */
const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "i",
  "¿": "i",
};

/**
 * Normalises text for detection by lowercasing, de-leetspeaking, stripping
 * diacritics, and collapsing non-alphanumeric runs to single spaces.
 * @param text - The input text to normalise.
 * @returns A cleaned, lowercase string of words separated by single spaces.
 */
export function normalise(text: string): string {
  let s = text.toLowerCase();
  s = s.replace(/[0134578@$!|¿]/g, (m) => LEET_MAP[m] ?? m);
  s = s.normalize("NFKD").replace(/\p{Diacritic}+/gu, "");
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ");
  s = s.trim().replace(/\s+/g, " ");
  return s;
}

/**
 * Extracts the raw word/phrase from a list entry.
 * @param entry - A string entry or `{ word }` object.
 * @returns The word/phrase, or an empty string when malformed.
 */
function entryWord(entry: WordListEntry): string {
  if (typeof entry === "string") return entry;
  return entry?.word ?? "";
}

/**
 * Wraps a regex source in whole-word boundaries so it only matches as a
 * standalone word (cannot match inside another word).
 * @param source - The user-supplied regex source.
 * @returns A compiled global, case-insensitive, unicode regex.
 */
function boundedPattern(source: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, "giu");
}

/** Substitutions the normaliser does not already fold (it handles 0134578@$!|¿). */
const FUZZY_CLASS: Record<string, string> = {
  g: "[g9]",
};

/**
 * Builds an obfuscation-tolerant regex source from a normalised word: each run
 * of a letter becomes that letter (or its leet class) repeated at least as many
 * times as in the word, with a trailing optional "s" for plurals. Together with
 * the normaliser (which already folds common leetspeak) and the automatic word
 * boundaries, this catches stretched/substituted spellings ("loooser", "l0ser"
 * for "loser") without matching shorter unrelated words (a "soon" pattern
 * requires both o's, so "son" never matches).
 * @param word - A normalised word (lowercase letters and single spaces).
 * @returns A regex source string.
 */
export function wordToPattern(word: string): string {
  let out = "";
  for (let i = 0; i < word.length; ) {
    const ch = word[i];
    let run = 1;
    while (word[i + run] === ch) run++;
    i += run;
    if (ch === " ") {
      out += "\\s+";
      continue;
    }
    const cls = FUZZY_CLASS[ch] ?? ch;
    out += run === 1 ? `${cls}+` : `${cls}{${run},}`;
  }
  return `${out}s*`;
}

/**
 * Loads and compiles the word list for a guild, falling back to the global list
 * when no per-guild override exists.
 * @param guildId - The Discord guild (server) ID.
 * @param listFile - JSON filename for the word list (e.g. "slurs.json").
 * @param fuzzy - When true, each word is compiled into an auto-generated
 *   obfuscation-tolerant pattern instead of a literal phrase.
 * @returns A {@link DetectList} of literal phrases and regex patterns.
 */
export function loadList(guildId: string, listFile: string, fuzzy = false): DetectList {
  const guildCfg = loadData<WordListConfig | null>(guildId, listFile, { soft: true });
  const globalCfg = loadData<WordListConfig>("global", listFile, { soft: true });
  const raw = guildCfg?.words?.length ? guildCfg.words : (globalCfg?.words ?? []);

  const phrases: string[] = [];
  const patterns: Array<{ word: string; re: RegExp }> = [];
  const category = new Map<string, string>();

  for (const entry of raw) {
    const word = normalise(entryWord(entry));
    if (!word) continue;
    if (fuzzy) {
      patterns.push({ word, re: boundedPattern(wordToPattern(word)) });
    } else {
      phrases.push(word);
    }
    if (typeof entry === "object" && entry.category) category.set(word, entry.category);
  }

  return { phrases: [...new Set(phrases)], patterns, category };
}

/**
 * Builds a whole-word matcher for normalised literal phrases (longest first, so
 * multi-word phrases win over their parts), or null when there are none.
 * @param phrases - Normalised phrases.
 * @returns A global, unicode regex, or null.
 */
export function buildMatcher(phrases: string[]): RegExp | null {
  if (phrases.length === 0) return null;
  const escaped = [...phrases]
    .sort((a, b) => b.length - a.length)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})(?![\\p{L}\\p{N}])`, "gu");
}

/**
 * Counts occurrences of any listed phrase or pattern in the text. Literal
 * phrases are recorded under the matched text; pattern hits under the entry's
 * canonical `word`.
 * @param text - Raw message content.
 * @param list - A compiled {@link DetectList} from {@link loadList}.
 * @returns Map of matched word > occurrence count.
 */
export function countMatches(text: string, list: DetectList): Map<string, number> {
  const counts = new Map<string, number>();
  const norm = normalise(text);

  const matcher = buildMatcher(list.phrases);
  if (matcher) {
    for (const m of norm.matchAll(matcher)) {
      counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
    }
  }

  for (const { word, re } of list.patterns) {
    const n = (norm.match(re) ?? []).length;
    if (n > 0) counts.set(word, (counts.get(word) ?? 0) + n);
  }

  return counts;
}

/**
 * Rolls per-word counts up into per-category totals (e.g. which group a user's
 * slurs target most), sorted highest first. Words with no category fall under
 * "uncategorised".
 * @param counts - Word > count map (a user's counts or guild totals).
 * @param category - Word > category map from {@link loadList}.
 * @returns Array of `{ category, count }` sorted desc by count.
 */
export function aggregateByCategory(
  counts: Record<string, number>,
  category: Map<string, string>,
): Array<{ category: string; count: number }> {
  const byCategory = new Map<string, number>();
  for (const [word, n] of Object.entries(counts)) {
    const key = category.get(word) ?? "uncategorised";
    byCategory.set(key, (byCategory.get(key) ?? 0) + n);
  }
  return [...byCategory.entries()]
    .map(([cat, count]) => ({ category: cat, count }))
    .sort((a, b) => b.count - a.count);
}
