// src/onMessageDelete.ts

/**
 * @file Cleans up after a message deletion: bot replies tied to the deleted
 * message (e.g. slur GIF replies) are deleted with it, and when the deleted
 * message was a moved repost, its pointer tail and record are removed.
 * Everything is looked up from persisted stores, so it works for any age of
 * message and across restarts.
 */

import { appendDeletionLog } from "@/media/audit";
import { getRepost, removeRepost } from "@/media/repostStore";
import { createLogger } from "@/utils/log";
import { takeReplies } from "@/utils/replyStore";
import { Message, PartialMessage } from "discord.js";

const log = createLogger("core/onMessageDelete");

/**
 * Handles a deleted message (possibly partial - deletions of uncached
 * messages still carry the IDs, which is all the stores need).
 * @param message - The deleted message.
 * @returns A promise that resolves once linked cleanup is done.
 */
export async function onMessageDelete(message: Message | PartialMessage): Promise<void> {
  const guildId = message.guildId;
  if (!guildId) return;

  // Bot replies linked to the deleted message.
  for (const ref of takeReplies(guildId, message.id)) {
    const channel = await message.client.channels.fetch(ref.channelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.messages.delete(ref.messageId).catch(() => {});
      log.info("deleted linked reply", { guildId, triggerId: message.id, replyId: ref.messageId });
    }
  }

  // The deleted message was a moved repost (e.g. removed by a mod): clean up
  // its pointer tail and record, and audit the deletion.
  const record = getRepost(guildId, message.id);
  if (record) {
    removeRepost(guildId, message.id);
    if (record.stubMessageId) {
      const channel = await message.client.channels.fetch(record.sourceChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.messages.delete(record.stubMessageId).catch(() => {});
      }
    }
    appendDeletionLog(guildId, {
      originalMessageId: record.originalMessageId,
      originalChannelId: record.sourceChannelId,
      repostMessageId: message.id,
      repostChannelId: record.repostChannelId,
      stubMessageId: record.stubMessageId,
      deletedAt: new Date().toISOString(),
    });
    log.info("cleaned up externally deleted repost", { guildId, movedId: message.id });
  }
}
