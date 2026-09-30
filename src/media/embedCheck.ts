// src/media/embedCheck.ts

// Confirms an embed-fixer mirror really serves a link's media before the bot
// reposts onto it, by fetching the page the way Discord's crawler does and
// then following the media URL the page declares.

import { INSTAGRAM_FRONTENDS, instagramKind } from "@/media/transform";
import { createLogger } from "@/utils/log";

const log = createLogger("media/embedCheck");

/**
 * Discord's crawler user agent. Fixer mirrors serve embed tags only to known
 * bots and redirect everyone else to the platform, so any other UA sees a
 * redirect instead of what Discord will see.
 */
export const DISCORD_UA = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";

/**
 * Budget per mirror, page and media fetch together. A dead mirror fails in
 * well under a second, but a mirror that re-hosts media (ins.so) pulls a large
 * reel from Instagram on its first request, which can take several seconds;
 * after that it is cached, so Discord's own fetch is fast. The prompt waits on
 * the check, so this is kept no longer than that cold fetch needs.
 */
const CHECK_TIMEOUT_MS = 10_000;

/** The fetch signature the check needs, so tests can stand in for the network. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Media a fixer page tells Discord to embed. */
export interface DeclaredMedia {
  url: string;
  kind: "video" | "image";
}

/** What a mirror check found: a reason it cannot embed, or what its embed shows. */
export type MirrorCheck = { problem: string } | { problem: null; showsCaption: boolean };

/**
 * Reads a page's meta tags into a map keyed by lowercased property/name. The
 * first tag wins for a repeated key. Handles either attribute order; content is
 * left HTML-encoded for the caller to decode as far as it needs.
 * @param html - The page body.
 * @returns Content per tag key.
 */
export function readMetaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    // Anchored on whitespace so "data-name=" does not read as "name="
    const key = /\s(?:property|name)\s*=\s*"([^"]+)"/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\scontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (key && content && !tags.has(key)) tags.set(key, content);
  }
  return tags;
}

/**
 * Reads the media a fixer page declares in its meta tags. Video wins over an
 * image, since a video page's og:image is only its thumbnail. Handles relative
 * URLs (InstaFix emits "/videos/<id>/1").
 * @param html - The page body.
 * @param pageUrl - The page's URL, for resolving relative media URLs.
 * @returns The declared media, or `null` when the page declares none.
 */
export function declaredMedia(html: string, pageUrl: string): DeclaredMedia | null {
  const tags = readMetaTags(html);
  const video =
    tags.get("og:video:secure_url") ?? tags.get("og:video") ?? tags.get("twitter:player:stream");
  const image = tags.get("og:image") ?? tags.get("twitter:image");
  const raw = video ?? image;
  if (!raw) return null;
  try {
    return {
      url: new URL(raw.replace(/&amp;/g, "&"), pageUrl).href,
      kind: video ? "video" : "image",
    };
  } catch {
    return null;
  }
}

/**
 * Whether a mirror's embed carries the post's text. Discord shows og:description
 * (or its twitter: twin) as the embed body, so a page without one embeds media
 * alone - ins.so's does.
 * @param html - The page body.
 * @returns True when the page declares a description.
 */
export function pageShowsCaption(html: string): boolean {
  const tags = readMetaTags(html);
  return Boolean(tags.get("og:description") ?? tags.get("twitter:description"));
}

/**
 * Checks one mirror page end to end. Fails when the page errors, bounces to
 * another host (the mirror gave up and sent the crawler to Instagram), declares
 * no media, or declares a video whose URL serves an image or a page instead -
 * the half-scrape where a reel comes back as its cover frame.
 * @param pageUrl - The mirror URL the bot would post.
 * @param fetchImpl - Network stand-in; the global fetch by default.
 * @returns The reason it cannot embed, or whether its embed shows the caption.
 */
export async function checkMirror(
  pageUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<MirrorCheck> {
  const init: RequestInit = {
    headers: { "user-agent": DISCORD_UA },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  };
  const host = (u: string): string => new URL(u).hostname.replace(/^www\./, "");
  try {
    const page = await fetchImpl(pageUrl, init);
    if (!page.ok) return { problem: `page ${page.status}` };
    if (page.url && host(page.url) !== host(pageUrl)) {
      return { problem: `redirected to ${host(page.url)}` };
    }
    const html = await page.text();
    const media = declaredMedia(html, pageUrl);
    if (!media) return { problem: "no media declared" };

    // Only the headers matter; a video body can run to megabytes
    const res = await fetchImpl(media.url, init);
    await res.body?.cancel();
    if (!res.ok) return { problem: `media ${res.status}` };
    // A missing or generic type (octet-stream from some CDNs) is let through:
    // only a type that contradicts the declared kind is proof of a bad embed.
    const family = (res.headers.get("content-type") ?? "").split("/")[0].trim().toLowerCase();
    if (family === "text" || (media.kind === "video" && family === "image")) {
      return { problem: `declared ${media.kind}, served ${res.headers.get("content-type")}` };
    }
    return { problem: null, showsCaption: pageShowsCaption(html) };
  } catch (err) {
    return { problem: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * {@link checkMirror} reduced to its verdict.
 * @param pageUrl - The mirror URL the bot would post.
 * @param fetchImpl - Network stand-in; the global fetch by default.
 * @returns `null` when the mirror embeds, otherwise a short reason for the log.
 */
export async function mirrorProblem(
  pageUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  return (await checkMirror(pageUrl, fetchImpl)).problem;
}

/**
 * Picks the first Instagram mirror that really embeds a link, trying the list
 * for its kind in order (see {@link INSTAGRAM_FRONTENDS}).
 * @param path - The mirror path from instagramPath, e.g. "reel/AbC" or "p/AbC/3".
 * @param fetchImpl - Network stand-in; the global fetch by default.
 * @returns The mirror host and whether its embed shows the caption, or `null`
 * when none of them can embed it.
 */
export async function pickInstagramFrontend(
  path: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ host: string; showsCaption: boolean } | null> {
  for (const host of INSTAGRAM_FRONTENDS[instagramKind(path)]) {
    const check = await checkMirror(`https://${host}/${path}`, fetchImpl);
    if (check.problem === null) return { host, showsCaption: check.showsCaption };
    log.info("instagram mirror skipped", { host, path, problem: check.problem });
  }
  return null;
}
