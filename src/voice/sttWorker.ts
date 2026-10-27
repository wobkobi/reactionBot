// src/voice/sttWorker.ts

// Runs the speech model off the main thread, where its CPU cost would stall
// gateway heartbeats and drop the bot from voice. Loads Moonshine or Whisper,
// whichever VOICE_MODEL names; the two differ in how their tokenizers mark
// word starts and in how long a transcript their pipelines let them write.
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

/** A loaded pipeline: callable, with its model's config and the tokenizer it decodes through. */
interface Transcriber {
  (audio: Float32Array, options?: Record<string, unknown>): Promise<unknown>;
  model: { config: { model_type: string; eos_token_id?: number } };
  tokenizer: {
    decode: (ids: number[], options?: Record<string, unknown>) => string;
    convert_tokens_to_ids: (tokens: string[]) => (number | undefined)[];
  };
}

/** The loaded pipeline, or null until init succeeds. */
let transcriber: Transcriber | null = null;

/**
 * Moonshine's end-of-text token while Moonshine is loaded, else undefined. The
 * worker caps its transcript length and guards its first step, which Whisper
 * needs neither of.
 */
let moonshineEos: number | undefined;

/**
 * Whisper's first special token. Every ID from here up is a control token
 * (end of text, start of transcript, timestamps) rather than part of a word.
 * Decoding drops the special ones anyway, but timestamps are not in the
 * tokenizer at all. Moonshine leaves this at infinity: it has no such token,
 * and its tokenizer flags every control token it has as special.
 */
let firstSpecialId = Number.POSITIVE_INFINITY;

/**
 * Silence put before and after every clip: 0.25s at 16kHz. Discord sends audio
 * only while its voice detection hears speech, so a clip opens on the first
 * syllable and closes on the last, and both families misread a word with no
 * quiet around it. On 24 lone test words, Moonshine tiny got 3 right tight and
 * 10 padded, base 5 and 11, Whisper tiny 9 and 11. A full second did worse
 * again: Moonshine took a clip that was mostly silence for no speech at all.
 */
const EDGE_PAD_SAMPLES = 4_000;

/**
 * Copies a clip into a buffer with {@link EDGE_PAD_SAMPLES} of silence each side.
 * @param samples - Mono 16kHz float samples.
 * @returns The padded copy.
 */
function padded(samples: Float32Array): Float32Array {
  const out = new Float32Array(samples.length + 2 * EDGE_PAD_SAMPLES);
  out.set(samples, EDGE_PAD_SAMPLES);
  return out;
}

/** Shortest transcript Moonshine is allowed: one long word and its full stop. */
const MOONSHINE_MIN_TOKENS = 6;

/**
 * Moonshine's cap on transcript length: 6 tokens per second of audio, the
 * Moonshine paper's limit against the model looping on a phrase it has
 * already written. The pipeline's own cap counts whole seconds only, which
 * gives a clip under a second no tokens at all, so this rounds up instead and
 * keeps a floor for a word said on its own.
 * @param samples - Length of the clip in 16kHz samples.
 * @returns The most tokens Moonshine may write for it.
 */
function moonshineMaxTokens(samples: number): number {
  return Math.max(MOONSHINE_MIN_TOKENS, Math.ceil((samples / 16_000) * 6));
}

/**
 * End-of-text odds on Moonshine's first step at or above which it is left to
 * write nothing. A word said on its own ("fart", "kirk") often gets end-of-text
 * as the first pick and comes back empty: at 0.3 to 0.55 on tiny, under 0.3 on
 * base. Noise, breath, hum, and the bot's own fart, burp and cave clips scored
 * 0.82 and up on base and 0.99 and up on tiny.
 */
const MOONSHINE_SILENT_EOS = 0.7;

/**
 * Softmax probability of one entry in a row of logits. Banned tokens are
 * -Infinity and add nothing.
 * @param row - The logits for one step.
 * @param index - The entry to score.
 * @returns Its probability, from 0 to 1.
 */
function probabilityOf(row: Float32Array, index: number): number {
  let max = Number.NEGATIVE_INFINITY;
  for (const x of row) if (x > max) max = x;
  let sum = 0;
  for (const x of row) sum += Math.exp(x - max);
  return Math.exp(row[index]! - max) / sum;
}

