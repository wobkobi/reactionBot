// src/commands/swearnuke.ts

import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import { resetGuild } from "../swears/storage.js";
import { createLogger } from "../utils/log.js";

const log = createLogger("cmd/swearnuke");

/**
 * @file Defines the /swearnuke command to reset all swear statistics
 * for the current guild.
 */

/**
 * Slash command definition for `/swearnuke`.
 * Restricted to members with Manage Server permission.
 */
export const data = new SlashCommandBuilder()
  .setName("swearnuke")
  .setDescription("Reset swear stats for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

/**
 * Executes the `/swearnuke` command.
 * Clears the guild’s swear statistics.
 * @param interaction - The command interaction context.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  log.info("invoked", {
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    guildId: interaction.guildId ?? "DM",
  });

  if (!interaction.inGuild()) {
    log.warn("used outside guild", { userId: interaction.user.id });
    await interaction.reply({
      content: "Use this command in a server.",
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guildId!;

  try {
    resetGuild(guildId);
    log.info("reset complete", { guildId });
    await interaction.reply({
      content: "✅ Swear stats reset.",
      ephemeral: true,
    });
  } catch (err) {
    log.error("reset failed", {
      guildId,
      error: err instanceof Error ? err.message : String(err),
    });

    const reply = {
      content: "⚠️ Failed to reset stats. Try again later.",
      ephemeral: true,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
}
