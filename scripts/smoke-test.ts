// scripts/smoke-test.ts

// No-Discord smoke test: exercises the logic that would otherwise need a live
// bot - command loading, link matching and rewriting, repost content, grace
// timing - then prints a results table. Runs in pre-push and CI, no token.
//
//   npx tsx scripts/smoke-test.ts [--verbose]   # --verbose echoes every check

import { data as calmDown } from "@/commands/calmdown";
import { data as deletePost } from "@/commands/deletepost";
import { data as editPost } from "@/commands/editpost";
import { buildHelpFields } from "@/commands/help";
import { data as myDelay, resolvePref } from "@/commands/mydelay";
import { mergePersonal, resolveGrace, data as setDelay } from "@/commands/setdelay";
import { data as setMediaChannel } from "@/commands/setmediachannel";
import { data as slursCommand } from "@/commands/slurs";
import { data as swearsCommand } from "@/commands/swears";
import { isApproved } from "@/media/approval";
import { stripTracking } from "@/media/cleanTracking";
import { buildCopyMessage } from "@/media/copyLink";
import { matchAny } from "@/media/match";
import { clampPref, clearPref, loadPref, savePref } from "@/media/prefs";
import {
  buildMovedContent,
  buildPointerContent,
  collectMentions,
  repostWithOptionalStub,
} from "@/media/repost";
import { findRepostForMessage, getRepost, removeRepost, saveRepost } from "@/media/repostStore";
import { resolvePlanFor } from "@/media/settings";
import { buildTransformedUrl, rewriteContent } from "@/media/transform";
import { MediaSettings } from "@/media/types";
import { copyHintFor } from "@/media/workflow";
import { trackerCommand } from "@/tracking/commands";
import { aggregateByCategory, countMatches, wordToPattern } from "@/tracking/detect";
import {
  addGif,
  GifResult,
  isValidGifUrl,
  listCategories,
  listGifs,
  MAX_PER_CATEGORY,
  RawResponsesFile,
  removeGif,
} from "@/tracking/gifs";
import {
  chooseReply,
  fillPlaceholders,
  poolFor,
  RESPONSE_COOLDOWN_MS,
  RESPONSE_SPAM_THRESHOLD,
} from "@/tracking/responses";
import { getTopWords, getUserTotal, incrementCounts } from "@/tracking/store";
import { phraseToEmojis, resolveReactions } from "@/tracking/track";
import { SLURS, SWEARS } from "@/tracking/trackers";
import { loadWords, parseJsonc } from "@/tracking/words";
import { ADMIN_COMMANDS, ADMIN_SUBCOMMANDS, needsAdmin } from "@/utils/permissions";
import { recordReply, takeReplies } from "@/utils/replyStore";
import { pruneByKeyAge, snowflakeTime } from "@/utils/retention";
import { ApplicationCommandOptionType, ApplicationCommandType } from "discord-api-types/v10";
import type { GuildTextBasedChannel, Message } from "discord.js";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

/* ------------------------------------------------------------------ types */

interface CheckResult {
  /** Section the check belongs to (e.g. "transforms"). */
  group: string;
  /** Human-readable description of the assertion. */
  name: string;
  /** Whether the assertion held. */
  status: "pass" | "fail";
}

/* --------------------------------------------------------------- constants */

/** Repository root, derived from this file's location. */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/* ---------------------------------------------------------------- helpers */

/**
 * Parses `--flag` CLI arguments.
 * @returns Parsed flags.
 */
function parseArgs(): { verbose: boolean } {
  return { verbose: process.argv.slice(2).includes("--verbose") };
}

const { verbose } = parseArgs();
const results: CheckResult[] = [];

/**
 * Records the outcome of a single assertion, echoing it live when --verbose is
 * set or when it fails.
 * @param group - Section the check belongs to.
 * @param name - Human-readable description of the check.
 * @param pass - Whether the assertion held.
 */
