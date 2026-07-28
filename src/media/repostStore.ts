// src/media/repostStore.ts

/**
 * @file Persists moved-message records so author deletes survive restarts.
 * Keyed by the moved (repost) message ID within each guild's reposts.json.
 */

import { loadData, saveData } from "@/utils/file";
import { createLogger } from "@/utils/log";

const log = createLogger("media/repostStore");

/** Filename for persisted repost records. */
export const REPOSTS_FILE = "reposts.json";

/** Everything needed to honour a later author-delete of a moved message. */
export interface RepostRecord {
  /** Original poster; the only user allowed to delete the repost. */
  authorId: string;
  /** ID of the (already deleted) original message, kept for the audit log. */
  originalMessageId: string;
  /** Channel the link was posted in (where the pointer stub lives). */
  sourceChannelId: string;
  /** Channel the repost was moved to. */
  repostChannelId: string;
  /** Pointer stub to clean up alongside the repost, when one was left. */
  stubMessageId?: string;
  /** ISO timestamp of the repost. */
  createdAt: string;
}

type RepostMap = Record<string, RepostRecord>;

/**
 * Loads the guild's repost map, tolerating a missing file.
 * @param guildId - Discord guild ID.
 * @returns Map of moved-message ID to {@link RepostRecord}.
 */
function loadMap(guildId: string): RepostMap {
  return loadData<RepostMap>(guildId, REPOSTS_FILE, { soft: true, defaultValue: {} });
}

/**
 * Stores the record for a moved message.
 * @param guildId - Discord guild ID.
 * @param movedMessageId - ID of the repost message in the target channel.
 * @param record - The {@link RepostRecord} to persist.
 */
export function saveRepost(guildId: string, movedMessageId: string, record: RepostRecord): void {
  const map = loadMap(guildId);
  map[movedMessageId] = record;
  saveData(guildId, REPOSTS_FILE, map);
  log.debug("saved repost record", { guildId, movedMessageId });
}

/**
 * Looks up the record for a moved message.
 * @param guildId - Discord guild ID.
 * @param movedMessageId - ID of the repost message.
 * @returns The stored {@link RepostRecord}, or `undefined` if none exists.
 */
export function getRepost(guildId: string, movedMessageId: string): RepostRecord | undefined {
  return loadMap(guildId)[movedMessageId];
}

/** A stored record together with the moved message it belongs to. */
export interface RepostLookup {
  /** ID of the moved message in the target channel. */
  movedMessageId: string;
  /** The stored record. */
  record: RepostRecord;
}

/**
 * Resolves the repost a message belongs to, whether it is the moved message
 * itself or the pointer stub left behind in the source channel. The map is
 * keyed by moved-message ID, so the stub match is a scan - a guild holds one
 * record per moved link, which stays small enough not to warrant a second
 * index.
 * @param guildId - Discord guild ID.
 * @param messageId - ID of the message the user acted on.
 * @returns The {@link RepostLookup}, or `undefined` when the message is neither.
 */
export function findRepostForMessage(guildId: string, messageId: string): RepostLookup | undefined {
  const map = loadMap(guildId);
  const direct = map[messageId];
  if (direct) return { movedMessageId: messageId, record: direct };
  for (const [movedMessageId, record] of Object.entries(map)) {
    if (record.stubMessageId === messageId) return { movedMessageId, record };
  }
  return undefined;
}

/**
 * Removes the record for a moved message (after deletion).
 * @param guildId - Discord guild ID.
 * @param movedMessageId - ID of the repost message.
 */
export function removeRepost(guildId: string, movedMessageId: string): void {
  const map = loadMap(guildId);
  if (!(movedMessageId in map)) return;
  delete map[movedMessageId];
  saveData(guildId, REPOSTS_FILE, map);
  log.debug("removed repost record", { guildId, movedMessageId });
}
