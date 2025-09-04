// src/media/repost.ts
import {
  GuildTextBasedChannel,
  Message,
  MessageReaction,
  TextChannel,
  User,
} from "discord.js";
import { createLogger } from "../utils/log.js";
import { appendDeletionLog } from "./audit.js";
import { RepostOutcome } from "./types.js";

const log = createLogger("media/repost");

/**
 * Split message text around the first URL.
 * @param text Full message content.
 * @returns Text before and after the first URL (trimmed). Empty strings if no URL.
 */
function extractBeforeAfter(text: string): { before: string; after: string } {
  const m = /(https?:\/\/\S+)/.exec(text);
  if (!m) return { before: "", after: "" };
  const i = m.index;
  const linkLen = m[1].length;
  const before = text.slice(0, i).trim();
  const after = text.slice(i + linkLen).trim();
  return { before, after };
}

/**
 * Build the slop line(s) for both channels.
 * @param authorMention Mention string, e.g. "<@123>".
 * @param chatLink URL of the moved message.
 * @param before Text before the original link (optional).
 * @param after Text after the original link (optional).
 * @returns Formatted content per spec.
 */
function formatSlop(
  authorMention: string,
  chatLink: string,
  before: string,
  after: string
): string {
  if (before || after) {
    const mid = [before, chatLink, after].filter(Boolean).join(" ");
    return `${authorMention} SENT SLOP\n\n${mid}`;
  }
  return `${authorMention} SENT SLOP ${chatLink}`;
}

/**
 * Delete the original, post the reformatted message in the target, and optionally mirror it as a stub.
 * The new content is:
 * - "`user` SENT SLOP `chat link`" if no extra text, or
 * - "`user` SENT SLOP\\n\\n`before` `chat link` `after`" if extra text exists.
 * @param original The original guild message to move.
 * @param rewrittenText The rewritten content where the first URL is the transformed link.
 * @param source Source channel.
 * @param target Target channel.
 * @param withStub When true and channels differ, post the same content back in source as a stub.
 * @returns The moved message, optional stub, and link URL.
 */
export async function repostWithOptionalStub(
  original: Message<true>,
  rewrittenText: string,
  source: GuildTextBasedChannel,
  target: GuildTextBasedChannel,
  withStub: boolean
): Promise<RepostOutcome> {
  const { before, after } = extractBeforeAfter(rewrittenText);
  const authorMention = `<@${original.author.id}>`;

  await original.delete().catch(() => {});
  log.trace("deleted original", { originalId: original.id });

  // Send placeholder, then edit to include its own chat link.
  const moved = await (target as TextChannel).send({
    content: "…",
    allowedMentions: { parse: [] },
  });
  const movedText = formatSlop(authorMention, moved.url, before, after);
  await moved.edit({
    content: movedText,
    allowedMentions: { parse: [], users: [original.author.id] },
  });
  log.info("posted moved message", { movedId: moved.id, targetId: target.id });

  let stub: Message<true> | undefined;
  if (withStub && source.id !== target.id) {
    const stubText = movedText; // same format in source channel
    stub = await source.send({
      content: stubText,
      allowedMentions: { parse: [], users: [original.author.id] },
    });
    log.debug("posted stub", { stubId: stub.id, sourceId: source.id });
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
  stubId?: string
): Promise<void> {
  await moved.react("🗑️").catch(() => {});
  log.trace("added delete reaction", {
    movedId: moved.id,
    authorId: author.id,
  });

  const filter = (r: MessageReaction, u: User) =>
    r.emoji.name === "🗑️" && u.id === author.id;
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
