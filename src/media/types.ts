// src/media/types.ts

/**
 * @file Shared types for the media workflow.
 */

import { GuildTextBasedChannel, Message } from "discord.js";

/** Supported media match keys (kept in sync with regex + transform). */
export type ServiceKey =
  | "tiktok-short"
  | "tiktok-full"
  | "twitter"
  | "instagram"
  | "reddit-comments"
  | "reddit-short"
  | "reddit-media";

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
  /** Grace behavior for approval. */
  grace?: GraceSetting;
}

/** Result of matching a supported link inside content. */
export interface MediaMatch {
  which: ServiceKey;
  /** The regex that matched (for replacement). */
  regex: RegExp;
  /** Capture groups extracted from the URL. */
  captures: string[];
}

/** Result of rewriting content containing a matched link. */
export interface RewriteResult {
  /** The single transformed URL for convenience. */
  newLink: string;
  /** The full message text with the original URL replaced. */
  rewrittenText: string;
}

/** Parameters that control the approval prompt at runtime. */
export interface ApprovalPlan {
  /** Whether to auto-approve without asking. */
  autoApprove: boolean;
  /** If set, the prompt auto-closes after this many ms. */
  timeoutMs?: number;
  /** If true, the prompt persists indefinitely (until a click). */
  persistIndefinitely: boolean;
  /** Text shown in the confirmation message. */
  promptText: string;
}

/** Outcome info when posting a repost + optional stub. */
export interface RepostOutcome {
  /** The reposted (or rewritten-in-place) message. */
  moved?: Message<true>;
  /** Optional stub/pointer left in the source channel. */
  stub?: Message<true>;
  /** Convenience link to the moved message (Discord URL). */
  linkUrl?: string;
}

/** Minimal shape for deletion audit entries. */
export interface DeletionLogEntry {
  originalMessageId: string;
  originalChannelId: string;
  repostMessageId: string;
  repostChannelId: string;
  stubMessageId?: string;
  deletedAt: string;
}

/** Narrow Discord channel type used by the workflow. */
export type GChannel = GuildTextBasedChannel;

/**
 * Context passed around the workflow after preflight.
 */
export interface MediaContext {
  message: Message<true>;
  source: GChannel;
  target: GChannel;
  sameChannel: boolean;
  settings: Required<Pick<MediaSettings, "channelId" | "grace">>;
  match: MediaMatch;
  rewrite: RewriteResult;
}

export interface ApprovalOptions {
  /**
   * Message to show above the buttons.
   * Defaults to `"<@user>, proceed?"` where `<@user>` is the author mention.
   */
  prompt?: string;

  /**
   * Grace behavior:
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
