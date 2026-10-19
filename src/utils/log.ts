// src/utils/log.ts

// A level picks the stream and, against LOG_LEVEL, whether the line is written
// at all. The default is info: debug carries a line per transcription and per
// dropped clip, which buries everything else in a busy call, so it is switched
// on while chasing a misfire rather than left running. Each record also splits
// its fields in two: the context someone reading the feed wants, and detail
// (snowflake IDs, full paths, codec facts) that only prints under debug.

/** Fields attached to a record, written as key=value pairs. */
export type LogFields = Record<string, unknown>;

/** Supported log levels. */
export type LogLevel = "error" | "warn" | "info" | "debug";

/** Numeric weights for the threshold; a record passes at or above LOG_LEVEL's. */
const LEVELS: Record<LogLevel, number> = {
  error: 40,
  warn: 30,
  info: 20,
  debug: 10,
};

// The settings below are read at the point of use rather than captured in a
// module constant. This module is imported by nearly every other one, so a
// constant here would be read before `dotenv.config()` runs in index.ts -
// ESM evaluates imports before the importing module's body - and LOG_LEVEL,
// LOG_FORMAT and NO_COLOR could never be set from .env at all.

/**
 * The lowest level written, from LOG_LEVEL.
 * @returns The level named, or "info" when LOG_LEVEL is unset or not a level.
 */
function minLevel(): LogLevel {
  const named = process.env.LOG_LEVEL?.toLowerCase();
  return named && Object.hasOwn(LEVELS, named) ? (named as LogLevel) : "info";
}

/**
 * The output format, from LOG_FORMAT.
 * @returns "json" when asked for, otherwise "pretty".
 */
function format(): "pretty" | "json" {
  return process.env.LOG_FORMAT?.toLowerCase() === "json" ? "json" : "pretty";
}

/**
 * Whether a record's detail fields print, which only debug asks for.
 * @returns `true` when LOG_LEVEL is debug.
 */
function showDetail(): boolean {
  return minLevel() === "debug";
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

/** A value that can go on the line bare: no whitespace, quote or `=` to misread. */
const BARE = /^[^\s"=]+$/;

/**
 * Writes one field value. Strings and lists of plain values go bare when that
 * reads unambiguously, so `matched=charlie` rather than `matched=["charlie"]`;
 * anything with a space is quoted so `user="vin diesel"` keeps its edges.
 * @param v - The value.
 * @returns The value as it appears after `key=`.
 */
function fmtValue(v: unknown): string {
  if (typeof v === "string") return BARE.test(v) ? v : JSON.stringify(v);
  if (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => ["string", "number", "boolean"].includes(typeof x))
  ) {
    const joined = v.join(",");
    if (BARE.test(joined)) return joined;
  }
  return JSON.stringify(v) ?? String(v);
}

// Looks up a guild's name for the pretty format; nothing until the client is up.
let guildName: (guildId: string) => string | undefined = () => undefined;

/**
 * Lets the pretty format print servers by name. A `guildId` field then reads
 * `guild="Name"`, with the raw ID kept only under debug; an ID the lookup
 * cannot resolve is printed as it is.
 * @param lookup - Resolves a guild ID to its name.
 */
export function nameGuilds(lookup: (guildId: string) => string | undefined): void {
  guildName = lookup;
}

/**
 * Serialises fields into key=value pairs for the pretty format.
 * @param fields - The record's fields, context then detail.
 * @param debug - Whether detail is showing, which keeps raw guild IDs too.
 * @returns Space-delimited key=value pairs, empty when there are none.
 */
function flat(fields: LogFields, debug: boolean): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const name = k === "guildId" && typeof v === "string" ? guildName(v) : undefined;
    if (name !== undefined) {
      parts.push(`guild=${fmtValue(name)}`);
      if (!debug) continue;
    }
    parts.push(`${k}=${fmtValue(v)}`);
  }
  return parts.join(" ");
}

/**
 * Whether a pretty line should carry its own timestamp. LOG_TIMESTAMPS=off is
 * for a host that stamps each line itself, as the TrueNAS log viewer does.
 * Unset, a terminal goes without (someone watching live, where the time is
 * noise) and anything else gets one, since `docker logs` only shows the times
 * it recorded when asked with --timestamps.
 * @returns `true` when the timestamp should be printed.
 */
