// src/tracking/sauce.ts

// Answers a bare number with the nhentai gallery it names, when that gallery
// exists, posted with the preview suppressed so the link is there to click but
// nothing is shown. Three skull reactions vote the link back down.

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
  User,
} from "discord.js";

const log = createLogger("tracking/sauce");

/**
 * The whole message must be the number: digits inside a sentence are not a
 * code. Five digits up keeps everyday numbers ("2", "100", "2024") quiet, and
 * nine is far past the highest gallery ID. No leading zero, so "00123" cannot
 * pass a short code off as a long one.
 */
const CODE = /^[1-9]\d{4,8}$/;

/** A missing answer is treated as a missing gallery, so the chat never waits long. */
const LOOKUP_TIMEOUT_MS = 5_000;

/** The reaction that votes a link down. */
const SKULL = "💀";

/** How many people it takes to vote a link down. */
export const SKULL_VOTES = 3;

/** A link reply is the bare gallery link and nothing else, as {@link sauceLink} builds it. */
const REPLY = /^https:\/\/nhentai\.net\/g\/\d+\/$/;

/**
 * Reads the gallery ID a message names, when the message is nothing but a
 * five-to-nine-digit number.
 * @param content - Raw message content.
 * @returns The gallery ID, or null when the message is not a bare code.
 */
export function sauceCode(content: string): string | null {
  const code = content.trim();
  return CODE.test(code) ? code : null;
}

/**
 * Builds the gallery page link for an ID.
 * @param id - Gallery ID from {@link sauceCode}.
 * @returns The gallery URL.
 */
export function sauceLink(id: string): string {
  return `https://nhentai.net/g/${id}/`;
}

/**
 * Whether a message's content is a link reply. Read off the content rather than
 * stored, so a vote still lands on a link posted before a restart.
 * @param content - The bot message's content.
 * @returns True when the content is exactly a gallery link.
 */
export function isSauceReply(content: string): boolean {
  return REPLY.test(content);
}

/**
 * Asks nhentai whether a gallery exists. The v2 API is used because the gallery
 * pages and the old API sit behind a Cloudflare challenge that answers every
 * script with 403, real gallery or not; v2 answers 200 or 404 straight. GET,
 * because v2 refuses HEAD with a 405.
 * @param id - Gallery ID from {@link sauceCode}.
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
 * Replies to a bare number with its gallery link when the gallery exists,
 * preview suppressed and without pinging the poster. Silent during calm mode.
 * Best-effort.
 * @param message - The guild message to consider.
 * @param fetchImpl - Network stand-in for the existence check; the global fetch by default.
 * @returns A promise resolving to `true` when a link was posted.
 */
export async function replyWithSauce(
  message: Message<true>,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  if (isCalm(message.guildId)) return false;
  const id = sauceCode(message.content);
  if (!id || !(await galleryExists(id, fetchImpl))) return false;

  const sent = await message
    .reply({
      content: sauceLink(id),
      flags: MessageFlags.SuppressEmbeds,
      allowedMentions: { parse: [], repliedUser: false },
    })
    .catch((err: unknown) => {
      log.warn("failed to post sauce link", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
  if (!sent) return false;

  log.info("sauce link sent", { guildId: message.guildId, authorId: message.author.id, id });
  // Deleting the code takes the link down with it
  recordReply(message.guildId, message.id, { channelId: sent.channelId, messageId: sent.id });
  return true;
}

/**
 * Counts a skull on one of the bot's link replies, and deletes the reply once
 * {@link SKULL_VOTES} people have voted. Bots never count, so the vote is
 * always people's. Only the link goes; the number that earned it stays.
 * @param reaction - The reaction that was added (possibly partial).
 * @param user - Who added it (possibly partial).
 * @returns A promise resolving to `true` when the vote deleted the link.
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
  if (!isSauceReply(message.content)) return false;

  const voters = await full.users.fetch().catch(() => null);
  if (!voters) return false;
  const votes = voters.filter((u) => !u.bot).size;
  if (votes < SKULL_VOTES) return false;

  const deleted = await message
    .delete()
    .then(() => true)
    .catch((err: unknown) => {
      log.warn("failed to delete voted-down sauce link", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    });
  if (deleted) log.info("sauce link voted down", { guildId: message.guildId, votes });
  return deleted;
}
