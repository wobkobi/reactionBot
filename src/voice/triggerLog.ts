// src/voice/triggerLog.ts

// One CSV per server of who said what to set a clip off, and what became of
// it. Only transcripts that matched a trigger are written: the file is for
// tuning the word lists, not a record of the call.
//
// A refused match is still a row. A misfire held back by a cooldown is a
// misfire all the same, and the fix for it is in the word list either way.

import { dataFilePath, guildDataDir } from "@/utils/file";
import { createLogger } from "@/utils/log";
import type { ClipVerdict } from "@/voice/playback";
import fs from "fs";

const log = createLogger("voice/triggerLog");

/** The log's name inside a server's data folder. */
export const TRIGGER_LOG_FILE = "voice_triggers.csv";

/** Column names, in the order {@link csvRow} writes them. */
export const TRIGGER_LOG_HEADER = "time,user_id,user_name,heard,matched,pool,clip,outcome";

/**
 * Byte-order mark ahead of the header. Excel reads a CSV without one in the
 * system code page, which garbles the emoji and accents in display names.
 */
const BOM = String.fromCharCode(0xfeff);

/** What became of a match: played, or the reason it did not. */
export type TriggerOutcome =
  "played" | Exclude<ClipVerdict, "play"> | "calm" | "no-clips" | "missing-file" | "not-played";

/** One row of the log. */
export interface TriggerRecord {
  /** When the transcript came back. */
  at: Date;
  userId: string;
  /** Server display name at the time, empty when the member was not cached. */
  userName: string;
  /** The whole transcript. */
  heard: string;
  /** Every word that fired a trigger, across all the pools it reached. */
  matched: string[];
  /** The pool that played or refused, empty when nothing got that far. */
  pool: string;
  /** The clip that played or was chosen, empty when none was. */
  clip: string;
  outcome: TriggerOutcome;
}

/**
 * Formats one value as a CSV field.
 *
 * A value opening with = + - or @ gets an apostrophe in front, since a
 * spreadsheet would otherwise run a transcript like "=1+1" as a formula. Then
 * RFC 4180 quoting: a field holding a comma, quote or line break is wrapped in
 * quotes, with its own quotes doubled.
 * @param value - The raw value.
 * @returns The field, ready to join with commas.
 */
export function csvField(value: string): string {
  const defused = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(defused) ? `"${defused.replace(/"/g, '""')}"` : defused;
}

/**
 * Formats one record as a CSV line in {@link TRIGGER_LOG_HEADER} order.
 * @param record - The row to write.
 * @returns The line, newline included.
 */
export function csvRow(record: TriggerRecord): string {
  const fields = [
    record.at.toISOString(),
    record.userId,
    record.userName,
    record.heard,
    record.matched.join("; "),
    record.pool,
    record.clip,
    record.outcome,
  ];
  return fields.map(csvField).join(",") + "\n";
}

/**
 * The write in flight per server. Each append waits on the one before, so two
 * speakers matching at once cannot both find the file missing and write the
 * header twice.
 */
const queues = new Map<string, Promise<void>>();

/**
 * Appends one row to a server's log, writing the header first when the file
 * is new or empty. Never rejects: a failed write is logged and dropped, since
 * losing a row must not cost the clip.
 * @param guildId - Discord guild (server) ID.
 * @param record - The row to write.
 */
async function append(guildId: string, record: TriggerRecord): Promise<void> {
  const file = dataFilePath(guildId, TRIGGER_LOG_FILE);
  try {
    await fs.promises.mkdir(guildDataDir(guildId), { recursive: true });
    const size = await fs.promises.stat(file).then(
      (s) => s.size,
      () => 0,
    );
    const header = size === 0 ? `${BOM}${TRIGGER_LOG_HEADER}\n` : "";
    await fs.promises.appendFile(file, header + csvRow(record), "utf-8");
  } catch (err) {
    log.warn("could not write trigger log", {
      guildId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Queues one row for a server's trigger log.
 * @param guildId - Discord guild (server) ID.
 * @param record - The row to write.
 * @returns Settles once the row is written or the write has failed.
 */
export function recordTrigger(guildId: string, record: TriggerRecord): Promise<void> {
  const next = (queues.get(guildId) ?? Promise.resolve()).then(() => append(guildId, record));
  queues.set(guildId, next);
  // Only the last write queued clears the entry, so a server that has gone
  // quiet holds nothing here.
  void next.then(() => {
    if (queues.get(guildId) === next) queues.delete(guildId);
  });
  return next;
}
