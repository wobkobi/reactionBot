// src/voice/spokenWords.ts

// Scores what people say in a call against the swear and slur trackers: the
// same words.json lists and the same stores a typed message counts toward, so
// /swears and /slurs cover both.
//
// Long speech arrives as overlapping chunks (CHUNK_OVERLAP_SAMPLES in
// audio.ts), so a word said near a cut is transcribed twice: at the end of one
// chunk and again at the start of the next. The transcriber gives no timings,
// so position in the transcript stands in for time - see stitchCounts. A word
// heard less surely than the server's floor is logged and not counted.

import { findMatches, type FoundMatch } from "@/tracking/detect";
import { incrementCounts } from "@/tracking/store";
import { SLURS, SWEARS } from "@/tracking/trackers";
import { loadWords, type TrackKey } from "@/tracking/words";
import { createLogger } from "@/utils/log";
import { matchConfidence } from "@/voice/stt";
import type { HeardWord } from "@/voice/sttTypes";

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
 * Splits a chunk's matches by how surely each was heard. A match with no
 * confidence to go on is kept, as a trigger's is: the floor is for doubtful
 * hearings, and a missing figure says nothing either way.
 * @param found - The chunk's matches, from {@link findMatches}.
 * @param heard - The transcript's words with their confidence.
 * @param floor - Confidence a match needs to count, 0 to 1.
 * @returns The sure and unsure matches, each in the order given.
 */
export function weighFound(
  found: FoundMatch[],
  heard: HeardWord[],
  floor: number,
): { sure: FoundMatch[]; unsure: FoundMatch[] } {
  const sure: FoundMatch[] = [];
  const unsure: FoundMatch[] = [];
  for (const match of found) {
    const confidence = matchConfidence([match.text], heard);
    (confidence !== null && confidence < floor ? unsure : sure).push(match);
  }
  return { sure, unsure };
}

/**
 * Counts the swears and slurs in one chunk of speech against the speaker.
 *
 * A match heard less surely than the floor is logged and not counted. It is
 * left out of the seam too, so a surer hearing of the same word in the next
 * chunk still counts rather than being taken for the copy.
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
 * @param transcript - What the chunk was heard as.
 * @param transcript.text - The chunk's transcript.
 * @param transcript.words - Its words with their confidence.
 * @param chunk - The chunk's place in its run; the run is updated with it.
 * @param floor - Confidence a word needs to count, 0 to 1.
 */
export function scoreSpoken(
  guildId: string,
  speaker: { userId: string; userName: string },
  transcript: { text: string; words: HeardWord[] },
  chunk: ChunkPlace,
  floor: number,
): void {
  const { run, index } = chunk;
  const words = loadWords(guildId);
  const follows = index > 0 && run.scored === index - 1;
  const tails = new Map<TrackKey, Map<string, number>>();

  for (const tracker of [SWEARS, SLURS]) {
    const found = findMatches(transcript.text, words.tracks[tracker.track]);
    const { sure, unsure } = weighFound(found, transcript.words, floor);
    const seam = follows ? run.tails.get(tracker.track) : undefined;
    const { counts, tail } = stitchCounts(sure, seam);
    tails.set(tracker.track, tail);
    if (counts.size > 0) incrementCounts(guildId, tracker.storeFile, speaker.userId, counts);

    // Slurs at info, as a typed one is; swears are too common to be worth more
    // than debug. Each line carries the least sure of its words, so a floor
    // can be tuned from the log.
    const line = tracker === SLURS ? log.info : log.debug;
    const confidenceOf = (matches: FoundMatch[]): number | null =>
      matchConfidence(
        matches.map((m) => m.text),
        transcript.words,
      );
    if (counts.size > 0) {
      line(
        `${tracker.noun} heard in voice`,
        {
          guildId,
          user: speaker.userName,
          words: [...counts.keys()],
          confidence: confidenceOf(sure.filter((m) => counts.has(m.word))),
        },
        { userId: speaker.userId },
      );
    }
    if (unsure.length > 0) {
      line(
        `${tracker.noun} not counted`,
        {
          guildId,
          user: speaker.userName,
          words: [...new Set(unsure.map((m) => m.word))],
          confidence: confidenceOf(unsure),
          reason: "heard unsurely",
          needs: floor,
        },
        { userId: speaker.userId },
      );
    }
  }

  run.scored = index;
  run.tails = tails;
}
