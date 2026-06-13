// src/tracking/trackers.ts

/**
 * @file Tracker configs. Each tracker pairs a word list (detection) with a
 * store file (persistence). Swears and slurs are attributed to the message
 * author; called-names are attributed to the target (who got called the name).
 */

/** A tracker's list/store filenames and display noun. */
export interface Tracker {
  /** Word-list JSON filename under data/<guild|global>/. */
  listFile: string;
  /** Per-guild count-store JSON filename. */
  storeFile: string;
  /** Singular noun used in command copy (e.g. "swear"). */
  noun: string;
}

/** Swears said by the author. */
export const SWEARS: Tracker = {
  listFile: "swears.json",
  storeFile: "swear_counts.json",
  noun: "swear",
};

/** Slurs said by the author (triggers a public shame). */
export const SLURS: Tracker = {
  listFile: "slurs.json",
  storeFile: "slur_counts.json",
  noun: "slur",
};

/** Insults attributed to the target who got called them. */
export const CALLED: Tracker = {
  listFile: "insults.json",
  storeFile: "insult_counts.json",
  noun: "insult",
};
