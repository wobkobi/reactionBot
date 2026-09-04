// src/voice/sounds.ts

// Spoken triggers and the clip pools they fire. Config resolution mirrors
// words.json: a guild's sounds.json overrides the global one wholesale, and a
// fingerprint cache picks up hand edits without a restart.
//
// Matching runs in two tiers. Tier one reuses tracking/detect.ts, so triggers
// inherit its normalisation (punctuation and capitalisation folding, diacritic
// stripping, whole-word Unicode boundaries). Tier two is phonetic and exists
// because Whisper mishears: it writes "swig" or "sweg" for "swag". See
// {@link phoneticMatch} for the guards that keep tier two from firing on
// ordinary speech.

import { compileItems, countMatches, normalise, type DetectList } from "@/tracking/detect";
import { parseJsonc } from "@/tracking/words";
import { configFingerprint, dataFilePath, guildDataDir } from "@/utils/file";
import { createLogger } from "@/utils/log";
import { COMMON_WORDS } from "@/voice/commonWords";
import { doubleMetaphone } from "double-metaphone";
import fs from "fs";
import path from "path";

const log = createLogger("voice/sounds");

/** Config file naming the triggers and pools. */
export const SOUNDS_FILE = "sounds.json";

/** Folder holding the clip files, under a guild's data dir or the shared root. */
export const SOUNDS_DIR = "sounds";

/**
 * Shortest trigger the phonetic tier will consider. Codes for two- and
 * three-letter words carry almost no information and collide with most of the
 * language.
 */
export const MIN_PHONETIC_LENGTH = 4;

/** One spoken trigger and the pool it fires. */
export interface SoundTrigger {
  words: string[];
  pool: string;
  fuzzy?: boolean;
  phonetic?: boolean;
  cooldownMs?: number;
}

/** Parsed sounds.json. */
export interface SoundsConfig {
  enabled?: boolean;
  minMembers?: number;
  guildCooldownMs?: number;
  userCooldownMs?: number;
  phonetic?: boolean;
  logTranscripts?: boolean;
  ignore?: string[];
  pools?: Record<string, string[]>;
  triggers?: SoundTrigger[];
}

/** A trigger word reduced to what the phonetic tier compares. */
interface PhoneticKey {
  /** Both Double Metaphone codes for the word. */
  codes: [string, string];
  /** First letter, which vetoes voiced/unvoiced confusions like drip vs trip. */
  initial: string;
}

/** A trigger compiled for matching, with its resolved clip list. */
export interface CompiledTrigger {
  trigger: SoundTrigger;
  files: string[];
  list: DetectList;
  phonetic: PhoneticKey[];
  cooldownMs?: number;
}

/** A whole config compiled and ready to match against transcripts. */
export interface CompiledSounds {
  config: SoundsConfig;
  triggers: CompiledTrigger[];
  ignore: DetectList;
}

/**
 * Reduces a word to its two Double Metaphone codes.
 * @param word - A single normalised word.
 * @returns The primary and secondary codes.
 */
function codesFor(word: string): [string, string] {
  const [primary, secondary] = doubleMetaphone(word);
  return [primary, secondary];
}

/**
 * Whether two code pairs share any code. Double Metaphone returns a secondary
 * spelling for words that are pronounced more than one way, and a match on
 * either is a match.
 * @param a - First word's codes.
 * @param b - Second word's codes.
 * @returns `true` when the words can be pronounced the same.
 */
function codesOverlap(a: [string, string], b: [string, string]): boolean {
  return a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1];
}

/**
 * Tests one heard word against a trigger's phonetic keys, applying the guards
 * that make the tier usable.
 *
 * Three conditions must all hold. The codes must overlap, which is the actual
 * soundalike test. The first letters must agree, because Double Metaphone
 * folds voiced and unvoiced consonants together and would otherwise match
 * "trip" to "drip" and "paced" to "based". And the heard word must not be
 * everyday English ({@link COMMON_WORDS}), because the vowel folding otherwise
 * matches "swag" to "sick", "sock", "sack", "seek" and "soak", and "yeet" to
 * "yet". Measured against a common-word list, all three together produce no
 * false hits while still catching genuine mishearings.
 * @param heard - One normalised word from the transcript.
 * @param keys - The trigger's precompiled phonetic keys.
 * @returns `true` when the word sounds like the trigger and passes the guards.
 */
