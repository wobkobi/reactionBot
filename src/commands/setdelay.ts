// src/commands/setdelay.ts

import { loadSettings, saveSettings } from "@/media/settings.js";
import { GraceSetting } from "@/media/types.js";
import { createLogger } from "@/utils/log.js";
import { isAdmin } from "@/utils/permissions.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

const log = createLogger("cmd/setdelay");

/**
 * Slash command definition for `/setdelay`. Subcommands make the input
 * self-explanatory - no mode/value combination to get wrong:
 * - `/setdelay instant` - move links immediately, no prompt
 * - `/setdelay seconds seconds:<1-300>` - prompt that times out
 * - `/setdelay disabled` - prompt that waits forever
 */
export const data = new SlashCommandBuilder()
  .setName("setdelay")
  .setDescription("⏱️ How long posters get before their link is moved")
  .addSubcommand((sub) =>
    sub.setName("instant").setDescription("No prompt - links get moved straight away"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("seconds")
      .setDescription("Give the poster a few seconds to hit Yes or No")
      .addIntegerOption((opt) =>
        opt
          .setName("seconds")
          .setDescription("How long they get (1-300)")
          .setMinValue(1)
          .setMaxValue(300)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("disabled").setDescription("Always ask, and wait forever for an answer"),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Converts the chosen subcommand/value into the persisted grace
 * representation.
 * @param mode - "instant", "disabled", or "seconds".
 * @param seconds - Optional seconds value when mode is "seconds".
 * @returns The {@link GraceSetting} to persist (milliseconds when mode is "seconds").
 */
export function resolveGrace(
  mode: "instant" | "disabled" | "seconds",
  seconds?: number | null,
): GraceSetting {
  if (mode === "instant" || mode === "disabled") return mode;
  // Stored as milliseconds: the approval pipeline treats a numeric grace as ms.
  return Number(seconds ?? 10) * 1000;
}

/**
 * Executes the `/setdelay` command: authorises the invoker, persists the new
 * grace setting, and confirms what behaviour was configured.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply has been sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    log.warn("invoked outside guild", { userId: interaction.user.id });
    await interaction.reply({ content: "Use in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (!isAdmin(interaction)) {
    log.warn("permission denied", { guildId, userId });
    await interaction.reply({
      content: "❌ You're not allowed to run this.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const mode = interaction.options.getSubcommand() as "instant" | "disabled" | "seconds";
  const seconds = mode === "seconds" ? interaction.options.getInteger("seconds", true) : null;

  try {
    const settings = loadSettings(guildId);
    settings.grace = resolveGrace(mode, seconds);
    saveSettings(guildId, settings);

    log.info("grace updated", { guildId, by: userId, mode, seconds });

    const confirmations: Record<typeof mode, string> = {
      instant: "✅ Links get moved straight away now, no prompt.",
      seconds: `✅ Posters get ${seconds}s to hit Yes or No before the prompt gives up.`,
      disabled: "✅ Posters always get asked, and the prompt waits forever.",
    };
    await interaction.reply({ content: confirmations[mode], flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error("failed to update grace", {
      guildId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    await interaction.reply({
      content: "⚠️ There was an error.",
      flags: MessageFlags.Ephemeral,
    });
  }
}
