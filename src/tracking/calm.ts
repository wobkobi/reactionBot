// src/tracking/calm.ts

// Calm mode: a per-guild window where replies are suppressed while reactions
// and stat tracking carry on. Started by /calmdown or by a spam escalation, and
// ended by a time limit OR a message count - whichever comes first, so a busy
// channel gets replies back sooner. Persisted, so a restart won't cut it short.
//
// Also home to the guild-wide reply limit: a cap on how many replies the bot
// sends per rolling window across every user, so people taking turns cannot
// each collect a GIF the way the per-user cooldown would allow.

import { loadData, saveData } from "@/utils/file";
import { createLogger } from "@/utils/log";

const log = createLogger("tracking/calm");

/** Storage filename for the calm window and auto-calm settings. */
const CALM_FILE = "calm.json";

/** Default time limit of an automatic calm (after the spam reply). */
export const AUTO_CALM_MS = 5 * 60_000;

/** Default message limit of an automatic calm. */
export const AUTO_CALM_MESSAGES = 20;

/** Default duration for a manual /calmdown without a minutes option. */
export const DEFAULT_CALM_MS = 30 * 60_000;

/** Default cap on replies per {@link REPLY_LIMIT_MS} window, across all users. */
export const REPLY_LIMIT = 1;

/** Default rolling window for the guild-wide reply limit. */
export const REPLY_LIMIT_MS = 2 * 60_000;

interface CalmState {
  /** Epoch ms when calm mode ends; 0 or past = not calm. */
  until: number;
  /** Guild messages left before calm ends; absent = no message limit. */
  messagesLeft?: number;
  /** Guild override for the auto-calm time limit (ms). */
  autoMs?: number;
  /** Guild override for the auto-calm message limit. */
  autoMessages?: number;
  /** Guild override for the reply limit count. */
  limitReplies?: number;
  /** Guild override for the reply limit window (ms). */
  limitMs?: number;
}

// Per guild send times of recent replies, for the reply limit. In memory only:
// a restart forgetting a couple of minutes of history is harmless.
const replyTimes = new Map<string, number[]>();

/**
 * Reads the stored calm state for a guild.
 * @param guildId - Discord guild (server) ID.
 * @returns The stored {@link CalmState} (defaults to not calm).
 */
function readState(guildId: string): CalmState {
  const state = loadData<Partial<CalmState>>(guildId, CALM_FILE, { soft: true });
  return {
    until: state.until ?? 0,
    messagesLeft: state.messagesLeft,
    autoMs: state.autoMs,
    autoMessages: state.autoMessages,
    limitReplies: state.limitReplies,
    limitMs: state.limitMs,
  };
}

/**
 * Persists a partial update to the calm state, preserving the other fields
 * (so ending a window never wipes the guild's auto-calm settings).
 * @param guildId - Discord guild (server) ID.
 * @param patch - Fields to change.
 * @returns The saved {@link CalmState}.
 */
function writeState(guildId: string, patch: Partial<CalmState>): CalmState {
  const next = { ...readState(guildId), ...patch };
  saveData(guildId, CALM_FILE, next);
  return next;
}

/**
 * Resolves the guild's auto-calm limits (settings with built-in defaults).
 * @param guildId - Discord guild (server) ID.
 * @returns The time limit (ms) and message limit for automatic calms.
 */
export function getAutoCalm(guildId: string): { ms: number; messages: number } {
  const state = readState(guildId);
  return { ms: state.autoMs ?? AUTO_CALM_MS, messages: state.autoMessages ?? AUTO_CALM_MESSAGES };
}

/**
 * Stores the guild's auto-calm limits.
 * @param guildId - Discord guild (server) ID.
 * @param ms - Time limit in milliseconds.
 * @param messages - Message limit.
 */
export function setAutoCalm(guildId: string, ms: number, messages: number): void {
  writeState(guildId, { autoMs: ms, autoMessages: messages });
  log.debug("auto-calm settings saved", { guildId, ms, messages });
}

/**
 * Resolves the guild's reply limit (settings with built-in defaults).
 * @param guildId - Discord guild (server) ID.
 * @returns How many replies may go out per rolling window, and the window (ms).
 */
