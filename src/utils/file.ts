// src/utils/file.ts
import fs from "fs";
import path from "path";
import { createLogger } from "./log.js";

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
 * @param opts - Optional behavior flags and default value.
 * @returns Parsed JSON object of type `T`.
 * @throws If the file is missing or invalid JSON and `soft` is not enabled.
 */
export function loadData<T>(
  guildId: string,
  fileName: string,
  opts?: LoadOptions<T>
): T {
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
    throw new Error(`Failed to parse JSON: ${filePath}\n${String(err)}`);
  }
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
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  log.debug("wrote json", { filePath });
}
