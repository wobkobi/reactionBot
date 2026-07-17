// src/commands/calledtop.ts

import { replyTopUsers } from "@/tracking/commands.js";
import { getTopWords } from "@/tracking/store.js";
import { CALLED } from "@/tracking/trackers.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { AutocompleteInteraction, ChatInputCommandInteraction, MessageFlags } from "discord.js";

/** Slash command definition for `/calledtop`. */
export const data = new SlashCommandBuilder()
  .setName("calledtop")
  .setDescription("Show who gets called names the most")
  .addStringOption((opt) =>
    opt
      .setName("word")
      .setDescription("Rank by who gets called this specific name (e.g. bender)")
      .setAutocomplete(true),
  )
  .addIntegerOption((opt) =>
    opt.setName("limit").setDescription("How many to show (1-25)").setMinValue(1).setMaxValue(25),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Autocompletes the `word` option from the names actually recorded in this
 * server, so typos and never-used words are avoided up front.
 * @param interaction - The autocomplete interaction context.
 * @returns A promise that resolves when the suggestions are sent.
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.respond([]);
    return;
  }
  const typed = interaction.options.getFocused().trim().toLowerCase();
  const words = getTopWords(interaction.guildId, CALLED.storeFile, 1000)
    .map((r) => r.word)
    .filter((w) => w.includes(typed))
    .slice(0, 25);
  await interaction.respond(words.map((w) => ({ name: w, value: w })));
}

/**
 * Executes `/calledtop`: a leaderboard of members by names received, optionally
 * filtered to one specific insult word.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const word = interaction.options.getString("word")?.trim().toLowerCase() || null;

  // Free-text safety net for anyone who bypasses the autocomplete: an unknown
  // word would only render an empty leaderboard, so say why instead.
  if (word && interaction.inGuild()) {
    const known = getTopWords(interaction.guildId, CALLED.storeFile, Infinity).some(
      (r) => r.word === word,
    );
    if (!known) {
      await interaction.reply({
        content: `No one has been called "${word}" here yet.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  await replyTopUsers(interaction, CALLED, { title: "Most called", word });
}
