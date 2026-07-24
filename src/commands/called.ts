// src/commands/called.ts

import { replyReset, replyTopUsers, replyTopWords, replyUserTotal } from "@/tracking/commands.js";
import { getTopWords } from "@/tracking/store.js";
import { CALLED } from "@/tracking/trackers.js";
import { requireAdmin } from "@/utils/permissions.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { AutocompleteInteraction, ChatInputCommandInteraction, MessageFlags } from "discord.js";

/** Slash command definition for `/called` and its subcommands. */
export const data = new SlashCommandBuilder()
  .setName("called")
  .setDescription("Name-calling tracking")
  .addSubcommand((sub) =>
    sub
      .setName("count")
      .setDescription("Show how many times a member has been called names")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Member to look up (defaults to you)"),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("top")
      .setDescription("Show who gets called names the most")
      .addStringOption((opt) =>
        opt
          .setName("word")
          .setDescription("Rank by who gets called this specific name (e.g. bender)")
          .setAutocomplete(true),
      )
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
      .setDescription("Show the most-thrown insults in this server")
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
      .setDescription("Reset called-names stats for this server (or one member) - admin only")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Reset only this member (defaults to the whole server)"),
      ),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Autocompletes the `word` option of `/called top` from the names actually
 * recorded in this server, so typos and never-used words are avoided up front.
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
 * Executes `/called top`: a leaderboard of members by names received,
 * optionally filtered to one specific insult word.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
async function executeTop(interaction: ChatInputCommandInteraction): Promise<void> {
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

/**
 * Executes `/called`: routes to the count, top, words, or nuke subcommand.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  switch (interaction.options.getSubcommand()) {
    case "count":
      await replyUserTotal(interaction, CALLED, { verbPast: "been called", noun: "name" });
      return;
    case "top":
      await executeTop(interaction);
      return;
    case "words":
      await replyTopWords(interaction, CALLED, "Most-thrown insults");
      return;
    case "nuke":
      if (!(await requireAdmin(interaction))) return;
      await replyReset(interaction, CALLED);
      return;
  }
}
