// src/commands/swearnuke.ts

import { resetGuild, resetUser } from "@/swears/storage.js";
import { createLogger } from "@/utils/log.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import {
  ChatInputCommandInteraction,
  InteractionReplyOptions,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

const log = createLogger("cmd/swearnuke");

/**
 * @file Defines the /swearnuke command to reset swear statistics for the whole
 * guild or a single member.
 */

/**
 * Slash command definition for `/swearnuke`.
 * Restricted to members with Manage Server permission.
 */
export const data = new SlashCommandBuilder()
  .setName("swearnuke")
  .setDescription("Reset swear stats for this server (or one member)")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("Reset only this member (defaults to the whole server)"),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

/**
 * Executes the `/swearnuke` command.
 * Clears the guild’s swear statistics.
 * @param interaction - The command interaction context.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  log.info("invoked", {
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    guildId: interaction.guildId ?? "DM",
  });

  if (!interaction.inGuild()) {
    log.warn("used outside guild", { userId: interaction.user.id });
    await interaction.reply({
      content: "Use this command in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guildId = interaction.guildId!;
  const target = interaction.options.getUser("user");

  try {
    if (target) {
      resetUser(guildId, target.id);
      log.info("reset user complete", { guildId, userId: target.id });
      await interaction.reply({
        content: `✅ Swear stats reset for ${target}.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    } else {
      resetGuild(guildId);
      log.info("reset complete", { guildId });
      await interaction.reply({
        content: "✅ Swear stats reset for the whole server.",
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    log.error("reset failed", {
      guildId,
      error: err instanceof Error ? err.message : String(err),
    });

    const reply: InteractionReplyOptions = {
      content: "⚠️ Failed to reset stats. Try again later.",
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
}