/**
 * Builds a logits processor that keeps Moonshine from giving up on a lone word.
 * On the first step it bans end-of-text unless the model is sure there is no
 * speech ({@link MOONSHINE_SILENT_EOS}), so the model writes its best guess
 * instead. The ban is what stops noise being forced into words too: given no
 * choice, Moonshine writes "You" or "Thank you" for a burp at up to 0.68.
 * @param eos - Moonshine's end-of-text token.
 * @returns The processor, for one transcription only.
 */
function firstWordGuard(eos: number): (ids: unknown, logits: { data: Float32Array }) => unknown {
  let first = true;
  return (_ids, logits) => {
    if (first && probabilityOf(logits.data, eos) < MOONSHINE_SILENT_EOS) {
      logits.data[eos] = Number.NEGATIVE_INFINITY;
    }
    first = false;
    return logits;
  };
}

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
 * softmax probability is the confidence. A first word {@link firstWordGuard}
 * kept from ending scores against the words alone, end-of-text gone. The
 * logits pass through untouched.
 * @param steps - Where each step is appended.
 * @returns The processor.
 */
function stepRecorder(steps: Step[]): (ids: unknown, logits: { data: Float32Array }) => unknown {
  return (_ids, logits) => {
    const row = logits.data;
    let best = 0;
    for (let i = 1; i < row.length; i++) if (row[i]! > row[best]!) best = i;
    steps.push({ token: best, p: probabilityOf(row, best) });
    return logits;
  };
}

/**
 * Groups recorded steps into words. A token's text is what it adds to the
 * transcript decoded so far, not the token decoded alone: Moonshine's
 * tokenizer marks a word start with a space that decoding strips from the
 * front of the text, so a lone token never shows it. A piece that opens with
 * a space starts a new word; one without continues the last. Control tokens
 * add nothing and drop out, and so do pieces with no letter or digit in them,
 * so a full stop the model was unsure of does not drag down the word before it.
 * @param pipe - The loaded pipeline, for its tokenizer.
 * @param steps - The steps {@link stepRecorder} collected.
 * @returns The words in order, each with its confidence.
 */
function wordsOf(pipe: Transcriber, steps: Step[]): HeardWord[] {
  const words: HeardWord[] = [];
  const ids: number[] = [];
  let text = "";
  for (const { token, p } of steps) {
    if (token >= firstSpecialId) continue;
    ids.push(token);
    const next = pipe.tokenizer.decode(ids, { skip_special_tokens: true });
    // A longer run can rewrite the end of the shorter one, as when one
    // character's bytes span two tokens; the token decoded alone stands in then.
    const piece = next.startsWith(text)
      ? next.slice(text.length)
      : pipe.tokenizer.decode([token], { skip_special_tokens: true });
    text = next;
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
  const family = transcriber.model.config.model_type;
  moonshineEos = family === "moonshine" ? transcriber.model.config.eos_token_id : undefined;
  // Looked up only for Whisper: a tokenizer without the token falls back to its
  // unknown-token ID where its vocabulary has one, often 0, which would mark
  // every token as control.
  if (family === "whisper") {
    firstSpecialId =
      transcriber.tokenizer.convert_tokens_to_ids(["<|endoftext|>"])[0] ?? Number.POSITIVE_INFINITY;
  }
  post({ type: "ready", model });
}

/**
 * Transcribes one utterance and reports the text.
 *
 * Both families load English-only checkpoints, so no `language` or `task`
 * option is passed: Whisper's `.en` models reject those rather than ignore them.
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
  const options: Record<string, unknown> = { logits_processor: [stepRecorder(steps)] };
  if (moonshineEos !== undefined) {
    // The guard goes first so the recorder scores the row it leaves.
    options.logits_processor = [firstWordGuard(moonshineEos), stepRecorder(steps)];
    // Sized on the speech alone: the padding holds nothing to write.
    options.max_new_tokens = moonshineMaxTokens(samples.length);
  }
  const output = (await transcriber(padded(samples), options)) as
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
