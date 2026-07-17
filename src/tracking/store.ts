// src/tracking/store.ts

/**
 * @file Generic per-guild count store, keyed by a store filename. Powers the
 * swear, slur and called-names trackers, which all share the same shape:
 * {
 *   "users":  { "<userId>": { "<word>": count, ... }, ... },
 *   "totals": { "<word>": count, ... }
 * }
 */

import { loadData, saveData } from "@/utils/file.js";
import { createLogger } from "@/utils/log.js";

const log = createLogger("tracking/store");

/** Per-user counts keyed by word/token. */
export type UserCounts = Record<string, number>;

/** Root shape stored on disk per guild, per tracker. */
export interface CountStore {
  /** Map of userId > per-word counts. */
  users: Record<string, UserCounts>;
  /** Aggregate counts across the whole guild, per word. */
  totals: Record<string, number>;
}

/**
 * Creates an empty store object.
 * @returns A new, empty {@link CountStore}.
 */
export function createEmptyStore(): CountStore {
  return { users: {}, totals: {} };
}

/**
 * Loads a tracker store for a guild, returning an empty structure if none
 * exists or the file is malformed.
 * @param guildId - Discord guild (server) ID.
 * @param storeFile - JSON filename for this tracker (e.g. "swear_counts.json").
 * @returns The deserialised {@link CountStore}.
 */
export function loadStore(guildId: string, storeFile: string): CountStore {
  const data = loadData<CountStore | null>(guildId, storeFile, { soft: true });
  if (!data || !data.users || !data.totals) return createEmptyStore();
  return data;
}

/**
 * Persists a tracker store to disk for a guild.
 * @param guildId - Discord guild (server) ID.
 * @param storeFile - JSON filename for this tracker.
 * @param store - The store to save.
 */
export function saveStore(guildId: string, storeFile: string, store: CountStore): void {
  saveData(guildId, storeFile, store as unknown as Record<string, unknown>);
  log.debug("store saved", {
    storeFile,
    guildId,
    users: Object.keys(store.users).length,
    totals: Object.keys(store.totals).length,
  });
}

/**
 * Adds counts for a specific user and updates guild totals.
 * @param guildId - Discord guild (server) ID.
 * @param storeFile - JSON filename for this tracker.
 * @param userId - Discord user ID whose counts to increment.
 * @param counts - Map of word > occurrences to add.
 * @returns The updated {@link CountStore}.
 */
export function incrementCounts(
  guildId: string,
  storeFile: string,
  userId: string,
  counts: Map<string, number>,
): CountStore {
  const store = loadStore(guildId, storeFile);
  if (!store.users[userId]) store.users[userId] = {};

  let added = 0;
  for (const [word, n] of counts) {
    if (n <= 0) continue;
    store.users[userId][word] = (store.users[userId][word] ?? 0) + n;
    store.totals[word] = (store.totals[word] ?? 0) + n;
    added += n;
  }

  saveStore(guildId, storeFile, store);
  log.debug("incremented counts", { storeFile, guildId, userId, added });
  return store;
}

/**
 * Returns a user's total count (sum across all tracked words).
 * @param guildId - Discord guild (server) ID.
 * @param storeFile - JSON filename for this tracker.
 * @param userId - Discord user ID.
 * @returns Total count for the user.
 */
export function getUserTotal(guildId: string, storeFile: string, userId: string): number {
  const u = loadStore(guildId, storeFile).users[userId];
  if (!u) return 0;
  return Object.values(u).reduce((a, b) => a + b, 0);
}

/**
 * Returns a user's per-word counts for a tracker (empty object when none).
 * @param guildId - Discord guild (server) ID.
 * @param storeFile - JSON filename for this tracker.
 * @param userId - Discord user ID.
 * @returns The user's word > count map.
 */
export function getUserCounts(guildId: string, storeFile: string, userId: string): UserCounts {
  return loadStore(guildId, storeFile).users[userId] ?? {};
}

