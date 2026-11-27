// src/media/transform.ts

// Rewrites matched platform URLs to embed-friendly frontends.

import {
  cleanAllTracking,
  normaliseSocialLink,
  stripTracking,
  trimUrlEnd,
} from "@/media/cleanTracking";
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
  reddit: "vxreddit.com", // rxddit gets blocked by Reddit
  bluesky: "fxbsky.app", // FxEmbed
  threads: "viewthreads.com", // vxthreads.net is dead
  tumblr: "tpmblr.com", // fxtumblr
  facebook: "facebed.com", // Facebed; returns a login-wall stub when it can't scrape
} as const;

/** What an Instagram link points at, which decides the mirrors that can embed it. */
export type InstagramKind = "video" | "post";

/**
 * Instagram mirrors in the order they are tried, per {@link InstagramKind}.
 * These half-work more than the other platforms' frontends - a reel served as
 * its cover image - so each link is checked against them in turn (see
 * embedCheck.ts) and the first whose media is real wins. The first entry is
 * only the link used when no check has run.
 *
 * Ordered by how reliably the media plays. ins.so re-hosts the media itself,
 * so it nearly always works, though its embed carries no caption or author.
 * toinstagram (InstaFix) shows author and caption too, but its scrape often
 * comes back half-empty. vxinstagram 404s on /p/ posts, so it is a video
 * candidate only.
 */
export const INSTAGRAM_FRONTENDS: Record<InstagramKind, readonly string[]> = {
  video: ["ins.so", "toinstagram.com", "vxinstagram.com"],
  post: ["ins.so", "toinstagram.com"],
};

/**
 * Classifies an Instagram path. reel/reels/tv are always video; a /p/ post can
 * be a photo, a carousel or a video, so it goes to the mirrors that handle all three.
 * @param path - The path captured by the Instagram regex, e.g. "reel/AbC".
 * @returns The kind of mirror list to try.
 */
export function instagramKind(path: string): InstagramKind {
  return /^p\//i.test(path) ? "post" : "video";
}

/**
 * The mirror path for an Instagram match, with the carousel slide when the
 * link named one. Mirrors take the slide as a 1-based path segment (/p/X/N),
 * which both InstaFix and ins.so read the same way as Instagram's img_index;
 * ins.so's own ?img_index counts from 0, so the query form is never passed on.
 * Slide 1 is the default and is left off. Reels have no slides.
 * @param captures - The Instagram regex captures: path, then optional slide.
 * @returns The path to append to a mirror host, e.g. "p/AbC/3".
 */
export function instagramPath(captures: string[]): string {
  const [path, slide] = captures;
  return instagramKind(path) === "post" && slide && Number(slide) > 1
    ? `${path}/${Number(slide)}`
    : path;
}

/**
 * Per-poster Twitter/X frontend overrides, keyed by Discord user ID. Anyone
 * not listed gets {@link FRONTENDS}.twitter. cunnyx.com is an FxEmbed mirror,
 * so an override only swaps the domain, not the embed behaviour.
 */
const TWITTER_FRONTEND_OVERRIDES: Record<string, string> = {
  "229791342547566592": "cunnyx.com",
};

/**
 * FxEmbed language segment appended to every X and Bluesky link. FxEmbed only
 * translates when the post's own language differs from this one, so an
 * English post embeds exactly as it would without it and the bot never has
 * to look the language up itself. cunnyx runs the same code, so overrides
 * keep it.
 */
export const FXEMBED_TRANSLATE_TO = "en";

/**
 * The X frontend for a poster: their override from
 * {@link TWITTER_FRONTEND_OVERRIDES}, or the default.
 * @param [authorId] - Discord ID of the poster.
 * @returns The frontend host, e.g. "fixupx.com".
 */
export function twitterFrontendFor(authorId?: string): string {
  return (authorId && TWITTER_FRONTEND_OVERRIDES[authorId]) || FRONTENDS.twitter;
}

/** Every host an X link can be rewritten to, overrides included. */
export const TWITTER_HOSTS: readonly string[] = [
  FRONTENDS.twitter,
  ...new Set(Object.values(TWITTER_FRONTEND_OVERRIDES)),
];

/**
 * Builds the transformed URL for a given platform match. Several platform
 * regexes capture up to the next whitespace, so a "." or ">" sitting against
 * the link would ride along; it is trimmed here, which keeps the Copy reply
 * and the repost to the bare link. Social links are then normalised so every
 * platform comes out in the same shape (see {@link normaliseSocialLink}).
 * @param match - The {@link MediaMatch} describing the platform and captures.
 * @param [authorId] - Discord ID of the poster, used to apply
 * {@link TWITTER_FRONTEND_OVERRIDES}. Omit for the default frontends.
 * @returns A transformed URL suitable for reposting.
 */
