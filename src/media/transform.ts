// src/media/transform.ts

// Rewrites matched platform URLs to embed-friendly frontends.

import { stripTracking } from "@/media/cleanTracking";
import { MediaMatch, RewriteResult } from "@/media/types";
import { createLogger } from "@/utils/log";

const log = createLogger("media/transform");

/**
 * Embeddable frontend domains per platform. These privacy/embed frontends die
 * or get blocked periodically, so keeping them in one place makes swapping a
 * dead service a one-line change. (Current as of July 2026.)
 */
export const FRONTENDS = {
  tiktok: "tnktok.com", // fxTikTok; "d." prefix = direct video/image embed
  twitter: "fixupx.com", // FxEmbed
  instagram: "toinstagram.com", // InstaFix; vxinstagram 404s on posts
  reddit: "vxreddit.com", // rxddit gets blocked by Reddit
  bluesky: "fxbsky.app", // FxEmbed
  threads: "viewthreads.com", // vxthreads.net is dead
  tumblr: "tpmblr.com", // fxtumblr
} as const;

/**
 * Per-poster Twitter/X frontend overrides, keyed by Discord user ID. Anyone
 * not listed gets {@link FRONTENDS}.twitter. cunnyx.com is an FxEmbed mirror,
 * so an override only swaps the domain, not the embed behaviour.
 */
const TWITTER_FRONTEND_OVERRIDES: Record<string, string> = {
  "229791342547566592": "cunnyx.com",
};

/**
 * Builds the transformed URL for a given platform match.
 * @param match - The {@link MediaMatch} describing the platform and captures.
 * @param [authorId] - Discord ID of the poster, used to apply
 * {@link TWITTER_FRONTEND_OVERRIDES}. Omit for the default frontends.
 * @returns A transformed URL suitable for reposting.
 */
export function buildTransformedUrl(match: MediaMatch, authorId?: string): string {
  const [a, b] = match.captures;
  switch (match.which) {
    case "tiktok-short":
      // b = short id. fxTikTok resolves a bare short id on its own "d." host,
      // and the vt/vm subdomain must be dropped rather than kept: nesting it
      // (d.vt.tnktok.com) is two levels deep and does not resolve.
      return `https://d.${FRONTENDS.tiktok}/${b}`;
    case "tiktok-full":
      return `https://d.${FRONTENDS.tiktok}/${a}`;
    case "twitter":
      return `https://${(authorId && TWITTER_FRONTEND_OVERRIDES[authorId]) || FRONTENDS.twitter}/${a}`;
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
    case "pre-embedded":
      // Already on a fixer frontend - keep the poster's link, minus any
      // tracking params it carries
      return stripTracking(a) ?? a;
    case "tracking":
      // a = the URL with its tracking params already stripped (see matchAny)
      return a;
  }
}

/**
 * Rewrites the original message content by replacing the first matched URL
 * with its transformed counterpart.
 * @param content - Original message content.
 * @param match - The platform match result.
 * @param [authorId] - Discord ID of the poster, passed through to
 * {@link buildTransformedUrl} for per-poster frontend overrides.
 * @returns A {@link RewriteResult} containing the new URL and full rewritten text.
 */
export function rewriteContent(
  content: string,
  match: MediaMatch,
  authorId?: string,
): RewriteResult {
  const newLink = buildTransformedUrl(match, authorId);
  // Inserted through a function, never as a replacement string: "$&", "$'" and
  // "$1" are substitution patterns there, and the link carries whatever the
  // poster's URL path held, so a "$" in it would rewrite to something else.
  const insert = (): string => newLink;
  let rewrittenText: string;
  if (match.literal) {
    // Tracking matches carry the exact URL - replace it as a plain string.
    rewrittenText = content.replace(match.literal, insert);
  } else {
    // Also consume any query/fragment trailing the matched URL - on social
    // links that tail is share-tracking junk (?s=20&t=...) which would
    // otherwise stay glued to the rewritten link.
    const consuming = new RegExp(`${match.regex.source}(?:[?#]\\S*)?`, match.regex.flags);
    rewrittenText = content.replace(consuming, insert);
  }
  log.debug("rewrote content", { which: match.which, newLink });
  return { newLink, rewrittenText };
}
