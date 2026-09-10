// src/voice/transcode.ts

// Prepares clip files for playback, converting each one once with ffmpeg and
// caching the result, so only a clip's first play pays for it.
//
// Discord accepts Opus and nothing else, and a file already holding Opus frames
// only needs its container unwrapped - Ogg and WebM both demux straight to
// packets. Asking for a loudness target gives up that shortcut, because
// normalising a clip means re-encoding it. It buys the thing no amount of
// per-file care does: clips that arrive at the same volume as each other, for
// one conversion per clip rather than one per play. Callers that would rather
// have the shortcut than the guarantee pass no target.

import { guildDataDir } from "@/utils/file";
import { createLogger } from "@/utils/log";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const log = createLogger("voice/transcode");

/** Folder holding converted clips, beside the originals. */
const CACHE_DIR = path.join(guildDataDir("sounds"), ".cache");

/**
 * Bytes to read when identifying the codec. Ogg announces itself in the first
 * page, but WebM names its codec in the Tracks element, which sits behind the
 * EBML and Segment headers, so the window has to be wide enough to reach it.
 */
const HEAD_BYTES = 8192;

/** EBML magic, the first four bytes of every Matroska and WebM file. */
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

/**
 * Integrated loudness a trigger clip is normalised to, in LUFS. Below
 * broadcast standard, because a sound bite lands in the middle of a
 * conversation rather than replacing it.
 */
export const TRIGGER_LUFS = -20;

/**
 * Integrated loudness an ambient clip is normalised to, in LUFS. Lower than
 * {@link TRIGGER_LUFS}: nobody asked for it, so it has to sit under the talking
 * rather than alongside it.
 */
export const AMBIENT_LUFS = -26;

/**
 * True peak ceiling, in dBTP. Clips arrive mastered to within a whisker of
 * full scale, and leaving no headroom is what turns a loud clip into a
 * distorted one once Opus has rounded it.
 */
const PEAK_CEILING_DBTP = -1.5;

/**
 * Loudness range passed to loudnorm, in LU. The default of 7 flattens a clip
 * hard enough to hear; 11 keeps some dynamics while still pinning the level.
 */
const LOUDNESS_RANGE_LU = 11;

let ffmpegChecked = false;
let ffmpegOk = false;

/** A container Discord can be handed without transcoding it first. */
export type OpusContainer = "ogg/opus" | "webm/opus";

/**
 * Identifies a container already holding Opus, so it can be played untouched.
 *
 * Both checks require the container's magic bytes as well as the codec marker.
 * The extension proves nothing on its own - Ogg and WebM each carry several
 * codecs, and an Ogg Vorbis file handed to StreamType.OggOpus plays silence
 * rather than failing - while the marker alone could appear anywhere in an
 * unrelated file's bytes.
 * @param head - The first bytes of the file.
 * @returns The container, or null when the file needs converting.
 */
export function detectOpusContainer(head: Uint8Array): OpusContainer | null {
  const buf = Buffer.from(head);
  if (buf.subarray(0, 4).toString("latin1") === "OggS" && buf.includes("OpusHead")) {
    return "ogg/opus";
  }
  // A_OPUS is Matroska's codec id; a WebM holding Vorbis or AAC says otherwise
  // and gets converted like anything else.
  if (EBML_MAGIC.every((byte, i) => buf[i] === byte) && buf.includes("A_OPUS")) {
    return "webm/opus";
  }
  return null;
}

/**
 * Names the loudnorm filter for a target, which doubles as the part of the
 * cache key that says how a clip was converted.
 * @param targetLufs - Integrated loudness to normalise to, in LUFS.
 * @returns The ffmpeg filter string.
 */
export function loudnormFilter(targetLufs: number): string {
  return `loudnorm=I=${targetLufs}:TP=${PEAK_CEILING_DBTP}:LRA=${LOUDNESS_RANGE_LU}`;
}

/**
 * Builds the ffmpeg arguments that produce a Discord-ready Ogg Opus file.
 * The sample rate and channel count are what Discord expects; getting either
 * wrong plays at the wrong speed instead of failing.
 * @param input - Source file path.
 * @param output - Destination .ogg path.
 * @param targetLufs - Integrated loudness to normalise to, in LUFS.
 * @returns The full argument list.
 */
export function ffmpegArgs(input: string, output: string, targetLufs: number): string[] {
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
    // Normalise before the encoder sees it, so the peak ceiling is what Opus
    // rounds rather than something it has already clipped.
    "-af",
    loudnormFilter(targetLufs),
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
    // Name the muxer rather than letting ffmpeg infer it. The output goes to a
    // .tmp path so a killed run cannot leave a half-written clip that later
    // looks like a cache hit, and an unrecognised extension makes ffmpeg refuse
    // the job outright.
    "-f",
    "ogg",
    output,
  ];
}

