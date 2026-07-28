// src/commands/swears.ts

import {
  autocompleteWord,
  replyReset,
  replyTopUsers,
  replyTopWords,
  replyUserTotal,
  trackerCommand,
} from "@/tracking/commands";
import { SWEARS } from "@/tracking/trackers";
import { requireAdmin } from "@/utils/permissions";
import { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";

/** Slash command definition for `/swears` and its subcommands. */
export const data = trackerCommand(SWEARS);

/**
 * Autocompletes the `word` option of `/swears top`.
 * @param interaction - The autocomplete interaction context.
 * @returns A promise that resolves when the suggestions are sent.
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await autocompleteWord(interaction, SWEARS);
}

/**
 * Executes `/swears`: routes to the count, top, words, or nuke subcommand.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  switch (interaction.options.getSubcommand()) {
    case "count":
      await replyUserTotal(interaction, SWEARS);
      return;
    case "top":
      await replyTopUsers(interaction, SWEARS);
      return;
    case "words":
      await replyTopWords(interaction, SWEARS);
      return;
    case "nuke":
      if (!(await requireAdmin(interaction))) return;
      await replyReset(interaction, SWEARS);
      return;
  }
}
