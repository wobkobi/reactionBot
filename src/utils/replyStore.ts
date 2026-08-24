// src/utils/replyStore.ts

/**
 * @file Persists which bot replies are tied to which user message, so when the
 * trigger message is deleted the bot's replies can be deleted too, across any
 * number of restarts and up to {@link REPLY_RETENTION_MS} after the fact.
 */

import { loadData, saveData } from "@/utils/file";
import { createLogger } from "@/utils/log";
import { pruneByKeyAge, REPLY_RETENTION_MS } from "@/utils/retention";

const log = createLogger("utils/replyStore");

/** Filename for the persisted trigger > replies map. */
export const REPLIES_FILE = "bot_replies.json";

/** One bot reply linked to a trigger message. */
export interface ReplyRef {
  channelId: string;
  messageId: string;
}

type ReplyMap = Record<string, ReplyRef[]>;

/**
 * Records a bot reply against the user message that triggered it.
 * @param guildId - Discord guild ID.
 * @param triggerMessageId - The user message the bot replied to.
 * @param ref - The bot reply's channel and message IDs.
 */
export function recordReply(guildId: string, triggerMessageId: string, ref: ReplyRef): void {
  const map = loadData<ReplyMap>(guildId, REPLIES_FILE, { soft: true, defaultValue: {} });
  // Pruned on write: an entry is only ever released when its trigger message
  // is deleted, and most never are, so the map would grow without bound.
  const { kept, dropped } = pruneByKeyAge(map, REPLY_RETENTION_MS);
  kept[triggerMessageId] = [...(kept[triggerMessageId] ?? []), ref];
  saveData(guildId, REPLIES_FILE, kept);
  if (dropped > 0) log.info("pruned expired reply links", { guildId, dropped });
  log.debug("recorded reply", { guildId, triggerMessageId, replyId: ref.messageId });
}

/**
 * Returns and removes the replies linked to a trigger message (empty when
 * none were recorded).
 * @param guildId - Discord guild ID.
 * @param triggerMessageId - The deleted user message.
 * @returns The linked {@link ReplyRef}s.
 */
export function takeReplies(guildId: string, triggerMessageId: string): ReplyRef[] {
  const map = loadData<ReplyMap>(guildId, REPLIES_FILE, { soft: true, defaultValue: {} });
  const refs = map[triggerMessageId];
  if (!refs?.length) return [];
  delete map[triggerMessageId];
  saveData(guildId, REPLIES_FILE, map);
  log.debug("took replies", { guildId, triggerMessageId, count: refs.length });
  return refs;
}
