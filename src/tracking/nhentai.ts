// src/tracking/nhentai.ts

// Answers numbers in a message with the nhentai galleries they name, when those
// galleries exist, posted with the preview suppressed so the links are there to
// click but nothing is shown. Three skull reactions vote the reply back down.

import type { FetchLike } from "@/media/embedCheck";
import { isCalm } from "@/tracking/calm";
import { createLogger } from "@/utils/log";
import { recordReply } from "@/utils/replyStore";
import {
  Message,
  MessageFlags,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  RESTJSONErrorCodes,
  User,
} from "discord.js";

const log = createLogger("tracking/nhentai");

/**
 * A code, 5 to 9 digits, whether posted alone or inside a sentence. Shorter
 * numbers are everyday chat ("2 cats", "in 2024", "12" answering an age) and
 * would earn a link nearly every time, since almost every ID up to around
 * 686,000 is live; nine digits is far past that.
 *
 * - `(?<![\w.,$£€:/])` - not the tail of a longer number or word, a decimal,
 *   a grouped number ("12,345"), a price or a path. Since \w covers digits,
 *   this is also what keeps a zero-padded number ("007") from counting at all,
 *   and a code from being cut out of a ten-digit number.
 * - `[1-9]\d{4,8}` - five to nine digits, no leading zero.
 * - `(?![\w%]|[.,:]\d)` - not followed by more of a word or unit ("12345k",
 *   "12345%") or by a decimal or grouped tail. A full stop or comma that ends
 *   the sentence is fine.
 */
const CODE = /(?<![\w.,$£€:/])[1-9]\d{4,8}(?![\w%]|[.,:]\d)/g;

/**
 * Text whose digits are never codes: links (a status or message ID), and
 * Discord markup in angle brackets (mentions, custom emoji, timestamps).
 */
const NOT_PROSE = /https?:\/\/\S+|<[^<>\s]+>/g;

/** Most codes looked up for one message, so a pasted list cannot fan out into dozens of requests. */
const MAX_CODES = 5;

/** A missing answer is treated as a missing gallery, so the chat never waits long. */
const LOOKUP_TIMEOUT_MS = 5_000;

/** The reaction that votes a link down. */
const SKULL = "💀";

/** How many people it takes to vote a link down. */
export const SKULL_VOTES = 3;

/** A link reply is one gallery link per line and nothing else, as {@link replyWithGalleries} posts it. */
const REPLY = /^https:\/\/nhentai\.net\/g\/\d+\/(?:\nhttps:\/\/nhentai\.net\/g\/\d+\/)*$/;

/**
 * Reads the gallery IDs a message names: each five-to-nine-digit number in its
 * prose ({@link CODE}), once each, in order, up to {@link MAX_CODES}.
 * @param content - Raw message content.
 * @returns The gallery IDs; empty when the message names none.
 */
export function galleryCodes(content: string): string[] {
  const prose = content.replace(NOT_PROSE, " ");
  return [...new Set(prose.match(CODE) ?? [])].slice(0, MAX_CODES);
}

/**
 * Builds the gallery page link for an ID.
 * @param id - Gallery ID from {@link galleryCodes}.
 * @returns The gallery URL.
 */
export function galleryLink(id: string): string {
  return `https://nhentai.net/g/${id}/`;
}

/**
 * Whether a message's content is a link reply. Read off the content rather than
 * stored, so a vote still lands on a link posted before a restart.
 * @param content - The bot message's content.
 * @returns True when the content is exactly a gallery link.
 */
export function isGalleryReply(content: string): boolean {
  return REPLY.test(content);
}

/**
 * Asks nhentai whether a gallery exists. The v2 API is used because the gallery
 * pages and the old API sit behind a Cloudflare challenge that answers every
 * script with 403, real gallery or not; v2 answers 200 or 404 straight. GET,
 * because v2 refuses HEAD with a 405.
 * @param id - Gallery ID from {@link galleryCodes}.
 * @param fetchImpl - Network stand-in; the global fetch by default.
 * @returns True only on a 200; any other status, error or timeout is false.
 */
export async function galleryExists(id: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`https://nhentai.net/api/v2/galleries/${id}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    // Only the status matters; an unread body holds its connection open
    await res.body?.cancel().catch(() => {});
    if (res.status !== 200) log.debug("no gallery for code", { id, status: res.status });
    return res.status === 200;
  } catch (err) {
    log.debug("gallery lookup failed", {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Replies to the numbers in a message with a link per gallery that exists, one
 * per line, preview suppressed and without pinging the poster. The lookups run
 * together, and a message whose numbers name no live gallery gets no reply.
 * The reply carries the bot's own skull so voting it down is one click away.
 * Silent during calm mode. Best-effort.
 * @param message - The guild message to consider.
 * @param fetchImpl - Network stand-in for the existence check; the global fetch by default.
 * @returns A promise resolving to `true` when a reply was posted.
 */
export async function replyWithGalleries(
  message: Message<true>,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  if (isCalm(message.guildId)) return false;
  const codes = galleryCodes(message.content);
  if (codes.length === 0) return false;
  const live = await Promise.all(codes.map((id) => galleryExists(id, fetchImpl)));
  const ids = codes.filter((_, i) => live[i]);
  if (ids.length === 0) return false;

  const sent = await message
    .reply({
      content: ids.map(galleryLink).join("\n"),
      flags: MessageFlags.SuppressEmbeds,
      allowedMentions: { parse: [], repliedUser: false },
    })
    .catch((err: unknown) => {
      log.warn("failed to post gallery links", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
  if (!sent) return false;

  log.info("gallery links sent", { guildId: message.guildId, authorId: message.author.id, ids });
  // Deleting the message takes the links down with it
  recordReply(message.guildId, message.id, { channelId: sent.channelId, messageId: sent.id });
  // A ready skull makes the vote one click; bots never count, so this one is free
  await sent.react(SKULL).catch((err: unknown) => {
    log.warn("failed to pre-react skull on gallery links", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  return true;
}

/**
 * Counts a skull on one of the bot's link replies, and deletes the reply once
 * {@link SKULL_VOTES} people have voted. Bots never count, so the vote is
 * always people's. Only the reply goes; the message that earned it stays.
 * @param reaction - The reaction that was added (possibly partial).
 * @param user - Who added it (possibly partial).
 * @returns A promise resolving to `true` when the vote deleted the reply.
 */
export async function handleSkullVote(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<boolean> {
  if (user.bot || reaction.emoji.name !== SKULL) return false;

  // Reactions on messages from before a restart arrive partial
  const full = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;
  if (!full) return false;
  const message = full.message.partial
    ? await full.message.fetch().catch(() => null)
    : full.message;
  if (!message?.inGuild() || message.author.id !== message.client.user.id) return false;
  if (!isGalleryReply(message.content)) return false;

  const voters = await full.users.fetch().catch(() => null);
  if (!voters) return false;
  const votes = voters.filter((u) => !u.bot).size;
  if (votes < SKULL_VOTES) return false;

  const deleted = await message
    .delete()
    .then(() => true)
    .catch((err: unknown) => {
      // Skulls landing together each count three and race to delete; the
      // losers find the reply already gone, which is the outcome they wanted.
      if ((err as { code?: number })?.code === RESTJSONErrorCodes.UnknownMessage) return false;
      log.warn("failed to delete voted-down gallery links", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    });
  if (deleted) log.info("gallery links voted down", { guildId: message.guildId, votes });
  return deleted;
}
