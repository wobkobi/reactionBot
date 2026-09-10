// src/utils/log.ts

// Every record is emitted. There is no threshold to configure: a level names
// the line and picks the stream, nothing more. A debug line saying why a clip
// was dropped is then in the log that recorded the drop, rather than behind a
// setting that had to be turned on before the thing worth reading happened.

/** Supported log levels. */
export type LogLevel = "error" | "warn" | "info" | "debug";

// The settings below are read at the point of use rather than captured in a
// module constant. This module is imported by nearly every other one, so a
// constant here would be read before `dotenv.config()` runs in index.ts -
// ESM evaluates imports before the importing module's body - and LOG_FORMAT
// and NO_COLOR could never be set from .env at all.

/**
 * The output format, from LOG_FORMAT.
 * @returns "json" when asked for, otherwise "pretty".
 */
function format(): "pretty" | "json" {
  return process.env.LOG_FORMAT?.toLowerCase() === "json" ? "json" : "pretty";
}

/**
 * Whether to colourise. Only when writing to an interactive terminal, so log
 * files and CI output stay free of ANSI escape codes; NO_COLOR disables it.
 * @returns `true` when output should carry ANSI escapes.
 */
function useColour(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

/** ANSI SGR codes per level (31 = red, 33 = yellow, 32 = green, 90 = grey). */
const LEVEL_COLOUR: Record<LogLevel, string> = {
  error: "31",
  warn: "33",
  info: "32",
  debug: "90",
};

/** ANSI code for dimmed text (namespace and context). */
const DIM = "2";

/**
 * Wraps text in an ANSI colour when colour output is enabled.
 * @param code - ANSI SGR code (e.g. "31" for red).
 * @param text - The text to colourise.
 * @returns The text, optionally wrapped in ANSI escapes.
 */
function colour(code: string, text: string): string {
  return useColour() ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/**
 * Creates an ISO-8601 timestamp for log records.
 * @returns Timestamp string in ISO-8601 format.
 */
function fmtTS(): string {
  return new Date().toISOString();
}

/**
 * Serialises a context object into key=value pairs.
 * @param ctx - Additional data to include with the log.
 * @returns Space-delimited key=value string or an empty string when no context is provided.
 */
function flat(ctx?: Record<string, unknown>): string {
  if (!ctx) return "";
  return Object.entries(ctx)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
}

/**
 * Whether a pretty line should carry its own timestamp. A terminal is someone
 * watching live, where the time is noise. Anything else is a log someone reads
 * later, and `docker logs` only shows the times it recorded when asked with
 * --timestamps, so a container without this has no clock at all.
 * @returns `true` when the timestamp should be printed.
 */
function wantsTimestamp(): boolean {
  return !process.stdout.isTTY;
}

/**
 * Builds a compact, human-readable log line: `level ns msg key=value`.
 * @param ns - Namespace identifying the subsystem (e.g., "media/repost").
 * @param level - Severity level for the record.
 * @param msg - Message describing the event.
 * @param [ctx] - Optional structured context to append.
 * @returns The formatted line.
 */
function prettyLine(
  ns: string,
  level: LogLevel,
  msg: string,
  ctx?: Record<string, unknown>,
): string {
  const stamp = wantsTimestamp() ? colour(DIM, fmtTS()) + " " : "";
  const lvl = colour(LEVEL_COLOUR[level], level.toUpperCase().padEnd(5));
  const tail = ctx ? " " + colour(DIM, flat(ctx)) : "";
  return `${stamp}${lvl} ${colour(DIM, ns)} ${msg}${tail}`;
}

/**
 * Builds a log line as a single JSON object.
 * @param ns - Namespace identifying the subsystem (e.g., "media/repost").
 * @param level - Severity level for the record.
 * @param msg - Message describing the event.
 * @param [ctx] - Optional structured context merged into the JSON payload.
 * @returns The serialised record.
 */
function jsonLine(ns: string, level: LogLevel, msg: string, ctx?: Record<string, unknown>): string {
  return JSON.stringify({ ts: fmtTS(), ns, level, msg, ...(ctx ?? {}) });
}

/**
 * Emits a log record using the configured output format.
 * @param ns - Namespace identifying the subsystem (e.g., "media/repost").
 * @param level - Severity level for the record.
 * @param msg - Message describing the event.
 * @param [ctx] - Optional structured context to include.
 */
function emit(ns: string, level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  const line =
    format() === "json" ? jsonLine(ns, level, msg, ctx) : prettyLine(ns, level, msg, ctx);
  // Problems go to stderr so a collector can tell them apart from ordinary
  // output. Docker tags the two streams separately, and a run that only needs
  // watching for trouble can then read stderr alone.
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/**
 * Reports the logging settings actually in force, so a run can say how it was
 * configured rather than leaving someone to guess.
 * @returns The resolved output format.
 */
export function logSettings(): { format: "pretty" | "json" } {
  return { format: format() };
}

export interface Logger {
  error: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  debug: (msg: string, ctx?: Record<string, unknown>) => void;
}

/**
 * Creates a namespaced logger with level helpers.
 * @param ns - Namespace label to prefix all log entries with.
 * @returns An object with convenience methods for each log level.
 */
export function createLogger(ns: string): Logger {
  return {
    error: (msg, ctx) => emit(ns, "error", msg, ctx),
    warn: (msg, ctx) => emit(ns, "warn", msg, ctx),
    info: (msg, ctx) => emit(ns, "info", msg, ctx),
    debug: (msg, ctx) => emit(ns, "debug", msg, ctx),
  };
}
