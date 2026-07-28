// src/utils/permissions.ts

import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

// Bot owner: always allowed to run admin commands in any guild. Set via the
// YOUR_ID env var; when unset no user ID can match it, so nothing is granted.
const BOT_OWNER_ID = process.env.YOUR_ID;

/**
 * Checks whether the invoker may run admin commands (settings, nukes).
 * Allowed: the bot owner ({@link BOT_OWNER_ID}), the guild owner, or a member
 * with Manage Server (Administrator implies it). Runtime check rather than
 * Discord default permissions so the bot-owner grant works for members
 * without Manage Server.
 *
 * Autocomplete interactions are accepted too, so a command can tailor its
 * suggestions to what the invoker is allowed to act on.
 * @param interaction - The command or autocomplete interaction to authorise.
 * @returns `true` when the invoker may run admin commands.
 */
export function isAdmin(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
): boolean {
  if (!interaction.inGuild()) return false;
  const userId = interaction.user.id;
  return (
    userId === BOT_OWNER_ID ||
    userId === interaction.guild?.ownerId ||
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
