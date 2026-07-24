// src/utils/permissions.ts

import { loadData } from "@/utils/file.js";
import { ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits } from "discord.js";

// Bot owner: always allowed to run admin commands in any guild. Overridable
// via the YOUR_ID env var.
const BOT_OWNER_ID = process.env.YOUR_ID;

/**
 * Checks whether the invoker may run admin commands (settings, allow/disallow,
 * nukes). Allowed: the guild owner, the bot owner ({@link BOT_OWNER_ID}),
 * anyone granted via the guild's allowed.json, or a member with Manage
 * Server (Administrator implies it). Runtime check rather than Discord default
 * permissions so allowed.json and bot-owner grants work for members without
 * Manage Server.
 * @param interaction - The command interaction to authorise.
 * @returns `true` when the invoker may run admin commands.
 */
export function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.inGuild()) return false;
  const userId = interaction.user.id;
  const allowed =
    loadData<{ allowed?: string[] }>(interaction.guildId, "allowed.json", { soft: true }).allowed ??
    [];
  return (
    userId === interaction.guild?.ownerId ||
    userId === BOT_OWNER_ID ||
    allowed.includes(userId) ||
    (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false)
  );
}

/**
 * Enforces {@link isAdmin} for a command, replying with an ephemeral refusal
 * when the invoker is not allowed.
 * @param interaction - The command interaction to authorise.
 * @returns `true` when the command may proceed, `false` when it was blocked
 * (a reply has already been sent).
 */
export async function requireAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (isAdmin(interaction)) return true;
  await interaction.reply({
    content: "❌ You're not allowed to run this.",
    flags: MessageFlags.Ephemeral,
  });
  return false;
}