export function getReplyLimit(guildId: string): { replies: number; ms: number } {
  const state = readState(guildId);
  return { replies: state.limitReplies ?? REPLY_LIMIT, ms: state.limitMs ?? REPLY_LIMIT_MS };
}

/**
 * Stores the guild's reply limit.
 * @param guildId - Discord guild (server) ID.
 * @param replies - Replies allowed per window.
 * @param ms - Window length in milliseconds.
 */
export function setReplyLimit(guildId: string, replies: number, ms: number): void {
  writeState(guildId, { limitReplies: replies, limitMs: ms });
  log.debug("reply limit saved", { guildId, replies, ms });
}

/**
 * Decides whether one more reply fits the limit. Pure, so the window maths is
 * testable.
 * @param times - Send times of earlier replies, oldest first.
 * @param now - Current time in epoch ms.
 * @param limit - The guild's reply limit.
 * @param limit.replies - Replies allowed per window.
 * @param limit.ms - Window length in milliseconds.
 * @returns The send times still inside the window, and whether another fits.
 */
export function checkReplyLimit(
  times: number[],
  now: number,
  limit: { replies: number; ms: number },
): { recent: number[]; allowed: boolean } {
  const recent = times.filter((t) => now - t < limit.ms);
  return { recent, allowed: recent.length < limit.replies };
}

/**
 * Claims a slot under the guild's reply limit, recording it when granted.
 * Check and record happen in one synchronous step, so two messages handled
 * concurrently cannot both squeeze into the last slot.
 * @param guildId - Discord guild (server) ID.
 * @returns `true` when the reply may be sent; `false` to stay silent.
 */
export function takeReplySlot(guildId: string): boolean {
  const now = Date.now();
  const { recent, allowed } = checkReplyLimit(
    replyTimes.get(guildId) ?? [],
    now,
    getReplyLimit(guildId),
  );
  if (allowed) recent.push(now);
  replyTimes.set(guildId, recent);
  if (!allowed) log.debug("reply held back by the reply limit", { guildId });
  return allowed;
}

/**
 * Starts (or extends) calm mode for a guild.
 * @param guildId - Discord guild (server) ID.
 * @param durationMs - How long the calm window should last from now.
 * @param messageCap - End early after this many guild messages; omit for a
 * purely time-based window.
 * @returns Epoch ms when the window ends (message cap may end it sooner).
 */
export function startCalm(guildId: string, durationMs: number, messageCap?: number): number {
  const until = Date.now() + durationMs;
  writeState(guildId, { until, messagesLeft: messageCap });
  log.info(
    "calm mode started",
    { guildId, minutes: Math.round(durationMs / 60_000), messageCap },
    { until: new Date(until).toISOString() },
  );
  return until;
}

/**
 * Ends calm mode for a guild immediately.
 * @param guildId - Discord guild (server) ID.
 */
export function stopCalm(guildId: string): void {
  writeState(guildId, { until: 0, messagesLeft: undefined });
  log.debug("calm mode stopped", { guildId });
}

/**
 * Counts a guild message against the calm window's message limit. Call once
 * per incoming guild message; a no-op when calm is off or purely time-based.
 * @param guildId - Discord guild (server) ID.
 */
export function noteMessage(guildId: string): void {
  const state = readState(guildId);
  if (state.until <= Date.now() || state.messagesLeft === undefined) return;
  const messagesLeft = state.messagesLeft - 1;
  if (messagesLeft <= 0) {
    writeState(guildId, { until: 0, messagesLeft: undefined });
    log.info("calm mode ended by message limit", { guildId });
    return;
  }
  writeState(guildId, { messagesLeft });
}

/**
 * Reports the end of the current calm window, if one is active.
 * @param guildId - Discord guild (server) ID.
 * @returns Epoch ms when calm mode ends (the message limit may end it
 * sooner), or null when not calm.
 */
export function calmUntil(guildId: string): number | null {
  const state = readState(guildId);
  return state.until > Date.now() ? state.until : null;
}

/**
 * Checks whether a guild is currently in calm mode.
 * @param guildId - Discord guild (server) ID.
 * @returns `true` while the calm window is active.
 */
export function isCalm(guildId: string): boolean {
  return calmUntil(guildId) !== null;
}
