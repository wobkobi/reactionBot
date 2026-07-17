// src/commands/help.ts

import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from "discord.js";

/** Slash command definition for `/help`. */
export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show all commands and what they do")
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/help`: an embed listing every loaded command with its
 * description, built from the live command collection.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder().setTitle("Commands").setColor(0x5865f2);
  const commands = [...interaction.client.commands.values()].sort((a, b) =>
    a.data.name.localeCompare(b.data.name),
  );
  for (const cmd of commands) {
    embed.addFields({ name: `/${cmd.data.name}`, value: cmd.data.description, inline: false });
  }
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
