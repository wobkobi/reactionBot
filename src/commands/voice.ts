// src/commands/voice.ts

import { requireAdmin } from "@/utils/permissions";
import { respond } from "@/utils/respond";
import { opusDecoderName } from "@/voice/opus";
import { closeSession, sessionChannelId } from "@/voice/session";
import { isVoiceEnabled, setVoiceEnabled } from "@/voice/settings";
import { loadSounds } from "@/voice/sounds";
import { sttModel, sttStatus } from "@/voice/stt";
import { ffmpegAvailable } from "@/voice/transcode";
import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("voice")
  .setDescription("Listen in voice channels and play sound bites")
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("Show what the voice listener is doing"),
  )
  .addSubcommand((sub) =>
    sub.setName("enable").setDescription("Let the bot join voice channels and listen"),
  )
  .addSubcommand((sub) => sub.setName("disable").setDescription("Stop listening in this server"))
  .addSubcommand((sub) =>
    sub.setName("leave").setDescription("Leave the current voice channel for now"),
  );

/**
 * Builds the status report. Everything here is something that silently stops
 * voice working, so they are listed together rather than left to the logs.
 * @param guildId - Discord guild (server) ID.
 * @returns The lines to show.
 */
async function statusLines(guildId: string): Promise<string[]> {
  const compiled = loadSounds(guildId);
  const channelId = sessionChannelId(guildId);
  const pools = Object.keys(compiled.config.pools ?? {}).length;
  const decoder = opusDecoderName();

  return [
    `**Listening:** ${isVoiceEnabled(guildId) ? "enabled" : "disabled"}`,
    `**Channel:** ${channelId ? `<#${channelId}>` : "not connected"}`,
    `**Triggers:** ${compiled.triggers.length} across ${pools} pool${pools === 1 ? "" : "s"}`,
    `**Speech recognition:** ${sttStatus()} (${sttModel()})`,
    `**Opus decoder:** ${decoder ?? "none loaded"}`,
    `**ffmpeg:** ${(await ffmpegAvailable()) ? "available" : "missing (Ogg Opus clips only)"}`,
  ];
}

/**
 * Runs the /voice command.
 * @param interaction - The command interaction.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await respond(interaction, {
      content: "This only works in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!(await requireAdmin(interaction))) return;

  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand();

  if (sub === "status") {
    await respond(interaction, {
      content: (await statusLines(guildId)).join("\n"),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "enable") {
    setVoiceEnabled(guildId, true);
    const compiled = loadSounds(guildId);
    const warning =
      compiled.triggers.length === 0
        ? "\n⚠️ No triggers are configured yet, so nothing will play. See `data/readme.md`."
        : "";
    await respond(interaction, {
      content: `🎙️ Listening enabled. The bot will join voice channels that have people in them.${warning}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "disable") {
    setVoiceEnabled(guildId, false);
    closeSession(guildId, "disabled by command");
    await respond(interaction, {
      content: "🔇 Listening disabled for this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // leave: a one-off exit that leaves the setting alone, so the bot rejoins
  // when the channel next fills up.
  const channelId = sessionChannelId(guildId);
  closeSession(guildId, "asked to leave");
  await respond(interaction, {
    content: channelId ? "👋 Left the voice channel." : "Not in a voice channel.",
    flags: MessageFlags.Ephemeral,
  });
}
