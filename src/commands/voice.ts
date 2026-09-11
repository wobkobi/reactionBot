// src/commands/voice.ts

import { requireAdmin } from "@/utils/permissions";
import { respond } from "@/utils/respond";
import { ambientRunning } from "@/voice/ambient";
import { opusDecoderName } from "@/voice/opus";
import { sessionChannelId } from "@/voice/session";
import { isAutojoin } from "@/voice/settings";
import {
  hasSomethingToPlay,
  loadSounds,
  resolveClipPath,
  resolveClips,
  type ClipSource,
  type CompiledSounds,
} from "@/voice/sounds";
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
  .setDescription("🎙️ Check the voice listener and its sound config")
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("Show what the voice listener is doing"),
  )
  .addSubcommand((sub) =>
    sub.setName("check").setDescription("Check the sound config and report anything broken"),
  );

/**
 * Describes ambient playback for the status report. It has no trigger anyone
 * can test against, so the only way to tell it is working is to be told.
 * @param compiled - The guild's compiled sound config.
 * @param guildId - Discord guild (server) ID.
 * @returns A one-line description.
 */
function ambientDescription(compiled: CompiledSounds, guildId: string): string {
  const ambient = compiled.ambient;
  if (!ambient) return "not configured";
  const clips = resolveClips(guildId, ambient.source).length;
  const mins = (ms: number): number => Math.round(ms / 60_000);
  const state = ambientRunning(guildId) ? "running" : "idle (not in a channel)";
  return `${state}, ${clips} clip${clips === 1 ? "" : "s"} every ${mins(ambient.minMs)}-${mins(ambient.maxMs)} min`;
}

/**
 * Names a clip source the way it reads in the config.
 * @param source - Where an entry draws its clips from.
 * @returns A short label.
 */
function sourceLabel(source: ClipSource): string {
  return source.kind === "folder" ? `\`${source.name}/\`` : "inline list";
}

/**
 * Checks one entry's clips and reports what is wrong, if anything.
 * @param guildId - Discord guild (server) ID.
 * @param label - What to call the entry in the report.
 * @param source - Where it draws its clips from.
 * @returns One report line, and whether it found a problem.
 */
function checkSource(
  guildId: string,
  label: string,
  source: ClipSource,
): { line: string; problem: boolean } {
  const clips = resolveClips(guildId, source);
  if (clips.length === 0) {
    return { line: `⚠️ ${label} > ${sourceLabel(source)} - no clips found`, problem: true };
  }
  // A folder listing is real by definition. A hand-written list is not, so
  // check the names actually point at files before the first play does.
  const missing = clips.filter((c) => resolveClipPath(guildId, c) === null);
  if (missing.length > 0) {
    return {
      line: `⚠️ ${label} > ${sourceLabel(source)} - missing: ${missing.slice(0, 3).join(", ")}`,
      problem: true,
    };
  }
  return { line: `✅ ${label} > ${sourceLabel(source)} (${clips.length})`, problem: false };
}

/**
 * Builds the config report for /voice check.
 * @param guildId - Discord guild (server) ID.
 * @returns The lines to show.
 */
function checkLines(guildId: string): string[] {
  const compiled = loadSounds(guildId);
  const lines: string[] = [];
  let problems = 0;

  // An ambient-only config has no triggers on purpose, so only a config with
  // nothing at all behind it is a problem worth counting.
  if (!hasSomethingToPlay(compiled)) {
    lines.push("⚠️ Nothing is configured to play.");
    problems += 1;
  } else if (compiled.triggers.length === 0) {
    lines.push("No triggers configured; ambient sounds only.");
  }
  for (const t of compiled.triggers) {
    const { line, problem } = checkSource(guildId, t.trigger.words.join(", "), t.source);
    lines.push(line);
    if (problem) problems += 1;
  }

  if (compiled.ambient) {
    const { line, problem } = checkSource(guildId, "ambient", compiled.ambient.source);
    lines.push(line);
    if (problem) problems += 1;
  }

  lines.push("");
  lines.push(problems === 0 ? "Everything resolves." : `${problems} to fix.`);
  return lines;
}

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
    `**Autojoin:** ${isAutojoin(guildId) ? "on" : "off (joins on /join only)"}`,
    `**Channel:** ${channelId ? `<#${channelId}>` : "not connected"}`,
    `**Triggers:** ${compiled.triggers.length} across ${pools} pool${pools === 1 ? "" : "s"}`,
    `**Ambient:** ${ambientDescription(compiled, guildId)}`,
    `**Speech recognition:** ${sttStatus()} (${sttModel()})`,
    `**Opus decoder:** ${decoder ?? "none loaded"}`,
    `**ffmpeg:** ${(await ffmpegAvailable()) ? "available" : "missing (no clip can play)"}`,
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

  if (sub === "check") {
    await respond(interaction, {
      content: checkLines(guildId).join("\n").slice(0, 1900),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // status
  await respond(interaction, {
    content: (await statusLines(guildId)).join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}
