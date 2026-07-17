// src/tracking/trackers.ts

/**
 * @file Tracker configs. Each tracker pairs a track key in the unified word
 * config (words.json, see tracking/words.ts) with a store file
 * (persistence). Swears and slurs are attributed to the message author;
 * called-names are attributed to the target (who got called the name).
 */

import { TrackKey } from "@/tracking/words.js";

/** A tracker's word-config key, store filename and display noun. */
export interface Tracker {
  /** Track key in the unified word config (words.json `types[].track`). */
  track: TrackKey;
  /** Per-guild count-store JSON filename. */
  storeFile: string;
  /** Singular noun used in command copy (e.g. "swear"). */
  noun: string;
}

/** Swears said by the author. */
export const SWEARS: Tracker = {
  track: "swears",
  storeFile: "swear_counts.json",
  noun: "swear",
};

/** Slurs said by the author (triggers a public shame). */
export const SLURS: Tracker = {
  track: "slurs",
  storeFile: "slur_counts.json",
  noun: "slur",
};

/** Insults attributed to the target who got called them. */
export const CALLED: Tracker = {
  track: "called",
  storeFile: "insult_counts.json",
  noun: "insult",
};
