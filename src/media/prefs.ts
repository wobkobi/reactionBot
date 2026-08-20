// src/media/prefs.ts

// Per-member move preferences: what each member picked for their own media
// links, and the admin bounds that decide how much of it actually applies.

import { MediaSettings, MemberPref, PersonalLimits } from "@/media/types";
import { loadData, saveData } from "@/utils/file";
import { createLogger } from "@/utils/log";

const log = createLogger("media/prefs");

/** Filename for persisted member preferences, keyed by user ID. */
export const PREFS_FILE = "media_prefs.json";

/**
 * Bounds applied when a guild has never run `/setdelay personal`. Members may
 * set a preference with no admin setup, on the reasoning that nothing changes
 * for a guild until one of its members actually does.
 */
export const DEFAULT_PERSONAL_LIMITS: PersonalLimits = {
  enabled: true,
  maxSeconds: 300,
  allowNever: true,
};

type PrefMap = Record<string, MemberPref>;

/**
 * Loads the guild's preference map, tolerating a missing or corrupt file.
 * @param guildId - Discord guild ID.
 * @returns Map of user ID to {@link MemberPref}.
 */
function loadMap(guildId: string): PrefMap {
  return loadData<PrefMap>(guildId, PREFS_FILE, { soft: true, defaultValue: {} });
}

/**
 * Reads a member's stored preference, exactly as they set it.
 * @param guildId - Discord guild ID.
 * @param userId - The member's user ID.
 * @returns The stored {@link MemberPref}, or `undefined` when they have none.
 */
export function loadPref(guildId: string, userId: string): MemberPref | undefined {
  return loadMap(guildId)[userId];
}

/**
 * Stores a member's preference, replacing any previous one.
 * @param guildId - Discord guild ID.
 * @param userId - The member's user ID.
 * @param pref - The {@link MemberPref} to persist.
 */
export function savePref(guildId: string, userId: string, pref: MemberPref): void {
  const map = loadMap(guildId);
  map[userId] = pref;
  saveData(guildId, PREFS_FILE, map);
  log.info("saved member preference", { guildId, userId, mode: pref.mode, seconds: pref.seconds });
}

/**
 * Drops a member's preference so the guild default applies to them again.
 * @param guildId - Discord guild ID.
 * @param userId - The member's user ID.
 */
export function clearPref(guildId: string, userId: string): void {
  const map = loadMap(guildId);
  if (!(userId in map)) return;
  delete map[userId];
  saveData(guildId, PREFS_FILE, map);
  log.info("cleared member preference", { guildId, userId });
}

/**
 * Resolves the bounds in force for a guild.
 * @param settings - Stored guild settings.
 * @returns The stored {@link PersonalLimits}, or {@link DEFAULT_PERSONAL_LIMITS}.
 */
export function resolveLimits(settings: MediaSettings): PersonalLimits {
  return settings.personal ?? DEFAULT_PERSONAL_LIMITS;
}

/**
 * Applies the admin bounds to a stored preference. Clamping happens on read
 * rather than only on write, so tightening the bounds reaches preferences
 * members saved while they were looser.
 * @param pref - The member's stored preference, if they have one.
 * @param limits - The bounds in force for the guild.
 * @returns The preference to act on, or `undefined` when the guild default
 * should apply instead.
 */
export function clampPref(
  pref: MemberPref | undefined,
  limits: PersonalLimits,
): MemberPref | undefined {
  if (!pref || !limits.enabled) return undefined;
  if (pref.mode === "never") return limits.allowNever ? pref : undefined;
  if (pref.mode === "instant") return pref;

  const max = Math.max(1, limits.maxSeconds);
  const wanted = Number.isFinite(pref.seconds) ? (pref.seconds as number) : 10;
  return { mode: pref.mode, seconds: Math.min(max, Math.max(1, Math.round(wanted))) };
}
