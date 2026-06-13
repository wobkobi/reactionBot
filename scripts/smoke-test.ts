// scripts/smoke-test.ts

/**
 * @file smoke-test.ts
 * @description No-Discord smoke test for reactionBot. Exercises the pure logic
 * that would otherwise need a live bot - command loading, link matching and
 * transformation, repost content, and grace timing - then prints a results
 * table. Runs in pre-push and CI and needs no bot token. Grows as features land.
 *
 * Usage:
 *   npx tsx scripts/smoke-test.ts            # run all checks
 *   npx tsx scripts/smoke-test.ts --verbose  # also echo every check as it runs
 *
 * Exit codes:
 *   0  all checks passed
 *   1  one or more checks failed
 */

import { resolveGrace } from "@/commands/setgrace.js";
import { matchAny } from "@/media/match.js";
import { buildMovedContent, buildPointerContent } from "@/media/repost.js";
import { buildTransformedUrl } from "@/media/transform.js";
import { aggregateByCategory, countMatches, loadList, wordToPattern } from "@/tracking/detect.js";
import {
  chooseSlurGif,
  fillPlaceholders,
  poolFor,
  SLUR_COOLDOWN_MS,
  SLUR_SPAM_THRESHOLD,
} from "@/tracking/slurResponse.js";
import { getTopWords, getUserTotal, incrementCounts } from "@/tracking/store.js";
import { CALLED, SLURS, SWEARS } from "@/tracking/trackers.js";
import { readdirSync, rmSync } from "fs";
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
    ["https://www.instagram.com/reel/AbC", "https://vxinstagram.com/reel/AbC"],
    ["https://www.instagram.com/reels/AbC", "https://vxinstagram.com/reels/AbC"],
    ["https://www.tiktok.com/@u/video/123", "https://d.tnktok.com/@u/video/123"],
    ["https://vm.tiktok.com/AbC123", "https://d.vm.tnktok.com/AbC123"],
    ["https://www.reddit.com/r/x/comments/abc/t", "https://rxddit.com/r/x/comments/abc/t"],
    ["https://www.reddit.com/r/x/s/Ab12", "https://rxddit.com/r/x/s/Ab12"],
    ["https://redd.it/abc1", "https://rxddit.com/abc1"],
    [
      "https://bsky.app/profile/h.bsky.social/post/ID1",
      "https://fxbsky.app/profile/h.bsky.social/post/ID1",
    ],
    ["https://www.threads.net/@u/post/ID1", "https://vxthreads.net/@u/post/ID1"],
    ["https://www.tumblr.com/blog/123/slug", "https://tpmblr.com/blog/123/slug"],
    ["https://blog.tumblr.com/post/123", "https://blog.tpmblr.com/post/123"],
  ];
  for (const [input, expected] of transforms) {
    const m = matchAny(input);
    const got = m ? buildTransformedUrl(m) : "(no match)";
    check("transforms", `${input} -> ${expected}`, got === expected);
  }

  // Links that must NOT match (already embeddable, or unfixable direct media).
  const noMatch = [
    "https://vxinstagram.com/reel/AbC",
    "https://fixupx.com/u/status/1",
    "https://rxddit.com/r/x/comments/abc",
    "https://d.tnktok.com/@u/video/123",
    "https://v.redd.it/xyz",
    "https://i.redd.it/xyz.jpg",
  ];
  for (const input of noMatch) {
    check("transforms", `${input} -> no match`, matchAny(input) === null);
  }
}

/**
 * Verifies the repost content builders: the moved message carries the
 * transformed link (so it embeds), and the source pointer links to the moved
 * message for quick access.
 */
