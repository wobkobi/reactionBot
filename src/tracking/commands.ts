// src/tracking/commands.ts

// Shared slash-command plumbing for the tracker commands (swears, slurs).
// trackerCommand builds the subcommands they have in common and the reply
// helpers render them; both take their wording from the Tracker, so a command
// file only wires the two together and adds whatever is unique to it (e.g.
// `/slurs groups`).
//
// The `top` and `words` leaderboards are global: they add up every server the
// bot is in. `count`, `nuke` and the category breakdown stay per server.

import { aggregateByCategory, listedIn } from "@/tracking/detect";
import {
  getTotals,
  getUserCounts,
  getUserTotal,
  rankUsers,
  rankUsersForWord,
  rankWords,
  readStores,
  resetGuild,
  resetUser,
  type CountStore,
  type WordFilter,
} from "@/tracking/store";
import { Tracker } from "@/tracking/trackers";
import { loadWords } from "@/tracking/words";
import { createLogger } from "@/utils/log";
import { respond } from "@/utils/respond";
import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  escapeMarkdown,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
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
    sub
      .setName("top")
      .setDescription(`Show who has ${tracker.verbPast} the most ${name} across every server`);
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
    sub.setName("words").setDescription(`Show the most-used ${name} across every server`);
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
 * The stored words a tracker still counts: the ones its current word list
 * matches. Every read below passes this, so a word taken out of words.json
 * drops off the boards and totals at once, without touching the counts on disk.
 * @param guildId - Discord guild (server) ID.
 * @param tracker - The tracker whose list to check against.
 * @returns The filter, from {@link listedIn}.
 */
function listedWords(guildId: string, tracker: Tracker): WordFilter {
  return listedIn(loadWords(guildId).tracks[tracker.track]);
}

/**
 * A tracker's counts from every server the bot is in, merged. Each server's
 * counts are filtered by its own word list before they are added together.
 * Servers the bot has left are not read, though their files stay on disk.
 * @param client - The logged-in client, for the list of servers.
 * @param tracker - The tracker whose stores to read.
 * @returns The merged store.
 */
function globalStore(client: Client, tracker: Tracker): CountStore {
  return readStores(client.guilds.cache.keys(), tracker.storeFile, (guildId) =>
    listedWords(guildId, tracker),
  );
}

/**
 * Every word recorded for a tracker in any server and still on that server's
 * list, most-used first. Backs both {@link autocompleteWord} and the free-text
 * check in {@link replyTopUsers}, so the two always agree on what counts as a
 * known word.
 * @param store - The merged store from {@link globalStore}.
 * @returns The recorded words, most-used first.
 */
function recordedWords(store: CountStore): string[] {
  return rankWords(store, Infinity).map((r) => r.word);
}

/**
 * How each ranked user is shown. A member this server has seen is a mention,
 * which Discord renders with their current name. Anyone else would render as
 * an unknown mention, so they are looked up and shown by name instead.
 * @param interaction - The command interaction, for the server and client.
 * @param userIds - The users on the board.
 * @returns Each user's label, keyed by user ID.
 */
async function boardNames(
  interaction: ChatInputCommandInteraction<"cached" | "raw">,
  userIds: string[],
): Promise<Map<string, string>> {
  const labels = await Promise.all(
    userIds.map(async (id): Promise<[string, string]> => {
      if (interaction.guild?.members.cache.has(id)) return [id, `<@${id}>`];
      const user = await interaction.client.users.fetch(id).catch(() => null);
      return [id, user ? `**${escapeMarkdown(user.displayName)}**` : `<@${id}>`];
    }),
  );
  return new Map(labels);
}

/**
 * Footer for a global board, so nobody reads it as this server alone.
 * @param client - The logged-in client.
 * @returns The footer text.
 */
function globalFooter(client: Client): { text: string } {
  const servers = client.guilds.cache.size;
  return { text: `Across ${servers} server${servers === 1 ? "" : "s"}` };
}

