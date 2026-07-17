// src/commands/slurtop.ts

import { replyTopUsers } from "@/tracking/commands.js";
import { SLURS } from "@/tracking/trackers.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction } from "discord.js";

/** Slash command definition for `/slurtop`. */
export const data = new SlashCommandBuilder()
  .setName("slurtop")
  .setDescription("Show top members by slurs said")
  .addIntegerOption((opt) =>
    opt.setName("limit").setDescription("How many to show (1-25)").setMinValue(1).setMaxValue(25),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/slurtop`: a leaderboard of members by slurs said.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await replyTopUsers(interaction, SLURS, { title: "Slur offenders" });
}
