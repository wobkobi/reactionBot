// scripts/smoke-test.ts

// No-Discord smoke test: exercises the logic that would otherwise need a live
// bot - command loading, link matching and rewriting, repost content, grace
// timing - then prints a results table. Runs in pre-push and CI, no token.
//
//   npx tsx scripts/smoke-test.ts [--verbose]   # --verbose echoes every check

import { data as deletePost } from "@/commands/deletepost";
import { data as editPost } from "@/commands/editpost";
import { resolveGrace } from "@/commands/setdelay";
import { data as slursCommand } from "@/commands/slurs";
import { stripTracking } from "@/media/cleanTracking";
import { buildCopyMessage } from "@/media/copyLink";
import { matchAny } from "@/media/match";
import { buildMovedContent, buildPointerContent, collectMentions } from "@/media/repost";
import { findRepostForMessage, getRepost, removeRepost, saveRepost } from "@/media/repostStore";
import { buildTransformedUrl, rewriteContent } from "@/media/transform";
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
import { recordReply, takeReplies } from "@/utils/replyStore";
import { ApplicationCommandType } from "discord-api-types/v10";
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
    checkLinkTransforms();
    checkRepostContent();
    checkRepostStore();
    checkReactions();
    checkGrace();
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
