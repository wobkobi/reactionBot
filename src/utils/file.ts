// src/utils/file.ts
import { createLogger } from "@/utils/log";
import fs from "fs";
import path from "path";

const log = createLogger("utils/file");
/** Absolute folder where per-guild JSON data is stored. */
const DATA_ROOT = path.join(process.cwd(), "data");

/**
 * Options for {@link loadData}.
 */
export interface LoadOptions<T = unknown> {
  /**
   * If `true`, return a default value when the file does not exist
   * (or cannot be parsed) instead of throwing.
   * @default false
   */
  soft?: boolean;
  /**
   * Value to return when `soft` is enabled and the file is missing or invalid.
   * If omitted, `{}` will be returned (typed as `T`).
   */
  defaultValue?: T;
}

/**
 * Ensures that a directory exists, creating it recursively if needed.
 * @param dir - Absolute directory path.
 * @returns The same `dir` path for convenience.
 */
function ensureDir(dir: string): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log.debug("created directory", { dir });
  }
  return dir;
}

/**
 * Checks that the data root exists and can actually be written to, by writing
 * a file rather than reading permission bits: a bind-mounted volume can be
 * owned by the right user and still refuse writes when an ACL overrides the
 * mode, which is the usual reason a container starts cleanly and then saves
 * nothing.
 * @returns The path, whether it is writable, and the reason when it is not.
 */
export function checkDataRoot(): { path: string; writable: boolean; error?: string } {
  try {
    ensureDir(DATA_ROOT);
    const probe = path.join(DATA_ROOT, `.write-probe.${process.pid}`);
    fs.writeFileSync(probe, "");
    fs.rmSync(probe, { force: true });
    return { path: DATA_ROOT, writable: true };
  } catch (err) {
    return {
      path: DATA_ROOT,
      writable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Returns the absolute directory path for a guild's data folder.
 * @param guildId - Discord guild ID or `"global"` for global config.
 * @returns Absolute path to the guild's data directory.
 */
export function guildDataDir(guildId: string): string {
  return path.join(DATA_ROOT, guildId);
}

/**
 * Builds the absolute file path for a guild-scoped JSON file.
 * @param guildId - Discord guild ID or `"global"`.
 * @param fileName - File name, e.g. `"media_settings.json"`.
 * @returns Absolute path to the requested JSON file.
 */
export function dataFilePath(guildId: string, fileName: string): string {
  return path.join(guildDataDir(guildId), fileName);
}

/**
 * Loads and parses a JSON file stored under the guild’s data directory.
 * Creates no files or folders. If the file is missing (or invalid) and
 * `soft` mode is enabled, returns `defaultValue` (or `{}` as `T`).
 * @template T - Expected JSON shape.
 * @param guildId - Discord guild ID or `"global"`.
 * @param fileName - JSON file name.
 * @param opts - Optional behaviour flags and default value.
 * @returns Parsed JSON object of type `T`.
 * @throws If the file is missing or invalid JSON and `soft` is not enabled.
 */
export function loadData<T>(guildId: string, fileName: string, opts?: LoadOptions<T>): T {
  const filePath = dataFilePath(guildId, fileName);

  if (!fs.existsSync(filePath)) {
    if (opts?.soft) {
      log.debug("missing file, returning default", { filePath });
      return (opts.defaultValue ?? ({} as T)) as T;
    }
    log.error("data file not found", { filePath });
    throw new Error(`Data file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    if (opts?.soft) {
      log.warn("failed to parse json, returning default", {
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      return (opts.defaultValue ?? ({} as T)) as T;
    }
    log.error("failed to parse json", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error(`Failed to parse JSON: ${filePath}`, { cause: err });
  }
}

/**
 * Reads a scoped config file, distinguishing "not there" from "there and
 * empty". {@link loadData} in soft mode returns `{}` for both, which is the
 * difference between falling back to the global config and deliberately
 * switching a feature off for one server.
 * @template T - Expected JSON shape.
 * @param scope - Discord guild ID or "global".
 * @param fileName - JSON file name.
 * @returns The parsed contents, or null when the file is absent or unreadable.
 */
export function readIfPresent<T>(scope: string, fileName: string): T | null {
  const filePath = dataFilePath(scope, fileName);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch (err) {
    log.warn("failed to parse config, ignoring it", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Picks the config a guild should use, applying the one rule every scoped
 * config follows: a server's own file wins as soon as it exists and parses,
 * whatever it contains. An empty file therefore means "off for this server",
 * never "fall back to the global one" - only an absent file falls back.
 * @template T - The config shape.
 * @param guildId - Discord guild (server) ID.
 * @param read - Reads one scope, returning null when the file is not there.
 * @returns The guild's config, the global one, or null when neither exists.
 */
export function resolveScoped<T>(guildId: string, read: (scope: string) => T | null): T | null {
  return read(guildId) ?? read("global");
}

/**
 * Serialises and writes a JSON value under the guild’s data directory.
 * Ensures the directory exists and pretty-prints with 2-space indent.
 * @template T - Any serialisable shape.
 * @param guildId - Discord guild ID or `"global"`.
 * @param fileName - JSON file name.
 * @param data - The data to write.
 */
export function saveData<T>(guildId: string, fileName: string, data: T): void {
  const dir = ensureDir(guildDataDir(guildId));
  const filePath = path.join(dir, fileName);
  // Write to a temp file then rename so a crash mid-write cannot leave a
  // truncated or empty JSON file in place.
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
  log.debug("wrote json", { filePath });
}

/**
 * Fingerprints the files a guild-scoped config resolves from: the guild's own
 * file and the global one it falls back to. Hand-edited configs have to be
 * picked up without a restart, so a cache keyed on this string reloads on any
 * edit; size is taken alongside the timestamp because two writes can land in
 * the same millisecond. A missing file contributes "-", so adding a guild
 * override invalidates the cache the same way editing one does.
 * @param guildId - Discord guild ID.
 * @param fileName - Config file name, e.g. `"words.json"`.
 * @returns A string that changes whenever either file does.
 */
export function configFingerprint(guildId: string, fileName: string): string {
  return [guildId, "global"]
    .map((scope) => {
      const stat = fs.statSync(dataFilePath(scope, fileName), { throwIfNoEntry: false });
      return stat ? `${stat.mtimeMs}:${stat.size}` : "-";
    })
    .join("|");
}
