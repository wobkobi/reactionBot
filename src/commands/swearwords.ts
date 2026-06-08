// src/commands/swearwords.ts

import { getTopSwears } from "@/swears/storage.js";
import { createLogger } from "@/utils/log.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  InteractionReplyOptions,
  MessageFlags,
} from "discord.js";

const log = createLogger("cmd/swearwords");

/**
 * Slash command definition for `/swearwords`.
 * Shows the most-used swear words across the server.
 */
export const data = new SlashCommandBuilder()
  .setName("swearwords")
  .setDescription("Show the most-used swear words in this server")
  .addIntegerOption((opt) =>
    opt.setName("limit").setDescription("How many to show (1-25)").setMinValue(1).setMaxValue(25),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Executes the `/swearwords` command.
 * Builds a leaderboard of the most-used swear words and replies with it.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the leaderboard is sent.
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

  try {
    const limit = interaction.options.getInteger("limit") ?? 10;
    const rows = getTopSwears(interaction.guildId!, limit);
    const lines = rows.map((r, i) => `**${i + 1}.** ${r.swear} - **${r.count}**`);

    const embed = new EmbedBuilder()
      .setTitle("Most-used swears")
      .setDescription(lines.join("\n") || "No data yet.");

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    log.info("sent swear words", { guildId: interaction.guildId!, shown: rows.length });
  } catch (err) {
    log.error("failed to build swear words", {
      guildId: interaction.guildId!,
      error: err instanceof Error ? err.message : String(err),
    });
    const reply: InteractionReplyOptions = {
      content: "⚠️ Could not fetch the swear words. Try again later.",
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
}
