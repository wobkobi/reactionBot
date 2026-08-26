// src/media/audit.ts
import { loadData, saveData } from "@/utils/file";
import { createLogger } from "@/utils/log";
import { AUDIT_RETENTION_MS } from "@/utils/retention";

const log = createLogger("media/audit");
export interface DeletionLogEntry {
  originalMessageId: string;
  originalChannelId: string;
  repostMessageId: string;
  repostChannelId: string;
  stubMessageId?: string;
  deletedAt: string;
}

/** Filename of the per-guild deletion log. */
export const AUDIT_FILE = "deleted_links.json";

/**
 * Drops entries past {@link AUDIT_RETENTION_MS}. Every append rewrites the
 * whole file, so without this each delete costs more than the last for the
 * life of the guild. An entry whose stamp will not parse is kept: its age
 * cannot be read, and discarding a record nobody can date loses more than it
 * saves - the same rule the message-keyed stores prune by.
 * @param entries - The log as read from disk.
 * @param now - Epoch ms to measure against; defaults to the current time.
 * @returns The entries still within the window.
 */
export function pruneDeletionLog(
  entries: DeletionLogEntry[],
  now: number = Date.now(),
): DeletionLogEntry[] {
  const cutoff = now - AUDIT_RETENTION_MS;
  return entries.filter((e) => {
    const at = Date.parse(e.deletedAt);
    return Number.isNaN(at) || at >= cutoff;
  });
}

/**
 * Append one deletion entry to the per-guild log array on disk.
 * Safely handles first-run and any legacy non-array shapes.
 * @param guildId - Guild whose log to update.
 * @param entry - The deletion entry to append.
 */
export function appendDeletionLog(guildId: string, entry: DeletionLogEntry): void {
  const raw = loadData<unknown>(guildId, AUDIT_FILE, { soft: true });

  // Coerce into an array (empty on first run or if legacy shape exists)
  const logArr: DeletionLogEntry[] = Array.isArray(raw) ? (raw as DeletionLogEntry[]) : [];

  const kept = pruneDeletionLog(logArr);
  const dropped = logArr.length - kept.length;
  kept.push(entry);

  // saveData can take arrays; no cast needed
  saveData(guildId, AUDIT_FILE, kept);
  if (dropped > 0) log.info("pruned expired deletion log entries", { guildId, dropped });
  log.debug("appended deletion log", { guildId, size: kept.length });
}
