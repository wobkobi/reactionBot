// src/commands/sweartop.ts

import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { getTopUsers } from "../swears/storage.js";
import { createLogger } from "../utils/log.js";

const log = createLogger("cmd/sweartop");

/**
 * Slash command definition for `/sweartop`.
 * Shows the top users in the server ranked by total swear count.
 */
export const data = new SlashCommandBuilder()
  .setName("sweartop")
  .setDescription("Show top users by total tracked swears")
  .addIntegerOption((opt) =>
    opt
      .setName("limit")
      .setDescription("How many to show (1-25)")
      .setMinValue(1)
      .setMaxValue(25)
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Executes the `/sweartop` command.
 * Gathers the top N users by total swears and replies with a compact leaderboard.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the leaderboard is sent.
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

  try {
    const limit = interaction.options.getInteger("limit") ?? 10;
    const stats = getTopUsers(interaction.guildId!, limit);
    const entries = stats.sort((a, b) => b.total - a.total).slice(0, limit);

    log.debug("computed leaderboard", {
      guildId: interaction.guildId!,
      limit,
      count: entries.length,
    });

    const lines = await Promise.all(
      entries.map(async (entry, i) => {
        const user = await interaction.client.users
          .fetch(entry.userId)
          .catch(() => null);
        const name = user?.tag ?? entry.userId;
        return `**${i + 1}.** ${name} — **${entry.total}**`;
      })
    );

    const embed = new EmbedBuilder()
      .setTitle("Swearboard")
      .setDescription(lines.join("\n") || "No data.");

    await interaction.reply({ embeds: [embed], ephemeral: true });

    log.info("sent leaderboard", {
      guildId: interaction.guildId!,
      limit,
      shown: entries.length,
    });
  } catch (err) {
    log.error("failed to build/send leaderboard", {
      guildId: interaction.guildId!,
      error: err instanceof Error ? err.message : String(err),
    });

    const reply = {
      content: "⚠️ Couldn’t fetch the leaderboard. Try again later.",
      ephemeral: true,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
}
