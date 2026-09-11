// src/media/repost.ts
import { RepostOutcome } from "@/media/types";
import { createLogger } from "@/utils/log";
import { GuildTextBasedChannel, Message, TextChannel } from "discord.js";

const log = createLogger("media/repost");

/**
 * API error codes that mean the target has refused the bot: 50001 Missing
 * Access (it cannot see the channel), 50013 Missing Permissions (it can see it
 * but may not post). Both apply to the channel, not to the payload, so every
 * send to that channel fails identically until someone changes a permission.
 */
const BLOCKED_CODES = new Set<number | string>([50001, 50013]);

/**
 * Whether a send failure is one a differently-shaped retry cannot fix. Nothing
 * is assumed about the rejection's shape: anything can be thrown, and a
 * cross-realm DiscordAPIError fails an `instanceof` check.
 * @param err - The rejection from the failed send.
 * @returns `true` when the target refused the bot rather than the payload.
 */
export function blocksRetry(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  const code = (err as { code: unknown }).code;
  return (typeof code === "number" || typeof code === "string") && BLOCKED_CODES.has(code);
}

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
 * Post the embeddable rewrite in the target channel (carrying over any
 * attachments), delete the original, and optionally leave a pointer back in
 * the source channel. In that order, so a failed post leaves the poster's
 * message where it is rather than losing it.
 * @param original The original guild message to move.
 * @param rewrittenText The rewritten content where the first URL is the transformed (embeddable) link.
 * @param source Source channel.
 * @param target Target channel.
 * @param withStub When true and channels differ, leave a pointer in the source channel.
 * @returns The moved message, optional pointer, and link URL; or a `failure`
 * alone when the post could not be made and nothing was moved.
 */
export async function repostWithOptionalStub(
  original: Message<true>,
  rewrittenText: string,
  source: GuildTextBasedChannel,
  target: GuildTextBasedChannel,
  withStub: boolean,
): Promise<RepostOutcome> {
  const authorMention = `<@${original.author.id}>`;
  const files = [...original.attachments.values()].map((a) => a.url);
  const mentions = collectMentions(original.content, original.author.id);

  // Post the rewrite (with the embeddable link) so Discord renders the embed.
  // Empty allowedMentions: the author's @ renders in the text without pinging.
  // No components: editing and deleting are author-only right-click entries
  // (Apps > Edit post / Delete post), so the post carries no button row.
  const payload = {
    content: buildMovedContent(authorMention, rewrittenText),
    allowedMentions: { parse: [] },
  } satisfies Parameters<TextChannel["send"]>[0];

  // The original is deleted only once the replacement is up. A send can fail
  // for reasons the caller cannot rule out in advance - the prefix pushing a
  // near-limit message past 2000 characters, a missing permission in the
  // target - and deleting first would destroy the poster's message with
  // nothing put back in its place.
  let moved: Message<true> | undefined;
  let blocked = false;
  try {
    moved = await (target as TextChannel).send(files.length ? { ...payload, files } : payload);
  } catch (err) {
    blocked = blocksRetry(err);
    log.warn("repost send failed", {
      targetId: target.id,
      files: files.length,
      blocked,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!moved && files.length && !blocked) {
    // Re-upload can fail on its own (e.g. a file over the bot's upload
    // limit); fall back to appending the CDN links so nothing is lost. A
    // target that refused the first send refuses this one too, so a blocked
    // send skips it rather than spending a request on a certain failure.
    moved = await (target as TextChannel)
      .send({ ...payload, content: `${payload.content}\n${files.join("\n")}` })
      .catch(() => undefined);
  }
  if (!moved) {
    log.error("repost failed, original left in place", {
      targetId: target.id,
      originalId: original.id,
      blocked,
    });
    return { failure: blocked ? "blocked" : "failed" };
  }
  log.info("posted moved message", { movedId: moved.id, targetId: target.id });

  await original.delete().catch(() => {});
  log.debug("deleted original", { originalId: original.id });

  // A pointer that will not send is cosmetic - the move itself has already
  // happened, so it must not take the caller's registration down with it.
  let stub: Message<true> | undefined;
  if (withStub && source.id !== target.id) {
    stub =
      (await source
        .send({
          content: buildPointerContent(authorMention, mentions, moved.url),
          allowedMentions: { parse: [] },
        })
        .catch((err: unknown) => {
          log.warn("pointer send failed", {
            sourceId: source.id,
            error: err instanceof Error ? err.message : String(err),
          });
          return undefined;
        })) ?? undefined;
    if (stub) log.debug("posted pointer", { stubId: stub.id, sourceId: source.id });
  }

  return { moved, stub, linkUrl: moved.url };
}