/**
 * Autocompletes the `word` option of a tracker's `top` subcommand from the
 * words recorded in any server, so typos and never-said words are avoided up
 * front.
 * @param interaction - The autocomplete interaction context.
 * @param tracker - The tracker whose store to suggest from.
 * @returns A promise that resolves when the suggestions are sent.
 */
export async function autocompleteWord(
  interaction: AutocompleteInteraction,
  tracker: Tracker,
): Promise<void> {
  const typed = interaction.options.getFocused().trim().toLowerCase();
  const words = recordedWords(globalStore(interaction.client, tracker))
    .filter((w) => w.includes(typed))
    .slice(0, 25);
  await interaction.respond(words.map((w) => ({ name: w, value: w })));
}

/**
 * Replies with a global leaderboard of users by total count, or by one word's
 * count when the `word` option is given (e.g. who says "wanker" the most).
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
  try {
    const word = interaction.options.getString("word")?.trim().toLowerCase() || null;
    const store = globalStore(interaction.client, tracker);

    // Free-text safety net for anyone who bypasses the autocomplete: an unknown
    // word would only render an empty leaderboard, so say why instead.
    if (word && !recordedWords(store).includes(word)) {
      await respond(interaction, {
        content: `No one has ${tracker.verbPast} "${word}" anywhere yet.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;
    // Word-specific rankings already name the word in the title; overall
    // rankings carry each user's favourite (most-used) word instead.
    const ranked = word
      ? rankUsersForWord(store, word, limit).map((r) => ({
          userId: r.userId,
          n: r.count,
          favourite: null as string | null,
        }))
      : rankUsers(store, limit).map((r) => ({
          userId: r.userId,
          n: r.total,
          favourite: r.favourite,
        }));

    // Looking up people from other servers can outlast Discord's 3s window.
    await interaction.deferReply();
    const names = await boardNames(
      interaction,
      ranked.map((r) => r.userId),
    );
    const lines = ranked.map((r, i) => {
      const favourite = r.favourite ? ` (favourite: ${r.favourite})` : "";
      return `**${i + 1}.** ${names.get(r.userId)} - **${r.n}**${favourite}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(word ? `${tracker.topTitle} (${word})` : tracker.topTitle)
      .setDescription(lines.join("\n") || "No data yet.")
      .setFooter(globalFooter(interaction.client));
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
 * Replies with a global leaderboard of the most-counted words for a tracker.
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
    const rows = rankWords(globalStore(interaction.client, tracker), limit);
    const lines = rows.map((r, i) => `**${i + 1}.** ${r.word} - **${r.count}**`);
    const embed = new EmbedBuilder()
      .setTitle(tracker.wordsTitle)
      .setDescription(lines.join("\n") || "No data yet.")
      .setFooter(globalFooter(interaction.client));
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
    const list = loadWords(interaction.guildId).tracks[tracker.track];
    const listed = listedIn(list);
    const target = interaction.options.getUser("user");
    const counts = target
      ? getUserCounts(interaction.guildId, tracker.storeFile, target.id, listed)
      : getTotals(interaction.guildId, tracker.storeFile, listed);

    const rows = aggregateByCategory(counts, list.category);
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
    const total = getUserTotal(
      interaction.guildId,
      tracker.storeFile,
      target.id,
      listedWords(interaction.guildId, tracker),
    );
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
      log.info(
        "reset user",
        { guildId, tracker: tracker.noun, user: target.username, by: interaction.user.username },
        { userId: target.id, storeFile: tracker.storeFile },
      );
      await respond(interaction, {
        content: `✅ ${tracker.noun} stats reset for ${target}.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    } else {
      resetGuild(guildId, tracker.storeFile);
      log.info(
        "reset guild",
        { guildId, tracker: tracker.noun, by: interaction.user.username },
        { storeFile: tracker.storeFile },
      );
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
