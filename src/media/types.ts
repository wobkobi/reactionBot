// src/media/types.ts

/**
 * @file Shared types for the media workflow.
 */

import { Message } from "discord.js";

/** Supported media match keys (kept in sync with regex + transform). */
export type ServiceKey =
  | "tiktok-short"
  | "tiktok-full"
  | "twitter"
  | "instagram"
  | "reddit-comments"
  | "reddit-share"
  | "reddit-short"
  | "bluesky"
  | "threads"
  | "tumblr"
  | "tumblr-sub";

/**
 * Grace period setting for auto-approval:
 * - "instant": approve immediately
 * - "disabled": no auto-approval (prompt persists)
 * - number: milliseconds before auto-approval
 */
export type GraceSetting = "instant" | "disabled" | number;

/** Stored settings per guild. */
export interface MediaSettings {
  /** Destination channel for reposts; if absent, use source channel. */
  channelId?: string;
  grace?: GraceSetting;
}

/** Result of matching a supported link inside content. */
export interface MediaMatch {
  which: ServiceKey;
  /** The regex that matched (kept for replacement). */
  regex: RegExp;
  captures: string[];
}

/** Result of rewriting content containing a matched link. */
export interface RewriteResult {
  /** The transformed URL on its own. */
  newLink: string;
  /** The full message text with the original URL replaced. */
  rewrittenText: string;
}

/** Parameters that control the approval prompt at runtime. */
export interface ApprovalPlan {
  autoApprove: boolean;
  /** If set, the prompt auto-closes after this many ms. */
  timeoutMs?: number;
  persistIndefinitely: boolean;
  promptText: string;
}

/** Outcome of posting a repost + optional source-channel pointer. */
export interface RepostOutcome {
  moved?: Message<true>;
  stub?: Message<true>;
  linkUrl?: string;
}

export interface ApprovalOptions {
  /**
   * Message to show above the buttons.
   * Defaults to `"<@user>, proceed?"` where `<@user>` is the author mention.
   */
  prompt?: string;

  /**
   * Grace behaviour:
   * - `"instant"` auto-approves immediately
   * - `"disabled"` never times out
   * - `number` is a timeout in **milliseconds**
   *
   * Default: `10_000` (10s).
   */
  grace?: GraceSetting;

  /**
   * Remove the prompt message after resolve/timeout.
   * Default: `true` unless `grace === "disabled"`, in which case the message is left visible.
   */
  autoDelete?: boolean;
}
