// src/commands/setbotchannel.ts

import { loadSettings, saveSettings } from "@/media/settings.js";
import { createLogger } from "@/utils/log.js";
import { isMediaAdmin } from "@/utils/permissions.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChannelType, ChatInputCommandInteraction, MessageFlags, TextChannel } from "discord.js";

const log = createLogger("cmd/setbotchannel");

/**
 * Command definition for /setbotchannel. Sets the channel bot commands must
 * be used in; until one is set, non-settings commands refuse to run.
 */
export const data = new SlashCommandBuilder()
  .setName("setbotchannel")
  .setDescription("🤖 Set the channel bot commands must be used in")
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Text channel where bot commands are allowed")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Executes the `/setbotchannel` command: authorises the invoker, persists the
 * bot channel, and confirms to the user.
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
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (!isMediaAdmin(interaction)) {
    log.warn("permission denied", { guildId, userId });
    await interaction.reply({
      content: "❌ You're not allowed to run this.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const settings = loadSettings(guildId);
    settings.botChannelId = channel.id;
    saveSettings(guildId, settings);

    log.info("bot channel set", { guildId, channelId: channel.id, by: userId });

    await interaction.reply({
      content: `✅ Bot commands now live in ${channel}.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    log.error("failed to set bot channel", {
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