function wantsTimestamp(): boolean {
  const setting = process.env.LOG_TIMESTAMPS?.toLowerCase();
  if (setting === "off") return false;
  if (setting === "on") return true;
  return !process.stdout.isTTY;
}

/** Namespace column width, so messages start in line for most subsystems. */
const NS_WIDTH = 15;

/**
 * Builds a compact, human-readable log line: `level ns msg key=value`.
 * @param ns - Namespace identifying the subsystem (e.g., "media/repost").
 * @param level - Severity level for the record.
 * @param msg - Message describing the event.
 * @param [ctx] - Fields always written.
 * @param [detail] - Fields written only under debug.
 * @returns The formatted line.
 */
function prettyLine(
  ns: string,
  level: LogLevel,
  msg: string,
  ctx?: LogFields,
  detail?: LogFields,
): string {
  const debug = showDetail();
  const fields = flat({ ...ctx, ...(debug ? detail : undefined) }, debug);
  const stamp = wantsTimestamp() ? colour(DIM, fmtTS()) + " " : "";
  const lvl = colour(LEVEL_COLOUR[level], level.toUpperCase().padEnd(5));
  const tail = fields ? " " + colour(DIM, fields) : "";
  return `${stamp}${lvl} ${colour(DIM, ns.padEnd(NS_WIDTH))} ${msg}${tail}`;
}

/**
 * Builds a log line as a single JSON object. Detail is always included: JSON
 * is for something querying the logs, which has no use for a shorter line.
 * @param ns - Namespace identifying the subsystem (e.g., "media/repost").
 * @param level - Severity level for the record.
 * @param msg - Message describing the event.
 * @param [ctx] - Fields merged into the JSON payload.
 * @param [detail] - Further fields merged in after them.
 * @returns The serialised record.
 */
function jsonLine(
  ns: string,
  level: LogLevel,
  msg: string,
  ctx?: LogFields,
  detail?: LogFields,
): string {
  return JSON.stringify({ ts: fmtTS(), ns, level, msg, ...ctx, ...detail });
}

/**
 * Emits a log record using the configured output format.
 * @param ns - Namespace identifying the subsystem (e.g., "media/repost").
 * @param level - Severity level for the record.
 * @param msg - Message describing the event.
 * @param [ctx] - Fields always written.
 * @param [detail] - Fields written only under debug, or always as JSON.
 */
function emit(ns: string, level: LogLevel, msg: string, ctx?: LogFields, detail?: LogFields): void {
  if (LEVELS[level] < LEVELS[minLevel()]) return;
  const line =
    format() === "json"
      ? jsonLine(ns, level, msg, ctx, detail)
      : prettyLine(ns, level, msg, ctx, detail);
  // Problems go to stderr so a collector can tell them apart from ordinary
  // output. Docker tags the two streams separately, and a run that only needs
  // watching for trouble can then read stderr alone.
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/**
 * Reports the logging settings actually in force, so a run can say how it was
 * configured rather than leaving someone to guess.
 * @returns The resolved threshold and output format.
 */
export function logSettings(): { level: LogLevel; format: "pretty" | "json" } {
  return { level: minLevel(), format: format() };
}

/** Writes one record: a message, its context, and detail only debug shows. */
type LogMethod = (msg: string, ctx?: LogFields, detail?: LogFields) => void;

export interface Logger {
  error: LogMethod;
  warn: LogMethod;
  info: LogMethod;
  debug: LogMethod;
}

/**
 * Creates a namespaced logger with level helpers.
 * @param ns - Namespace label to prefix all log entries with.
 * @returns An object with convenience methods for each log level.
 */
export function createLogger(ns: string): Logger {
  return {
    error: (msg, ctx, detail) => emit(ns, "error", msg, ctx, detail),
    warn: (msg, ctx, detail) => emit(ns, "warn", msg, ctx, detail),
    info: (msg, ctx, detail) => emit(ns, "info", msg, ctx, detail),
    debug: (msg, ctx, detail) => emit(ns, "debug", msg, ctx, detail),
  };
}
