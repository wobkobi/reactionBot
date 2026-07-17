// src/commands/callednuke.ts

import { replyReset } from "@/tracking/commands.js";
import { CALLED } from "@/tracking/trackers.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";

/** Slash command definition for `/callednuke` (Manage Server only). */
export const data = new SlashCommandBuilder()
  .setName("callednuke")
  .setDescription("Reset called-names stats for this server (or one member)")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("Reset only this member (defaults to the whole server)"),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/callednuke`: clears called-names stats for the guild or a member.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await replyReset(interaction, CALLED);
}