function checkRepostContent(): void {
  const rewritten = "look https://vxinstagram.com/reel/x";
  const moved = buildMovedContent("<@1>", rewritten);
  check(
    "repost",
    "moved message carries the rewritten text verbatim",
    moved === `<@1> SENT SLOP\n\n${rewritten}`,
  );
  const movedUrl = "https://discord.com/channels/1/2/3";
  const pointer = buildPointerContent("<@1>", movedUrl);
  check(
    "repost",
    "source pointer links to the moved message",
    pointer === `<@1> SENT SLOP ${movedUrl}`,
  );
}

/**
 * Verifies the /setgrace conversion: a seconds value is stored as milliseconds
 * (the unit the approval pipeline expects), and the special modes pass through.
 */
function checkGrace(): void {
  check("grace", "30 seconds -> 30000 ms", resolveGrace("seconds", 30) === 30_000);
  check("grace", "instant passes through", resolveGrace("instant") === "instant");
  check("grace", "disabled passes through", resolveGrace("disabled") === "disabled");
}

/**
 * Verifies swear detection against the seeded global word list: the list is
 * non-empty and a sample sentence containing a seeded word is detected.
 */
function checkSwears(): void {
  const list = loadList("global", SWEARS.listFile);
  check("swears", "global swear list is non-empty", list.phrases.length > 0);
  const counts = countMatches("oh fuck this, what a shitshow", list);
  check("swears", "detects seeded swears in a sentence", counts.size >= 1);
}

/**
 * Verifies the slur and called-names trackers: the insults list detects words,
 * the slurs list parses, and the generic store round-trips totals (under a
 * throwaway guild that is cleaned up afterwards).
 */
function checkTrackers(): void {
  const insults = loadList("global", CALLED.listFile);
  check("trackers", "insults list is non-empty", insults.phrases.length > 0);
  loadList("global", SLURS.listFile); // parses without throwing (may be empty)

  const counts = countMatches("you absolute bender and wanker", insults);
  check(
    "trackers",
    "detects insults in a sentence",
    counts.get("bender") === 1 && counts.get("wanker") === 1,
  );
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

  // Auto-generated fuzzy matching (catches stretched/obfuscated spellings).
  check("trackers", "fuzzy generator uses run-length", wordToPattern("boot") === "b+o{2,}t+s*");
  const fuzzyInsults = loadList("global", CALLED.listFile, true);
  check(
    "trackers",
    "fuzzy matches a stretched word",
    countMatches("you absolute beeeender", fuzzyInsults).get("bender") === 1,
  );
  check(
    "trackers",
    "fuzzy still needs the whole word",
    countMatches("just bend it", fuzzyInsults).get("bender") === undefined,
  );

  const guild = "__smoketest__";
  try {
    incrementCounts(guild, CALLED.storeFile, "u1", new Map([["bender", 2]]));
    check(
      "trackers",
      "store records a user total",
      getUserTotal(guild, CALLED.storeFile, "u1") === 2,
    );
    check(
      "trackers",
      "store records a word total",
      getTopWords(guild, CALLED.storeFile)[0]?.word === "bender",
    );
  } finally {
    rmSync(path.join(ROOT, "data", guild), { recursive: true, force: true });
  }
}

/**
 * Verifies the slur reply chooser: silent within the cooldown, a pool entry
 * after it, and the spam entry once the threshold is hit.
 */
function checkSlurResponses(): void {
  const pool = ["A", "B"];
  check(
    "responder",
    "stays silent within cooldown",
    chooseSlurGif(1, SLUR_COOLDOWN_MS - 1, pool, "ENOUGH", 0) === null,
  );
  check(
    "responder",
    "picks a pool entry after cooldown",
    chooseSlurGif(1, SLUR_COOLDOWN_MS, pool, "ENOUGH", 1) === "B",
  );
  check(
    "responder",
    "escalates to the spam entry",
    chooseSlurGif(SLUR_SPAM_THRESHOLD, SLUR_COOLDOWN_MS, pool, "ENOUGH", 0) === "ENOUGH",
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
    checkGrace();
    checkSwears();
    checkTrackers();
    checkSlurResponses();

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
