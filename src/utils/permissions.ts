// src/utils/permissions.ts

import { respond } from "@/utils/respond";
import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

/**
 * The bot owner, always allowed to run admin commands in any guild, set via
 * the YOUR_ID env var. When unset no user ID can match, so nothing is granted.
 *
 * Read at the point of use rather than captured in a module constant: index.ts
 * imports this module, and ESM evaluates an imported module before the body of
 * the one importing it, so a constant here would be read before
 * `dotenv.config()` has populated the environment - leaving the grant
 * permanently unset for anyone configuring it through .env.
 * @returns The owner's Discord ID, or `undefined` when YOUR_ID is unset.
 */
function botOwnerId(): string | undefined {
  return process.env.YOUR_ID || undefined;
}

/**
 * Commands that need admin from end to end. No builder carries default member
 * permissions: Discord applies those before dispatching, which would keep the
 * bot-owner grant in {@link isAdmin} from ever being consulted for an owner
 * without Manage Server. Authorisation is {@link requireAdmin} at runtime
 * instead, and `/help` uses this list to keep them out of a member's listing.
 */
export const ADMIN_COMMANDS: string[] = ["calmdown", "setdelay", "setmediachannel"];

/**
 * Subcommands that need admin on commands that are otherwise open to everyone,
 * keyed by command name. `/help` drops these lines for a member rather than the
 * whole command, and marks them for an admin. Keep both lists in step with the
 * {@link requireAdmin} calls in the command modules.
 */
export const ADMIN_SUBCOMMANDS: Record<string, string[]> = {
  slurs: ["nuke"],
  swears: ["nuke"],
};

/**
 * Checks whether the invoker may run admin commands (settings, nukes).
 * Allowed: the bot owner ({@link botOwnerId}), the guild owner, or a member
 * with Manage Server (Administrator implies it). Runtime check rather than
 * Discord default permissions so the bot-owner grant works for members
 * without Manage Server - see {@link ADMIN_COMMANDS}.
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
    userId === botOwnerId() ||
    userId === interaction.guild?.ownerId ||
    (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false)
  );
}

/**
 * Enforces {@link isAdmin} for a command, replying with an ephemeral refusal
 * when the invoker is not allowed.
 * @param interaction - The command interaction to authorise.
 * @returns `true` when the command may proceed, `false` when it was blocked
 * (the refusal has been sent, or dropped when the interaction was already
 * gone - see {@link respond}).
 */
export async function requireAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (isAdmin(interaction)) return true;
  await respond(interaction, {
    content: "❌ You're not allowed to run this.",
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

/**
 * Whether an invocation needs admin, by name. Covers both a wholly admin
 * command ({@link ADMIN_COMMANDS}) and an admin subcommand of an open one
 * ({@link ADMIN_SUBCOMMANDS}).
 * @param command - The command name, without the leading slash.
 * @param subcommand - The chosen subcommand, or null when there is none.
 * @returns `true` when the invocation is admin-only.
 */
export function needsAdmin(command: string, subcommand?: string | null): boolean {
  if (ADMIN_COMMANDS.includes(command)) return true;
  return subcommand !== null && subcommand !== undefined
    ? (ADMIN_SUBCOMMANDS[command] ?? []).includes(subcommand)
    : false;
}

/**
 * Authorises a command before it is dispatched. Nothing is registered with
 * default member permissions, so Discord hands every command to every member
 * and this is the gate that stops one - a command module's own
 * {@link requireAdmin} call is a second layer, not the only one.
 * @param interaction - The command interaction about to be dispatched.
 * @returns `true` when the command may run, `false` when it was refused (see
 * {@link requireAdmin} for what the caller was told).
 */
export async function gateCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!needsAdmin(interaction.commandName, interaction.options.getSubcommand(false))) return true;
  return requireAdmin(interaction);
}

/**
 * Authorises an autocomplete request. Suggestions for an admin-only
 * invocation would otherwise be served to anyone who can type the command,
 * which is everyone now that Discord filters nothing.
 * @param interaction - The autocomplete interaction about to be dispatched.
 * @returns `true` when the suggestions may be built.
 */
export function gateAutocomplete(interaction: AutocompleteInteraction): boolean {
  if (!needsAdmin(interaction.commandName, interaction.options.getSubcommand(false))) return true;
  return isAdmin(interaction);
}
