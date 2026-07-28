// src/commands/gif.ts

import {
  addGif,
  GENERIC,
  listCategories,
  listGifs,
  loadGifConfig,
  removeGif,
  saveGifConfig,
} from "@/tracking/gifs.js";
import { isAdmin } from "@/utils/permissions.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { randomUUID } from "crypto";
import { InteractionContextType } from "discord-api-types/v10";
import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";

/** Slash command definition for `/gif` and its subcommands. */
export const data = new SlashCommandBuilder()
  .setName("gif")
  .setDescription("Manage the GIFs the bot replies with")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Add a reply GIF to a category - anyone can do this")
      .addStringOption((opt) =>
        opt
          .setName("category")
          .setDescription("What it replies to (generic = any slur)")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("url").setDescription("Link to the GIF or image").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("Show the reply GIFs currently in the pool")
      .addStringOption((opt) =>
        opt.setName("category").setDescription("Only show this category").setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove a GIF you added (admins can remove any)")
      .addStringOption((opt) =>
        opt
          .setName("entry")
          .setDescription("Which GIF to remove")
          .setAutocomplete(true)
          .setRequired(true),
      ),
  )
  .setContexts(InteractionContextType.Guild);

/** Longest URL fragment shown in an autocomplete label. */
const LABEL_URL_MAX = 60;

/** Most entries shown by `/gif list` before it asks for a category filter. */
const LIST_MAX = 25;

/**
 * Shortens text for an autocomplete label, which Discord caps at 100
 * characters.
 * @param text - The text to shorten.
 * @param max - Length to trim to, ellipsis included.
 * @returns The shortened text.
 */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Autocompletes `/gif`: category names for add and list, and the removable
 * entries for remove - the invoker's own, or all of them for an admin.
 * @param interaction - The autocomplete interaction context.
 * @returns A promise that resolves when the suggestions are sent.
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.respond([]);
    return;
  }
  const typed = interaction.options.getFocused().trim().toLowerCase();

  if (interaction.options.getSubcommand() === "remove") {
    // Only entries added through /gif carry an id, so the hand-written
    // originals are never offered here.
    const canRemoveAny = isAdmin(interaction);
    const choices = listGifs(loadGifConfig())
      .filter((e) => e.id && (canRemoveAny || e.addedBy === interaction.user.id))
      .filter((e) => e.content.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((e) => ({
        name: truncate(`${(e.categories ?? [GENERIC]).join("/")} - ${e.content}`, LABEL_URL_MAX),
        value: e.id!,
      }));
    await interaction.respond(choices);
    return;
  }

  const cats = listCategories(interaction.guildId)
    .filter((c) => c.toLowerCase().includes(typed))
    .slice(0, 25);
  await interaction.respond(cats.map((c) => ({ name: c, value: c })));
}

/**
 * Executes `/gif add`: appends a GIF to a category. Open to everyone, so the
 * entry records who added it and can be taken back out by them or an admin.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
async function executeAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const category = interaction.options.getString("category", true).trim();
  const url = interaction.options.getString("url", true).trim();

  const result = addGif({
    raw: loadGifConfig(),
    category,
    validCategories: listCategories(interaction.guildId!),
    url,
    addedBy: interaction.user.id,
    id: randomUUID().slice(0, 8),
    addedAt: new Date().toISOString(),
  });
  if (!result.ok) {
    await interaction.reply({ content: `⚠️ ${result.reason}`, flags: MessageFlags.Ephemeral });
    return;
  }

  saveGifConfig(result.config);
  await interaction.reply({
    content: `✅ Added to **${category}**. It's in the rotation from the next message on.`,
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Executes `/gif list`: the current pool, optionally filtered to one category.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
async function executeList(interaction: ChatInputCommandInteraction): Promise<void> {
  const category = interaction.options.getString("category")?.trim() || undefined;
  const entries = listGifs(loadGifConfig(), category);

  const lines = entries.slice(0, LIST_MAX).map((e, i) => {
    const tags = (e.categories ?? [GENERIC]).join("/");
    const who = e.addedBy ? ` - added by <@${e.addedBy}>` : "";
    return `**${i + 1}.** \`${tags}\`${who}\n${e.content}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(category ? `Reply GIFs (${category})` : "Reply GIFs")
    .setDescription(lines.join("\n\n") || "Nothing here yet.");
  if (entries.length > LIST_MAX) {
    embed.setFooter({
      text: `Showing ${LIST_MAX} of ${entries.length} - filter by category to see the rest.`,
    });
  }

  // Ephemeral and unping-ing: managing the pool shouldn't spam the channel or
  // poke everyone who ever added a GIF.
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

/**
 * Executes `/gif remove`: drops an entry the invoker added, or any entry when
 * they are an admin.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
async function executeRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.options.getString("entry", true).trim();

  const result = removeGif(loadGifConfig(), id, interaction.user.id, isAdmin(interaction));
  if (!result.ok) {
    await interaction.reply({ content: `⚠️ ${result.reason}`, flags: MessageFlags.Ephemeral });
    return;
  }

  saveGifConfig(result.config);
  await interaction.reply({ content: "✅ Removed.", flags: MessageFlags.Ephemeral });
}

/**
 * Executes `/gif`: routes to the add, list, or remove subcommand.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) return;
  switch (interaction.options.getSubcommand()) {
    case "add":
      await executeAdd(interaction);
      return;
    case "list":
      await executeList(interaction);
      return;
    case "remove":
      await executeRemove(interaction);
      return;
  }
}
