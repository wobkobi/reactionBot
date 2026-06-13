// src/tracking/commands.ts

/**
 * @file Shared slash-command helpers for the tracker commands (swears, slurs,
 * called-names). Each command file wires its SlashCommandBuilder and delegates
 * to one of these, passing the relevant {@link Tracker}.
 */

import { aggregateByCategory, loadList } from "@/tracking/detect.js";
import {
  getTopUsers,
  getTopUsersForWord,
  getTopWords,
  getTotals,
  getUserCounts,
  getUserTotal,
  resetGuild,
  resetUser,
} from "@/tracking/store.js";
import { Tracker } from "@/tracking/trackers.js";
import { createLogger } from "@/utils/log.js";
import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  InteractionReplyOptions,
  MessageFlags,
} from "discord.js";

const log = createLogger("tracking/commands");

/**
 * Replies that the command must be used in a server.
 * @param interaction - The command interaction.
 * @returns A promise that resolves once the reply is sent.
 */
async function guildOnly(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({
    content: "Use this command in a server.",
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Sends an ephemeral error, handling already-replied interactions.
 * @param interaction - The command interaction.
 * @param content - The error message.
 * @returns A promise that resolves once the error is sent.
 */
async function replyError(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  const reply: InteractionReplyOptions = { content, flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) await interaction.followUp(reply);
  else await interaction.reply(reply);
}

/**
 * Replies with a leaderboard of users by total count, or by one word's count
 * when `word` is supplied (e.g. who gets called "bender" the most).
 * @param interaction - The command interaction (reads the `limit` integer option).
 * @param tracker - The tracker whose store to read.
 * @param opts - Leaderboard options.
 * @param opts.title - The embed title.
 * @param opts.word - When set, rank by this word's count instead of overall totals.
 * @returns A promise that resolves once the leaderboard is sent.
 */
export async function replyTopUsers(
  interaction: ChatInputCommandInteraction,
  tracker: Tracker,
  opts: { title: string; word?: string | null },
): Promise<void> {
  if (!interaction.inGuild()) {
    await guildOnly(interaction);
    return;
  }
  try {
    const limit = interaction.options.getInteger("limit") ?? 10;
    const word = opts.word?.trim().toLowerCase();
    const ranked = word
      ? getTopUsersForWord(interaction.guildId, tracker.storeFile, word, limit).map((r) => ({
          userId: r.userId,
          n: r.count,
        }))
      : getTopUsers(interaction.guildId, tracker.storeFile, limit).map((r) => ({
          userId: r.userId,
          n: r.total,
        }));

    const lines = await Promise.all(
      ranked.map(async (r, i) => {
        const user = await interaction.client.users.fetch(r.userId).catch(() => null);
        return `**${i + 1}.** ${user?.tag ?? r.userId} - **${r.n}**`;
      }),
    );

    const embed = new EmbedBuilder()
      .setTitle(word ? `${opts.title} (${word})` : opts.title)
      .setDescription(lines.join("\n") || "No data yet.");
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error("failed to build user leaderboard", {
      storeFile: tracker.storeFile,
      error: err instanceof Error ? err.message : String(err),
    });
    await replyError(interaction, "⚠️ Could not fetch the leaderboard. Try again later.");
  }
}

/**
 * Replies with a leaderboard of the most-counted words for a tracker.
 * @param interaction - The command interaction (reads the `limit` integer option).
 * @param tracker - The tracker whose store to read.
 * @param title - The embed title.
 * @returns A promise that resolves once the leaderboard is sent.
 */
export async function replyTopWords(
  interaction: ChatInputCommandInteraction,
  tracker: Tracker,
  title: string,
): Promise<void> {
  if (!interaction.inGuild()) {
    await guildOnly(interaction);
    return;
  }
  try {
    const limit = interaction.options.getInteger("limit") ?? 10;
    const rows = getTopWords(interaction.guildId, tracker.storeFile, limit);
    const lines = rows.map((r, i) => `**${i + 1}.** ${r.word} - **${r.count}**`);
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(lines.join("\n") || "No data yet.");
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error("failed to build word leaderboard", {
      storeFile: tracker.storeFile,
      error: err instanceof Error ? err.message : String(err),
    });
    await replyError(interaction, "⚠️ Could not fetch the words. Try again later.");
  }
}

/**
 * Replies with a category breakdown ("which group they offend most") for a
 * member, or guild-wide when no `user` option is given. Uses the categories
 * declared in the tracker's word list.
 * @param interaction - The command interaction.
 * @param tracker - The tracker whose list/store to read.
 * @returns A promise that resolves once the reply is sent.
 */
export async function replyCategoryBreakdown(
  interaction: ChatInputCommandInteraction,
  tracker: Tracker,
): Promise<void> {
  if (!interaction.inGuild()) {
    await guildOnly(interaction);
    return;
  }
  try {
    const { category } = loadList(interaction.guildId, tracker.listFile);
    const target = interaction.options.getUser("user");
    const counts = target
      ? getUserCounts(interaction.guildId, tracker.storeFile, target.id)
      : getTotals(interaction.guildId, tracker.storeFile);

    const rows = aggregateByCategory(counts, category);
    const lines = rows.map((r, i) => `**${i + 1}.** ${r.category} - **${r.count}**`);
    const title = target ? `Groups ${target.username} offends most` : "Most-targeted groups";

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(lines.join("\n") || "No data yet.");
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error("failed to build category breakdown", {
      storeFile: tracker.storeFile,
      error: err instanceof Error ? err.message : String(err),
    });
    await replyError(interaction, "⚠️ Could not fetch the breakdown. Try again later.");
  }
}

/**
 * Replies with a member's total for a tracker (defaults to the caller). Reads
 * the optional `user` option.
 * @param interaction - The command interaction.
 * @param tracker - The tracker whose store to read.
 * @param phrasing - Sentence parts for the reply.
 * @param phrasing.verbPast - Optional past-tense verb (e.g. "said", "been called").
 * @param phrasing.noun - Singular noun for the count (pluralised automatically).
 * @returns A promise that resolves once the reply is sent.
 */
export async function replyUserTotal(
  interaction: ChatInputCommandInteraction,
  tracker: Tracker,
  phrasing: { verbPast?: string; noun: string },
): Promise<void> {
  if (!interaction.inGuild()) {
    await guildOnly(interaction);
    return;
  }
  const target = interaction.options.getUser("user") ?? interaction.user;
  const total = getUserTotal(interaction.guildId, tracker.storeFile, target.id);
  const isSelf = target.id === interaction.user.id;
  const subject = isSelf ? "You" : `${target}`;
  const has = isSelf ? "have" : "has";
  const verb = phrasing.verbPast ? ` ${phrasing.verbPast}` : "";
  const noun = `${phrasing.noun}${total === 1 ? "" : "s"}`;
  await interaction.reply({
    content: `${subject} ${has}${verb} **${total}** ${noun}.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

/**
 * Resets a tracker for the whole guild, or for one member when the `user`
 * option is provided.
 * @param interaction - The command interaction.
 * @param tracker - The tracker whose store to reset.
 * @returns A promise that resolves once the reply is sent.
 */
export async function replyReset(
  interaction: ChatInputCommandInteraction,
  tracker: Tracker,
): Promise<void> {
  if (!interaction.inGuild()) {
    await guildOnly(interaction);
    return;
  }
  const guildId = interaction.guildId;
  const target = interaction.options.getUser("user");
  try {
    if (target) {
      resetUser(guildId, tracker.storeFile, target.id);
      log.info("reset user", { storeFile: tracker.storeFile, guildId, userId: target.id });
      await interaction.reply({
        content: `✅ ${tracker.noun} stats reset for ${target}.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    } else {
      resetGuild(guildId, tracker.storeFile);
      log.info("reset guild", { storeFile: tracker.storeFile, guildId });
      await interaction.reply({
        content: `✅ ${tracker.noun} stats reset for the whole server.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    log.error("reset failed", {
      storeFile: tracker.storeFile,
      error: err instanceof Error ? err.message : String(err),
    });
    await replyError(interaction, "⚠️ Failed to reset stats. Try again later.");
  }
}
