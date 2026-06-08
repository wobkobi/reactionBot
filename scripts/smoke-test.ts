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
import { readdirSync } from "fs";
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
  const moved = buildMovedContent("<@1>", "look https://vxinstagram.com/reel/x");
  check(
    "repost",
    "moved message contains the embeddable link",
    moved.includes("https://vxinstagram.com/reel/x"),
  );
  const pointer = buildPointerContent("<@1>", "https://discord.com/channels/1/2/3");
  check(
    "repost",
    "source pointer links to the moved message",
    pointer.includes("https://discord.com/channels/1/2/3"),
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
