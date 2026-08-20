// src/media/types.ts

// Shared types for the media workflow.

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
  | "tumblr-sub"
  | "pre-embedded"
  | "tracking";

/**
 * Grace period setting for auto-approval:
 * - "instant": approve immediately
 * - "disabled": no auto-approval (prompt persists)
 * - number: milliseconds before auto-approval
 */
export type GraceSetting = "instant" | "disabled" | number;

/**
 * How a member wants their own media links handled on a cross-channel move:
 * - "instant": move it straight away, no prompt
 * - "countdown": show a Cancel prompt, and move it when the time runs out
 * - "ask": show a Yes/No prompt, and leave it put on silence
 * - "never": leave it put, without prompting at all
 */
export type MemberMode = "instant" | "countdown" | "ask" | "never";

/** A member's stored choice. `seconds` applies to countdown and ask only. */
export interface MemberPref {
  mode: MemberMode;
  seconds?: number;
}

/** Guild-wide switch and bounds on what members may pick for themselves. */
export interface PersonalLimits {
  enabled: boolean;
  maxSeconds: number;
  allowNever: boolean;
}

/** Stored settings per guild. */
export interface MediaSettings {
  /** Destination channel for reposts; if absent, use source channel. */
  channelId?: string;
  grace?: GraceSetting;
  /** Bounds on member preferences; absent means the defaults in prefs.ts. */
  personal?: PersonalLimits;
}

/** Result of matching a supported link inside content. */
export interface MediaMatch {
  which: ServiceKey;
  /** The regex that matched (kept for replacement). */
  regex: RegExp;
  captures: string[];
  /**
   * Exact matched URL, set on "tracking" matches. Replaced as a literal
   * string instead of via a content-derived regex.
   */
  literal?: string;
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
  /** Running out of time counts as approval. Set by countdown mode. */
  approveOnTimeout: boolean;
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

  /**
   * Ephemeral text answering a click, keyed by button id. Listed buttons reply
   * privately instead of editing the prompt, so the reply survives `autoDelete`.
   */
  privateReplies?: Record<string, string>;
}
