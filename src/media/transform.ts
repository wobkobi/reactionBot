// src/media/transform.ts

/**
 * @file Transforms matched platform URLs to privacy-friendly frontends
 * and rewrites the message content.
 */

import { MediaMatch, RewriteResult } from "@/media/types.js";
import { createLogger } from "@/utils/log.js";

const log = createLogger("media/transform");

/**
 * Embeddable frontend domains per platform. These privacy/embed frontends die
 * or get blocked periodically, so keeping them in one place makes swapping a
 * dead service a one-line change. (Current as of June 2026.)
 */
export const FRONTENDS = {
  tiktok: "tnktok.com", // fxTikTok; "d." prefix = direct video/image embed
  twitter: "fixupx.com", // FxEmbed
  instagram: "vxinstagram.com",
  reddit: "rxddit.com", // fxreddit
  bluesky: "fxbsky.app", // FxEmbed
  threads: "vxthreads.net",
  tumblr: "tpmblr.com", // fxtumblr
} as const;

/**
 * Builds the transformed URL for a given platform match.
 * @param match - The {@link MediaMatch} describing the platform and captures.
 * @returns A transformed URL suitable for reposting.
 */
export function buildTransformedUrl(match: MediaMatch): string {
  const [a, b] = match.captures;
  switch (match.which) {
    case "tiktok-short":
      // a = "vt" | "vm" short host, b = id; "d." = direct embed
      return `https://d.${a}.${FRONTENDS.tiktok}/${b}`;
    case "tiktok-full":
      return `https://d.${FRONTENDS.tiktok}/${a}`;
    case "twitter":
      return `https://${FRONTENDS.twitter}/${a}`;
    case "instagram":
      return `https://${FRONTENDS.instagram}/${a}`;
    case "reddit-comments":
    case "reddit-share":
    case "reddit-short":
      return `https://${FRONTENDS.reddit}/${a}`;
    case "bluesky":
      return `https://${FRONTENDS.bluesky}/${a}`;
    case "threads":
      return `https://${FRONTENDS.threads}/${a}`;
    case "tumblr":
      return `https://${FRONTENDS.tumblr}/${a}`;
    case "tumblr-sub":
      // a = blog subdomain, b = post id (+ optional slug)
      return `https://${a}.${FRONTENDS.tumblr}/post/${b}`;
  }
}

/**
 * Rewrites the original message content by replacing the first matched URL
 * with its transformed counterpart.
 * @param content - Original message content.
 * @param match - The platform match result.
 * @returns A {@link RewriteResult} containing the new URL and full rewritten text.
 */
export function rewriteContent(content: string, match: MediaMatch): RewriteResult {
  const newLink = buildTransformedUrl(match);
  const rewrittenText = content.replace(match.regex, newLink);
  log.debug("rewrote content", { which: match.which, newLink });
  return { newLink, rewrittenText };
}
