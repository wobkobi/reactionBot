// src/utils/log.ts

// Supported log levels
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

// Numeric weights for filtering
const LEVELS: Record<LogLevel, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

// Env-driven defaults
const ENV_LEVEL = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || "info";
const ENV_FORMAT = (process.env.LOG_FORMAT?.toLowerCase() || "pretty") as
  | "pretty"
  | "json";
const MIN_LEVEL = LEVELS[ENV_LEVEL] ?? 30;

/**
 * Creates an ISO-8601 timestamp for log records.
 * @returns Timestamp string in ISO-8601 format.
 */
function fmtTS(): string {
  return new Date().toISOString();
}

/**
 * Serializes a context object into key=value pairs.
 * @param ctx - Additional data to include with the log.
 * @returns Space-delimited key=value string or an empty string when no context is provided.
 */
function flat(ctx?: Record<string, unknown>): string {
  if (!ctx) return "";
  return Object.entries(ctx)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");
}

/**
 * Writes a log line in human-readable format.
 * @param ns - Namespace identifying the subsystem (e.g., "media/repost").
 * @param level - Severity level for the record.
 * @param msg - Message describing the event.
 * @param [ctx] - Optional structured context to append.
 */
function writePretty(
  ns: string,
  level: LogLevel,
  msg: string,
  ctx?: Record<string, unknown>
): void {
  console.log(
    `[${fmtTS()}] ${ns} ${level.toUpperCase()}: ${msg}${ctx ? " " + flat(ctx) : ""}`
  );
}

/**
 * Writes a log line as a single JSON object.
 * @param ns - Namespace identifying the subsystem (e.g., "media/repost").
 * @param level - Severity level for the record.
 * @param msg - Message describing the event.
 * @param [ctx] - Optional structured context merged into the JSON payload.
 */
function writeJson(
  ns: string,
  level: LogLevel,
  msg: string,
  ctx?: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      ts: fmtTS(),
      ns,
      level,
      msg,
      ...(ctx ?? {}),
    })
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
function emit(
  ns: string,
  level: LogLevel,
  msg: string,
  ctx?: Record<string, unknown>
): void {
  if (!shouldLog(level)) return;
  if (ENV_FORMAT === "json") {
    writeJson(ns, level, msg, ctx);
  } else {
    writePretty(ns, level, msg, ctx);
  }
}

export interface Logger {
  fatal: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  debug: (msg: string, ctx?: Record<string, unknown>) => void;
  trace: (msg: string, ctx?: Record<string, unknown>) => void;
}

/**
 * Creates a namespaced logger with level helpers.
 * @param ns - Namespace label to prefix all log entries with.
 * @returns An object with convenience methods for each log level.
 */
export function createLogger(ns: string): Logger {
  return {
    fatal: (msg, ctx) => emit(ns, "fatal", msg, ctx),
    error: (msg, ctx) => emit(ns, "error", msg, ctx),
    warn: (msg, ctx) => emit(ns, "warn", msg, ctx),
    info: (msg, ctx) => emit(ns, "info", msg, ctx),
    debug: (msg, ctx) => emit(ns, "debug", msg, ctx),
    trace: (msg, ctx) => emit(ns, "trace", msg, ctx),
  };
}
