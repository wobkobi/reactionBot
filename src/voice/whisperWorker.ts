// src/voice/whisperWorker.ts

// Runs Whisper off the main thread. Inference is CPU-bound and would otherwise
// stall discord.js gateway heartbeats, which drops the bot from voice and then
// from the gateway.
//
// This module is spawned by path, never imported, and must stay self-contained:
// its only runtime imports are node:worker_threads and the dynamically loaded
// transformers package. The sttTypes import is type-only, so it erases and
// never has to resolve at runtime. That keeps the file runnable under tsx,
// under Node's own TypeScript stripping, and as compiled JavaScript.

import type { SttIn, SttOut } from "@/voice/sttTypes";
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

/** The loaded pipeline, or null until init succeeds. */
let transcriber:
  ((audio: Float32Array, options?: Record<string, unknown>) => Promise<unknown>) | null = null;

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
 */
async function init(model: string, cacheDir: string): Promise<void> {
  // A non-literal specifier keeps TypeScript from resolving the package, so the
  // project typechecks and builds with this optional dependency absent.
  const specifier = "@huggingface/transformers";
  const mod = (await import(specifier)) as unknown as TransformersModule;

  mod.env.cacheDir = cacheDir;
  mod.env.allowLocalModels = false;

  transcriber = await mod.pipeline("automatic-speech-recognition", model);
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
  const output = (await transcriber(samples)) as { text?: string } | Array<{ text?: string }>;
  const first = Array.isArray(output) ? output[0] : output;
  post({ type: "result", id, text: (first?.text ?? "").trim(), ms: Date.now() - startedAt });
}

port?.on("message", (message: SttIn) => {
  if (message.type === "init") {
    init(message.model, message.cacheDir).catch((err: unknown) => {
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
