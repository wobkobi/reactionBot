// src/events/messageCreate.ts
import { Client, Message, Snowflake } from "discord.js";
import { loadData, saveData } from "../utils/file.js";
import {
  handleOtherReactions,
  handleRandomReactions,
  handleSlay,
} from "./reactions.js";
import {
  transformAndReplyLinks,
  transformInstagramLink,
  transformTikTokLink,
  transformTwitterLink,
} from "./transformations.js";

export async function handleMessageCreate(
  client: Client,
  message: Message
): Promise<void> {
  // Process only non-bot messages in guilds.
  if (message.author.bot || !message.guild) return;
  const guildId: Snowflake = message.guild.id;

  // Process SLAY keyword.
  await handleSlay(message);

  // Process random reactions.
  await handleRandomReactions(message);

  // Process link transformations.
  await transformAndReplyLinks(client, message, transformTwitterLink);
  await transformAndReplyLinks(client, message, transformInstagramLink);
  await transformAndReplyLinks(client, message, transformTikTokLink);

  // Process additional reactions.
  await handleOtherReactions(message);

  // Save any global count data if necessary.
  const count = loadData(guildId, "count.json");
  saveData(guildId, "count.json", count);
}
