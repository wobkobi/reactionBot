// src/media/repost.ts
import { RepostOutcome } from "@/media/types";
import { createLogger } from "@/utils/log";
import { GuildTextBasedChannel, Message, TextChannel } from "discord.js";

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
  return `from ${authorMention}\n\n${rewrittenText}`;
}

/**
 * Collect a message's user mentions, in order and deduped. The digit after the
 * optional "!" (legacy nickname form) keeps role and channel tokens out.
 * @param content Raw message content.
 * @param excludeId Discord ID to skip, normally the poster's own.
 * @returns Mention strings, e.g. ["<@123>"].
 */
export function collectMentions(content: string, excludeId?: string): string[] {
  const ids = new Set<string>();
  for (const [, id] of content.matchAll(/<@!?(\d+)>/g)) {
    if (id !== excludeId) ids.add(id);
  }
  return [...ids].map((id) => `<@${id}>`);
}

/**
 * Build the pointer left in the source channel, linking to the moved message
 * for quick access and naming anyone the original tagged.
 * @param authorMention Mention string, e.g. "<@123>".
 * @param mentions Mentions from the original, empty when it tagged nobody.
 * @param movedUrl Jump URL of the moved message.
 * @returns The content to post in the source channel.
 */
export function buildPointerContent(
  authorMention: string,
  mentions: string[],
  movedUrl: string,
): string {
  const targets = mentions.length > 0 ? ` TO ${mentions.join(" ")}` : "";
  return `${authorMention} SENT SLOP${targets} ${movedUrl}`;
}

/**
 * Delete the original, post the embeddable rewrite in the target channel
 * (carrying over any attachments), and optionally leave a pointer back in the
 * source channel.
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

  // Capture attachment URLs before deleting the original: the signed CDN
  // links stay valid after deletion, long enough to re-upload the files with
  // the moved message so images/videos survive the move.
  const files = [...original.attachments.values()].map((a) => a.url);

  const mentions = collectMentions(original.content, original.author.id);

  await original.delete().catch(() => {});
  log.debug("deleted original", { originalId: original.id });

  // Post the rewrite (with the embeddable link) so Discord renders the embed.
  // Empty allowedMentions: the author's @ renders in the text without pinging.
  // No components: editing and deleting are author-only right-click entries
  // (Apps > Edit post / Delete post), so the post carries no button row.
  const payload = {
    content: buildMovedContent(authorMention, rewrittenText),
    allowedMentions: { parse: [] },
  } satisfies Parameters<TextChannel["send"]>[0];

  let moved: Message<true>;
  if (files.length === 0) {
    moved = await (target as TextChannel).send(payload);
  } else {
    try {
      moved = await (target as TextChannel).send({ ...payload, files });
    } catch (err) {
      // Re-upload can fail (e.g. a file over the bot's upload limit); fall
      // back to appending the CDN links so nothing is silently lost.
      log.warn("attachment re-upload failed, linking instead", {
        count: files.length,
        error: err instanceof Error ? err.message : String(err),
      });
      moved = await (target as TextChannel).send({
        ...payload,
        content: `${payload.content}\n${files.join("\n")}`,
      });
    }
  }
  log.info("posted moved message", { movedId: moved.id, targetId: target.id });

  let stub: Message<true> | undefined;
  if (withStub && source.id !== target.id) {
    stub = await source.send({
      content: buildPointerContent(authorMention, mentions, moved.url),
      allowedMentions: { parse: [] },
    });
    log.debug("posted pointer", { stubId: stub.id, sourceId: source.id });
  }

  return { moved, stub, linkUrl: moved.url };
}
