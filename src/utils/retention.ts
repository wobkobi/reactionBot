// src/utils/retention.ts

// Age-based pruning for the message-keyed stores. Both are keyed by a Discord
// message ID, and a snowflake carries its own creation time, so an entry's age
// is readable from the key alone - nothing has to be stamped beside it, and
// records written before this existed prune on the same rule as new ones.

/** Start of Discord's snowflake epoch (2015-01-01), in epoch ms. */
const DISCORD_EPOCH = 1_420_070_400_000;

/** How long a moved post stays editable/deletable by its author. */
export const REPOST_RETENTION_MS = 90 * 24 * 60 * 60_000;

/**
 * How long a deletion stays in the audit log. Matched to
 * {@link REPOST_RETENTION_MS}: past it the repost record is gone too, so the
 * entry documents something nothing can act on any more.
 */
export const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60_000;

/** How long a bot reply stays linked to the message that triggered it. */
export const REPLY_RETENTION_MS = 30 * 24 * 60 * 60_000;

/**
 * Reads the creation time out of a Discord snowflake. The timestamp is the top
 * 42 bits, counted from {@link DISCORD_EPOCH} rather than the Unix one.
 * @param id - A Discord message, channel or user ID.
 * @returns Epoch ms, or `null` when the string is not a snowflake.
 */
export function snowflakeTime(id: string): number | null {
  if (!/^\d{17,20}$/.test(id)) return null;
  return Number(BigInt(id) >> 22n) + DISCORD_EPOCH;
}

/**
 * Drops the entries of a message-keyed map whose keys name messages older than
 * the retention window. A key that is not a snowflake is kept: its age cannot
 * be read, and silently discarding an entry nobody can date would lose more
 * than it saves.
 * @param map - The store to prune. Not mutated.
 * @param maxAgeMs - How long an entry is kept, from its key's message time.
 * @param now - Epoch ms to measure against; defaults to the current time.
 * @returns The surviving entries and how many were dropped.
 */
export function pruneByKeyAge<T>(
  map: Record<string, T>,
  maxAgeMs: number,
  now: number = Date.now(),
): { kept: Record<string, T>; dropped: number } {
  const kept: Record<string, T> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(map)) {
    const created = snowflakeTime(key);
    if (created !== null && now - created > maxAgeMs) {
      dropped++;
      continue;
    }
    kept[key] = value;
  }
  return { kept, dropped };
}
