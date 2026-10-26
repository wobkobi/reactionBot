// src/voice/stt.ts

// Parent side of the speech-to-text worker: lifecycle, a bounded job queue, and
// the promise plumbing that turns worker messages back into awaited results.
//
// The queue sheds load rather than growing. If people talk faster than Whisper
// transcribes, the oldest utterance is dropped first, because a sound bite
// fired late is worse than one not fired at all.

import { createLogger } from "@/utils/log";
import {
  DEFAULT_MODEL,
  type HeardWord,
  type SttInit,
  type SttJob,
  type SttOut,
} from "@/voice/sttTypes";
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
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
  settle: (transcript: Transcript | null) => void;
}

/** A finished transcription: the text, and the same words with their confidence. */
export interface Transcript {
  text: string;
  words: HeardWord[];
  /** How long the model itself took, without the wait in the queue. */
  ms: number;
}

/**
 * How sure the model was of the words that fired a trigger, for the trigger
 * log. Each matched word is looked up among the heard ones by its letters
 * alone, so "China," still finds "china". A word heard more than once counts
 * at its surest, since any one of them would have fired it; across several
 * matched words, or the parts of a phrase, the least sure decides, since the
 * match needed all of them.
 * @param matched - The words that fired, as the trigger matcher reports them.
 * @param words - The transcript's words with their confidence.
 * @returns The confidence, or null when none of the matched words was found.
 */
export function matchConfidence(matched: string[], words: HeardWord[]): number | null {
  const letters = (word: string): string => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const best = new Map<string, number>();
  for (const { word, confidence } of words) {
    const key = letters(word);
    if (key) best.set(key, Math.max(best.get(key) ?? 0, confidence));
  }
  let least: number | null = null;
  for (const part of matched.flatMap((word) => word.split(/\s+/)).map(letters)) {
    const found = best.get(part);
    if (found !== undefined) least = Math.min(least ?? 1, found);
  }
  // Two places is all a threshold could ever be set to, and it keeps the log
  // line from printing sixteen digits.
  return least === null ? null : Math.round(least * 100) / 100;
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
 * Sizes Whisper's thread pool to a container CPU limit. onnxruntime takes one
 * thread per physical core and never looks at the limit, so under a cap its
 * threads can spend the whole quota between them, and the kernel then pauses
 * every thread in the container, clip playback included, until the next
 * period. One CPU of the limit is left to the rest of the bot for that reason.
 * @param cpuMax - cgroup v2's cpu.max: "<quota> <period>" in microseconds, or
 * "max <period>" when there is no limit. Null when it could not be read.
 * @param machineCpus - Logical CPUs on the machine, from os.cpus(). Not
 * availableParallelism(): Node folds the cgroup quota into that, so under a
 * limit of 4 it reads 4 and the limit looks as big as the machine.
 * @returns The thread count, or undefined to keep onnxruntime's default.
 */
export function whisperThreads(cpuMax: string | null, machineCpus: number): number | undefined {
  const [quota, period] = (cpuMax ?? "").trim().split(/\s+/).map(Number);
  // "max" parses to NaN and an empty file to 0: both mean no limit.
  if (!quota || !period) return undefined;
  const limit = quota / period;
  // A limit as big as the machine is no limit, and the default already fits it.
  if (limit >= machineCpus) return undefined;
  return Math.max(1, Math.floor(limit) - 1);
}

/**
 * Reads the container's CPU limit.
 * @returns The contents of cgroup v2's cpu.max, or null where there is none to
 * read: Windows, macOS, or a host still on cgroup v1.
 */
function readCpuMax(): string | null {
  try {
    return readFileSync("/sys/fs/cgroup/cpu.max", "utf8");
  } catch {
    return null;
  }
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
        inFlight.settle(
          message.text ? { text: message.text, words: message.words, ms: message.ms } : null,
        );
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
  const threads = whisperThreads(readCpuMax(), cpus().length);

  try {
    status = "starting";
    const started = new Worker(pathToFileURL(workerPath), {
      // Clearing the inherited argv and re-adding tsx only for the .ts form
      // keeps this working under tsx, under Node's own stripping, and compiled.
      execArgv: path.extname(workerPath) === ".ts" ? ["--import", "tsx"] : [],
    });
    worker = started;
    started.on("message", onMessage);
    // A worker that stopStt let go has not failed: its exit is the terminate
    // landing, and reading it as a crash would schedule a restart.
    started.on("error", (err: unknown) => {
      if (worker === started) handleWorkerGone(err instanceof Error ? err.message : String(err));
    });
    started.on("exit", (code) => {
      if (worker === started && status !== "unavailable") {
        handleWorkerGone(`worker exited with code ${code}`);
      }
    });
    started.unref();
    const init: SttInit = { type: "init", model, cacheDir, threads };
    started.postMessage(init);
    log.info("transcriber starting", { model, threads: threads ?? "default" }, { cacheDir });
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
 * @returns The transcript, or null when it was dropped, failed, came back
 * empty, or the transcriber is unavailable.
 */
export function transcribe(samples: Float32Array): Promise<Transcript | null> {
  if (status === "off") startStt();
  if (status === "unavailable") return Promise.resolve(null);

  return new Promise<Transcript | null>((resolve) => {
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
