// src/voice/sounds.ts

// Spoken triggers and the clip pools they fire, resolved like every other
// scoped config and cached on a fingerprint so hand edits apply without a restart.
//
// Matching runs in two tiers: tracking/detect.ts first, then a phonetic pass,
// because Whisper writes "swig" or "sweg" for "swag". See phoneticMatch for
// the guards that keep that tier off ordinary speech.

import { compileItems, countMatches, normalise, type DetectList } from "@/tracking/detect";
import { configFingerprint, dataFilePath, guildDataDir, resolveScoped } from "@/utils/file";
import { parseJsonc } from "@/utils/jsonc";
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

/**
 * One spoken trigger and the clips it fires. Name a `pool` (a folder under
 * data/sounds, or a key in the optional `pools` block) or list `sounds`
 * inline; a trigger with neither plays nothing.
 */
export interface SoundTrigger {
  words: string[];
  pool?: string;
  sounds?: string[];
  fuzzy?: boolean;
  phonetic?: boolean;
  cooldownMs?: number;
}

/** One person's entrance: what plays as they arrive, and what gets posted. */
export interface Entrance {
  /** Discord user IDs this applies to; several can share one entrance. */
  users: string[];
  /** Text to post. A link on its own line embeds; anything else is sent as written. */
  message?: string;
  /**
   * A file to attach, named relative to the entrances folder. Preferred over a
   * link for anything that has to keep working: a Discord CDN URL is signed and
   * dies after 24 hours, and any other host can go away on its own schedule.
   */
  file?: string;
  /**
   * A clip folder under the sounds directory, played as they arrive. The same
   * pools the triggers draw on, so a clip need not be kept twice.
   */
  pool?: string;
}

/** Entrances, and the one channel their posts go to. */
export interface EntrancesConfig {
  /** Text channel the posts are made in. Nothing is posted without one. */
  channelId?: string;
  /** Who gets an entrance, and what. */
  list?: Entrance[];
}

/** Occasional unprompted sounds while the bot is sitting in a channel. */
export interface AmbientConfig {
  pool?: string;
  sounds?: string[];
  minMinutes?: number;
  maxMinutes?: number;
}

/** Parsed sounds.json. */
export interface SoundsConfig {
  enabled?: boolean;
  minMembers?: number;
  guildCooldownMs?: number;
  phonetic?: boolean;
  logTranscripts?: boolean;
  ignore?: string[];
  pools?: Record<string, string[]>;
  triggers?: SoundTrigger[];
  ambient?: AmbientConfig;
  entrances?: EntrancesConfig;
}

/** A trigger word reduced to what the phonetic tier compares. */
interface PhoneticKey {
  /** Both Double Metaphone codes for the word. */
  codes: [string, string];
  /** First letter, which vetoes voiced/unvoiced confusions like drip vs trip. */
  initial: string;
}

/**
 * Where a trigger's clips come from. A named pool is resolved against the
 * filesystem when it is about to play rather than when the config is read, so
 * dropping a file into the folder takes effect without touching the JSON.
 */
export type ClipSource = { kind: "list"; files: string[] } | { kind: "folder"; name: string };

/** A trigger compiled for matching, with the clips it will draw from. */
export interface CompiledTrigger {
  trigger: SoundTrigger;
  source: ClipSource;
  list: DetectList;
  phonetic: PhoneticKey[];
  cooldownMs?: number;
}

/** Ambient playback: where its clips come from and how far apart they fall. */
export interface CompiledAmbient {
  source: ClipSource;
  minMs: number;
  maxMs: number;
}

/** A whole config compiled and ready to match against transcripts. */
export interface CompiledSounds {
  config: SoundsConfig;
  triggers: CompiledTrigger[];
  ignore: DetectList;
  ambient: CompiledAmbient | null;
}

/** Default gap either side of an ambient sound when the config gives none. */
export const AMBIENT_MIN_MS = 5 * 60_000;
export const AMBIENT_MAX_MS = 20 * 60_000;

/**
 * Shortest gap accepted. A range of zero would fire as fast as clips finish,
 * which is a fault rather than a setting.
 */
export const AMBIENT_FLOOR_MS = 10_000;

/**
 * Works out where a trigger or the ambient block draws its clips from. Inline
 * `sounds` win, then an explicit `pools` entry, and otherwise the name is taken
 * as a folder under data/sounds and read when it is about to play.
 * @param named - The `pool` name, if one was given.
 * @param inline - Clips listed directly on the entry, if any.
 * @param pools - The optional `pools` block.
 * @returns Where the clips come from, or null when neither was given.
 */
function clipSource(
  named: string | undefined,
  inline: string[] | undefined,
  pools: Record<string, string[]>,
): ClipSource | null {
  const listed = (inline ?? []).map(safeClipName).filter((n): n is string => n !== null);
  if (listed.length > 0) return { kind: "list", files: listed };
  if (!named) return null;

  const explicit = pools[named];
  if (explicit) {
    const files = explicit.map(safeClipName).filter((n): n is string => n !== null);
    return files.length > 0 ? { kind: "list", files } : null;
  }
  return safeClipName(named) ? { kind: "folder", name: named } : null;
}

/**
 * Resolves the ambient block, or null when it is absent or names nothing.
 * @param config - The parsed config.
 * @param pools - The optional `pools` block.
 * @returns The compiled ambient settings, or null when ambient is off.
 */
