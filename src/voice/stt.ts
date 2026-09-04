// src/voice/stt.ts

// Parent side of the speech-to-text worker: lifecycle, a bounded job queue, and
// the promise plumbing that turns worker messages back into awaited results.
//
// The queue sheds load rather than growing. If people talk faster than Whisper
// transcribes, the oldest utterance is dropped first, because a sound bite
// fired late is worse than one not fired at all.

import { createLogger } from "@/utils/log";
import { DEFAULT_MODEL, type SttJob, type SttOut } from "@/voice/sttTypes";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const log = createLogger("voice/stt");

/** Utterances allowed to wait for the model before the oldest is dropped. */
export const STT_QUEUE_MAX = 8;

/** Age at which a queued utterance is no longer worth transcribing. */
export const STT_JOB_TTL_MS = 8_000;

/** Delay before retrying a worker that died, and the attempt cap. */
const RESTART_DELAY_MS = 10 * 60_000;
const MAX_RESTARTS = 3;

/** Lifecycle of the transcriber. */
export type SttStatus = "off" | "starting" | "ready" | "unavailable";

/** A queued utterance and the promise waiting on it. */
interface PendingJob {
  id: number;
  samples: Float32Array;
  enqueuedAt: number;
  settle: (text: string | null) => void;
}

let worker: Worker | null = null;
let status: SttStatus = "off";
let restarts = 0;
let nextId = 1;
let inFlight: PendingJob | null = null;
let queue: PendingJob[] = [];

/**
 * Locates the worker module next to this one, matching the extension of
 * whatever form is running: `.ts` under tsx or Node's own type stripping, `.js`
 * once compiled into build/.
 * @param moduleUrl - The calling module's `import.meta.url`.
 * @returns Absolute path to the worker module.
 */
export function resolveWorkerPath(moduleUrl: string): string {
  const here = fileURLToPath(moduleUrl);
  return path.join(path.dirname(here), `whisperWorker${path.extname(here)}`);
}

/**
 * Appends a job, dropping the oldest when the queue is full.
 * @template T - The queued item type.
 * @param pending - The current queue, oldest first.
 * @param job - The job to add.
 * @param max - Maximum queue length.
 * @returns The new queue and anything dropped to make room.
 */
export function enqueueBounded<T>(pending: T[], job: T, max: number): { queue: T[]; dropped: T[] } {
  const next = [...pending, job];
  if (next.length <= max) return { queue: next, dropped: [] };
  return { queue: next.slice(next.length - max), dropped: next.slice(0, next.length - max) };
}

/**
 * Whether a queued job has waited too long to still be worth transcribing.
 * @param enqueuedAt - When the job was queued, epoch ms.
 * @param now - Current time, epoch ms.
 * @param ttlMs - Maximum useful age.
 * @returns `true` when the job should be discarded unheard.
 */
export function isStale(enqueuedAt: number, now: number, ttlMs: number): boolean {
  return now - enqueuedAt >= ttlMs;
}

/**
 * Reports the transcriber's current state.
 * @returns The lifecycle status.
 */
export function sttStatus(): SttStatus {
  return status;
}

/**
 * Reports the model the transcriber loads.
 * @returns The configured checkpoint name.
 */
export function sttModel(): string {
  return process.env.VOICE_MODEL || DEFAULT_MODEL;
}

/**
 * Resolves every waiting job with null, used when the worker goes away.
 */
function drainQueue(): void {
  for (const job of [inFlight, ...queue]) job?.settle(null);
  inFlight = null;
  queue = [];
}

/**
 * Hands the next queued job to the worker, skipping any that went stale while
 * they waited.
 */
function pump(): void {
  if (!worker || status !== "ready" || inFlight) return;
  const now = Date.now();
  while (queue.length > 0) {
    const job = queue.shift()!;
    if (isStale(job.enqueuedAt, now, STT_JOB_TTL_MS)) {
      log.debug("dropped stale utterance", { id: job.id, waitedMs: now - job.enqueuedAt });
      job.settle(null);
      continue;
    }
    inFlight = job;
    const message: SttJob = { type: "job", id: job.id, samples: job.samples };
    // Hold the event loop open only while a transcription is actually running,
    // so an idle worker never keeps the process alive but an in-flight one is
    // not abandoned half-way.
    worker.ref();
    // Transfer rather than copy the samples; a 12s utterance is 768KB.
    worker.postMessage(message, [job.samples.buffer as ArrayBuffer]);
    return;
  }
  worker.unref();
}