function check(group: string, name: string, pass: boolean): void {
  results.push({ group, name, status: pass ? "pass" : "fail" });
  if (verbose || !pass) {
    const icon = pass ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${icon} ${DIM}${group}${RESET} ${name}`);
  }
}

/* ----------------------------------------------------------------- checks */

/**
 * Verifies every module in src/commands exports a valid slash-command
 * definition (a builder with toJSON plus an execute function), matching what
 * the loader in src/index.ts requires.
 * @returns A promise that resolves once all command modules are checked.
 */
async function checkCommandsLoad(): Promise<void> {
  const dir = path.join(ROOT, "src", "commands");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  check("commands", "command files found", files.length > 0);
  for (const file of files) {
    const url = pathToFileURL(path.join(dir, file)).href;
    const mod = (await import(url)) as {
      data?: { toJSON?: unknown };
      execute?: unknown;
    };
    const ok = typeof mod.data?.toJSON === "function" && typeof mod.execute === "function";
    check("commands", `${file} exports data + execute`, ok);
  }
  checkTrackerCommands();
}

/**
 * Verifies both tracker commands come out of the shared builder with the same
 * core subcommands, an autocompleting `word` option on `top`, and whatever they
 * add of their own (`/slurs groups`).
 */
function checkTrackerCommands(): void {
  for (const tracker of [SWEARS, SLURS]) {
    const json = trackerCommand(tracker).toJSON();
    const subs = json.options ?? [];
    check(
      "commands",
      `/${tracker.name} builds the shared subcommands`,
      json.name === tracker.name &&
        ["count", "top", "words", "nuke"].every((n) => subs.some((s) => s.name === n)),
    );
    const top = subs.find((s) => s.name === "top");
    const word = top && "options" in top ? top.options?.find((o) => o.name === "word") : undefined;
    check(
      "commands",
      `/${tracker.name} top autocompletes its word option`,
      Boolean(word && "autocomplete" in word && word.autocomplete),
    );
  }
  const slurSubs = slursCommand.toJSON().options ?? [];
  check(
    "commands",
    "/slurs keeps its own groups subcommand",
    slurSubs.some((s) => s.name === "groups"),
  );
}

/**
 * Verifies link detection and transformation: supported links map to the
 * expected embeddable frontend, while already-transformed links and Reddit
 * direct-media links are left untouched (no match).
 */
function checkLinkTransforms(): void {
  // [input, expected transformed URL]
  const transforms: Array<[string, string]> = [
    ["https://x.com/u/status/1", "https://fixupx.com/u/status/1"],
    ["https://www.instagram.com/reel/AbC", "https://toinstagram.com/reel/AbC"],
    ["https://www.instagram.com/reels/AbC", "https://toinstagram.com/reels/AbC"],
    ["https://www.tiktok.com/@u/video/123", "https://d.tnktok.com/@u/video/123"],
    ["https://vm.tiktok.com/AbC123", "https://d.tnktok.com/AbC123"],
    ["https://vt.tiktok.com/ZSXow1G3u", "https://d.tnktok.com/ZSXow1G3u"],
    ["https://www.reddit.com/r/x/comments/abc/t", "https://vxreddit.com/r/x/comments/abc/t"],
    ["https://www.reddit.com/r/x/s/Ab12", "https://vxreddit.com/r/x/s/Ab12"],
    ["https://redd.it/abc1", "https://vxreddit.com/abc1"],
    [
      "https://bsky.app/profile/h.bsky.social/post/ID1",
      "https://fxbsky.app/profile/h.bsky.social/post/ID1",
    ],
    ["https://www.threads.net/@u/post/ID1", "https://viewthreads.com/@u/post/ID1"],
    ["https://www.tumblr.com/blog/123/slug", "https://tpmblr.com/blog/123/slug"],
    ["https://blog.tumblr.com/post/123", "https://blog.tpmblr.com/post/123"],
  ];
  for (const [input, expected] of transforms) {
    const m = matchAny(input);
    const got = m ? buildTransformedUrl(m) : "(no match)";
    check("transforms", `${input} -> ${expected}`, got === expected);
  }

  // Per-poster frontend override: one user's X links route to the cunnyx
  // mirror, every other poster keeps the default.
  const xLink = matchAny("https://x.com/u/status/1");
  check(
    "transforms",
    "overridden poster's x.com link -> cunnyx.com, others unchanged",
    xLink !== null &&
      buildTransformedUrl(xLink, "229791342547566592") === "https://cunnyx.com/u/status/1" &&
      buildTransformedUrl(xLink, "1") === "https://fixupx.com/u/status/1",
  );

  // Links already on a fixer frontend: matched as pre-embedded by path shape
  // (any domain, even mirrors we have never heard of) or by the short-form
  // domain list, and kept unchanged so they get moved without rewriting.
  const preEmbedded = [
    "https://toinstagram.com/reel/AbC",
    "https://fixupx.com/u/status/1",
    "https://fxtwitter.com/u/status/1",
    "https://cunnyx.com/u/status/1",
    "https://some-unknown-mirror.net/u/status/1",
    "https://ddinstagram.com/p/AbC",
    "https://vxreddit.com/r/x/comments/abc",
    "https://viewthreads.com/@u/post/ID1",
    "https://d.tnktok.com/@u/video/123",
    "https://d.tnktok.com/AbC123",
  ];
  for (const input of preEmbedded) {
    const m = matchAny(input);
    const ok = m?.which === "pre-embedded" && buildTransformedUrl(m) === input;
    check("transforms", `${input} -> pre-embedded, unchanged`, ok);
  }

  // Links that must NOT match (unfixable direct media, bare fixer homepages,
  // clean links with only functional params).
  const noMatch = [
    "https://v.redd.it/xyz",
    "https://i.redd.it/xyz.jpg",
    "https://fixupx.com/",
    "https://youtube.com/watch?v=abc&t=42",
  ];
  for (const input of noMatch) {
    check("transforms", `${input} -> no match`, matchAny(input) === null);
  }

  // Tracking-junk cleaning: non-media links with tracker params get offered
  // an in-place clean; functional params survive.
  check(
    "tracking",
    "strips utm_*/fbclid, keeps functional params",
    stripTracking("https://example.com/p?utm_source=x&utm_medium=y&fbclid=z&id=7") ===
      "https://example.com/p?id=7",
  );
  check(
    "tracking",
    "returns null when nothing to strip",
    stripTracking("https://example.com/p?id=7") === null,
  );
  // Short, widely-reused keys are left alone: a site can legitimately mean
  // something functional by them, and a wrong strip breaks the link.
  check(
    "tracking",
    "generic keys are not treated as trackers",
    stripTracking("https://example.com/p?si=1&ref_url=2&share_id=3&spm=4") === null,
  );
  const tracked = matchAny("look https://example.com/article?utm_source=news&fbclid=abc123&id=7");
  check(
    "tracking",
    "tracked link matches as 'tracking' with the cleaned URL",
    tracked?.which === "tracking" &&
      buildTransformedUrl(tracked) === "https://example.com/article?id=7",
  );
  const socialTail = matchAny("https://x.com/u/status/1?s=20&t=trackme");
  check(
    "tracking",
    "platform rewrite drops the ?s=20&t=... tail",
    socialTail !== null &&
      rewriteContent("https://x.com/u/status/1?s=20&t=trackme", socialTail).rewrittenText ===
        "https://fixupx.com/u/status/1",
  );

  // "$&" and friends are substitution patterns to String.replace, and a URL
  // path may hold them, so the rewritten link has to go in through a function
  // rather than as a replacement string.
  const dollarTracked = "https://example.com/a$&b?utm_source=x";
  const dollarMatch = matchAny(dollarTracked);
  check(
    "tracking",
    "a $ in a cleaned link is inserted literally",
    dollarMatch !== null &&
      rewriteContent(dollarTracked, dollarMatch).rewrittenText === "https://example.com/a$&b",
  );
  const dollarPost = "https://www.tumblr.com/blog/123/my$&slug";
  const dollarPlatform = matchAny(dollarPost);
  check(
    "tracking",
    "a $ in a platform link survives the rewrite",
    dollarPlatform !== null &&
      rewriteContent(dollarPost, dollarPlatform).rewrittenText ===
        "https://tpmblr.com/blog/123/my$&slug",
  );
}

/**
 * Verifies the repost content builders: the moved message carries the
 * transformed link (so it embeds), and the source pointer links to the moved
 * message for quick access, naming anyone the original tagged.
 */
function checkRepostContent(): void {
  const rewritten = "look https://vxinstagram.com/reel/x";
  const moved = buildMovedContent("<@1>", rewritten);
  check(
    "repost",
    "moved message carries the rewritten text verbatim",
    moved === `from <@1>\n\n${rewritten}`,
  );
  const movedUrl = "https://discord.com/channels/1/2/3";
  const pointer = buildPointerContent("<@1>", [], movedUrl);
  check(
    "repost",
    "source pointer links to the moved message",
    pointer === `<@1> SENT SLOP ${movedUrl}`,
  );
  check(
    "repost",
    "source pointer names anyone the original tagged",
    buildPointerContent("<@1>", ["<@2>"], movedUrl) === `<@1> SENT SLOP TO <@2> ${movedUrl}`,
  );
  check(
    "repost",
    "several tagged users all make the pointer",
    buildPointerContent("<@1>", ["<@2>", "<@3>"], movedUrl) ===
      `<@1> SENT SLOP TO <@2> <@3> ${movedUrl}`,
  );

  check(
    "repost",
    "mentions are collected in order, deduped, without the poster",
    collectMentions("hey <@3> and <@!2> and <@3> and me <@1>", "1").join(" ") === "<@3> <@2>",
  );
  check(
    "repost",
    "role and channel tokens are not treated as mentions",
    collectMentions("<@&99> over in <#88> look <@2>", "1").join(" ") === "<@2>",
  );

  // The copy hand-off fences the URL so Discord renders no embed and mobile
  // shows a copy button.
  const clean = "https://example.com/x?v=1";
  check(
    "repost",
    "copy hand-off fences the link under its lead line",
    buildCopyMessage(clean, "Here you go:") === `Here you go:\n\`\`\`\n${clean}\n\`\`\``,
  );
}

