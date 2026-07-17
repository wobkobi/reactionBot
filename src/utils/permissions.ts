// src/utils/permissions.ts

import { loadData } from "@/utils/file.js";
import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";

/**
 * Checks whether the invoker may change media settings (/setmediachannel,
 * /setdelay). Allowed: the guild owner, the bot owner (YOUR_ID env var),
 * anyone granted via the guild's allowed.json, or a member with Manage
 * Server. Runtime check rather than Discord default permissions so
 * allowed.json grants work for members without Manage Server.
 * @param interaction - The command interaction to authorise.
 * @returns `true` when the invoker may change media settings.
 */
export function isMediaAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.inGuild()) return false;
  const userId = interaction.user.id;
  const allowed =
    loadData<{ allowed?: string[] }>(interaction.guildId, "allowed.json", { soft: true }).allowed ??
    [];
  return (
    userId === interaction.guild?.ownerId ||
    (!!process.env.YOUR_ID && userId === process.env.YOUR_ID) ||
    allowed.includes(userId) ||
    (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false)
  );
}
