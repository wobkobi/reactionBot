// src/commands/help.ts
import { Client, CommandInteraction, EmbedBuilder } from 'discord.js';

export async function handleHelp(client: Client, interaction: CommandInteraction) {
  const embed = new EmbedBuilder()
    .setTitle('Help Command')
    .setColor(0x0000ff);

  // Retrieve commands from the client's application commands cache
  const commands = client.application?.commands.cache;
  if (commands) {
    commands.forEach((command) => {
      embed.addFields({
        name: command.name,
        value: command.description || 'No description provided.',
        inline: false,
      });
    });
  } else {
    embed.setDescription('No commands found.');
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