/**
 * Builds the fakes {@link repostWithOptionalStub} touches, with a scripted send.
 * @param send - Stands in for the target channel's send, resolving with a moved
 * message or rejecting the way Discord would.
 * @returns The fake original and channels, plus a reader for whether the
 * original ended up deleted.
 */
function fakeMove(send: () => Promise<unknown>): {
  original: Message<true>;
  source: GuildTextBasedChannel;
  target: GuildTextBasedChannel;
  deleted: () => boolean;
} {
  let deleted = false;
  const original = {
    id: "orig1",
    author: { id: "1" },
    content: "look https://x.com/a/status/1",
    attachments: new Map(),
    delete: async () => {
      deleted = true;
      return original;
    },
  };
  const source = { id: "c1", send: async () => ({ id: "stub1" }) };
  const target = { id: "c2", send };
  return {
    original: original as unknown as Message<true>,
    source: source as unknown as GuildTextBasedChannel,
    target: target as unknown as GuildTextBasedChannel,
    deleted: () => deleted,
  };
}

/**
 * Verifies the move's ordering. The poster's message is deleted for them, so a
 * send that fails - the "from <@id>" prefix pushing a near-limit message past
 * 2000 characters, a missing permission in the target - must leave it where it
 * is rather than destroy it with nothing put back.
 */
async function checkRepostOrdering(): Promise<void> {
  const failing = fakeMove(() => Promise.reject(new Error("Invalid Form Body: content too long")));
  const refused = await repostWithOptionalStub(
    failing.original,
    "look https://fixupx.com/a/status/1",
    failing.source,
    failing.target,
    true,
  );
  check("repost", "a failed post moves nothing", refused.moved === undefined);
  check("repost", "a failed post leaves the original in place", !failing.deleted());

  const working = fakeMove(() =>
    Promise.resolve({ id: "moved1", url: "https://discord.com/channels/1/2/3" }),
  );
  const done = await repostWithOptionalStub(
    working.original,
    "look https://fixupx.com/a/status/1",
    working.source,
    working.target,
    true,
  );
  check("repost", "a successful post returns the moved message", done.moved?.id === "moved1");
  check("repost", "a successful post deletes the original", working.deleted());
  check("repost", "a successful cross-channel post leaves a pointer", done.stub?.id === "stub1");
}

/**
 * Builds the snowflake Discord would have minted at the given time.
 * @param epochMs - When the message was posted, in epoch ms.
 * @returns The message ID a post at that moment would carry.
 */
function snowflakeAt(epochMs: number): string {
  return String(BigInt(epochMs - 1_420_070_400_000) << 22n);
}

/**
 * Verifies the message-keyed stores prune themselves. An entry is only ever
 * released when its own message is deleted, which for most never happens, so
 * without an age rule both files grow for the life of the guild.
 */
