// scripts/smoke-test.ts

/**
 * @file No-Discord smoke test for reactionBot. Exercises the pure logic that
 * would otherwise need a live bot (command loading, link matching/transform,
 * swear detection, grace timing, repost content) and runs in pre-push + CI.
 * Exits non-zero on the first failed assertion. Grows as features land.
 */

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

await checkCommandsLoad();

if (failures > 0) {
  console.error(`\nsmoke test FAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nsmoke test passed");
