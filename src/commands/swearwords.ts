// src/commands/swearwords.ts

import { replyTopWords } from "@/tracking/commands.js";
import { SWEARS } from "@/tracking/trackers.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction } from "discord.js";

/** Slash command definition for `/swearwords`. */
export const data = new SlashCommandBuilder()
  .setName("swearwords")
  .setDescription("Show the most-used swear words in this server")
  .addIntegerOption((opt) =>
    opt.setName("limit").setDescription("How many to show (1-25)").setMinValue(1).setMaxValue(25),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/swearwords`: a leaderboard of the most-used swear words.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await replyTopWords(interaction, SWEARS, "Most-used swears");
}
