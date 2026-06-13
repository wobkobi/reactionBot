// src/commands/calledtop.ts

import { replyTopUsers } from "@/tracking/commands.js";
import { CALLED } from "@/tracking/trackers.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction } from "discord.js";

/** Slash command definition for `/calledtop`. */
export const data = new SlashCommandBuilder()
  .setName("calledtop")
  .setDescription("Show who gets called names the most")
  .addStringOption((opt) =>
    opt.setName("word").setDescription("Rank by who gets called this specific name (e.g. bender)"),
  )
  .addIntegerOption((opt) =>
    opt.setName("limit").setDescription("How many to show (1-25)").setMinValue(1).setMaxValue(25),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/calledtop`: a leaderboard of members by names received, optionally
 * filtered to one specific insult word.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await replyTopUsers(interaction, CALLED, {
    title: "Most called",
    word: interaction.options.getString("word"),
  });
}
