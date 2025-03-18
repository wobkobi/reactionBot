// src/commands/clear.ts
import {
  SlashCommandBuilder,
  CommandInteraction,
  TextChannel,
} from 'discord.js';
import { loadData, saveData } from '../utils/file.js';
import dotenv from 'dotenv';
dotenv.config();

export const data = new SlashCommandBuilder()
  .setName('clear')
  .setDescription('Clears reactions from messages.');

export async function execute(interaction: CommandInteraction) {
  if (!interaction.guild || !interaction.channel) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }
  const guildId = interaction.guild.id;
  const allowed = loadData(guildId, 'allowed.json');
  const reactedMessages = loadData(guildId, 'reacted_messages.json');
  const YOUR_ID = process.env.YOUR_ID;

  if (
    interaction.user.id !== interaction.guild.ownerId &&
    interaction.user.id !== YOUR_ID &&
    !allowed[interaction.user.id]
  ) {
    await interaction.reply({
      content: 'You do not have permission to run this command!',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: 'Processing request...',
    ephemeral: true,
  });

  const channel = interaction.channel as TextChannel;
  for (const messageId of Object.keys(reactedMessages)) {
    try {
      const msg = await channel.messages.fetch(messageId);
      for (const reaction of msg.reactions.cache.values()) {
        if (reaction.me) {
          try {
            await reaction.remove();
          } catch (error) {
            console.error(
              `Failed to remove reaction ${reaction.emoji}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      console.error(`Message ${messageId} not found or error occurred:`, error);
      continue;
    }
  }
  // Clear the reacted messages.
  for (const key in reactedMessages) {
    delete reactedMessages[key];
  }
  saveData(guildId, 'reacted_messages.json', reactedMessages);
  await interaction.followUp(
    'All reactions from people on the list have been removed.',
  );
}
