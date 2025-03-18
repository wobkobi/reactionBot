// src/commands/ban.ts
import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { saveData } from '../utils/file.js';
import dotenv from 'dotenv';
import { CustomOptions } from '../types/CustomOptions';
dotenv.config();

export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Starts tracking a banned word for a specified timeframe.')
  .addStringOption((option) =>
    option.setName('word').setDescription('Word to ban').setRequired(true),
  )
  .addIntegerOption((option) =>
    option
      .setName('timeframe')
      .setDescription('Timeframe in days')
      .setRequired(true),
  );

export async function execute(interaction: CommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }
  const guildId = interaction.guild.id;
  const options = interaction.options as unknown as CustomOptions;
  const word = options.getString('word', true);
  const timeframe = options.getInteger('timeframe', true);

  if (timeframe <= 0) {
    await interaction.reply({
      content: 'Timeframe must be a positive number of days.',
      ephemeral: true,
    });
    return;
  }

  const joinedWord = word.split('').join('+?');
  const regexPattern = `(?<!:)\\b\\w*${joinedWord}+\\w*\\b(?!:)`;

  const wordData = {
    regex: regexPattern,
    last_mention: null,
    total_count: 0,
    user_counts: {},
    timeframe: timeframe,
  };

  saveData(guildId, `banned_${word}.json`, wordData);
  await interaction.reply({
    content: `Tracking for the word '${word}' has been added for ${timeframe} days.`,
  });
}