export function phoneticMatch(heard: string, keys: PhoneticKey[]): boolean {
  if (keys.length === 0) return false;
  if (heard.length < MIN_PHONETIC_LENGTH) return false;
  if (COMMON_WORDS.has(heard)) return false;
  const heardCodes = codesFor(heard);
  const initial = heard[0];
  return keys.some((key) => key.initial === initial && codesOverlap(heardCodes, key.codes));
}

/**
 * Expands a trigger word into the forms tier one should match. A multi-word
 * phrase also gets its spaces removed: {@link normalise} keeps word gaps and
 * the compiled pattern needs one, but Whisper routinely writes "shutup" for
 * "shut up", which would otherwise never fire.
 * @param word - A raw trigger word or phrase from the config.
 * @returns The forms to compile, without duplicates.
 */
function triggerForms(word: string): string[] {
  const normalised = normalise(word);
  if (!normalised) return [];
  const joined = normalised.replace(/\s+/g, "");
  return joined !== normalised ? [normalised, joined] : [normalised];
}

/**
 * Rejects clip names that would escape the sounds folder. Config files are
 * hand-edited, so a name reaches the filesystem straight from user input.
 * @param name - Clip name as written in the config.
 * @returns The name unchanged, or null when it is unsafe.
 */
export function safeClipName(name: string): string | null {
  if (!name || typeof name !== "string") return null;
  if (path.isAbsolute(name) || /^[a-zA-Z]:/.test(name)) return null;
  const parts = name.split(/[\\/]/);
  if (parts.some((part) => part === ".." || part === "." || part === "")) return null;
  return name;
}

/**
 * Compiles a parsed config into matchable form, dropping triggers that cannot
 * fire and saying why.
 * @param config - The parsed sounds.json.
 * @returns The compiled triggers and ignore list.
 */
export function compileSounds(config: SoundsConfig): CompiledSounds {
  const pools = config.pools ?? {};
  const phoneticDefault = config.phonetic ?? true;
  const triggers: CompiledTrigger[] = [];

  for (const trigger of config.triggers ?? []) {
    const words = (trigger.words ?? []).filter((word) => typeof word === "string" && word.trim());
    if (words.length === 0) {
      log.warn("trigger has no words", { pool: trigger.pool });
      continue;
    }

    const rawFiles = pools[trigger.pool];
    if (!rawFiles) {
      log.warn("trigger names an unknown pool", { pool: trigger.pool, words });
      continue;
    }

    const files = rawFiles.map(safeClipName).filter((name): name is string => name !== null);
    if (files.length !== rawFiles.length) {
      log.warn("pool dropped unsafe clip names", { pool: trigger.pool });
    }
    if (files.length === 0) {
      log.warn("trigger names an empty pool", { pool: trigger.pool, words });
      continue;
    }

    const forms = words.flatMap(triggerForms);
    if (forms.length === 0) continue;

    const usePhonetic = trigger.phonetic ?? phoneticDefault;
    const phonetic: PhoneticKey[] = usePhonetic
      ? [...new Set(forms)]
          .filter((form) => !form.includes(" ") && form.length >= MIN_PHONETIC_LENGTH)
          .map((form) => ({ codes: codesFor(form), initial: form[0]! }))
      : [];

    triggers.push({
      trigger,
      files,
      list: compileItems(forms.map((word) => ({ word, fuzzy: trigger.fuzzy }))),
      phonetic,
      cooldownMs: trigger.cooldownMs,
    });
  }

  const ignore = compileItems((config.ignore ?? []).map((word) => ({ word })));
  return { config, triggers, ignore };
}

