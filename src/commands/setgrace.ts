// src/commands/setgrace.ts

import { loadData, saveData } from "@/utils/file.js";
import { createLogger } from "@/utils/log.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

const log = createLogger("cmd/setgrace");

/**
 * Shape of the media settings persisted per guild.
 */
interface MediaSettings {
  /** Channel where transformed media gets reposted. */
  channelId?: string;
  /**
   * Grace period before moving a media link.
   * - "instant": move immediately without confirmation.
   * - "disabled": never auto-move (prompt stays).
   * - number: milliseconds before auto-approval.
   */
  grace?: "instant" | "disabled" | number;
}

/**
 * Slash command definition for `/setgrace`.
 * Sets how long to wait (if at all) before auto-moving matched media links.
 */
export const data = new SlashCommandBuilder()
  .setName("setgrace")
  .setDescription("⏱️ Set auto-move grace period for media links")
  .addStringOption((opt) =>
    opt
      .setName("mode")
      .setDescription("instant | disabled | seconds")
      .setRequired(true)
      .addChoices(
        { name: "instant", value: "instant" },
        { name: "disabled", value: "disabled" },
        { name: "seconds", value: "seconds" },
      ),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("value")
      .setDescription("If mode=seconds, number of seconds (1–300)")
      .setMinValue(1)
      .setMaxValue(300),
  );

/**
 * Converts the provided mode/value into the persisted grace representation.
 * @param mode - "instant", "disabled", or "seconds".
 * @param seconds - Optional seconds value when mode is "seconds".
 * @returns The grace value to persist (milliseconds when mode is "seconds").
 */
export function resolveGrace(
  mode: "instant" | "disabled" | "seconds",
  seconds?: number | null,
): "instant" | "disabled" | number {
  if (mode === "instant" || mode === "disabled") return mode;
  // Stored as milliseconds: the approval pipeline treats a numeric grace as ms.
  return Number(seconds ?? 10) * 1000;
}

/**
 * Executes the `/setgrace` command.
 * Validates input, updates `media_settings.json`, and confirms to the invoker.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply has been sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    log.warn("invoked outside guild", { userId: interaction.user.id });
    await interaction.reply({ content: "Use in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const mode = interaction.options.getString("mode", true) as "instant" | "disabled" | "seconds";
  const value = interaction.options.getInteger("value");
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  log.debug("invoked", { guildId, userId, mode, value });

  if (mode === "seconds" && (value == null || value < 1 || value > 300)) {
    log.warn("invalid seconds value", { guildId, userId, mode, value });
    await interaction.reply({
      content: "Provide a valid seconds value between 1 and 300.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const settings = loadData<MediaSettings>(guildId, "media_settings.json", {
      soft: true,
    });

    const resolved = resolveGrace(mode, value);
    log.debug("resolved grace", { guildId, userId, resolved });

    settings.grace = resolved;
    saveData(guildId, "media_settings.json", settings);

    log.info("grace updated", {
      guildId,
      by: userId,
      mode,
      seconds: value ?? null,
      resolved,
    });

    const msg = mode === "seconds" ? `✅ Grace set to ${value}s.` : `✅ Grace set to ${mode}.`;

    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error("failed to update grace", {
      guildId,
      userId,
      error: (err as Error)?.message,
    });
    await interaction.reply({
      content: "⚠️ There was an error.",
      flags: MessageFlags.Ephemeral,
    });
  }
}
