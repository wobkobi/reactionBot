// src/media/match.ts

/**
 * @file Detects supported media URLs inside message content.
 */

import { MediaMatch, ServiceKey } from "@/media/types.js";
import {
  BLUESKY_REGEX,
  INSTAGRAM_REGEX,
  REDDIT_COMMENTS_REGEX,
  REDDIT_SHARE_REGEX,
  REDDIT_SHORT_REGEX,
  THREADS_REGEX,
  TIKTOK_FULL_REGEX,
  TIKTOK_SHORT_REGEX,
  TUMBLR_REGEX,
  TUMBLR_SUB_REGEX,
  TWITTER_X_REGEX,
} from "@/regex.js";
import { createLogger } from "@/utils/log.js";

const log = createLogger("media/match");
/**
 * Attempts to find the first supported media URL in the given content.
 * @param content - Raw message text.
 * @returns A {@link MediaMatch} describing the hit, or `null` if none.
 */
export function matchAny(content: string): MediaMatch | null {
  const tries: Array<[ServiceKey, RegExp]> = [
    ["tiktok-short", TIKTOK_SHORT_REGEX],
    ["tiktok-full", TIKTOK_FULL_REGEX],
    ["twitter", TWITTER_X_REGEX],
    ["instagram", INSTAGRAM_REGEX],
    ["reddit-comments", REDDIT_COMMENTS_REGEX],
    ["reddit-share", REDDIT_SHARE_REGEX],
    ["reddit-short", REDDIT_SHORT_REGEX],
    ["bluesky", BLUESKY_REGEX],
    ["threads", THREADS_REGEX],
    ["tumblr-sub", TUMBLR_SUB_REGEX],
    ["tumblr", TUMBLR_REGEX],
  ];
  for (const [which, rx] of tries) {
    const m = rx.exec(content);
    if (m) {
      const hit = { which, regex: rx, captures: m.slice(1) };
      log.debug("matched", { which });
      return hit;
    }
  }
  log.debug("no match");
  return null;
}