/**
 * Finds the trigger a transcript fires. Tier one runs first across every
 * trigger, so an exact hit always beats a soundalike one; only when nothing
 * matched exactly does the phonetic tier run.
 * @param text - The raw transcript from the transcriber.
 * @param compiled - The compiled config from {@link compileSounds}.
 * @returns The first matching trigger in config order, or null.
 */
export function matchTrigger(text: string, compiled: CompiledSounds): CompiledTrigger | null {
  for (const entry of compiled.triggers) {
    if (countMatches(text, entry.list).size > 0) return entry;
  }

  const heardWords = normalise(text).split(" ").filter(Boolean);
  if (heardWords.length === 0) return null;
  for (const entry of compiled.triggers) {
    if (heardWords.some((heard) => phoneticMatch(heard, entry.phonetic))) return entry;
  }
  return null;
}

/**
 * Whether a transcript is one of the phrases Whisper invents on near-silence
 * (or anything else the config vetoes).
 * @param text - The raw transcript.
 * @param compiled - The compiled config.
 * @returns `true` when the transcript should be discarded.
 */
export function isIgnoredTranscript(text: string, compiled: CompiledSounds): boolean {
  return countMatches(text, compiled.ignore).size > 0;
}

/**
 * Picks one clip from a pool.
 * @param files - The pool's clip names.
 * @param randomIndex - Any non-negative integer; wrapped to the pool size.
 * @returns The chosen clip name, or null for an empty pool.
 */
export function pickClip(files: string[], randomIndex: number): string | null {
  if (files.length === 0) return null;
  return files[Math.abs(Math.trunc(randomIndex)) % files.length] ?? null;
}

/**
 * Reads and parses a sounds.json, tolerating comments and trailing commas the
 * way the other hand-edited configs do.
 * @param scope - Discord guild ID or "global".
 * @returns The parsed config, or null when missing or broken.
 */
export function readSounds(scope: string): SoundsConfig | null {
  const filePath = dataFilePath(scope, SOUNDS_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    return parseJsonc<SoundsConfig>(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    log.error("failed to parse sounds config", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Resolves a clip name to a file on disk, preferring a guild's own copy over
 * the shared folder so a server can override one clip without copying the set.
 * @param guildId - Discord guild ID.
 * @param name - Clip name from the config.
 * @returns An absolute path to an existing file, or null.
 */
export function resolveClipPath(guildId: string, name: string): string | null {
  const safe = safeClipName(name);
  if (!safe) {
    log.warn("refused unsafe clip name", { guildId, name });
    return null;
  }
  // guildDataDir("sounds") is data/sounds: the shared folder sits alongside the
  // per-guild ones, and guild IDs are snowflakes so the name cannot collide.
  const candidates = [
    path.join(guildDataDir(guildId), SOUNDS_DIR, safe),
    path.join(guildDataDir(SOUNDS_DIR), safe),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** Compiled config per guild, keyed by the {@link configFingerprint} it came from. */
const cache = new Map<string, { fingerprint: string; compiled: CompiledSounds }>();

/**
 * Loads and compiles a guild's sound config, reusing the last compile while
 * both files are unchanged. Every utterance runs this, and a compile builds a
 * regex per trigger, so the cache is what keeps that work off the hot path.
 * @param guildId - Discord guild ID.
 * @returns The compiled config for matching.
 */
export function loadSounds(guildId: string): CompiledSounds {
  const current = configFingerprint(guildId, SOUNDS_FILE);
  const cached = cache.get(guildId);
  if (cached?.fingerprint === current) return cached.compiled;

  const guildCfg = readSounds(guildId);
  const cfg =
    guildCfg?.triggers && guildCfg.triggers.length > 0 ? guildCfg : (readSounds("global") ?? {});
  const compiled = compileSounds(cfg);
  cache.set(guildId, { fingerprint: current, compiled });
  return compiled;
}
