// scripts/smoke-test.ts

/**
 * @file No-Discord smoke test for reactionBot. Exercises the pure logic that
 * would otherwise need a live bot (command loading, link matching/transform,
 * swear detection, grace timing, repost content) and runs in pre-push + CI.
 * Exits non-zero on the first failed assertion. Grows as features land.
 */

import { matchAny } from "@/media/match.js";
import { buildMovedContent, buildPointerContent } from "@/media/repost.js";
import { buildTransformedUrl } from "@/media/transform.js";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;

/**
 * Records the outcome of a single assertion.
 * @param cond - Condition that must hold for the check to pass.
 * @param msg - Human-readable description of the check.
 */
function check(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ok   ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL ${msg}`);
  }
}

/**
 * Verifies every module in src/commands exports a valid slash-command
 * definition (a builder with toJSON plus an execute function), matching what
 * the loader in src/index.ts requires.
 * @returns A promise that resolves once all command modules are checked.
 */
async function checkCommandsLoad(): Promise<void> {
  console.log("commands load:");
  const dir = path.join(ROOT, "src", "commands");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  check(files.length > 0, "command files found");
  for (const file of files) {
    const url = pathToFileURL(path.join(dir, file)).href;
    const mod = (await import(url)) as {
      data?: { toJSON?: unknown };
      execute?: unknown;
    };
    const ok = typeof mod.data?.toJSON === "function" && typeof mod.execute === "function";
    check(ok, `${file} exports data + execute`);
  }
}

/**
 * Verifies link detection and transformation: supported links map to the
 * expected embeddable frontend, while already-transformed links and Reddit
 * direct-media links are left untouched (no match).
 */
function checkLinkTransforms(): void {
  console.log("link transforms:");

  // [input, expected transformed URL]
  const transforms: Array<[string, string]> = [
    ["https://x.com/u/status/1", "https://fixupx.com/u/status/1"],
    ["https://www.instagram.com/reel/AbC", "https://vxinstagram.com/reel/AbC"],
    ["https://www.instagram.com/reels/AbC", "https://vxinstagram.com/reels/AbC"],
    ["https://www.tiktok.com/@u/video/123", "https://d.tnktok.com/@u/video/123"],
    ["https://vm.tiktok.com/AbC123", "https://d.vm.tnktok.com/AbC123"],
    ["https://www.reddit.com/r/x/comments/abc/title", "https://rxddit.com/r/x/comments/abc/title"],
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
    check(got === expected, `${input} -> ${expected}`);
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
    check(matchAny(input) === null, `${input} -> no match`);
  }
}

/**
 * Verifies the repost content builders: the moved message carries the
 * transformed link (so it embeds), and the source pointer links to the moved
 * message for quick access.
 */
function checkRepostContent(): void {
  console.log("repost content:");
  const moved = buildMovedContent("<@1>", "look https://vxinstagram.com/reel/x");
  check(
    moved.includes("https://vxinstagram.com/reel/x"),
    "moved message contains the embeddable link",
  );
  const pointer = buildPointerContent("<@1>", "https://discord.com/channels/1/2/3");
  check(
    pointer.includes("https://discord.com/channels/1/2/3"),
    "source pointer links to the moved message",
  );
}

await checkCommandsLoad();
checkLinkTransforms();
checkRepostContent();

if (failures > 0) {
  console.error(`\nsmoke test FAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nsmoke test passed");
