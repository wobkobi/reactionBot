// src/commands/clear.ts
import {CommandInteraction, GuildTextBasedChannel, Message, PermissionFlagsBits} from "discord.js";
import {loadData, saveData} from "../utils/file";
import {Client} from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const YOUR_ID = Number(process.env.YOUR_ID);

export async function handleClear(client: Client, interaction: CommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  // Load data (allowed users and reacted messages)
  const allowed = loadData(guildId, "allowed.json");
  const reactedMessages = loadData(guildId, "reacted_messages.json");

  // Check if the user is allowed to run the command
  if (interaction.user.id !== interaction.guild?.ownerId && interaction.user.id !== String(YOUR_ID) && !allowed[interaction.user.id]) {
    await interaction.reply({content: "You do not have permission to run this command!", ephemeral: true});
    return;
  }

  await interaction.reply({content: "Processing request...", ephemeral: true});

  // Iterate over reacted messages and remove bot reactions
  for (const messageId of Object.keys(reactedMessages)) {
    try {
      const channel = interaction.channel as GuildTextBasedChannel;
      const msg: Message = await channel.messages.fetch(messageId);
      for (const reaction of msg.reactions.cache.values()) {
        if (reaction.me) {
          try {
            await reaction.remove();
          } catch (error) {
            console.error(`Failed to remove reaction ${reaction.emoji}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`Message ${messageId} not found or error occurred.`);
      continue;
    }
  }

  // Clear reacted messages and save
  for (const key in reactedMessages) {
    delete reactedMessages[key];
  }
  saveData(guildId, "reacted_messages.json", reactedMessages);

  await interaction.followUp("All reactions from people on the list have been removed.");
}
