// src/voice/spokenWords.ts

// Scores what people say in a call against the swear and slur trackers: the
// same words.json lists and the same stores a typed message counts toward, so
// /swears and /slurs cover both.
//
// Long speech arrives as overlapping chunks (CHUNK_OVERLAP_SAMPLES in
// audio.ts), so a word said near a cut is transcribed twice: at the end of one
// chunk and again at the start of the next. The transcriber gives no timings,
// so position in the transcript stands in for time - see stitchCounts.

import { findMatches, type FoundMatch } from "@/tracking/detect";
import { incrementCounts } from "@/tracking/store";
import { SLURS, SWEARS } from "@/tracking/trackers";
import { loadWords, type TrackKey } from "@/tracking/words";
import { createLogger } from "@/utils/log";

const log = createLogger("voice/spokenWords");

/**
 * Words either side of a cut that may have been heard twice. The overlap is
 * 0.6s, about two words of quick speech; the third is slack for where the cut
 * happens to fall.
 */
export const SEAM_WORDS = 3;

/** Speech a speaker has kept up without a break, as the chunks it was cut into. */
export interface SpeechRun {
  /** Index of the last chunk scored, or -1 before the first. */
  scored: number;
  /** Per track, the words in that chunk's closing words, by how many times each. */
  tails: Map<TrackKey, Map<string, number>>;
}

/** Where a chunk sits: the run it was cut from, and its place in it from 0. */
export interface ChunkPlace {
  run: SpeechRun;
  index: number;
}

/**
 * Opens a run for a speaker who has just started talking.
 * @returns A run with nothing scored yet.
 */
export function startRun(): SpeechRun {
  return { scored: -1, tails: new Map() };
}

/**
 * Tallies the words found in one chunk, less the ones the chunk before already
 * counted across the cut.
 *
 * A match among this chunk's opening {@link SEAM_WORDS} words is skipped when
 * the same word sat in the previous chunk's closing ones, once per sighting
 * there, so "fuck" heard on both sides of a cut counts once. Matching on the
 * listed word rather than the transcript's spelling holds up when the two
 * chunks hear it differently. The cost is a word really said twice within a
 * second or so across a cut, which counts once.
 * @param found - The chunk's matches, from {@link findMatches}.
 * @param [seam] - Words in the previous chunk's closing words, by how many
 * times each; omitted when this chunk does not follow one that was scored.
 * @returns The counts to add, and this chunk's own closing words for the next.
 */
export function stitchCounts(
  found: FoundMatch[],
  seam?: Map<string, number>,
): { counts: Map<string, number>; tail: Map<string, number> } {
  const unclaimed = new Map(seam);
  const counts = new Map<string, number>();
  const tail = new Map<string, number>();
  for (const { word, before, after } of found) {
    if (after < SEAM_WORDS) tail.set(word, (tail.get(word) ?? 0) + 1);
    const heard = unclaimed.get(word) ?? 0;
    if (before < SEAM_WORDS && heard > 0) {
      unclaimed.set(word, heard - 1);
      continue;
    }
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return { counts, tail };
}

/**
 * Counts the swears and slurs in one chunk of speech against the speaker.
 *
 * Chunks reach here in the order they were cut, since the transcriber works
 * through them one at a time, but one can go missing: dropped under load, or
 * thrown out as a hallucination. A chunk only stitches onto the one before it
 * when that one was scored, since a word a missing chunk heard was never
 * counted at all.
 * @param guildId - Discord guild (server) ID.
 * @param speaker - Who spoke, by ID and by name for the log.
 * @param speaker.userId - Discord user ID the counts go to.
 * @param speaker.userName - Display name, for the log line.
 * @param text - The chunk's transcript.
 * @param chunk - The chunk's place in its run; the run is updated with it.
 */
export function scoreSpoken(
  guildId: string,
  speaker: { userId: string; userName: string },
  text: string,
  chunk: ChunkPlace,
): void {
  const { run, index } = chunk;
  const words = loadWords(guildId);
  const follows = index > 0 && run.scored === index - 1;
  const tails = new Map<TrackKey, Map<string, number>>();

  for (const tracker of [SWEARS, SLURS]) {
    const found = findMatches(text, words.tracks[tracker.track]);
    const seam = follows ? run.tails.get(tracker.track) : undefined;
    const { counts, tail } = stitchCounts(found, seam);
    tails.set(tracker.track, tail);
    if (counts.size === 0) continue;
    incrementCounts(guildId, tracker.storeFile, speaker.userId, counts);
    // Slurs at info, as a typed one is; swears are too common to be worth more
    // than debug.
    const fields = { guildId, user: speaker.userName, words: [...counts.keys()] };
    if (tracker === SLURS) log.info("slur heard in voice", fields, { userId: speaker.userId });
    else log.debug("swear heard in voice", fields, { userId: speaker.userId });
  }

  run.scored = index;
  run.tails = tails;
}
