// src/voice/transcode.ts

// Turns whatever clip files someone dropped in data/sounds into something
// @discordjs/voice can stream with no encoder in the way.
//
// An Ogg Opus file is passed through untouched: StreamType.OggOpus sends its
// pages straight to Discord, so playback needs neither ffmpeg nor an Opus
// encoder. Anything else (mp3, wav, m4a, and Ogg Vorbis, which is a different
// codec in the same container) is converted once with ffmpeg and cached, so the
// cost is paid on the first play of each file and never again.

import { guildDataDir } from "@/utils/file";
import { createLogger } from "@/utils/log";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const log = createLogger("voice/transcode");

/** Folder holding converted clips, beside the originals. */
const CACHE_DIR = path.join(guildDataDir("sounds"), ".cache");

/** Bytes of an Ogg file to read when identifying the codec. */
const HEAD_BYTES = 512;

let ffmpegChecked = false;
let ffmpegOk = false;

/**
 * Detects Opus inside an Ogg container. Ogg holds several codecs, and handing
 * an Ogg Vorbis file to StreamType.OggOpus produces silence rather than an
 * error, so the extension alone cannot be trusted.
 * @param head - The first bytes of the file.
 * @returns `true` when the stream is Opus.
 */
export function hasOpusHead(head: Uint8Array): boolean {
  return Buffer.from(head).includes("OpusHead");
}

/**
 * Builds the ffmpeg arguments that produce a Discord-ready Ogg Opus file.
 * The sample rate and channel count are what Discord expects; getting either
 * wrong plays at the wrong speed instead of failing.
 * @param input - Source file path.
 * @param output - Destination .ogg path.
 * @returns The full argument list.
 */
export function ffmpegArgs(input: string, output: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-vn",
    "-map",
    "a:0",
    "-c:a",
    "libopus",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-b:a",
    "96k",
    "-frame_duration",
    "20",
    "-application",
    "audio",
    output,
  ];
}

/**
 * Names the cached conversion of a source file. Keyed on the path, size and
 * modification time, so replacing a clip with a different file of the same name
 * produces a new cache entry rather than playing the stale one.
 * @param sourcePath - Absolute path of the original clip.
 * @param mtimeMs - The original's modification time.
 * @param size - The original's size in bytes.
 * @returns Absolute path of the cached .ogg.
 */
export function cachedOggPath(sourcePath: string, mtimeMs: number, size: number): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${sourcePath}:${mtimeMs}:${size}`)
    .digest("hex")
    .slice(0, 16);
  return path.join(CACHE_DIR, `${hash}.ogg`);
}

/**
 * Resolves the ffmpeg binary to run.
 * @returns The configured path, or the bare command to find on PATH.
 */
function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

/**
 * Checks once whether ffmpeg can be run at all.
 * @returns `true` when ffmpeg is available.
 */
export async function ffmpegAvailable(): Promise<boolean> {
  if (ffmpegChecked) return ffmpegOk;
  ffmpegChecked = true;
  ffmpegOk = await new Promise<boolean>((resolve) => {
    const proc = spawn(ffmpegBin(), ["-version"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
  if (!ffmpegOk) log.warn("ffmpeg not found, only Ogg Opus clips can play");
  return ffmpegOk;
}

/**
 * Runs one conversion.
 * @param input - Source file path.
 * @param output - Destination .ogg path.
 * @returns `true` when ffmpeg exited cleanly and produced a file.
 */
async function convert(input: string, output: string): Promise<boolean> {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const partial = `${output}.${process.pid}.tmp`;
  const ok = await new Promise<boolean>((resolve) => {
    const proc = spawn(ffmpegBin(), ffmpegArgs(input, partial), { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
  if (!ok || !fs.existsSync(partial)) {
    fs.rmSync(partial, { force: true });
    return false;
  }
  // Rename into place so a killed conversion cannot leave a truncated clip that
  // later looks like a valid cache hit.
  fs.renameSync(partial, output);
  return true;
}

/**
 * Returns a path that is safe to hand to StreamType.OggOpus, converting and
 * caching the file first when it is not already Ogg Opus.
 * @param sourcePath - Absolute path of the clip to play.
 * @returns A playable path, or null when the file cannot be prepared.
 */
export async function ensurePlayableOgg(sourcePath: string): Promise<string | null> {
  const stat = fs.statSync(sourcePath, { throwIfNoEntry: false });
  if (!stat) return null;

  const head = Buffer.alloc(HEAD_BYTES);
  const fd = fs.openSync(sourcePath, "r");
  try {
    fs.readSync(fd, head, 0, HEAD_BYTES, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (hasOpusHead(head)) return sourcePath;

  const cached = cachedOggPath(sourcePath, stat.mtimeMs, stat.size);
  if (fs.existsSync(cached)) return cached;

  if (!(await ffmpegAvailable())) {
    log.warn("clip needs conversion but ffmpeg is unavailable", { sourcePath });
    return null;
  }

  log.info("converting clip to ogg opus", { sourcePath });
  if (!(await convert(sourcePath, cached))) {
    log.warn("clip conversion failed", { sourcePath });
    return null;
  }
  return cached;
}
