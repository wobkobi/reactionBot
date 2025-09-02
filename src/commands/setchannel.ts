// src/commands/setchannel.ts

import { SlashCommandBuilder } from "@discordjs/builders";
import { ChatInputCommandInteraction, TextChannel } from "discord.js";
import * as dotenv from "dotenv";
import { loadData, saveData } from "../utils/file.js";
import { createLogger } from "../utils/log.js";

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
      .setRequired(true)
  );

/**
 * Executes the `/setchannel` command.
 * Validates permissions, persists `media_settings.json`, and confirms to the user.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply has been sent.
 */
export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.inGuild()) {
    log.warn("invoked outside guild", { userId: interaction.user.id });
    await interaction.reply({ content: "Use in a server.", ephemeral: true });
    return;
  }

  const channel = interaction.options.getChannel(
    "channel",
    true
  ) as TextChannel;
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
      userId === interaction.guild!.ownerId ||
      userId === OWNER_ID ||
      allowedIds.includes(userId);

    if (!isAdmin) {
      log.warn("permission denied", { guildId, userId });
      await interaction.reply({
        content: "❌ You’re not allowed to run this.",
        ephemeral: true,
      });
      return;
    }

    // Save (compat): write into media_settings.json (used by onMessage) and legacy media_channel.json
    const settings = loadData<{ channelId?: string; grace?: unknown }>(
      guildId,
      "media_settings.json",
      { soft: true }
    );
    settings.channelId = channel.id;

    saveData(guildId, "media_settings.json", settings);
    saveData(guildId, "media_channel.json", { channelId: channel.id }); // legacy

    log.info("media channel set", {
      guildId,
      channelId: channel.id,
      by: userId,
    });

    await interaction.reply({
      content: `✅ Media channel set to ${channel}`,
      ephemeral: true,
    });
  } catch (err) {
    log.error("failed to set media channel", {
      guildId,
      userId,
      error: (err as Error)?.message,
    });
    await interaction.reply({
      content: "⚠️ There was an error.",
      ephemeral: true,
    });
  }
}
