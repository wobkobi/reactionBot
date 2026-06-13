// src/commands/calledwords.ts

import { replyTopWords } from "@/tracking/commands.js";
import { CALLED } from "@/tracking/trackers.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction } from "discord.js";

/** Slash command definition for `/calledwords`. */
export const data = new SlashCommandBuilder()
  .setName("calledwords")
  .setDescription("Show the most-thrown insults in this server")
  .addIntegerOption((opt) =>
    opt.setName("limit").setDescription("How many to show (1-25)").setMinValue(1).setMaxValue(25),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/calledwords`: a leaderboard of the most-thrown insults.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await replyTopWords(interaction, CALLED, "Most-thrown insults");
}
