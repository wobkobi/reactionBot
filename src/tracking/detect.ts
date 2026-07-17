// src/tracking/detect.ts

/**
 * @file Generic word/phrase detection shared by the trackers and reactions.
 * Words come from the unified config (see tracking/words.ts) and are matched
 * whole-word, leetspeak- and diacritic-insensitive. Fuzzy items compile into
 * an obfuscation-tolerant regex (see {@link wordToPattern}).
 */

/** One word/phrase to compile, with its matching mode and metadata. */
export interface CompileItem {
  word: string;
  /** Compile into an obfuscation-tolerant pattern instead of a literal phrase. */
  fuzzy?: boolean;
  category?: string;
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

// Discord structural tokens: custom emojis (<:name:id>), user/role/channel
// mentions, timestamps, and slash-command mentions. Dropped before matching so
// emoji NAMES don't count as said words and so their long digit IDs can't
// de-leet into phantom letter-soup matches.
const DISCORD_TOKEN_REGEX = /<a?:\w+:\d+>|<\/[\w -]+:\d+>|<[@#][!&]?\d+>|<t:-?\d+(?::[a-zA-Z])?>/g;

// Zero-width and other invisible characters (ZWSP/ZWJ/ZWNJ, word joiner,
// BOM, soft hyphen). Removed (not spaced) so a zero-width-broken "slur" still reads "slur"
// instead of evading the whole-word matchers.
const INVISIBLE_CHARS_REGEX = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;

// Links: words inside a URL weren't said by the poster.
const URL_REGEX = /https?:\/\/\S+/gi;

/**
 * Normalises text for detection: drops Discord tokens, URLs, invisible
 * characters, and markdown marks, then lowercases, de-leetspeaks, strips
 * diacritics, and collapses non-alphanumeric runs to single spaces.
 * Apostrophes are removed rather than spaced so contractions stay one word:
 * "can't"/"can’t" fold to "cant" and match a "cant" list entry.
 * @param text - The input text to normalise.
 * @returns A cleaned, lowercase string of words separated by single spaces.
 */
export function normalise(text: string): string {
  let s = text.replace(DISCORD_TOKEN_REGEX, " ").replace(URL_REGEX, " ");
  s = s.replace(INVISIBLE_CHARS_REGEX, "");
  // Fold markdown marks so "sl**ur**" and "||slur||" read whole. Spoiler
  // pipes are stripped as a PAIR before the leet map turns single "|" into
  // "i" (which would wrap the word in letters and defeat word boundaries).
  s = s.replace(/\|\|/g, "").replace(/[*_~`]/g, "");
  s = s.toLowerCase();
  s = s.replace(/[0134578@$!|¿]/g, (m) => LEET_MAP[m] ?? m);
  s = s.normalize("NFKD").replace(/\p{Diacritic}+/gu, "");
  s = s.replace(/['’`´]/g, "");
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ");
  s = s.trim().replace(/\s+/g, " ");
  return s;
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
  for (let i = 0; i < word.length;) {
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
 * Compiles words into a matchable {@link DetectList}. Each item chooses its
 * own mode: fuzzy items become obfuscation-tolerant patterns, the rest are
 * whole-word literal phrases.
 * @param items - The words to compile, with per-item mode and metadata.
 * @returns A {@link DetectList} of literal phrases and regex patterns.
 */
export function compileItems(items: CompileItem[]): DetectList {
  const phrases: string[] = [];
  const patterns: Array<{ word: string; re: RegExp }> = [];
  const category = new Map<string, string>();

  for (const item of items) {
    const word = normalise(item.word);
    if (!word) continue;
    if (item.fuzzy) {
      patterns.push({ word, re: boundedPattern(wordToPattern(word)) });
    } else {
      phrases.push(word);
    }
    if (item.category) category.set(word, item.category);
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
 * @param list - A compiled {@link DetectList} from {@link compileItems}.
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
 * @param category - Word > category map from a compiled {@link DetectList}.
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
