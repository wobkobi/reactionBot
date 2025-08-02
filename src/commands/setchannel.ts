// src/commands/setmediachannel.ts

/**
 * Slash command for setting the channel where media links (TikTok, Instagram, Twitter, Reddit)
 * will be reposted after transformation.
 */
import { SlashCommandBuilder } from "@discordjs/builders";
import { ChatInputCommandInteraction, TextChannel } from "discord.js";
import * as dotenv from "dotenv";
import { loadData, saveData } from "../utils/file";

dotenv.config();

/**
 * Command definition for /setmediachannel.
 */
export const data = new SlashCommandBuilder()
  .setName("setmediachannel")
  .setDescription("📺 Set where media links get reposted")
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Text channel to post transformed media into")
      .setRequired(true)
  );

// Bot owner ID from environment
const OWNER_ID = process.env.YOUR_ID;

/**
 * Executes the /setmediachannel command.
 * Checks if the user is an admin (guild owner, bot owner, or listed in allowed.json),
 * then saves the selected channel ID to the guild's media_channel.json and confirms.
 * @param interaction The ChatInputCommandInteraction provided by Discord.js.
 */
export async function execute(interaction: ChatInputCommandInteraction) {
  const channel = interaction.options.getChannel(
    "channel",
    true
  ) as TextChannel;
  const guildId = interaction.guildId!;

  const { allowed } = loadData(guildId, "allowed.json") as {
    allowed?: string[];
  };
  const allowedIds = allowed || [];

  const isAdmin =
    interaction.user.id === interaction.guild!.ownerId ||
    interaction.user.id === OWNER_ID ||
    allowedIds.includes(interaction.user.id);

  if (!isAdmin) {
    await interaction.reply({
      content: "❌ You’re not allowed to run this.",
      ephemeral: true,
    });
    return;
  }

  saveData(guildId, "media_channel.json", { channelId: channel.id });
  await interaction.reply({
    content: `✅ Media channel set to ${channel}`,
    ephemeral: true,
  });
}
