// src/media/transform.ts

/**
 * @file Transforms matched platform URLs to privacy-friendly frontends
 * and rewrites the message content.
 */

import { createLogger } from "../utils/log.js";
import { MediaMatch, RewriteResult } from "./types.js";

const log = createLogger("media/transform");
/**
 * Builds the transformed URL for a given platform match.
 * @param match - The {@link MediaMatch} describing the platform and captures.
 * @returns A transformed URL suitable for reposting.
 */
export function buildTransformedUrl(match: MediaMatch): string {
  const [a, b] = match.captures;
  switch (match.which) {
    case "tiktok-short":
      return `https://vt.vxtiktok.com/${a}`;
    case "tiktok-full":
      return `https://www.vxtiktok.com/${a}`;
    case "twitter":
      return `https://vxtwitter.com/${a}`;
    case "instagram":
      return `https://ddinstagram.com/${a}`;
    case "reddit-comments":
      return `https://libredd.it/${a}`;
    case "reddit-short":
      return `https://libredd.it/comments/${a}`;
    case "reddit-media":
      return a === "v.redd.it"
        ? `https://libredd.it/v/${b}`
        : `https://libredd.it/i/${b}`;
  }
}

/**
 * Rewrites the original message content by replacing the first matched URL
 * with its transformed counterpart.
 * @param content - Original message content.
 * @param match - The platform match result.
 * @returns A {@link RewriteResult} containing the new URL and full rewritten text.
 */
export function rewriteContent(
  content: string,
  match: MediaMatch
): RewriteResult {
  const newLink = buildTransformedUrl(match);
  const rewrittenText = content.replace(match.regex, newLink);
  log.debug("rewrote content", { which: match.which, newLink });
  return { newLink, rewrittenText };
}
