// src/commands/swears.ts

import { getUserTotal } from "@/swears/storage.js";
import { createLogger } from "@/utils/log.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

const log = createLogger("cmd/swears");

/**
 * Slash command definition for `/swears`.
 * Shows a member's total tracked swears (defaults to the caller).
 */
export const data = new SlashCommandBuilder()
  .setName("swears")
  .setDescription("Show how many tracked swears a member has")
  .addUserOption((opt) => opt.setName("user").setDescription("Member to look up (defaults to you)"))
  .setContexts(InteractionContextType.Guild);

/**
 * Executes the `/swears` command.
 * Replies with the target member's total tracked swears.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    log.warn("used outside guild", { userId: interaction.user.id });
    await interaction.reply({
      content: "Use this command in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const target = interaction.options.getUser("user") ?? interaction.user;
  const total = getUserTotal(interaction.guildId!, target.id);
  log.debug("user swear total", {
    guildId: interaction.guildId!,
    userId: target.id,
    total,
  });

  const who = target.id === interaction.user.id ? "You have" : `${target} has`;
  await interaction.reply({
    content: `${who} **${total}** tracked swear${total === 1 ? "" : "s"}.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}