export function buildTransformedUrl(match: MediaMatch, authorId?: string): string {
  // A tracking match's capture is already cleaned from a trimmed URL; trimming
  // again would eat path punctuation the query was protecting (/Washington,_D.C.?utm=)
  if (match.which === "tracking") return untrimmedTransformedUrl(match, authorId);
  const link = trimUrlEnd(untrimmedTransformedUrl(match, authorId));
  // Pre-embedded links match by path shape on any domain, so a shop's /p/item
  // can land here; only a known fixer host gets the social share-param rules.
  if (match.which === "pre-embedded" && !isKnownFixerHost(link)) {
    return stripTracking(link) ?? link;
  }
  return normaliseSocialLink(link);
}

/**
 * Embed-fixer hosts whose URLs copy a social platform's, so its share params
 * mean the same there. Holds the bot's own frontends and the common mirrors
 * posters paste themselves.
 */
const KNOWN_FIXER_HOSTS = new Set<string>([
  ...Object.values(FRONTENDS),
  ...INSTAGRAM_FRONTENDS.video,
  ...INSTAGRAM_FRONTENDS.post,
  ...TWITTER_HOSTS,
  "fxtwitter.com",
  "vxtwitter.com",
  "fixvx.com",
  "twittpr.com",
  "ddinstagram.com",
  "kkinstagram.com",
  "instagramez.com",
  "vxtiktok.com",
  "tiktxk.com",
  "rxddit.com",
  "fxtumblr.com",
  "bskx.app",
  "vxthreads.net",
]);

/**
 * Whether a link is on a known embed fixer (or a subdomain of one, as in d.tnktok.com).
 * @param url - The link to check.
 * @returns `true` for a host in {@link KNOWN_FIXER_HOSTS}.
 */
function isKnownFixerHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  for (;;) {
    if (KNOWN_FIXER_HOSTS.has(host)) return true;
    const dot = host.indexOf(".");
    if (dot === -1) return false;
    host = host.slice(dot + 1);
  }
}

/**
 * The per-platform rewrite behind {@link buildTransformedUrl}, before trimming.
 * @param match - The {@link MediaMatch} describing the platform and captures.
 * @param [authorId] - Discord ID of the poster, for per-poster frontends.
 * @returns The transformed URL, possibly with trailing junk.
 */
function untrimmedTransformedUrl(match: MediaMatch, authorId?: string): string {
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
      return `https://${twitterFrontendFor(authorId)}/${a}/${FXEMBED_TRANSLATE_TO}`;
    case "instagram":
      return `https://${match.frontend ?? INSTAGRAM_FRONTENDS[instagramKind(a)][0]}/${instagramPath(match.captures)}`;
    case "reddit-comments":
    case "reddit-share":
    case "reddit-short":
      return `https://${FRONTENDS.reddit}/${a}`;
    case "bluesky":
      return `https://${FRONTENDS.bluesky}/${a}/${FXEMBED_TRANSLATE_TO}`;
    case "threads":
      return `https://${FRONTENDS.threads}/${a}`;
    case "tumblr":
      return `https://${FRONTENDS.tumblr}/${a}`;
    case "tumblr-sub":
      // a = blog subdomain, b = post id (+ optional slug)
      return `https://${a}.${FRONTENDS.tumblr}/post/${b}`;
    case "facebook":
      return `https://${FRONTENDS.facebook}/${a}`;
    case "pre-embedded":
      // Already on a fixer frontend - keep the poster's link; its share
      // junk goes in the normalising pass
      return a;
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
  // The junk trimmed off the link's end ("." closing a sentence, ">" of
  // <link>) was consumed by the match, so it is put back after the new link.
  const insert = (matched: string): string => newLink + matched.slice(trimUrlEnd(matched).length);
  let rewrittenText: string;
  if (match.literal) {
    // Tracking matches: the cleaning pass below replaces every tracked link
    // at its own position, so a copy nested in another link is never hit
    rewrittenText = content;
  } else {
    // Also consume any query/fragment trailing the matched URL - on social
    // links that tail is share-tracking junk (?s=20&t=...) which would
    // otherwise stay glued to the rewritten link.
    const consuming = new RegExp(`${match.regex.source}(?:[?#]\\S*)?`, match.regex.flags);
    rewrittenText = content.replace(consuming, insert);
  }
  // Any other links in the message lose their tracking params too, so a
  // repost never carries the junk forward
  rewrittenText = cleanAllTracking(rewrittenText);
  log.debug("rewrote content", { which: match.which, newLink });
  return { newLink, rewrittenText };
}
