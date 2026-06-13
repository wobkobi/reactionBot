// src/commands/slurgroups.ts

import { replyCategoryBreakdown } from "@/tracking/commands.js";
import { SLURS } from "@/tracking/trackers.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction } from "discord.js";

/** Slash command definition for `/slurgroups`. */
export const data = new SlashCommandBuilder()
  .setName("slurgroups")
  .setDescription("Show which groups someone's slurs target most (or server-wide)")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("Member to break down (defaults to the whole server)"),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/slurgroups`: a per-category breakdown of slurs for a member, or
 * guild-wide when no user is given.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await replyCategoryBreakdown(interaction, SLURS);
}
