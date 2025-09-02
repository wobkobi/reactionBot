// src/swears/detector.ts

/**
 * @file Swear detection utilities.
 * This file does not include actual slur words in source.
 * Populate them in `data/global/swears.json` or per-guild overrides.
 */

import { loadData } from "../utils/file.js";
import { createLogger } from "../utils/log.js";

const log = createLogger("swears/detector");
/**
 * Configuration object for a swear set.
 */
export interface SwearConfig {
  /** Lowercased swear words to detect. */
  words: string[];
}

/**
 * Map for replacing common leetspeak characters with their alphabetic equivalents.
 */
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
 * Normalises text for swear detection by:
 * - Converting to lowercase
 * - Replacing common leetspeak characters
 * - Removing diacritics
 * - Replacing non-alphanumeric characters with spaces
 * - Collapsing multiple spaces into one
 * @param text - The input text to normalise.
 * @returns A cleaned, lowercase string with leetspeak normalised.
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
 * Splits normalised text into individual tokens.
 * @param text - The input text to tokenise.
 * @returns An array of word tokens.
 */
export function tokenise(text: string): string[] {
  const norm = normalise(text);
  if (!norm) return [];
  return norm.split(" ").filter(Boolean);
}

/**
 * Loads the swear set for a given guild.
 * Falls back to the global swear list if no per-guild override exists.
 * @param guildId - The Discord guild (server) ID.
 * @returns A set of swear words for quick lookup.
 */
export function loadSwearSet(guildId: string): Set<string> {
  const guildCfg = loadData<SwearConfig | null>(guildId, "swears.json", {
    soft: true,
  });
  const globalCfg = loadData<SwearConfig>("global", "swears.json", {
    soft: true,
  });
  const words = guildCfg?.words?.length
    ? guildCfg.words
    : globalCfg?.words || [];
  log.debug("loaded swear set", {
    guildId,
    count: words.length,
    source: guildCfg?.words?.length ? "guild" : "global",
  });
  return new Set(words.map((w) => w.toLowerCase()));
}

/**
 * Counts swear word occurrences from a token array against a given swear set.
 * @param tokens - Tokenised message content.
 * @param swearSet - A set of swear words to match against.
 * @returns A map of swear words to their occurrence counts.
 */
export function countSwears(
  tokens: string[],
  swearSet: Set<string>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) {
    if (!swearSet.has(t)) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return counts;
}
