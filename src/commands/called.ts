// src/commands/called.ts

import { replyUserTotal } from "@/tracking/commands.js";
import { CALLED } from "@/tracking/trackers.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction } from "discord.js";

/** Slash command definition for `/called`. */
export const data = new SlashCommandBuilder()
  .setName("called")
  .setDescription("Show how many times a member has been called names")
  .addUserOption((opt) => opt.setName("user").setDescription("Member to look up (defaults to you)"))
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/called`: replies with how many names a member has been called.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await replyUserTotal(interaction, CALLED, { verbPast: "been called", noun: "name" });
}