/**
 * Returns the guild-wide word > count totals for a tracker.
 * @param guildId - Discord guild (server) ID.
 * @param storeFile - JSON filename for this tracker.
 * @returns The word > total count map.
 */
export function getTotals(guildId: string, storeFile: string): Record<string, number> {
  return loadStore(guildId, storeFile).totals;
}

/**
 * Builds a leaderboard of users by total count.
 * @param guildId - Discord guild (server) ID.
 * @param storeFile - JSON filename for this tracker.
 * @param limit - Max number of users to return (default 10).
 * @returns Array of `{ userId, total }` sorted desc by total.
 */
export function getTopUsers(
  guildId: string,
  storeFile: string,
  limit = 10,
): Array<{ userId: string; total: number }> {
  const store = loadStore(guildId, storeFile);
  const rows = Object.entries(store.users).map(([userId, counts]) => ({
    userId,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  }));
  rows.sort((a, b) => b.total - a.total);
  return rows.slice(0, Math.max(0, limit));
}

/**
 * Returns the most-counted words across the guild.
 * @param guildId - Discord guild (server) ID.
 * @param storeFile - JSON filename for this tracker.
 * @param limit - Max words to return (default 10).
 * @returns Array of `{ word, count }` sorted desc by count.
 */
export function getTopWords(
  guildId: string,
  storeFile: string,
  limit = 10,
): Array<{ word: string; count: number }> {
  const store = loadStore(guildId, storeFile);
  const rows = Object.entries(store.totals).map(([word, count]) => ({ word, count }));
  rows.sort((a, b) => b.count - a.count);
  return rows.slice(0, Math.max(0, limit));
}

/**
 * Builds a leaderboard of users by their count of one specific word (e.g. who
 * gets called "bender" the most).
 * @param guildId - Discord guild (server) ID.
 * @param storeFile - JSON filename for this tracker.
 * @param word - The word to rank users by (lowercased).
 * @param limit - Max number of users to return (default 10).
 * @returns Array of `{ userId, count }` sorted desc by that word's count.
 */
export function getTopUsersForWord(
  guildId: string,
  storeFile: string,
  word: string,
  limit = 10,
): Array<{ userId: string; count: number }> {
  const w = word.toLowerCase();
  const store = loadStore(guildId, storeFile);
  const rows = Object.entries(store.users)
    .map(([userId, counts]) => ({ userId, count: counts[w] ?? 0 }))
    .filter((r) => r.count > 0);
  rows.sort((a, b) => b.count - a.count);
  return rows.slice(0, Math.max(0, limit));
}

/**
 * Resets all counts for a user and adjusts guild totals accordingly.
 * @param guildId - Discord guild (server) ID.
 * @param storeFile - JSON filename for this tracker.
 * @param userId - Discord user ID to reset.
 * @returns The updated {@link CountStore}.
 */
export function resetUser(guildId: string, storeFile: string, userId: string): CountStore {
  const store = loadStore(guildId, storeFile);
  const current = store.users[userId];
  if (!current) return store;

  for (const [word, n] of Object.entries(current)) {
    store.totals[word] = Math.max(0, (store.totals[word] ?? 0) - n);
    if (store.totals[word] === 0) delete store.totals[word];
  }

  delete store.users[userId];
  saveStore(guildId, storeFile, store);
  log.info("reset user", { storeFile, guildId, userId });
  return store;
}

/**
 * Clears all data for a tracker in the guild.
 * @param guildId - Discord guild (server) ID.
 * @param storeFile - JSON filename for this tracker.
 * @returns The new, empty {@link CountStore}.
 */
export function resetGuild(guildId: string, storeFile: string): CountStore {
  const empty = createEmptyStore();
  saveStore(guildId, storeFile, empty);
  log.info("reset guild", { storeFile, guildId });
  return empty;
}
