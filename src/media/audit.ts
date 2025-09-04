// src/media/audit.ts
import { loadData, saveData } from "../utils/file.js";
import { createLogger } from "../utils/log.js";

const log = createLogger("media/audit");
export interface DeletionLogEntry {
  originalMessageId: string;
  originalChannelId: string;
  repostMessageId: string;
  repostChannelId: string;
  stubMessageId?: string;
  deletedAt: string;
}

/**
 * Append one deletion entry to the per-guild log array on disk.
 * Safely handles first-run and any legacy non-array shapes.
 * @param guildId - Guild whose log to update.
 * @param entry - The deletion entry to append.
 */
export function appendDeletionLog(
  guildId: string,
  entry: DeletionLogEntry
): void {
  const raw = loadData<unknown>(guildId, "deleted_links.json", { soft: true });

  // Coerce into an array (empty on first run or if legacy shape exists)
  const logArr: DeletionLogEntry[] = Array.isArray(raw)
    ? (raw as DeletionLogEntry[])
    : [];

  logArr.push(entry);

  // saveData can take arrays; no cast needed
  saveData(guildId, "deleted_links.json", logArr);
  log.debug("appended deletion log", { guildId, size: logArr.length });
}
