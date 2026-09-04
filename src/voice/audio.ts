// src/voice/audio.ts

// PCM helpers for the voice capture path. Discord delivers 48kHz stereo signed
// 16-bit audio once Opus is decoded; Whisper wants 16kHz mono float samples in
// [-1, 1]. 48000 / 16000 is exactly 3, so the conversion is a clean 3:1
// decimation with a box filter rather than a resampler, which keeps the whole
// step in plain JS and off ffmpeg.

/** Sample rate Discord delivers after Opus decoding. */
export const SOURCE_RATE = 48_000;

/** Sample rate Whisper expects. */
export const TARGET_RATE = 16_000;

/** Exact ratio between the two rates, so decimation needs no interpolation. */
export const DECIMATION = SOURCE_RATE / TARGET_RATE;

/** Channel count Discord delivers. */
export const SOURCE_CHANNELS = 2;

/** Interleaved source samples that collapse into one output sample. */
const GROUP = DECIMATION * SOURCE_CHANNELS;

/** Full-scale magnitude of a signed 16-bit sample. */
const INT16_SCALE = 32_768;

/** Shortest utterance worth transcribing: 400ms at the target rate. */
export const MIN_UTTERANCE_SAMPLES = TARGET_RATE * 0.4;

/** Longest utterance held before flushing: 12s at the target rate. */
export const MAX_UTTERANCE_SAMPLES = TARGET_RATE * 12;

/**
 * Loudness below which an utterance counts as silence. Whisper invents fixed
 * phrases ("Thank you.", "you") when handed near-silent audio, so the gate is
 * cheaper and more reliable than filtering the hallucinations afterwards.
 */
export const SILENCE_RMS = 0.006;

/**
 * Discord's three-byte "I have stopped talking" Opus frame. Decoding it yields
 * a frame of silence, so it is skipped before it reaches the decoder.
 */
const SILENCE_FRAME = [0xf8, 0xff, 0xfe];

/** What to do with a finished utterance. */
export type UtteranceVerdict = "keep" | "too-short" | "silent";

/**
 * Reinterprets a byte buffer of little-endian signed 16-bit samples.
 * Copies rather than aliasing the underlying `ArrayBuffer`: Node hands out
 * Buffers carved from a shared pool, so `byteOffset` is routinely non-zero and
 * is rarely two-byte aligned, which an `Int16Array` view cannot represent.
 * @param buf - Raw PCM bytes, s16le.
 * @returns The samples as an `Int16Array`. A trailing odd byte is dropped.
 */
export function pcmToInt16(buf: Uint8Array): Int16Array {
  const count = buf.length >> 1;
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    const lo = buf[i * 2]!;
    const hi = buf[i * 2 + 1]!;
    // Reassemble little-endian, then sign-extend the 16-bit value.
    const raw = lo | (hi << 8);
    out[i] = raw >= 0x8000 ? raw - 0x10000 : raw;
  }
  return out;
}

/**
 * Converts interleaved 48kHz stereo s16 samples to 16kHz mono floats. Each
 * output sample is the mean of one group of three stereo frames, which
 * downmixes and low-pass filters in the same pass.
 * @param stereo48k - Interleaved L,R samples at the source rate.
 * @returns Mono samples at the target rate, scaled into [-1, 1]. A tail that
 * does not fill a whole group is dropped rather than read past.
 */
export function downsampleToMono16k(stereo48k: Int16Array): Float32Array {
  const groups = Math.floor(stereo48k.length / GROUP);
  const out = new Float32Array(groups);
  for (let g = 0; g < groups; g++) {
    const base = g * GROUP;
    let sum = 0;
    for (let i = 0; i < GROUP; i++) sum += stereo48k[base + i]!;
    out[g] = sum / GROUP / INT16_SCALE;
  }
  return out;
}

/**
 * Joins captured chunks into the single buffer the transcriber takes.
 * @param chunks - Mono float chunks in capture order.
 * @param total - Combined sample count across the chunks.
 * @returns One contiguous buffer holding every sample.
 */
export function concatFloat32(chunks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Measures the root-mean-square level of a buffer, a cheap stand-in for
 * loudness.
 * @param samples - Mono float samples in [-1, 1].
 * @returns The RMS level, 0 for an empty or silent buffer.
 */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Decides whether a finished utterance is worth the cost of transcribing.
 * @param sampleCount - Samples captured at the target rate.
 * @param level - The buffer's RMS level from {@link rms}.
 * @returns `"keep"` when it should be transcribed, otherwise why it was dropped.
 */
export function utteranceVerdict(sampleCount: number, level: number): UtteranceVerdict {
  if (sampleCount < MIN_UTTERANCE_SAMPLES) return "too-short";
  if (level < SILENCE_RMS) return "silent";
  return "keep";
}

/**
 * Recognises Discord's silence frame, which carries no speech and only costs
 * a decode.
 * @param packet - One received Opus packet.
 * @returns `true` when the packet is the silence frame.
 */
export function isSilenceFrame(packet: Uint8Array): boolean {
  return (
    packet.length === SILENCE_FRAME.length && SILENCE_FRAME.every((byte, i) => packet[i] === byte)
  );
}
