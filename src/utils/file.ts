// src/utils/file.ts

/**
 * Utility functions for loading and saving per-guild JSON data files.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Resolve __dirname in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Root directory where guild data folders are stored.
 */
const DATA_ROOT = path.resolve(__dirname, "../../data");

/**
 * Loads JSON data for a given guild and filename. Creates the guild directory if it doesn't exist.
 * @template T - The expected shape of the JSON data.
 * @param guildId - The Discord guild (server) ID.
 * @param fileName - The name of the JSON file (e.g., "allowed.json").
 * @returns The parsed JSON data, or an empty object if the file does not exist.
 */
export function loadData<T = Record<string, unknown>>(
  guildId: string,
  fileName: string
): T {
  const dir = path.join(DATA_ROOT, guildId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  if (!fs.existsSync(filePath)) return {} as T;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

/**
 * Saves JSON data for a given guild and filename. Creates the guild directory if it doesn't exist.
 * @param guildId - The Discord guild (server) ID.
 * @param fileName - The name of the JSON file (e.g., "media_channel.json").
 * @param data - The data to serialize and save.
 */
export function saveData(
  guildId: string,
  fileName: string,
  data: Record<string, unknown>
): void {
  const dir = path.join(DATA_ROOT, guildId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}
