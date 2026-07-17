// src/utils/log.ts

// Supported log levels
export type LogLevel = "error" | "warn" | "info" | "debug";

// Numeric weights for filtering
const LEVELS: Record<LogLevel, number> = {
  error: 40,
  warn: 30,
  info: 20,
  debug: 10,
};

// Env-driven defaults
const ENV_LEVEL = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || "info";
const ENV_FORMAT = (process.env.LOG_FORMAT?.toLowerCase() || "pretty") as "pretty" | "json";
const MIN_LEVEL = LEVELS[ENV_LEVEL] ?? LEVELS.info;

// Colourise pretty output only when writing to an interactive terminal, so log
// files and CI output stay free of ANSI escape codes. Set NO_COLOR to disable.
const USE_COLOUR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

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
  return USE_COLOUR ? `\x1b[${code}m${text}\x1b[0m` : text;
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
 * Writes a compact, human-readable log line: `level ns msg key=value`. No
 * timestamp (the host/process manager adds its own); JSON mode keeps one.
 * @param ns - Namespace identifying the subsystem (e.g., "media/repost").
 * @param level - Severity level for the record.
 * @param msg - Message describing the event.
 * @param [ctx] - Optional structured context to append.
 */
function writePretty(
  ns: string,
  level: LogLevel,
  msg: string,
  ctx?: Record<string, unknown>,
): void {
  const lvl = colour(LEVEL_COLOUR[level], level.toUpperCase().padEnd(5));
  const tail = ctx ? " " + colour(DIM, flat(ctx)) : "";
  console.log(`${lvl} ${colour(DIM, ns)} ${msg}${tail}`);
}

/**
 * Writes a log line as a single JSON object.
 * @param ns - Namespace identifying the subsystem (e.g., "media/repost").
 * @param level - Severity level for the record.
 * @param msg - Message describing the event.
 * @param [ctx] - Optional structured context merged into the JSON payload.
 */
function writeJson(ns: string, level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      ts: fmtTS(),
      ns,
      level,
      msg,
      ...(ctx ?? {}),
    }),
  );
}

/**
 * Determines if a message at the provided level should be emitted.
 * @param level - Severity level to test.
 * @returns True when the level meets the current minimum threshold.
 */
function shouldLog(level: LogLevel): boolean {
  return (LEVELS[level] ?? 0) >= MIN_LEVEL;
}

/**
 * Emits a log record using the configured output format.
 * @param ns - Namespace identifying the subsystem (e.g., "media/repost").
 * @param level - Severity level for the record.
 * @param msg - Message describing the event.
 * @param [ctx] - Optional structured context to include.
 */
function emit(ns: string, level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  if (ENV_FORMAT === "json") {
    writeJson(ns, level, msg, ctx);
  } else {
    writePretty(ns, level, msg, ctx);
  }
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
