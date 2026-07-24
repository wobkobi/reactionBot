// src/commands/allow.ts

import { loadData, saveData } from "@/utils/file.js";
import { createLogger } from "@/utils/log.js";
import { isAdmin } from "@/utils/permissions.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

const log = createLogger("cmd/allow");

/** Slash command definition for `/allow` - grant bot-admin privileges. */
export const data = new SlashCommandBuilder()
  .setName("allow")
  .setDescription("🔑 Let someone use the bot's admin commands")
  .addUserOption((opt) => opt.setName("user").setDescription("Member to allow").setRequired(true))
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/allow`: adds a member to the guild's allowed list (read by the
 * admin check for settings and reaction commands).
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply has been sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Use in a server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: "❌ You're not allowed to run this.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const user = interaction.options.getUser("user", true);
  const guildId = interaction.guildId;
  const config = loadData<{ allowed?: string[] }>(guildId, "allowed.json", { soft: true });
  const allowed = config.allowed ?? [];

  if (allowed.includes(user.id)) {
    await interaction.reply({
      content: `${user} is already allowed.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  allowed.push(user.id);
  saveData(guildId, "allowed.json", { ...config, allowed });
  log.info("user allowed", { guildId, userId: user.id, by: interaction.user.id });
  await interaction.reply({
    content: `✅ ${user} has been given special privileges.`,
    allowedMentions: { parse: [] },
  });
}
