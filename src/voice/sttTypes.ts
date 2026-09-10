// src/voice/sttTypes.ts

// Message shapes shared by the transcriber and its worker. Kept in their own
// module so the parent never has to import the worker (which would pull the
// model into the main thread), and so the worker can import them with a
// type-only import that erases at runtime and leaves it self-contained.

/** Ask the worker to load a model. Sent once, before any job. */
export interface SttInit {
  type: "init";
  model: string;
  cacheDir: string;
}

/** One utterance to transcribe. */
export interface SttJob {
  type: "job";
  id: number;
  samples: Float32Array;
}

/** Anything the parent sends the worker. */
export type SttIn = SttInit | SttJob;

/** Anything the worker sends back. */
export type SttOut =
  | { type: "ready"; model: string }
  | { type: "result"; id: number; text: string; ms: number }
  | { type: "error"; id: number; message: string }
  | { type: "fatal"; message: string };

/**
 * Default Whisper checkpoint. Transcription sits in the middle of the wait
 * between a word being said and its clip playing, and on base.en that measured
 * about 770ms per utterance - most of a second the joke spends landing. The
 * tiny English-only model roughly halves it. It mishears more, which the
 * phonetic tier and the per-trigger word lists exist to absorb, and a config
 * that would rather have the accuracy than the second sets VOICE_MODEL back to
 * Xenova/whisper-base.en.
 */
export const DEFAULT_MODEL = "Xenova/whisper-tiny.en";
