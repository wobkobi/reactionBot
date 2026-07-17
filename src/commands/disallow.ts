// src/commands/disallow.ts

import { loadData, saveData } from "@/utils/file.js";
import { createLogger } from "@/utils/log.js";
import { isMediaAdmin } from "@/utils/permissions.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

const log = createLogger("cmd/disallow");

/** Slash command definition for `/disallow` - revoke bot-admin privileges. */
export const data = new SlashCommandBuilder()
  .setName("disallow")
  .setDescription("🔒 Take someone's bot-admin privileges away")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("Member to disallow").setRequired(true),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/disallow`: removes a member from the guild's allowed list.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply has been sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Use in a server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!isMediaAdmin(interaction)) {
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

  if (!allowed.includes(user.id)) {
    await interaction.reply({
      content: `${user} was not on the allowed list.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  saveData(guildId, "allowed.json", { ...config, allowed: allowed.filter((id) => id !== user.id) });
  log.info("user disallowed", { guildId, userId: user.id, by: interaction.user.id });
  await interaction.reply({
    content: `✅ ${user} no longer has special privileges.`,
    allowedMentions: { parse: [] },
  });
}