function compileAmbient(
  config: SoundsConfig,
  pools: Record<string, string[]>,
): CompiledAmbient | null {
  const ambient = config.ambient;
  if (!ambient) return null;

  const source = clipSource(ambient.pool, ambient.sounds, pools);
  if (!source) {
    log.warn("ambient names no clips", { pool: ambient.pool });
    return null;
  }

  const minMs = Math.max(AMBIENT_FLOOR_MS, (ambient.minMinutes ?? 5) * 60_000);
  // A max below the min would otherwise produce a negative range; treat the
  // pair as one value rather than refusing the whole block.
  const maxMs = Math.max(minMs, (ambient.maxMinutes ?? 20) * 60_000);
  return { source, minMs, maxMs };
}

/**
 * Picks the gap before the next ambient sound, re-rolled after each one so the
 * timing never settles into a rhythm.
 * @param minMs - Shortest gap.
 * @param maxMs - Longest gap.
 * @param roll - A value in [0, 1); the caller supplies it so this stays pure.
 * @returns The delay in milliseconds.
 */
export function nextAmbientDelay(minMs: number, maxMs: number, roll: number): number {
  const low = Math.max(AMBIENT_FLOOR_MS, Math.min(minMs, maxMs));
  const high = Math.max(low, maxMs);
  const clamped = Math.min(Math.max(roll, 0), 0.999999);
  return Math.round(low + (high - low) * clamped);
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
      log.warn("trigger has no words", { pool: trigger.pool ?? "(inline)" });
      continue;
    }

    const source = clipSource(trigger.pool, trigger.sounds, pools);
    if (!source) {
      log.warn("trigger names no clips", { pool: trigger.pool, words });
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
      source,
      list: compileItems(forms.map((word) => ({ word, fuzzy: trigger.fuzzy }))),
      phonetic,
      cooldownMs: trigger.cooldownMs,
    });
  }

  const ignore = compileItems((config.ignore ?? []).map((word) => ({ word })));
  return { config, triggers, ignore, ambient: compileAmbient(config, pools) };
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
 * Extensions treated as clips when reading a pool folder. Everything else in
 * there (notes, artwork, half-finished edits) is ignored rather than queued up
 * to fail at playback.
 *
 * Video containers are in the list because the conversion already drops the
 * picture - ffmpegArgs passes `-vn -map a:0` - so a clip saved as the video it
 * was cut from plays its audio without anyone having to strip it first. WebM
 * was always here and is one of them.
 */
const CLIP_EXTENSIONS = new Set([
  ".ogg",
  ".opus",
  ".webm",
  ".mp3",
  ".wav",
  ".m4a",
  ".flac",
  ".mp4",
  ".mov",
  ".mkv",
]);

/**
 * Lists the clips in a pool folder, looked up under the guild's own sounds
 * folder first and then the shared one. Reading the folder each time is what
 * lets someone add a clip without editing any JSON.
 * @param guildId - Discord guild (server) ID.
 * @param name - Folder name, relative to a sounds folder.
 * @returns Clip names relative to the sounds folder, sorted for a stable order.
 */
export function readPoolFolder(guildId: string, name: string): string[] {
  const safe = safeClipName(name);
  if (!safe) return [];

  // Same order as a single clip: the guild's own folder first, then the shared
  // one, so a server can replace a whole pool without copying the rest.
  const candidates = [
    path.join(guildDataDir(guildId), SOUNDS_DIR, safe),
    path.join(guildDataDir(SOUNDS_DIR), safe),
  ];
  for (const folder of candidates) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    const files = entries
      .filter((e) => e.isFile() && CLIP_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
      .map((e) => `${safe}/${e.name}`)
      .sort();
    if (files.length > 0) return files;
  }
  return [];
}

/**
 * Resolves a clip source to the names it can play right now.
 * @param guildId - Discord guild (server) ID.
 * @param source - Where the clips come from.
 * @returns Clip names, empty when the folder is missing or holds no audio.
 */
export function resolveClips(guildId: string, source: ClipSource): string[] {
  return source.kind === "list" ? source.files : readPoolFolder(guildId, source.name);
}

/**
 * Identifies the pool a trigger draws from, so its cooldown is shared with
 * every other trigger playing the same clips and with nothing else. Two
 * triggers pointing at one folder are the same sound to whoever is listening,
 * and letting them take turns would double how often it plays.
 * @param source - Where the trigger's clips come from.
 * @returns A key stable across reloads for the same set of clips.
 */
export function poolKey(source: ClipSource): string {
  return source.kind === "folder" ? `folder:${source.name}` : `list:${source.files.join("|")}`;
}

/**
 * Whether a guild has anything worth joining a channel for. Ambient sounds
 * need no triggers, so testing triggers alone would keep the bot out of voice
 * for a config that only wants atmosphere.
 * @param compiled - The guild's compiled sound config.
 * @returns `true` when something could play.
 */
export function hasSomethingToPlay(compiled: CompiledSounds): boolean {
  return compiled.triggers.length > 0 || compiled.ambient !== null;
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

  const cfg = resolveScoped(guildId, readSounds) ?? {};
  const compiled = compileSounds(cfg);
  cache.set(guildId, { fingerprint: current, compiled });
  return compiled;
}
