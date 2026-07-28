// src/tracking/trackers.ts

/**
 * @file Tracker configs. Each tracker pairs a track key in the unified word
 * config (words.json, see tracking/words.ts) with a store file (persistence)
 * and the copy its slash command renders - the command builder and every reply
 * helper in tracking/commands.ts read their wording from here, so this file is
 * the only place a tracker's user-facing text lives. Both trackers are
 * attributed to the message author.
 */

import { TrackKey } from "@/tracking/words";

/** A tracker's word-config key, store filename and command copy. */
export interface Tracker {
  /** Track key in the unified word config (words.json `types[].track`). */
  track: TrackKey;
  /** Per-guild count-store JSON filename. */
  storeFile: string;
  /** Slash command name, and the plural noun in command copy (e.g. "swears"). */
  name: string;
  /** Singular noun used in command copy (e.g. "swear"). */
  noun: string;
  /** Past-tense verb for the count reply and the unknown-word notice. */
  verbPast: string;
  /** Description of the top-level command. */
  description: string;
  /** Embed title for the people leaderboard. */
  topTitle: string;
  /** Embed title for the word leaderboard. */
  wordsTitle: string;
}

/** Swears and insults said by the author. */
export const SWEARS: Tracker = {
  track: "swears",
  storeFile: "swear_counts.json",
  name: "swears",
  noun: "swear",
  verbPast: "said",
  description: "Swear and insult tracking",
  topTitle: "Swearboard",
  wordsTitle: "Most-used swears",
};

/** Slurs said by the author (triggers a public shame). */
export const SLURS: Tracker = {
  track: "slurs",
  storeFile: "slur_counts.json",
  name: "slurs",
  noun: "slur",
  verbPast: "said",
  description: "Slur tracking",
  topTitle: "Slur offenders",
  wordsTitle: "Most-used slurs",
};
