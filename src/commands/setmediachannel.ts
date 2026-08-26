// src/commands/setmediachannel.ts

import { loadSettings, saveSettings } from "@/media/settings";
import { createLogger } from "@/utils/log";
import { requireAdmin } from "@/utils/permissions";
import { respond } from "@/utils/respond";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChannelType, ChatInputCommandInteraction, MessageFlags, TextChannel } from "discord.js";

const log = createLogger("cmd/setmediachannel");

/**
 * Command definition for /setmediachannel. The picker only offers text
 * channels, so a category or voice channel can't be chosen by mistake.
 */
export const data = new SlashCommandBuilder()
  .setName("setmediachannel")
  .setDescription("📺 Set where media links get reposted")
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Text channel to post transformed media into")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Executes the `/setmediachannel` command: authorises the invoker, persists
 * the target channel, and confirms to the user.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply has been sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    log.warn("invoked outside guild", { userId: interaction.user.id });
    await respond(interaction, { content: "Use in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = interaction.options.getChannel("channel", true) as TextChannel;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (!(await requireAdmin(interaction))) {
    log.warn("permission denied", { guildId, userId });
    return;
  }

  log.debug("invoked", { guildId, userId, targetChannelId: channel.id });

  try {
    const settings = loadSettings(guildId);
    settings.channelId = channel.id;
    saveSettings(guildId, settings);

    log.info("media channel set", { guildId, channelId: channel.id, by: userId });

    await respond(interaction, {
      content: `✅ Media channel set to ${channel}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    log.error("failed to set media channel", {
      guildId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    await respond(interaction, {
      content: "⚠️ There was an error.",
      flags: MessageFlags.Ephemeral,
    });
  }
}