/**
 * Names the cached conversion of a source file. Keyed on the path, size and
 * modification time, so replacing a clip with a different file of the same name
 * produces a new cache entry rather than playing the stale one.
 *
 * The conversion recipe is in the key as well. Without it, changing a loudness
 * target would leave every clip already in the cache playing at the old level
 * for good, which looks exactly like the change having no effect. It also
 * separates the ambient and trigger copies of a clip used by both.
 * @param sourcePath - Absolute path of the original clip.
 * @param mtimeMs - The original's modification time.
 * @param size - The original's size in bytes.
 * @param targetLufs - Integrated loudness it is normalised to, in LUFS.
 * @returns Absolute path of the cached .ogg.
 */
export function cachedOggPath(
  sourcePath: string,
  mtimeMs: number,
  size: number,
  targetLufs: number,
): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${sourcePath}:${mtimeMs}:${size}:${loudnormFilter(targetLufs)}`)
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
  if (!ffmpegOk) log.warn("ffmpeg not found, no clip can be prepared");
  return ffmpegOk;
}

/**
 * Runs one conversion.
 * @param input - Source file path.
 * @param output - Destination .ogg path.
 * @param targetLufs - Integrated loudness to normalise to, in LUFS.
 * @returns `true` when ffmpeg exited cleanly and produced a file.
 */
async function convert(input: string, output: string, targetLufs: number): Promise<boolean> {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const partial = `${output}.${process.pid}.tmp`;
  const { ok, stderr } = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
    const proc = spawn(ffmpegBin(), ffmpegArgs(input, partial, targetLufs), {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    proc.on("error", (spawnErr) => resolve({ ok: false, stderr: spawnErr.message }));
    proc.on("close", (code) => resolve({ ok: code === 0, stderr: err }));
  });
  if (!ok || !fs.existsSync(partial)) {
    fs.rmSync(partial, { force: true });
    // ffmpeg says exactly what it disliked; without this the only trace is that
    // the clip never plays.
    log.warn("ffmpeg could not convert the clip", {
      input,
      // Collapsed onto one line and capped, so a chatty failure cannot break
      // the log format or flood it.
      ffmpeg: stderr.trim().replace(/\s+/g, " ").slice(0, 400) || "no output",
    });
    return false;
  }
  // Rename into place so a killed conversion cannot leave a truncated clip that
  // later looks like a valid cache hit.
  fs.renameSync(partial, output);
  return true;
}

/** A clip ready to stream, with the container the player should declare. */
export interface Playable {
  path: string;
  container: OpusContainer;
}

/**
 * Prepares a clip for playback, converting and caching it when it needs it.
 *
 * With a loudness target every clip is converted, Opus included: normalising
 * one means re-encoding it, so the container shortcut cannot apply. Without a
 * target, a clip already holding Opus frames is streamed untouched.
 * @param sourcePath - Absolute path of the clip to play.
 * @param targetLufs - Integrated loudness to normalise to, in LUFS, or null to
 * stream an Opus clip as it is.
 * @returns The path to stream and its container, or null when the file cannot
 * be prepared.
 */
export async function ensurePlayable(
  sourcePath: string,
  targetLufs: number | null,
): Promise<Playable | null> {
  const stat = fs.statSync(sourcePath, { throwIfNoEntry: false });
  if (!stat) return null;

  if (targetLufs === null) {
    const head = Buffer.alloc(HEAD_BYTES);
    const fd = fs.openSync(sourcePath, "r");
    let read = 0;
    try {
      read = fs.readSync(fd, head, 0, HEAD_BYTES, 0);
    } finally {
      fs.closeSync(fd);
    }
    const container = detectOpusContainer(head.subarray(0, read));
    if (container) return { path: sourcePath, container };
  }

  const target = targetLufs ?? TRIGGER_LUFS;
  const cached = cachedOggPath(sourcePath, stat.mtimeMs, stat.size, target);
  if (fs.existsSync(cached)) return { path: cached, container: "ogg/opus" };

  if (!(await ffmpegAvailable())) {
    log.warn("clip needs conversion but ffmpeg is unavailable", { sourcePath });
    return null;
  }

  log.info("converting clip to ogg opus", { sourcePath, targetLufs: target });
  if (!(await convert(sourcePath, cached, target))) {
    log.warn("clip conversion failed", { sourcePath });
    return null;
  }
  return { path: cached, container: "ogg/opus" };
}
