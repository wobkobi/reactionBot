// What this process is, for the boot log. A deploy that quietly kept running
// the previous image looks identical to one that worked, so the answer has to
// be in the logs rather than something to go and check.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Levels to climb looking for package.json before giving up. */
const MAX_CLIMB = 4;

/**
 * Finds the version in the nearest package.json at or above a directory.
 *
 * Climbs rather than taking a fixed relative path because this module sits at
 * a different depth once compiled - `src/utils/` in development, `build/utils/`
 * in the image - and a path correct for one is wrong for the other.
 * @param startDir - Directory to start climbing from.
 * @param exists - Whether a path is a readable file; injectable for tests.
 * @param read - Reads a file as UTF-8; injectable for tests.
 * @returns The version, or undefined when no package.json has one.
 */
export function findVersion(
  startDir: string,
  exists: (p: string) => boolean = fs.existsSync,
  read: (p: string) => string = (p) => fs.readFileSync(p, "utf-8"),
): string | undefined {
  let dir = startDir;
  for (let i = 0; i <= MAX_CLIMB; i++) {
    const candidate = path.join(dir, "package.json");
    if (exists(candidate)) {
      try {
        const parsed = JSON.parse(read(candidate)) as { version?: unknown };
        if (typeof parsed.version === "string" && parsed.version) return parsed.version;
      } catch {
        // A package.json that will not parse is not worth failing a boot over;
        // keep climbing in case an outer one is readable.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Shortens a commit hash the way git and GitHub display one, so it can be read
 * against a tag or a commit list by eye.
 * @param sha - The full hash, or whatever the build baked in.
 * @returns The short form, or undefined when there is nothing usable.
 */
export function shortCommit(sha: string | undefined): string | undefined {
  const trimmed = sha?.trim();
  if (!trimmed || !/^[0-9a-f]{7,40}$/i.test(trimmed)) return undefined;
  return trimmed.slice(0, 7);
}

let cached: string | undefined;

/**
 * The running version, read once from the package.json shipped beside the code.
 * @returns The version, or `"unknown"` when it cannot be read.
 */
export function botVersion(): string {
  cached ??= findVersion(path.dirname(fileURLToPath(import.meta.url))) ?? "unknown";
  return cached;
}

/**
 * The commit this build was cut from, baked in by the image build.
 * @returns The short hash, or `"unknown"` outside a built image.
 */
export function botCommit(): string {
  return shortCommit(process.env.GIT_SHA) ?? "unknown";
}
