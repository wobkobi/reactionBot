// src/voice/opus.ts

// Opus decoding for received voice packets. mediaplex first, since its
// napi-rs prebuilds compile nothing, then opusscript as a pure-JS fallback.
// With neither, voice switches off and the text side is untouched.
//
// prism-media is avoided: it only knows backends that can demand a C++
// toolchain on Windows.

import { createLogger } from "@/utils/log";

const log = createLogger("voice/opus");

/** The one operation the capture path needs from an Opus backend. */
export interface OpusDecoder {
  decode(packet: Buffer): Uint8Array;
}

/** Constructor shape both backends happen to share. */
type DecoderCtor = new (rate: number, channels: number) => OpusDecoder;

let cached: OpusDecoder | null = null;
let backend: string | null = null;
let attempted = false;

/**
 * Loads an Opus backend, trying the fast one first. The result is cached, including
 * the failure, so a missing package is reported once rather than on every join.
 * @returns A decoder, or null when no backend could be loaded.
 */
export async function loadOpusDecoder(): Promise<OpusDecoder | null> {
  if (attempted) return cached;
  attempted = true;

  // Non-literal specifiers keep TypeScript from resolving these optional
  // packages, so the project typechecks and builds without them installed.
  // mediaplex exports the class as OpusEncoder (it both encodes and decodes);
  // opusscript exports it as the default.
  const candidates = [
    { name: "mediaplex", specifier: "mediaplex", exportName: "OpusEncoder" },
    { name: "opusscript", specifier: "opusscript", exportName: "default" },
  ];

  for (const { name, specifier, exportName } of candidates) {
    try {
      const mod = (await import(specifier)) as Record<string, unknown>;
      const Ctor = mod[exportName] as DecoderCtor | undefined;
      if (typeof Ctor !== "function") continue;
      cached = new Ctor(48_000, 2);
      backend = name;
      log.info("opus decoder loaded", { backend });
      return cached;
    } catch (err) {
      log.debug("opus backend unavailable", {
        backend: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.warn("no opus decoder available, voice listening is off");
  return null;
}

/**
 * Reports which Opus backend is in use.
 * @returns The backend name, or null when none loaded.
 */
export function opusDecoderName(): string | null {
  return backend;
}
