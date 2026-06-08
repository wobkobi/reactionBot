// src/media/repost.ts
import { appendDeletionLog } from "@/media/audit.js";
import { RepostOutcome } from "@/media/types.js";
import { createLogger } from "@/utils/log.js";
import { GuildTextBasedChannel, Message, MessageReaction, TextChannel, User } from "discord.js";

const log = createLogger("media/repost");

/**
 * Build the moved-message content for the target channel. Includes the
 * rewritten text (which contains the transformed link) so Discord renders the
 * embed.
 * @param authorMention Mention string, e.g. "<@123>".
 * @param rewrittenText Message content with the original URL replaced by the embeddable link.
 * @returns The content to post in the target channel.
 */
export function buildMovedContent(authorMention: string, rewrittenText: string): string {
  return `${authorMention} SENT SLOP\n\n${rewrittenText}`;
}

/**
 * Build the pointer left in the source channel, linking to the moved message
 * for quick access.
 * @param authorMention Mention string, e.g. "<@123>".
 * @param movedUrl Jump URL of the moved message.
 * @returns The content to post in the source channel.
 */
export function buildPointerContent(authorMention: string, movedUrl: string): string {
  return `${authorMention} SENT SLOP ${movedUrl}`;
}

/**
 * Delete the original, post the embeddable rewrite in the target channel, and
 * optionally leave a pointer back in the source channel.
 * @param original The original guild message to move.
 * @param rewrittenText The rewritten content where the first URL is the transformed (embeddable) link.
 * @param source Source channel.
 * @param target Target channel.
 * @param withStub When true and channels differ, leave a pointer in the source channel.
 * @returns The moved message, optional pointer, and link URL.
 */
export async function repostWithOptionalStub(
  original: Message<true>,
  rewrittenText: string,
  source: GuildTextBasedChannel,
  target: GuildTextBasedChannel,
  withStub: boolean,
): Promise<RepostOutcome> {
  const authorMention = `<@${original.author.id}>`;

  await original.delete().catch(() => {});
  log.trace("deleted original", { originalId: original.id });

  // Post the rewrite (with the embeddable link) so Discord renders the embed.
  const moved = await (target as TextChannel).send({
    content: buildMovedContent(authorMention, rewrittenText),
    allowedMentions: { parse: [], users: [original.author.id] },
  });
  log.info("posted moved message", { movedId: moved.id, targetId: target.id });

  let stub: Message<true> | undefined;
  if (withStub && source.id !== target.id) {
    stub = await source.send({
      content: buildPointerContent(authorMention, moved.url),
      allowedMentions: { parse: [], users: [original.author.id] },
    });
    log.debug("posted pointer", { stubId: stub.id, sourceId: source.id });
  }

  return { moved, stub, linkUrl: moved.url };
}

/**
 * Allow the author to delete the moved message (and stub) with a 🗑️ reaction.
 * Records an audit entry on deletion.
 * @param moved The moved message in the target channel.
 * @param author The original author who is allowed to delete.
 * @param guildId Guild ID for audit logging.
 * @param originalChannelId Source channel ID to find and remove the stub.
 * @param [stubId] Optional stub message ID to delete alongside the moved message.
 * @returns Resolves after the collector is set up.
 */
export async function enableAuthorDelete(
  moved: Message<true>,
  author: User,
  guildId: string,
  originalChannelId: string,
  stubId?: string,
): Promise<void> {
  await moved.react("🗑️").catch(() => {});
  log.trace("added delete reaction", {
    movedId: moved.id,
    authorId: author.id,
  });

  const filter = (r: MessageReaction, u: User) => r.emoji.name === "🗑️" && u.id === author.id;
  const collector = moved.createReactionCollector({
    filter,
    max: 1,
    time: 86_400_000,
  });

  collector.on("collect", async (r: MessageReaction, u: User) => {
    log.debug("delete reaction collected", { movedId: moved.id, by: u.id });
    await r.users.remove(u.id).catch(() => {});
    await moved.delete().catch(() => {});

    if (stubId) {
      const ch = moved.client.channels.cache.get(originalChannelId) as
        | GuildTextBasedChannel
        | undefined;
      if (ch) {
        const stub = await ch.messages.fetch(stubId).catch(() => null);
        if (stub) await stub.delete().catch(() => {});
        log.trace("deleted stub if existed", { stubId });
      }
    }

    appendDeletionLog(guildId, {
      originalMessageId: "unknown",
      originalChannelId,
      repostMessageId: moved.id,
      repostChannelId: moved.channelId,
      stubMessageId: stubId,
      deletedAt: new Date().toISOString(),
    });
    log.info("appended deletion audit", { guildId, movedId: moved.id });
  });
}
