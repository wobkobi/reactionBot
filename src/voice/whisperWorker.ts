// src/voice/whisperWorker.ts

// Runs Whisper off the main thread, where its CPU cost would stall gateway
// heartbeats and drop the bot from voice.
//
// Spawned by path, never imported, so it must stay self-contained: only
// node:worker_threads and the transformers package at runtime, with sttTypes
// imported as types alone. That keeps it runnable under tsx, under Node's own
// type stripping, and as compiled JavaScript.

import type { HeardWord, SttIn, SttOut } from "@/voice/sttTypes";
import { parentPort } from "node:worker_threads";

/** Shape of the one transformers entry point this worker uses. */
interface TransformersModule {
  pipeline: (
    task: string,
    model: string,
    options?: Record<string, unknown>,
  ) => Promise<(audio: Float32Array, options?: Record<string, unknown>) => Promise<unknown>>;
  env: Record<string, unknown>;
}

/** A loaded pipeline: callable, with the tokenizer it decodes through. */
interface Transcriber {
  (audio: Float32Array, options?: Record<string, unknown>): Promise<unknown>;
  tokenizer: {
    decode: (ids: number[], options?: Record<string, unknown>) => string;
    convert_tokens_to_ids: (tokens: string[]) => (number | undefined)[];
  };
}

/** The loaded pipeline, or null until init succeeds. */
let transcriber: Transcriber | null = null;

/**
 * Whisper's first special token. Every ID from here up is a control token
 * (end of text, start of transcript, timestamps) rather than part of a word.
 */
let firstSpecialId = Number.POSITIVE_INFINITY;

/** One decoding step: the token picked and the probability it had. */
interface Step {
  token: number;
  p: number;
}

/**
 * Builds a logits processor that records each step's pick and its probability.
 * The pipeline has no way to return scores, but it runs any processor it is
 * handed after its own, so this one sees the final distribution the token is
 * drawn from. Decoding is greedy, so the pick is the most likely token and its
 * softmax probability is the confidence. The logits pass through untouched.
 * @param steps - Where each step is appended.
 * @returns The processor.
 */
function stepRecorder(steps: Step[]): (ids: unknown, logits: { data: Float32Array }) => unknown {
  return (_ids, logits) => {
    const row = logits.data;
    let best = 0;
    for (let i = 1; i < row.length; i++) if (row[i]! > row[best]!) best = i;
    // Softmax of the best entry alone: 1 / sum(exp(x - max)). Suppressed tokens
    // are -Infinity and add nothing.
    let sum = 0;
    for (let i = 0; i < row.length; i++) sum += Math.exp(row[i]! - row[best]!);
    steps.push({ token: best, p: 1 / sum });
    return logits;
  };
}

/**
 * Groups recorded steps into words. A token whose text opens with a space
 * starts a new word; one without continues the last. Control tokens are
 * skipped, and so are pieces with no letter or digit in them, so a full stop
 * the model was unsure of does not drag down the word before it.
 * @param pipe - The loaded pipeline, for its tokenizer.
 * @param steps - The steps {@link stepRecorder} collected.
 * @returns The words in order, each with its confidence.
 */
function wordsOf(pipe: Transcriber, steps: Step[]): HeardWord[] {
  const words: HeardWord[] = [];
  for (const { token, p } of steps) {
    if (token >= firstSpecialId) continue;
    const piece = pipe.tokenizer.decode([token]);
    const last = words.at(-1);
    if (last && !/^\s/.test(piece)) {
      last.word += piece;
      if (/[\p{L}\p{N}]/u.test(piece)) last.confidence = Math.min(last.confidence, p);
    } else if (piece.trim()) {
      words.push({ word: piece.trim(), confidence: /[\p{L}\p{N}]/u.test(piece) ? p : 1 });
    }
  }
  return words;
}

const port = parentPort;

/**
 * Sends a message back to the parent.
 * @param message - The outgoing message.
 */
function post(message: SttOut): void {
  port?.postMessage(message);
}

/**
 * Loads the model. A failure here is terminal for the worker: without a
 * pipeline there is nothing it can do, so it reports and exits rather than
 * failing every job forever.
 * @param model - Checkpoint name to load.
 * @param cacheDir - Directory to download and cache weights into.
 * @param threads - Threads for onnxruntime, or undefined to keep its default.
 */
async function init(model: string, cacheDir: string, threads: number | undefined): Promise<void> {
  // A non-literal specifier keeps TypeScript from resolving the package, so the
  // project typechecks and builds with this optional dependency absent.
  const specifier = "@huggingface/transformers";
  const mod = (await import(specifier)) as unknown as TransformersModule;

  mod.env.cacheDir = cacheDir;
  mod.env.allowLocalModels = false;

  // Spinning keeps idle pool threads busy-waiting for the next op. It measured
  // a third to a half of each job's CPU time for no gain in speed, and under a
  // container CPU limit the spin is billed against the quota like real work.
  const sessionOptions: Record<string, unknown> = {
    extra: { session: { intra_op: { allow_spinning: "0" } } },
  };
  if (threads) sessionOptions.intraOpNumThreads = threads;

  transcriber = (await mod.pipeline("automatic-speech-recognition", model, {
    session_options: sessionOptions,
  })) as Transcriber;
  firstSpecialId =
    transcriber.tokenizer.convert_tokens_to_ids(["<|endoftext|>"])[0] ?? Number.POSITIVE_INFINITY;
  post({ type: "ready", model });
}

/**
 * Transcribes one utterance and reports the text.
 *
 * The checkpoint is English-only, so no `language` or `task` option is passed:
 * those are rejected by `.en` models rather than ignored.
 * @param id - Job id, echoed back so the parent can settle the right promise.
 * @param samples - Mono 16kHz float samples.
 */
async function run(id: number, samples: Float32Array): Promise<void> {
  if (!transcriber) {
    post({ type: "error", id, message: "model not loaded" });
    return;
  }
  const startedAt = Date.now();
  const steps: Step[] = [];
  const output = (await transcriber(samples, { logits_processor: [stepRecorder(steps)] })) as
    { text?: string } | Array<{ text?: string }>;
  const first = Array.isArray(output) ? output[0] : output;
  post({
    type: "result",
    id,
    text: (first?.text ?? "").trim(),
    words: wordsOf(transcriber, steps),
    ms: Date.now() - startedAt,
  });
}

port?.on("message", (message: SttIn) => {
  if (message.type === "init") {
    init(message.model, message.cacheDir, message.threads).catch((err: unknown) => {
      post({ type: "fatal", message: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
    return;
  }
  run(message.id, message.samples).catch((err: unknown) => {
    post({
      type: "error",
      id: message.id,
      message: err instanceof Error ? err.message : String(err),
    });
  });
});