function checkRetention(): void {
  const now = Date.now();
  const day = 24 * 60 * 60_000;

  const minted = now - 5 * day;
  check(
    "retention",
    "a snowflake reports the time it was minted",
    snowflakeTime(snowflakeAt(minted)) === minted,
  );
  check("retention", "a non-snowflake has no readable age", snowflakeTime("m1") === null);

  const fresh = snowflakeAt(now - day);
  const stale = snowflakeAt(now - 100 * day);
  const pruned = pruneByKeyAge({ [fresh]: 1, [stale]: 2, m1: 3 }, 90 * day, now);
  check(
    "retention",
    "pruning drops what is past the window and keeps the rest",
    pruned.dropped === 1 && pruned.kept[fresh] === 1 && pruned.kept[stale] === undefined,
  );
  check(
    "retention",
    "an entry with no readable age is kept",
    pruned.kept.m1 === 3 && Object.keys(pruned.kept).length === 2,
  );

  const guild = "__smoketest__";
  const record = {
    authorId: "u1",
    originalMessageId: "o1",
    sourceChannelId: "c1",
    repostChannelId: "c2",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const old = snowflakeAt(now - 200 * day);
  const recent = snowflakeAt(now);
  try {
    saveRepost(guild, old, record);
    saveRepost(guild, recent, record);
    check(
      "retention",
      "saving a repost drops the expired records",
      getRepost(guild, old) === undefined && getRepost(guild, recent) !== undefined,
    );
  } finally {
    rmSync(path.join(ROOT, "data", guild), { recursive: true, force: true });
  }

  try {
    recordReply(guild, old, { channelId: "c1", messageId: "r1" });
    recordReply(guild, recent, { channelId: "c1", messageId: "r2" });
    check(
      "retention",
      "recording a reply drops the expired links",
      takeReplies(guild, old).length === 0 && takeReplies(guild, recent).length === 1,
    );
  } finally {
    rmSync(path.join(ROOT, "data", guild), { recursive: true, force: true });
  }
}

/**
 * Verifies the repost store round-trips records on disk: what author-delete
 * looks up after a restart is exactly what the repost saved.
 */
function checkRepostStore(): void {
  const guild = "__smoketest__";
  const record = {
    authorId: "u1",
    originalMessageId: "o1",
    sourceChannelId: "c1",
    repostChannelId: "c2",
    stubMessageId: "s1",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  try {
    saveRepost(guild, "m1", record);
    const loaded = getRepost(guild, "m1");
    check(
      "repost",
      "store round-trips a record",
      loaded?.authorId === "u1" && loaded.stubMessageId === "s1",
    );
    removeRepost(guild, "m1");
    check("repost", "store removes a record", getRepost(guild, "m1") === undefined);
  } finally {
    rmSync(path.join(ROOT, "data", guild), { recursive: true, force: true });
  }

  try {
    recordReply(guild, "t1", { channelId: "c1", messageId: "r1" });
    recordReply(guild, "t1", { channelId: "c1", messageId: "r2" });
    const taken = takeReplies(guild, "t1");
    check(
      "repost",
      "reply store links and releases bot replies",
      taken.length === 2 && taken[1].messageId === "r2" && takeReplies(guild, "t1").length === 0,
    );
  } finally {
    rmSync(path.join(ROOT, "data", guild), { recursive: true, force: true });
  }

  // Right-clicking either the moved post or the pointer stub has to reach the
  // same record - the stub match is a scan, so it is worth pinning down.
  try {
    saveRepost(guild, "m1", record);
    const viaPost = findRepostForMessage(guild, "m1");
    check(
      "repost",
      "lookup resolves the moved post",
      viaPost?.movedMessageId === "m1" && viaPost.record.authorId === "u1",
    );
    const viaStub = findRepostForMessage(guild, "s1");
    check(
      "repost",
      "lookup resolves the pointer stub to its post",
      viaStub?.movedMessageId === "m1" && viaStub.record.stubMessageId === "s1",
    );
    check(
      "repost",
      "lookup ignores an unrelated message",
      findRepostForMessage(guild, "nope") === undefined,
    );
  } finally {
    rmSync(path.join(ROOT, "data", guild), { recursive: true, force: true });
  }

  // The two right-click entries must register as message commands; a wrong
  // type silently never appears in the Apps menu.
  for (const [label, json] of [
    ["Edit post", editPost.toJSON()],
    ["Delete post", deletePost.toJSON()],
  ] as const) {
    check(
      "repost",
      `"${label}" registers as a message context command`,
      json.name === label && json.type === ApplicationCommandType.Message,
    );
  }
}

/** Throwaway guild for list/store checks; cleaned up in checkTrackers. */
const SMOKE_GUILD = "__smoketest__";

/**
 * Writes a known words.json for {@link SMOKE_GUILD} so list-driven checks are
 * self-contained (the real global words.json is gitignored and absent in CI).
 * Idempotent; the directory is removed at the end of checkTrackers.
 */
function writeSmokeWords(): void {
  const cfg = {
    types: {
      swear: { track: "swears" },
      slur: { track: "slurs", fuzzy: true },
      girls: { reaction: "💅", pool: "slang", fuzzy: true },
      british: { reaction: "🇬🇧", pool: "slang", fuzzy: true },
      llama: { reaction: "🦙", fuzzy: true, triggerEmoji: "🦙" },
    },
    words: {
      // Simple entries: plain strings.
      swear: ["fuck", "shitshow", "bender", "wanker"],
      // Advanced entries (benign stand-in for a slur with a spell-out
      // reaction), mixed with a simple one in the same list.
      slur: [{ word: "duck", category: "waterfowl", reaction: "nword" }, "goose"],
      girls: ["slay", "the girls are", "the girls arent"],
      // bender appears under two types on purpose (swear + british react).
      british: ["bender", "cheeky", "cant be arsed"],
      llama: ["llama"],
    },
  };
  // Written WITH comments and a trailing comma to exercise the tolerant
  // words.json parser (hand-edited files have both).
  const raw =
    "// smoke-test words config\n" +
    JSON.stringify(cfg, null, 2)
      .replace('"words": {', '"words": { // per-type lists')
      .replace('["llama"]', '["llama",]');
  mkdirSync(path.join(ROOT, "data", SMOKE_GUILD), { recursive: true });
  writeFileSync(path.join(ROOT, "data", SMOKE_GUILD, "words.json"), raw, "utf-8");
}

/**
 * Verifies the unified word config: types drive tracking and reactions, word
 * matching is fuzzy where configured, and the normaliser defeats the common
 * evasions (markdown, zero-width chars, Discord tokens, URLs).
 */
function checkReactions(): void {
  writeSmokeWords();
  const words = loadWords(SMOKE_GUILD);
  const hits = (text: string): boolean => countMatches(text, words.reactionList).size > 0;

  check("reactions", "reaction words compile", words.reactionList.patterns.length > 0);
  check(
    "reactions",
    "config with comments and trailing commas parses",
    parseJsonc<{ a: number[] }>('{ /* block */ "a": [1, 2,], } // line').a.length === 2 &&
      parseJsonc<{ a: string }>('{ "a": "not // a comment" }').a === "not // a comment",
  );
  check("reactions", "girls word matches stretched 'slaaay'", hits("slaaay queen"));
  check("reactions", "llama word matches 'what a llama'", hits("what a llama"));
  check(
    "reactions",
    "girls phrase matches 'the girls are fighting'",
    hits("the girls are fighting"),
  );
  check("reactions", "british word matches 'a cheeky cuppa'", hits("a cheeky cuppa"));
  check(
    "reactions",
    "apostrophes fold: \"can't be arsed\" matches 'cant be arsed'",
    hits("can't be arsed") && hits("can’t be arsed"),
  );
  check(
    "reactions",
    'girls phrase matches "the girls aren\'t fighting"',
    hits("the girls aren't fighting"),
  );
  check("reactions", "plain text matches nothing", !hits("nothing to see here"));
  check("reactions", "zero-width evasion folds: 'sl\\u200bay' still matches", hits("sl​ay"));
  check(
    "reactions",
    "custom emoji names don't trigger: <:slay:123456789>",
    !hits("<:slay:123456789>"),
  );
  check(
    "reactions",
    "mention IDs can't phantom-match: <@919191919191919191>",
    !hits("hello <@919191919191919191>"),
  );
  check(
    "reactions",
    "URL words don't trigger: https://slay.example.com",
    !hits("look at https://slay.example.com/queen"),
  );
  check("reactions", "bold-broken word folds: sl**ay**", hits("sl**ay**"));
  check("reactions", "spoilered word folds: ||slay||", hits("||slay||"));
  check(
    "reactions",
    "trailing '!' stays punctuation: 'Slay!!' still matches",
    hits("Slay!!") && hits("slay! queen"),
  );
  check(
    "reactions",
    "word-internal '!' still de-leets: 'the g!rls are'",
    hits("the g!rls are fighting"),
  );

  // Reaction specs: type defaults, pools, and word-level overrides.
  const slaySpecs = words.reactionSpecs.get("slay") ?? [];
  check(
    "reactions",
    "type default applies: slay > 💅 in the slang pool",
    slaySpecs.length === 1 && slaySpecs[0].value === "💅" && slaySpecs[0].pool === "slang",
  );
  const duckSpecs = words.reactionSpecs.get("duck") ?? [];
  check(
    "reactions",
    "word-level reaction overrides the type default",
    duckSpecs.length === 1 && duckSpecs[0].value === "nword" && duckSpecs[0].pool === undefined,
  );
  check(
    "reactions",
    "emoji trigger registered for 🦙",
    words.emojiTriggers.some((t) => t.emoji === "🦙" && t.spec.value === "🦙"),
  );

  // Pool resolution: pooled specs collapse to one pick, poolless all fire.
  const resolved = resolveReactions([
    { value: "💅", pool: "slang" },
    { value: "🇬🇧", pool: "slang" },
    { value: "🦙" },
    { value: "nword" },
  ]);
  check(
    "reactions",
    "pooled reactions collapse to one pick",
    resolved.length === 3 &&
      resolved.includes("🦙") &&
      resolved.includes("nword") &&
      resolved.includes("💅") !== resolved.includes("🇬🇧"),
  );

  // Spell-out reactions: letters in order; repeated characters are skipped.
  check(
    "reactions",
    "spell-out word becomes letter emojis",
    (phraseToEmojis("nword") ?? []).join(" ") === "🇳 🇼 🇴 🇷 🇩",
  );
  check("reactions", "repeated letters skip the spell-out", phraseToEmojis("cool") === null);
  check("reactions", "digits become keycaps", (phraseToEmojis("5b") ?? []).join(" ") === "5️⃣ 🇧");
  check(
    "reactions",
    "spaces are dropped from a phrase",
    (phraseToEmojis("5b to israel") ?? []).join("") === "5️⃣🇧🇹🇴🇮🇸🇷🇦🇪🇱",
  );
  check("reactions", "repeated digits skip the spell-out", phraseToEmojis("1488") === null);
  check(
    "reactions",
    "over the reaction cap skips the spell-out",
    phraseToEmojis("abcdefghijklmnopqrstuvwxyz") === null,
  );
}

/**
 * Verifies the /setdelay conversion: a seconds value is stored as milliseconds
 * (the unit the approval pipeline expects), and the special modes pass through.
 */
function checkGrace(): void {
  check("grace", "30 seconds -> 30000 ms", resolveGrace("seconds", 30) === 30_000);
  check("grace", "instant passes through", resolveGrace("instant") === "instant");
  check("grace", "disabled passes through", resolveGrace("disabled") === "disabled");
}

/**
 * Verifies swear detection through the unified config: swear-typed words
 * compile into the swears track and hit in a sample sentence. Insults feed the
 * same counter, so they are checked here too.
 */
function checkSwears(): void {
  writeSmokeWords();
  const list = loadWords(SMOKE_GUILD).tracks.swears;
  check("swears", "swear track compiles from words.json", list.phrases.length > 0);
  const counts = countMatches("oh fuck this, what a shitshow", list);
  check("swears", "detects swears in a sentence", counts.size === 2);
  const insults = countMatches("you absolute bender and wanker", list);
  check(
    "swears",
    "insults count as swears",
    insults.get("bender") === 1 && insults.get("wanker") === 1,
  );
}

/**
 * Verifies the shared detection primitives and the slur tracker: phrases,
 * boundaries, fuzzy patterns, category roll-up, and a generic store round-trip
 * (under a throwaway guild that is cleaned up afterwards).
 */
function checkTrackers(): void {
  writeSmokeWords();
  const words = loadWords(SMOKE_GUILD);
  // Multi-word phrases and word boundaries (benign words; the slur list relies
  // on both for entries like "porch monkey" without matching inside words).
  check(
    "trackers",
    "detects multi-word phrases",
    countMatches("he is a couch potato today", {
      phrases: ["couch potato"],
      patterns: [],
      category: new Map(),
    }).get("couch potato") === 1,
  );
  check(
    "trackers",
    "respects word boundaries",
    countMatches("class", { phrases: ["lass"], patterns: [], category: new Map() }).size === 0,
  );
  // Regex patterns: obfuscation-resistant but boundary-safe (benign "duck").
  const duck = {
    phrases: [],
    patterns: [{ word: "duck", re: /(?<![\p{L}\p{N}])(?:d+u+ck)(?![\p{L}\p{N}])/giu }],
    category: new Map<string, string>(),
  };
  check(
    "trackers",
    "regex pattern matches obfuscation",
    countMatches("you ddduuuck mate", duck).get("duck") === 1,
  );
  check("trackers", "regex pattern respects boundaries", countMatches("abduck", duck).size === 0);

  // Category roll-up: which group is offended most (benign words).
  const groups = aggregateByCategory(
    { apple: 3, pear: 2, oak: 1 },
    new Map([
      ["apple", "fruit"],
      ["pear", "fruit"],
      ["oak", "tree"],
    ]),
  );
  check(
    "trackers",
    "aggregates counts by category",
    groups[0]?.category === "fruit" && groups[0]?.count === 5,
  );

  // Auto-generated fuzzy matching (catches stretched/obfuscated spellings):
  // the slur track compiles fuzzy per its type definition.
  check("trackers", "fuzzy generator uses run-length", wordToPattern("boot") === "b+o{2,}t+s*");
  check(
    "trackers",
    "fuzzy track matches a stretched word",
    countMatches("you absolute dddduuuck", words.tracks.slurs).get("duck") === 1,
  );
  check(
    "trackers",
    "fuzzy track still needs the whole word",
    countMatches("just abduck it", words.tracks.slurs).get("duck") === undefined,
  );
  check(
    "trackers",
    "slur track carries the category",
    words.tracks.slurs.category.get("duck") === "waterfowl",
  );
  check(
    "trackers",
    "simple string entries work alongside advanced ones",
    countMatches("a goose walked in", words.tracks.slurs).get("goose") === 1,
  );

  const guild = "__smoketest__";
  try {
    incrementCounts(guild, SWEARS.storeFile, "u1", new Map([["bender", 2]]));
    check(
      "trackers",
      "store records a user total",
      getUserTotal(guild, SWEARS.storeFile, "u1") === 2,
    );
    check(
      "trackers",
      "store records a word total",
      getTopWords(guild, SWEARS.storeFile)[0]?.word === "bender",
    );
  } finally {
    rmSync(path.join(ROOT, "data", guild), { recursive: true, force: true });
  }
}

/**
 * Verifies the reply chooser: silent within the cooldown, a pool entry after
 * it, and the spam entry once the threshold is hit.
 */
function checkSlurResponses(): void {
  const pool = ["A", "B"];
  check(
    "responder",
    "stays silent within cooldown",
    chooseReply(1, RESPONSE_COOLDOWN_MS - 1, pool, "ENOUGH", 0) === null,
  );
  check(
    "responder",
    "picks a pool entry after cooldown",
    chooseReply(1, RESPONSE_COOLDOWN_MS, pool, "ENOUGH", 1) === "B",
  );
  check(
    "responder",
    "escalates to the spam entry",
    chooseReply(RESPONSE_SPAM_THRESHOLD, RESPONSE_COOLDOWN_MS, pool, "ENOUGH", 0) === "ENOUGH",
  );
  check(
    "responder",
    "fills {user}/{count} placeholders",
    fillPlaceholders("{user} said a slur #{count}", "<@1>", 7) === "<@1> said a slur #7",
  );
  // Tagged replies: generic always applies; a tagged reply only joins matching categories.
  const config = {
    responses: ["G", { content: "B", categories: ["black", "LGBT"] }],
    spam: "",
  };
  check(
    "responder",
    "pools generic + matching category",
    poolFor(config, ["black"]).join(",") === "G,B",
  );
  check(
    "responder",
    "shares one entry across categories",
    poolFor(config, ["LGBT"]).join(",") === "G,B",
  );
  check(
    "responder",
    "excludes non-matching category",
    poolFor(config, ["jewish"]).join(",") === "G",
  );
}

/**
 * Verifies the /gif rules: categories come from the word config, URLs are
 * validated, and add/remove enforce ownership and the per-category cap while
 * preserving the parts of responses.json the command does not own.
 */
function checkGifs(): void {
  writeSmokeWords();
  try {
    // Derived from the slur words rather than hardcoded: the smoke config
    // declares exactly one category. The real ten live in the gitignored
    // global words.json, which CI does not have.
    check(
      "gifs",
      "categories come from the word config, generic first",
      listCategories(SMOKE_GUILD).join(",") === "generic,waterfowl",
    );
  } finally {
    rmSync(path.join(ROOT, "data", SMOKE_GUILD), { recursive: true, force: true });
  }

  check("gifs", "accepts an https link", isValidGifUrl("https://tenor.com/view/x-gif-1"));
  check("gifs", "rejects a non-url", !isValidGifUrl("notaurl"));
  check("gifs", "rejects a non-http scheme", !isValidGifUrl("ftp://example.com/x.gif"));

  const cats = ["generic", "waterfowl"];
  // A hand-written entry and a sibling key, so the checks below prove neither
  // is disturbed by an edit.
  const base: RawResponsesFile = {
    _comment: "keep me",
    types: { slur: { responses: ["hand-written"], spam: "ENOUGH" } },
  };
  const add = (
    raw: RawResponsesFile,
    url: string,
    id: string,
    category = "waterfowl",
    by = "u1",
  ): GifResult =>
    addGif({
      raw,
      category,
      validCategories: cats,
      url,
      addedBy: by,
      id,
      addedAt: "2026-01-01T00:00:00.000Z",
    });

  const added = add(base, "https://a.example/1.gif", "id1");
  check(
    "gifs",
    "add appends a tagged entry",
    added.ok && listGifs(added.config, "waterfowl").length === 1,
  );
  check(
    "gifs",
    "add preserves keys it does not own",
    added.ok && added.config._comment === "keep me" && added.config.types?.slur?.spam === "ENOUGH",
  );
  check(
    "gifs",
    "add leaves the hand-written entry alone",
    added.ok && listGifs(added.config).some((e) => e.content === "hand-written" && !e.id),
  );
  check(
    "gifs",
    "add rejects an unknown category",
    !add(base, "https://a.example/1.gif", "x", "nope").ok,
  );
  check("gifs", "add rejects a bad url", !add(base, "notaurl", "id2").ok);
  check(
    "gifs",
    "add rejects a duplicate in the same category",
    added.ok && !add(added.config, "https://a.example/1.gif", "id3").ok,
  );

  // Fill the category to the cap, then confirm the next one is turned away.
  let full: RawResponsesFile = base;
  for (let i = 0; i < MAX_PER_CATEGORY; i++) {
    const r = add(full, `https://a.example/${i}.gif`, `f${i}`);
    if (!r.ok) break;
    full = r.config;
  }
  check(
    "gifs",
    "add refuses once the category is full",
    listGifs(full, "waterfowl").length === MAX_PER_CATEGORY &&
      !add(full, "https://a.example/extra.gif", "over").ok,
  );

  const owned = added.ok ? added.config : base;
  check("gifs", "remove refuses someone else's entry", !removeGif(owned, "id1", "u2", false).ok);
  check("gifs", "admin removes someone else's entry", removeGif(owned, "id1", "u2", true).ok);
  check("gifs", "remove refuses an unknown id", !removeGif(owned, "nosuch", "u1", true).ok);

  const removed = removeGif(owned, "id1", "u1", false);
  check(
    "gifs",
    "owner removes their own entry",
    removed.ok && listGifs(removed.config, "waterfowl").length === 0,
  );
  // The curated entries have no id, so nothing the command does can reach them.
  check(
    "gifs",
    "remove leaves the hand-written entry in place",
    removed.ok && listGifs(removed.config).some((e) => e.content === "hand-written"),
  );
}

/**
 * Verifies per-member move preferences: how a stored choice resolves into an
 * approval plan, how admin bounds clamp it on read, how silence is read under
 * each mode, and that the store round-trips. Cross-channel moves only - the
 * same-channel rewrite must ignore preferences entirely.
 */
function checkMemberPrefs(): void {
  const guild = "__smoketest__";
  const guildDefault: MediaSettings = { grace: 10_000 };

  check(
    "prefs",
    "no stored preference leaves the guild default",
    resolvePlanFor(guildDefault, undefined, false)?.timeoutMs === 10_000,
  );
  check(
    "prefs",
    "instant moves without prompting",
    resolvePlanFor({ grace: "disabled" }, { mode: "instant" }, false)?.autoApprove === true,
  );

  const countdown = resolvePlanFor(guildDefault, { mode: "countdown", seconds: 30 }, false);
  check(
    "prefs",
    "countdown counts silence as approval",
    countdown?.autoApprove === false &&
      countdown.approveOnTimeout === true &&
      countdown.timeoutMs === 30_000,
  );

  const ask = resolvePlanFor(guildDefault, { mode: "ask", seconds: 15 }, false);
  check(
    "prefs",
    "ask needs a click and never approves on timeout",
    ask?.autoApprove === false && ask.approveOnTimeout === false && ask.timeoutMs === 15_000,
  );

  check(
    "prefs",
    "never skips the move entirely",
    resolvePlanFor(guildDefault, { mode: "never" }, false) === null,
  );

  // Bounds are applied on read, so tightening them reaches preferences that
  // were already saved under the looser limit.
  check(
    "prefs",
    "seconds clamp to the admin maximum on read",
    resolvePlanFor(
      { grace: 10_000, personal: { enabled: true, maxSeconds: 60, allowNever: true } },
      { mode: "countdown", seconds: 300 },
      false,
    )?.timeoutMs === 60_000,
  );
  check(
    "prefs",
    "never falls back to the guild default when it is not allowed",
    resolvePlanFor(
      { grace: 10_000, personal: { enabled: true, maxSeconds: 300, allowNever: false } },
      { mode: "never" },
      false,
    )?.timeoutMs === 10_000,
  );
  check(
    "prefs",
    "personal preferences switched off ignores a stored preference",
    resolvePlanFor(
      { grace: 10_000, personal: { enabled: false, maxSeconds: 300, allowNever: true } },
      { mode: "instant" },
      false,
    )?.autoApprove === false,
  );
  check(
    "prefs",
    "same-channel rewrites ignore member preferences",
    resolvePlanFor(guildDefault, { mode: "instant" }, true)?.timeoutMs === 15_000,
  );

  // What /mydelay show reports: the preference after clamping, not the one
  // that was typed.
  check(
    "prefs",
    "clamping reports what is actually active",
    clampPref({ mode: "ask", seconds: 300 }, { enabled: true, maxSeconds: 20, allowNever: true })
      ?.seconds === 20 &&
      clampPref({ mode: "never" }, { enabled: true, maxSeconds: 20, allowNever: false }) ===
        undefined,
  );

  // A prompt that never reached the channel must not read as silent consent,
  // or a failed send would move the link on its own.
  const cd = resolvePlanFor(guildDefault, { mode: "countdown", seconds: 30 }, false)!;
  check(
    "prefs",
    "countdown treats an unsent prompt as leave it",
    isApproved(cd, { choice: null, prompted: false }) === false,
  );
  check(
    "prefs",
    "countdown moves when nobody cancels",
    isApproved(cd, { choice: null, prompted: true }) === true,
  );
  check(
    "prefs",
    "countdown stops on cancel",
    isApproved(cd, { choice: "no", prompted: true }) === false,
  );
  const asked = resolvePlanFor(guildDefault, { mode: "ask", seconds: 15 }, false)!;
  check(
    "prefs",
    "ask approves only on yes",
    isApproved(asked, { choice: null, prompted: true }) === false &&
      isApproved(asked, { choice: "yes", prompted: true }) === true,
  );

  try {
    savePref(guild, "u1", { mode: "countdown", seconds: 45 });
    const loaded = loadPref(guild, "u1");
    check(
      "prefs",
      "store round-trips a member preference",
      loaded?.mode === "countdown" && loaded.seconds === 45,
    );
    clearPref(guild, "u1");
    check("prefs", "store clears a member preference", loadPref(guild, "u1") === undefined);
  } finally {
    rmSync(path.join(ROOT, "data", guild), { recursive: true, force: true });
  }

  check(
    "prefs",
    "the copy hand-off carries a hint under the fenced link",
    buildCopyMessage("https://example.com/x", "Here you go:", "-# hint").endsWith("```\n-# hint"),
  );

  check(
    "prefs",
    "a countdown choice keeps its seconds, instant carries none",
    resolvePref("countdown", 45).seconds === 45 && resolvePref("instant").seconds === undefined,
  );

  // Every /setdelay personal option is optional, so an admin can tighten one
  // bound without restating the others.
  check(
    "prefs",
    "personal bounds change only what was supplied",
    JSON.stringify(
      mergePersonal(
        { enabled: true, maxSeconds: 300, allowNever: true },
        { enabled: null, maxSeconds: 60, allowNever: null },
      ),
    ) === JSON.stringify({ enabled: true, maxSeconds: 60, allowNever: true }),
  );

  // The hint promises control that /mydelay only has over cross-channel moves.
  check(
    "prefs",
    "the /mydelay hint rides on cross-channel moves only",
    copyHintFor(false, false)?.includes("/mydelay") === true &&
      copyHintFor(true, false) === undefined &&
      copyHintFor(false, true) === undefined,
  );

  const mine = myDelay.toJSON();
  const subs = (mine.options ?? [])
    .filter((o) => o.type === ApplicationCommandOptionType.Subcommand)
    .map((o) => o.name);
  check(
    "prefs",
    "/mydelay registers its subcommands",
    mine.name === "mydelay" &&
      ["instant", "countdown", "ask", "never", "show", "clear"].every((n) => subs.includes(n)),
  );
  check(
    "prefs",
    "/setdelay gains a personal subcommand",
    (setDelay.toJSON().options ?? []).some(
      (o) => o.type === ApplicationCommandOptionType.Subcommand && o.name === "personal",
    ),
  );
}

/**
 * Verifies who sees what. Discord applies a command's default permissions
 * before dispatching it, which would shut the bot owner out of the very
 * commands the owner grant exists for, so no builder carries them and every
 * admin command is authorised at runtime instead. /help then has to do the
 * hiding, or it advertises commands a member can only be refused.
 */
function checkCommandVisibility(): void {
  const builders = [setDelay, setMediaChannel, calmDown, myDelay, swearsCommand, slursCommand];
  // Registering any default permission would silently reinstate the gate the
  // owner grant cannot beat, so this is the invariant the rest rests on.
  check(
    "perms",
    "no command registers a default member permission",
    builders.every((b) => {
      const perms = b.toJSON().default_member_permissions;
      return perms === null || perms === undefined;
    }),
  );

  // A renamed command that keeps its requireAdmin call but drops out of
  // ADMIN_COMMANDS is open to everyone, and nothing else would say so.
  const names = new Set(builders.map((b) => b.toJSON().name));
  check(
    "perms",
    "every ADMIN_COMMANDS entry names a real command",
    ADMIN_COMMANDS.every((name) => names.has(name)),
  );
  check(
    "perms",
    "every ADMIN_SUBCOMMANDS key names a real command",
    Object.keys(ADMIN_SUBCOMMANDS).every((name) => names.has(name)),
  );

  // The gate the dispatcher calls, on the cases it has to tell apart.
  check("perms", "the gate catches a wholly admin command", needsAdmin("setdelay", "instant"));
  check("perms", "the gate catches an admin subcommand", needsAdmin("swears", "nuke"));
  check("perms", "the gate lets an open subcommand through", !needsAdmin("swears", "top"));
  check("perms", "the gate lets an open command with no subcommand through", !needsAdmin("help"));

  const asMember = buildHelpFields([setDelay.toJSON(), myDelay.toJSON()], false);
  const asAdmin = buildHelpFields([setDelay.toJSON(), myDelay.toJSON()], true);
  check(
    "perms",
    "/help hides admin commands from a member",
    !asMember.some((f) => f.name === "/setdelay") && asMember.some((f) => f.name === "/mydelay"),
  );
  check(
    "perms",
    "/help lists admin commands to an admin, marked",
    asAdmin.some((f) => f.name === "/setdelay 🔒") && asAdmin.some((f) => f.name === "/mydelay"),
  );

  // A command open to everyone bar one subcommand is filtered line by line.
  const swearsAsMember = buildHelpFields([swearsCommand.toJSON()], false)[0].value.split(/\r?\n/);
  check(
    "perms",
    "/help drops the admin subcommand of a shared command for a member",
    !swearsAsMember.some((line) => line.includes("nuke")) &&
      swearsAsMember.some((line) => line.includes("top")),
  );
  const swearsAsAdmin = buildHelpFields([swearsCommand.toJSON()], true)[0].value.split(/\r?\n/);
  check(
    "perms",
    "/help marks the admin subcommand of a shared command for an admin",
    swearsAsAdmin.some((line) => line.includes("nuke") && line.includes("🔒")) &&
      swearsAsAdmin.some((line) => line.includes("top") && !line.includes("🔒")),
  );
}

/* --------------------------------------------------------------- reporting */

/**
 * Prints a results table grouped by check, with a coloured status icon.
 */
function printTable(): void {
  const col = Math.max(...results.map((r) => r.group.length), 5) + 2;
  const header = `  Status  ${"Group".padEnd(col)}Check`;
  console.log(`\n${header}`);
  console.log("  " + "─".repeat(header.length));
  for (const r of results) {
    const icon = r.status === "pass" ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`    ${icon}     ${r.group.padEnd(col)}${r.name}`);
  }
  console.log("  " + "─".repeat(header.length));
}

/* ------------------------------------------------------------------ main */

void (async () => {
  let exitCode = 0;

  try {
    await checkCommandsLoad();
    checkCommandVisibility();
    checkLinkTransforms();
    checkRepostContent();
    await checkRepostOrdering();
    checkRepostStore();
    checkRetention();
    checkReactions();
    checkGrace();
    checkMemberPrefs();
    checkSwears();
    checkTrackers();
    checkSlurResponses();
    checkGifs();

    printTable();

    const failed = results.filter((r) => r.status === "fail");
    if (failed.length === 0) {
      console.log(`\n  ${GREEN}✓ all ${results.length} checks passed${RESET}\n`);
    } else {
      console.log(`\n  ${RED}✗ ${failed.length} of ${results.length} checks failed${RESET}\n`);
      exitCode = 1;
    }
  } catch (err) {
    console.error("\nFatal error:", err);
    exitCode = 1;
  }

  process.exit(exitCode);
})();
