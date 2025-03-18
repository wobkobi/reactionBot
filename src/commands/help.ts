// src/commands/help.ts
import {
  SlashCommandBuilder,
  CommandInteraction,
  EmbedBuilder,
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Displays help information about available commands.');

export async function execute(interaction: CommandInteraction) {
  const embed = new EmbedBuilder().setTitle('Help').setColor(0x0099ff);
  const clientCommands = (interaction.client as any).commands;
  if (clientCommands) {
    clientCommands.forEach((cmd: any) => {
      embed.addFields({
        name: cmd.data.name,
        value: cmd.data.description || 'No description provided.',
        inline: false,
      });
    });
  } else {
    embed.setDescription('No commands available.');
  }
  await interaction.reply({ embeds: [embed], ephemeral: true });
}
