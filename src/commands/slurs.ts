// src/commands/slurs.ts

import {
  autocompleteWord,
  replyCategoryBreakdown,
  replyReset,
  replyTopUsers,
  replyTopWords,
  replyUserTotal,
  trackerCommand,
} from "@/tracking/commands";
import { SLURS } from "@/tracking/trackers";
import { requireAdmin } from "@/utils/permissions";
import { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";

/**
 * Slash command definition for `/slurs`: the shared tracker subcommands plus
 * `groups`, the targeted-group breakdown only slurs carry categories for.
 */
export const data = trackerCommand(SLURS).addSubcommand((sub) =>
  sub
    .setName("groups")
    .setDescription("Show which groups someone's slurs target most (or server-wide)")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Member to break down (defaults to the whole server)"),
    ),
);

/**
 * Autocompletes the `word` option of `/slurs top`.
 * @param interaction - The autocomplete interaction context.
 * @returns A promise that resolves when the suggestions are sent.
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await autocompleteWord(interaction, SLURS);
}

/**
 * Executes `/slurs`: routes to the count, top, words, groups, or nuke
 * subcommand.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  switch (interaction.options.getSubcommand()) {
    case "count":
      await replyUserTotal(interaction, SLURS);
      return;
    case "top":
      await replyTopUsers(interaction, SLURS);
      return;
    case "words":
      await replyTopWords(interaction, SLURS);
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
