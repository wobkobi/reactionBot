// src/commands/help.ts

import { SlashCommandBuilder } from "@discordjs/builders";
import { ApplicationCommandOptionType, InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from "discord.js";

/** Slash command definition for `/help`. */
export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show all commands and what they do")
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/help`: an embed listing every loaded command with its
 * description, built from the live command collection. Commands with
 * subcommands list each subcommand with its own description.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder().setTitle("Commands").setColor(0x5865f2);
  const commands = [...interaction.client.commands.values()].sort((a, b) =>
    a.data.name.localeCompare(b.data.name),
  );
  for (const cmd of commands) {
    const json = cmd.data.toJSON();
    const subs = (json.options ?? []).filter(
      (o) => o.type === ApplicationCommandOptionType.Subcommand,
    );
    const value = subs.length
      ? subs.map((s) => `\`/${json.name} ${s.name}\` - ${s.description}`).join("\n")
      : json.description;
    embed.addFields({ name: `/${json.name}`, value, inline: false });
  }
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
