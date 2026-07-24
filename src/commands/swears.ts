// src/commands/swears.ts

import { replyReset, replyTopUsers, replyTopWords, replyUserTotal } from "@/tracking/commands.js";
import { SWEARS } from "@/tracking/trackers.js";
import { requireAdmin } from "@/utils/permissions.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction } from "discord.js";

/** Slash command definition for `/swears` and its subcommands. */
export const data = new SlashCommandBuilder()
  .setName("swears")
  .setDescription("Swear tracking")
  .addSubcommand((sub) =>
    sub
      .setName("count")
      .setDescription("Show how many tracked swears a member has")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Member to look up (defaults to you)"),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("top")
      .setDescription("Show top members by total tracked swears")
      .addIntegerOption((opt) =>
        opt
          .setName("limit")
          .setDescription("How many to show (1-25)")
          .setMinValue(1)
          .setMaxValue(25),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("words")
      .setDescription("Show the most-used swear words in this server")
      .addIntegerOption((opt) =>
        opt
          .setName("limit")
          .setDescription("How many to show (1-25)")
          .setMinValue(1)
          .setMaxValue(25),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("nuke")
      .setDescription("Reset swear stats for this server (or one member) - admin only")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Reset only this member (defaults to the whole server)"),
      ),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/swears`: routes to the count, top, words, or nuke subcommand.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  switch (interaction.options.getSubcommand()) {
    case "count":
      await replyUserTotal(interaction, SWEARS, { verbPast: "said", noun: "swear" });
      return;
    case "top":
      await replyTopUsers(interaction, SWEARS, { title: "Swearboard" });
      return;
    case "words":
      await replyTopWords(interaction, SWEARS, "Most-used swears");
      return;
    case "nuke":
      if (!(await requireAdmin(interaction))) return;
      await replyReset(interaction, SWEARS);
      return;
  }
}
