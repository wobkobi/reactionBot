// src/commands/setchannel.ts

import { loadData, saveData } from "@/utils/file.js";
import { createLogger } from "@/utils/log.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { ChatInputCommandInteraction, MessageFlags, TextChannel } from "discord.js";
import * as dotenv from "dotenv";

dotenv.config();

const log = createLogger("cmd/setchannel");

// Bot owner ID from environment
const OWNER_ID = process.env.YOUR_ID;

/**
 * Command definition for /setchannel.
 */
export const data = new SlashCommandBuilder()
  .setName("setchannel")
  .setDescription("📺 Set where media links get reposted")
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Text channel to post transformed media into")
      .setRequired(true),
  );

/**
 * Executes the `/setchannel` command.
 * Validates permissions, persists `media_settings.json`, and confirms to the user.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply has been sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    log.warn("invoked outside guild", { userId: interaction.user.id });
    await interaction.reply({ content: "Use in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = interaction.options.getChannel("channel", true) as TextChannel;
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  log.debug("invoked", {
    guildId,
    userId,
    targetChannelId: channel.id,
  });

  try {
    const config = loadData<{ allowed?: string[] }>(guildId, "allowed.json", {
      soft: true,
    });
    const allowedIds = config.allowed ?? [];

    const isAdmin =
      userId === interaction.guild!.ownerId || userId === OWNER_ID || allowedIds.includes(userId);

    if (!isAdmin) {
      log.warn("permission denied", { guildId, userId });
      await interaction.reply({
        content: "❌ You’re not allowed to run this.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Persist the target channel into media_settings.json (read by onMessage).
    const settings = loadData<{ channelId?: string; grace?: unknown }>(
      guildId,
      "media_settings.json",
      { soft: true },
    );
    settings.channelId = channel.id;

    saveData(guildId, "media_settings.json", settings);

    log.info("media channel set", {
      guildId,
      channelId: channel.id,
      by: userId,
    });

    await interaction.reply({
      content: `✅ Media channel set to ${channel}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    log.error("failed to set media channel", {
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
