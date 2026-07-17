// src/media/repost.ts
import { buildRepostButtons } from "@/media/repostActions.js";
import { RepostOutcome } from "@/media/types.js";
import { createLogger } from "@/utils/log.js";
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

  await original.delete().catch(() => {});
  log.debug("deleted original", { originalId: original.id });

  // Post the rewrite (with the embeddable link) so Discord renders the embed.
  // Empty allowedMentions: the author's @ renders in the text without pinging.
  // The Edit/Delete buttons are author-only (enforced on interaction).
  const payload = {
    content: buildMovedContent(authorMention, rewrittenText),
    allowedMentions: { parse: [] },
    components: [buildRepostButtons()],
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
      content: buildPointerContent(authorMention, moved.url),
      allowedMentions: { parse: [] },
    });
    log.debug("posted pointer", { stubId: stub.id, sourceId: source.id });
  }

  return { moved, stub, linkUrl: moved.url };
}
