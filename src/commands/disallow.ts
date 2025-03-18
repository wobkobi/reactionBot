// src/commands/disallow.ts
import { CommandInteraction, GuildMember } from 'discord.js';
import { loadData, saveData } from '../utils/file';
import dotenv from 'dotenv';
dotenv.config();

const YOUR_ID = process.env.YOUR_ID;

export async function handleDisallow(interaction: CommandInteraction, user: GuildMember) {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a guild.', ephemeral: true });
    return;
  }
  const guildId = interaction.guild.id;
  const allowed = loadData(guildId, 'allowed.json');

  if (
    interaction.user.id !== interaction.guild.ownerId &&
    interaction.user.id !== YOUR_ID &&
    !allowed[interaction.user.id]
  ) {
    await interaction.reply({ content: 'You do not have permission to run this command!', ephemeral: true });
    return;
  }

  if (!allowed[user.id]) {
    await interaction.reply({ content: `<@${user.id}> is not on allowed list.`, ephemeral: true });
    return;
  }

  delete allowed[user.id];
  saveData(guildId, 'allowed.json', allowed);
  await interaction.reply({ content: `<@${user.id}> has been removed from the special privileges list.` });
}
