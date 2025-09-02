// src/swears/track.ts

/**
 * @file Hooks into message events to detect and record swears.
 */

import { GuildTextBasedChannel, Message } from "discord.js";
import { createLogger } from "../utils/log.js";
import { countSwears, loadSwearSet, tokenise } from "./detector.js";
import { incrementUserCounts } from "./storage.js";

const log = createLogger("swears/track");
/**
 * Scans a guild message for swears and updates the swear stats if any are found.
 * @param message - The message to scan. Only in-guild messages from non-bot users are processed.
 * @returns A promise that resolves once tracking is complete or skipped.
 */
export async function trackSwears(message: Message): Promise<void> {
  // Ignore DMs and bot messages
  if (!message.inGuild() || message.author.bot) return;
  if (!message.channel.isTextBased()) return;

  const guildId = message.guildId!;
  const swearSet = loadSwearSet(guildId);
  if (swearSet.size === 0) return;

  const tokens = tokenise(message.content);
  if (tokens.length === 0) return;

  const counts = countSwears(tokens, swearSet);
  if (counts.size === 0) return;

  incrementUserCounts(guildId, message.author.id, counts);

  const ch = message.channel as GuildTextBasedChannel;
  log.info("matched swears", {
    author: message.author.tag,
    channelId: ch.id,
    matches: [...counts.entries()].map(([w, n]) => `${w}:${n}`).join(", "),
  });
}
