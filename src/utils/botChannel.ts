// src/utils/botChannel.ts

import { loadSettings } from "@/media/settings.js";
import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

/**
 * Enforces the bot-channel rule for non-settings commands: a bot channel must
 * be configured (via /setbotchannel), and the command must be invoked there.
 * Replies with the reason when the rule blocks the command.
 * @param interaction - The command interaction to check.
 * @returns `true` when the command may proceed, `false` when it was blocked
 * (a reply has already been sent).
 */
export async function requireBotChannel(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (!interaction.inGuild()) return true;

  const { botChannelId } = loadSettings(interaction.guildId);
  if (!botChannelId) {
    await interaction.reply({
      content: "⚠️ No bot channel is set - an admin needs to run /setbotchannel first.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  if (interaction.channelId !== botChannelId) {
    await interaction.reply({
      content: `Use bot commands in <#${botChannelId}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}
