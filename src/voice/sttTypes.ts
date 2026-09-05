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
 * Default Whisper checkpoint. The English-only base model is the balance point:
 * small enough to stay ahead of conversation on a CPU, accurate enough for
 * keyword spotting. VOICE_MODEL overrides it, and whisper-tiny.en roughly
 * halves the inference cost.
 */
export const DEFAULT_MODEL = "Xenova/whisper-base.en";
