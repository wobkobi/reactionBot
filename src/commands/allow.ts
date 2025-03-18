// src/commands/allow.ts
import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { loadData, saveData } from '../utils/file.js';
import dotenv from 'dotenv';
import { CustomOptions } from '../types/CustomOptions';
dotenv.config();

export const data = new SlashCommandBuilder()
  .setName('allow')
  .setDescription('Gives special privileges to a user.')
  .addUserOption((option) =>
    option.setName('user').setDescription('User to allow').setRequired(true),
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
  const allowed = loadData(guildId, 'allowed.json');
  const options = interaction.options as unknown as CustomOptions;
  const user = options.getUser('user', true);
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

  if (allowed[user.id]) {
    await interaction.reply({
      content: `<@${user.id}> is already allowed.`,
      ephemeral: true,
    });
    return;
  }

  allowed[user.id] = true;
  saveData(guildId, 'allowed.json', allowed);
  await interaction.reply({
    content: `<@${user.id}> has been given special privileges.`,
  });
}
