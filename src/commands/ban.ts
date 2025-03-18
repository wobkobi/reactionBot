// src/commands/ban.ts
import { CommandInteraction } from 'discord.js';
import { loadData, saveData } from '../utils/file';

export async function handleBan(interaction: CommandInteraction, word: string, timeframe: number) {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a guild.', ephemeral: true });
    return;
  }
  const guildId = interaction.guild.id;

  if (timeframe <= 0) {
    await interaction.reply({ content: 'Timeframe must be a positive number of days.', ephemeral: true });
    return;
  }

  // Build regex pattern similar to Python's logic:
  // (?<!:)\b\w* +? join(word) + \w*\b(?!:)
  const joinedWord = word.split('').join('+?');
  const regexPattern = `(?<!:)\\b\\w*${joinedWord}+\\w*\\b(?!:)`;

  const wordData = {
    regex: regexPattern,
    last_mention: null,
    total_count: 0,
    user_counts: {},
    timeframe: timeframe,
  };

  // Save the tracking data; here we use JSON (adjust file path/extension as needed)
  saveData(guildId, `blocked/${word}_blocked.json`, wordData);
  await interaction.reply({ content: `Tracking for the word '${word}' has been added for ${timeframe} days.` });
}
