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
  /** Threads for onnxruntime, or absent to keep its default of one per physical core. */
  threads?: number;
}

/** One utterance to transcribe. */
export interface SttJob {
  type: "job";
  id: number;
  samples: Float32Array;
}

/** Anything the parent sends the worker. */
export type SttIn = SttInit | SttJob;

/** One word of a transcript, with how sure the model was of it. */
export interface HeardWord {
  /** The word as written, punctuation and all. */
  word: string;
  /**
   * The model's probability for the word, from 0 to 1. A word split into
   * several tokens takes its least likely one, since a mishearing can sit in
   * any piece of it.
   */
  confidence: number;
}

/** Anything the worker sends back. */
export type SttOut =
  | { type: "ready"; model: string }
  | { type: "result"; id: number; text: string; words: HeardWord[]; ms: number }
  | { type: "error"; id: number; message: string }
  | { type: "fatal"; message: string };

/**
 * Default speech model. Transcription sits in the middle of the wait between a
 * word being said and its clip playing. Whisper pads every clip to 30s and
 * turns it into a spectrogram first, so whisper-tiny.en took ~530ms on a 2s
 * chunk and ~460ms on "Nice shot." alike. Moonshine reads the raw audio at its
 * own length: its base model took ~140ms on a 2.1s chunk and ~80ms on "Nice
 * shot, man." on the same CPU, and its tiny model about half that. Base is the
 * default because tiny misheard more of the words said on their own, which is
 * how most triggers come, and turned one of the bot's own clips into words. A
 * config that wants tiny sets VOICE_MODEL to onnx-community/moonshine-tiny-ONNX;
 * Whisper is Xenova/whisper-tiny.en, or Xenova/whisper-base.en to mishear less.
 */
export const DEFAULT_MODEL = "onnx-community/moonshine-base-ONNX";
