// src/commands/slurs.ts

import { replyUserTotal } from "@/tracking/commands.js";
import { SLURS } from "@/tracking/trackers.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction } from "discord.js";

/** Slash command definition for `/slurs`. */
export const data = new SlashCommandBuilder()
  .setName("slurs")
  .setDescription("Show how many slurs a member has said")
  .addUserOption((opt) => opt.setName("user").setDescription("Member to look up (defaults to you)"))
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/slurs`: replies with a member's total slurs said.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await replyUserTotal(interaction, SLURS, { verbPast: "said", noun: "slur" });
}
