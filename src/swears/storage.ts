// src/swears/storage.ts

/**
 * @file Persistence helpers for swear statistics (per-guild).
 * Structure:
 * {
 *   "users": { "<userId>": { "<swear>": count, ... }, ... },
 *   "totals": { "<swear>": count, ... }
 * }
 */

import { loadData, saveData } from "../utils/file.js";
import { createLogger } from "../utils/log.js";

const log = createLogger("swears/storage");

/** JSON filename used to persist swear stats per guild. */
export const SWEAR_STORE_FILE = "swear_counts.json";

/** Per-user counts keyed by swear token. */
export type UserSwearCounts = Record<string, number>;

/** Root shape stored on disk for a guild. */
export interface GuildSwearStore {
  /** Map of userId -> per-swear counts. */
  users: Record<string, UserSwearCounts>;
  /** Aggregate counts across the whole guild, per swear. */
  totals: Record<string, number>;
}

/**
 * Creates an empty store object.
 * @returns A new, empty {@link GuildSwearStore}.
 */
export function createEmptyStore(): GuildSwearStore {
  return { users: {}, totals: {} };
}

/**
 * Loads the swear store for a guild, returning an empty structure if none exists.
 * @param guildId - Discord guild (server) ID.
 * @returns The deserialised {@link GuildSwearStore}.
 */
export function loadStore(guildId: string): GuildSwearStore {
  const data = loadData<GuildSwearStore | null>(guildId, SWEAR_STORE_FILE, {
    soft: true,
  });
  if (!data || !data.users || !data.totals) return createEmptyStore();
  return data;
}

/**
 * Persists a store to disk for a guild.
 * @param guildId - Discord guild (server) ID.
 * @param store - The store to save.
 */
export function saveStore(guildId: string, store: GuildSwearStore): void {
  // Cast to a generic record to satisfy saveData typing.
  saveData(
    guildId,
    SWEAR_STORE_FILE,
    store as unknown as Record<string, unknown>
  );
  log.debug("store saved", {
    guildId,
    users: Object.keys(store.users).length,
    totals: Object.keys(store.totals).length,
  });
}

/**
 * Adds counts for a specific user and updates guild totals.
 * @param guildId - Discord guild (server) ID.
 * @param userId - Discord user ID whose counts to increment.
 * @param counts - Map of swear -> occurrences to add.
 * @returns The updated {@link GuildSwearStore}.
 */
export function incrementUserCounts(
  guildId: string,
  userId: string,
  counts: Map<string, number>
): GuildSwearStore {
  const store = loadStore(guildId);
  if (!store.users[userId]) store.users[userId] = {};

  let added = 0;
  for (const [swear, n] of counts) {
    if (n <= 0) continue;
    // Per-user
    store.users[userId][swear] = (store.users[userId][swear] ?? 0) + n;
    // Totals
    store.totals[swear] = (store.totals[swear] ?? 0) + n;
    added += n;
  }

  saveStore(guildId, store);
  log.debug("incremented user counts", { guildId, userId, added });
  return store;
}

/**
 * Returns a user’s total swear count (sum across all tracked swears).
 * @param guildId - Discord guild (server) ID.
 * @param userId - Discord user ID.
 * @returns Total count for the user.
 */
export function getUserTotal(guildId: string, userId: string): number {
  const store = loadStore(guildId);
  const u = store.users[userId];
  if (!u) return 0;
  return Object.values(u).reduce((a, b) => a + b, 0);
}

/**
 * Builds a leaderboard of users by total swear count.
 * @param guildId - Discord guild (server) ID.
 * @param limit - Max number of users to return (default 10).
 * @returns Array of `{ userId, total }` sorted desc by total.
 */
export function getTopUsers(
  guildId: string,
  limit = 10
): Array<{ userId: string; total: number }> {
  const store = loadStore(guildId);
  const rows = Object.entries(store.users).map(([userId, counts]) => ({
    userId,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  }));
  rows.sort((a, b) => b.total - a.total);
  return rows.slice(0, Math.max(0, limit));
}

/**
 * Returns the top swears across the guild.
 * @param guildId - Discord guild (server) ID.
 * @param limit - Max swears to return (default 10).
 * @returns Array of `{ swear, count }` sorted desc by count.
 */
export function getTopSwears(
  guildId: string,
  limit = 10
): Array<{ swear: string; count: number }> {
  const store = loadStore(guildId);
  const rows = Object.entries(store.totals).map(([swear, count]) => ({
    swear,
    count,
  }));
  rows.sort((a, b) => b.count - a.count);
  return rows.slice(0, Math.max(0, limit));
}

/**
 * Resets all counts for a user and adjusts guild totals accordingly.
 * @param guildId - Discord guild (server) ID.
 * @param userId - Discord user ID to reset.
 * @returns The updated {@link GuildSwearStore}.
 */
export function resetUser(guildId: string, userId: string): GuildSwearStore {
  const store = loadStore(guildId);
  const current = store.users[userId];
  if (!current) return store;

  for (const [swear, n] of Object.entries(current)) {
    store.totals[swear] = Math.max(0, (store.totals[swear] ?? 0) - n);
    if (store.totals[swear] === 0) delete store.totals[swear];
  }

  delete store.users[userId];
  saveStore(guildId, store);
  log.info("reset user", { guildId, userId });
  return store;
}

/**
 * Clears all swear data for the guild.
 * @param guildId - Discord guild (server) ID.
 * @returns The new, empty {@link GuildSwearStore}.
 */
export function resetGuild(guildId: string): GuildSwearStore {
  const empty = createEmptyStore();
  saveStore(guildId, empty);
  log.info("reset guild", { guildId });
  return empty;
}
