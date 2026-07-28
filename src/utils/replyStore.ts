// src/utils/replyStore.ts

/**
 * @file Persists which bot replies are tied to which user message, so when
 * the trigger message is deleted the bot's replies can be deleted too - no
 * matter how old they are or how many restarts have happened since.
 */

import { loadData, saveData } from "@/utils/file";
import { createLogger } from "@/utils/log";

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
  map[triggerMessageId] = [...(map[triggerMessageId] ?? []), ref];
  saveData(guildId, REPLIES_FILE, map);
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
