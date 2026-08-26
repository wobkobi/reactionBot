// src/tracking/commands.ts

/**
 * @file Shared slash-command plumbing for the tracker commands (swears, slurs).
 * {@link trackerCommand} builds the subcommands they have in common and the
 * reply helpers render them; both take their wording from the {@link Tracker},
 * so a command file only wires the two together and adds whatever is unique to
 * it (e.g. `/slurs groups`).
 */

import { aggregateByCategory } from "@/tracking/detect";
import {
  getTopUsers,
  getTopUsersForWord,
  getTopWords,
  getTotals,
  getUserCounts,
  getUserTotal,
  resetGuild,
  resetUser,
} from "@/tracking/store";
import { Tracker } from "@/tracking/trackers";
import { loadWords } from "@/tracking/words";
import { createLogger } from "@/utils/log";
import { respond } from "@/utils/respond";
import { SlashCommandBuilder, SlashCommandSubcommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";

const log = createLogger("tracking/commands");

/** Default rows in a leaderboard when the `limit` option is left out. */
const DEFAULT_LIMIT = 10;

/**
 * Adds the leaderboard `limit` option shared by the `top` and `words`
 * subcommands.
 * @param sub - The subcommand being built.
 */
function addLimitOption(sub: SlashCommandSubcommandBuilder): void {
  sub.addIntegerOption((opt) =>
    opt.setName("limit").setDescription("How many to show (1-25)").setMinValue(1).setMaxValue(25),
  );
}

/**
 * Builds the slash command a tracker exposes: `count`, `top`, `words` and
 * `nuke`, all worded from the tracker. Returned as a plain
 * {@link SlashCommandBuilder} (subcommands are added in place rather than
 * chained) so a caller can still append its own subcommands.
 * @param tracker - The tracker whose command to build.
 * @returns The command builder, ready to export or extend.
 */
export function trackerCommand(tracker: Tracker): SlashCommandBuilder {
  const { name, noun } = tracker;
  const cmd = new SlashCommandBuilder();
  cmd.setName(name);
  cmd.setDescription(tracker.description);

  cmd.addSubcommand((sub) => {
    sub.setName("count").setDescription(`Show how many ${name} a member has ${tracker.verbPast}`);
    sub.addUserOption((opt) =>
      opt.setName("user").setDescription("Member to look up (defaults to you)"),
    );
    return sub;
  });

  cmd.addSubcommand((sub) => {
    sub.setName("top").setDescription(`Show top members by ${name} ${tracker.verbPast}`);
    sub.addStringOption((opt) =>
      opt
        .setName("word")
        .setDescription("Rank by who says this specific word")
        .setAutocomplete(true),
    );
    addLimitOption(sub);
    return sub;
  });

  cmd.addSubcommand((sub) => {
    sub.setName("words").setDescription(`Show the most-used ${name} in this server`);
    addLimitOption(sub);
    return sub;
  });

  cmd.addSubcommand((sub) => {
    sub
      .setName("nuke")
      .setDescription(`Reset ${noun} stats for this server (or one member) - admin only`);
    sub.addUserOption((opt) =>
      opt.setName("user").setDescription("Reset only this member (defaults to the whole server)"),
    );
    return sub;
  });

  cmd.setContexts(InteractionContextType.Guild);
  return cmd;
}

/**
 * Replies that the command must be used in a server. Every tracker command is
 * guild-only, so this cannot fire in practice - the `inGuild()` calls that
 * reach it are kept because they narrow `guildId` to a string for the store
 * calls below. Several callers sit outside their own try, so it answers
 * through {@link respond} rather than throwing past them.
 * @param interaction - The command interaction.
 * @returns A promise that resolves once the reply is sent or dropped.
 */
async function guildOnly(interaction: ChatInputCommandInteraction): Promise<void> {
  await respond(interaction, {
    content: "Use this command in a server.",
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Sends an ephemeral error, following up when the command has already
 * answered, and never throwing - see {@link respond}.
 * @param interaction - The command interaction.
 * @param content - The error message.
 * @returns A promise that resolves once the error is sent or dropped.
 */
async function replyError(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  await respond(interaction, { content, flags: MessageFlags.Ephemeral });
}

/**
 * Every word recorded for a tracker in this guild, most-used first. Backs both
 * {@link autocompleteWord} and the free-text check in {@link replyTopUsers}, so
 * the two always agree on what counts as a known word.
 * @param guildId - Discord guild (server) ID.
 * @param tracker - The tracker whose store to read.
 * @returns The recorded words, most-used first.
 */
function recordedWords(guildId: string, tracker: Tracker): string[] {
  return getTopWords(guildId, tracker.storeFile, Infinity).map((r) => r.word);
}

/**
 * Autocompletes the `word` option of a tracker's `top` subcommand from the
 * words actually recorded in this server, so typos and never-said words are
 * avoided up front.
 * @param interaction - The autocomplete interaction context.
 * @param tracker - The tracker whose store to suggest from.
 * @returns A promise that resolves when the suggestions are sent.
 */
export async function autocompleteWord(
  interaction: AutocompleteInteraction,
  tracker: Tracker,
): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.respond([]);
    return;
  }
  const typed = interaction.options.getFocused().trim().toLowerCase();
  const words = recordedWords(interaction.guildId, tracker)
    .filter((w) => w.includes(typed))
    .slice(0, 25);
  await interaction.respond(words.map((w) => ({ name: w, value: w })));
}

/**
 * Replies with a leaderboard of users by total count, or by one word's count
 * when the `word` option is given (e.g. who says "wanker" the most).
 * @param interaction - The command interaction (reads the `word` and `limit` options).
 * @param tracker - The tracker whose store to read.
 * @returns A promise that resolves once the leaderboard is sent.
 */
export async function replyTopUsers(
  interaction: ChatInputCommandInteraction,
  tracker: Tracker,
): Promise<void> {
  if (!interaction.inGuild()) {
    await guildOnly(interaction);
    return;
  }
  const guildId = interaction.guildId;
  try {
    const word = interaction.options.getString("word")?.trim().toLowerCase() || null;

    // Free-text safety net for anyone who bypasses the autocomplete: an unknown
    // word would only render an empty leaderboard, so say why instead.
    if (word && !recordedWords(guildId, tracker).includes(word)) {
      await respond(interaction, {
        content: `No one has ${tracker.verbPast} "${word}" here yet.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
    // Word-specific rankings already name the word in the title; overall
    // rankings carry each user's favourite (most-used) word instead.
    const ranked = word
      ? getTopUsersForWord(guildId, tracker.storeFile, word, limit).map((r) => ({
          userId: r.userId,
          n: r.count,
          favourite: null as string | null,
        }))
      : getTopUsers(guildId, tracker.storeFile, limit).map((r) => ({
          userId: r.userId,
          n: r.total,
          favourite: r.favourite,
        }));

    // Mentions rather than tags: Discord resolves <@id> client-side, so the
    // name always renders current with no per-user fetch. Members who left
    // still show as an unresolved mention rather than a bare ID.
    const lines = ranked.map((r, i) => {
      const favourite = r.favourite ? ` (favourite: ${r.favourite})` : "";
      return `**${i + 1}.** <@${r.userId}> - **${r.n}**${favourite}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(word ? `${tracker.topTitle} (${word})` : tracker.topTitle)
      .setDescription(lines.join("\n") || "No data yet.");
    // Public on purpose: leaderboards are for the whole channel to see.
    // Empty allowedMentions so the ranked members render without being pinged.
    await respond(interaction, { embeds: [embed], allowedMentions: { parse: [] } });
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
 * @returns A promise that resolves once the leaderboard is sent.
 */
export async function replyTopWords(
  interaction: ChatInputCommandInteraction,
  tracker: Tracker,
): Promise<void> {
  if (!interaction.inGuild()) {
    await guildOnly(interaction);
    return;
  }
  try {
    const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
    const rows = getTopWords(interaction.guildId, tracker.storeFile, limit);
    const lines = rows.map((r, i) => `**${i + 1}.** ${r.word} - **${r.count}**`);
    const embed = new EmbedBuilder()
      .setTitle(tracker.wordsTitle)
      .setDescription(lines.join("\n") || "No data yet.");
    // Public on purpose: leaderboards are for the whole channel to see.
    await respond(interaction, { embeds: [embed] });
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
    const { category } = loadWords(interaction.guildId).tracks[tracker.track];
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
    // Public on purpose: breakdowns are for the whole channel to see.
    await respond(interaction, { embeds: [embed] });
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
 * @returns A promise that resolves once the reply is sent.
 */
export async function replyUserTotal(
  interaction: ChatInputCommandInteraction,
  tracker: Tracker,
): Promise<void> {
  if (!interaction.inGuild()) {
    await guildOnly(interaction);
    return;
  }
  try {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const total = getUserTotal(interaction.guildId, tracker.storeFile, target.id);
    const isSelf = target.id === interaction.user.id;
    const subject = isSelf ? "You" : `${target}`;
    const has = isSelf ? "have" : "has";
    const noun = `${tracker.noun}${total === 1 ? "" : "s"}`;
    await respond(interaction, {
      content: `${subject} ${has} ${tracker.verbPast} **${total}** ${noun}.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    log.error("failed to fetch user total", {
      storeFile: tracker.storeFile,
      error: err instanceof Error ? err.message : String(err),
    });
    await replyError(interaction, "⚠️ Could not fetch the count. Try again later.");
  }
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
      await respond(interaction, {
        content: `✅ ${tracker.noun} stats reset for ${target}.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    } else {
      resetGuild(guildId, tracker.storeFile);
      log.info("reset guild", { storeFile: tracker.storeFile, guildId });
      await respond(interaction, {
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