/**
 * Handles the worker going away, whether it exited or failed to start. Retries
 * with a long delay a few times, because the usual cause is a transient network
 * failure fetching the model.
 * @param reason - What ended the worker, for the log.
 */
function handleWorkerGone(reason: string): void {
  worker = null;
  drainQueue();
  if (restarts >= MAX_RESTARTS) {
    status = "unavailable";
    log.error("transcriber gave up after repeated failures", { reason, restarts });
    return;
  }
  status = "unavailable";
  restarts += 1;
  log.warn("transcriber stopped, retrying later", { reason, attempt: restarts });
  setTimeout(() => {
    if (status === "unavailable") startStt();
  }, RESTART_DELAY_MS).unref();
}

/**
 * Routes one message from the worker.
 * @param message - The worker's message.
 */
function onMessage(message: SttOut): void {
  switch (message.type) {
    case "ready":
      status = "ready";
      restarts = 0;
      log.info("transcriber ready", { model: message.model });
      pump();
      return;
    case "result":
      if (inFlight?.id === message.id) {
        log.debug("transcribed", { id: message.id, ms: message.ms });
        inFlight.settle(message.text || null);
        inFlight = null;
      }
      pump();
      return;
    case "error":
      if (inFlight?.id === message.id) {
        log.warn("transcription failed", { id: message.id, error: message.message });
        inFlight.settle(null);
        inFlight = null;
      }
      pump();
      return;
    case "fatal":
      log.error("transcriber could not load the model", { error: message.message });
      return;
  }
}

/**
 * Starts the transcriber if it is not already running. Never throws and never
 * blocks: everything else in the bot has to keep working when speech
 * recognition is unavailable.
 */
export function startStt(): void {
  if (worker || status === "starting") return;

  const workerPath = resolveWorkerPath(import.meta.url);
  const model = sttModel();
  const cacheDir = process.env.VOICE_MODEL_DIR || path.join(process.cwd(), "data", "models");

  try {
    status = "starting";
    worker = new Worker(pathToFileURL(workerPath), {
      // Clearing the inherited argv and re-adding tsx only for the .ts form
      // keeps this working under tsx, under Node's own stripping, and compiled.
      execArgv: path.extname(workerPath) === ".ts" ? ["--import", "tsx"] : [],
    });
    worker.on("message", onMessage);
    worker.on("error", (err: unknown) =>
      handleWorkerGone(err instanceof Error ? err.message : String(err)),
    );
    worker.on("exit", (code) => {
      if (status !== "unavailable") handleWorkerGone(`worker exited with code ${code}`);
    });
    worker.unref();
    worker.postMessage({ type: "init", model, cacheDir });
    log.info("transcriber starting", { model, cacheDir });
  } catch (err) {
    handleWorkerGone(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Stops the transcriber and settles anything waiting on it.
 */
export function stopStt(): void {
  status = "off";
  drainQueue();
  void worker?.terminate();
  worker = null;
}

/**
 * Transcribes one utterance.
 * @param samples - Mono 16kHz float samples. The underlying buffer is
 * transferred to the worker, so the caller must not reuse it.
 * @returns The transcript, or null when it was dropped, failed, or the
 * transcriber is unavailable.
 */
export function transcribe(samples: Float32Array): Promise<string | null> {
  if (status === "off") startStt();
  if (status === "unavailable") return Promise.resolve(null);

  return new Promise<string | null>((resolve) => {
    const job: PendingJob = { id: nextId++, samples, enqueuedAt: Date.now(), settle: resolve };
    const { queue: next, dropped } = enqueueBounded(queue, job, STT_QUEUE_MAX);
    queue = next;
    for (const stale of dropped) {
      log.debug("dropped oldest utterance under load", { id: stale.id });
      stale.settle(null);
    }
    pump();
  });
}
