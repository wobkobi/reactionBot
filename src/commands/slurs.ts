// src/commands/slurs.ts

import {
  replyCategoryBreakdown,
  replyReset,
  replyTopUsers,
  replyTopWords,
  replyUserTotal,
} from "@/tracking/commands.js";
import { SLURS } from "@/tracking/trackers.js";
import { requireAdmin } from "@/utils/permissions.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction } from "discord.js";

/** Slash command definition for `/slurs` and its subcommands. */
export const data = new SlashCommandBuilder()
  .setName("slurs")
  .setDescription("Slur tracking")
  .addSubcommand((sub) =>
    sub
      .setName("count")
      .setDescription("Show how many slurs a member has said")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Member to look up (defaults to you)"),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("top")
      .setDescription("Show top members by slurs said")
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
      .setDescription("Show the most-used slurs in this server")
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
      .setName("groups")
      .setDescription("Show which groups someone's slurs target most (or server-wide)")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Member to break down (defaults to the whole server)"),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("nuke")
      .setDescription("Reset slur stats for this server (or one member) - admin only")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Reset only this member (defaults to the whole server)"),
      ),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/slurs`: routes to the count, top, words, groups, or nuke
 * subcommand.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  switch (interaction.options.getSubcommand()) {
    case "count":
      await replyUserTotal(interaction, SLURS, { verbPast: "said", noun: "slur" });
      return;
    case "top":
      await replyTopUsers(interaction, SLURS, { title: "Slur offenders" });
      return;
    case "words":
      await replyTopWords(interaction, SLURS, "Most-used slurs");
      return;
    case "groups":
      await replyCategoryBreakdown(interaction, SLURS);
      return;
    case "nuke":
      if (!(await requireAdmin(interaction))) return;
      await replyReset(interaction, SLURS);
      return;
  }
}
