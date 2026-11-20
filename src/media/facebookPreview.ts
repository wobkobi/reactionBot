// src/media/facebookPreview.ts

// Fallback preview for Facebook links Facebed cannot scrape (Marketplace
// listings, some share links). Facebook hands Discord's servers a login wall
// for these, but answers the bot's own host with the real preview tags, so the
// bot reads them itself and posts the embed Discord could not build.

import { DISCORD_UA, type FetchLike, readMetaTags } from "@/media/embedCheck";
import { decodeEntities, tidyCaption } from "@/media/instagramCaption";
import { createLogger } from "@/utils/log";
import { EmbedBuilder } from "discord.js";

const log = createLogger("media/facebookPreview");

/** Facebook answers in about a second; past this, give up on the preview. */
const PREVIEW_TIMEOUT_MS = 8_000;

/** Facebook's blue, so the embed reads as a Facebook card. */
const FACEBOOK_COLOUR = 0x1877f2;

/** Embed descriptions are capped by Discord at 4096; listings rarely need more than this. */
const DESCRIPTION_MAX_CHARS = 500;

/** The og:title Facebook serves in place of the real one when it wants a login. */
const LOGIN_WALL_TITLE = /^log in or sign up/i;

/** What Facebook's preview tags say about a post or listing. */
export interface FacebookPreview {
  title: string;
  /** Canonical URL, e.g. the marketplace/item URL a share link resolves to. */
  url: string;
  description?: string;
  image?: string;
}

/**
 * Parses Facebook's preview tags. The login-wall page carries a title too, so
 * that title is rejected rather than trusted.
 * @param html - The Facebook page body.
 * @returns The preview, or `null` when the page is the login wall or has no title.
 */
export function parseFacebookPreview(html: string): FacebookPreview | null {
  const tags = readMetaTags(html);
  const get = (key: string): string | undefined => {
    const raw = tags.get(key);
    return raw ? decodeEntities(raw).trim() || undefined : undefined;
  };
  const title = get("og:title") ?? get("twitter:title");
  const url = get("og:url");
  if (!title || !url || LOGIN_WALL_TITLE.test(title)) return null;
  return {
    title,
    url,
    description: get("og:description") ?? get("twitter:description"),
    image: get("og:image") ?? get("twitter:image"),
  };
}

/**
 * Fetches a Facebook link's preview tags as Discord's crawler would.
 * @param path - The path matched by FACEBOOK_REGEX, e.g. "share/1JrESB2tuM".
 * @param fetchImpl - Network stand-in; the global fetch by default.
 * @returns The preview, or `null` when Facebook gave a login wall or failed.
 */
export async function fetchFacebookPreview(
  path: string,
  fetchImpl: FetchLike = fetch,
): Promise<FacebookPreview | null> {
  try {
    const res = await fetchImpl(`https://www.facebook.com/${path}`, {
      headers: { "user-agent": DISCORD_UA },
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.debug("facebook preview fetch failed", { path, status: res.status });
      return null;
    }
    return parseFacebookPreview(await res.text());
  } catch (err) {
    log.debug("facebook preview fetch failed", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Builds the Discord embed for a preview. Long descriptions are cut, and an
 * image URL that is not http(s) is dropped since Discord rejects the embed.
 * @param preview - Parsed preview tags.
 * @returns The embed to post.
 */
export function buildFacebookEmbed(preview: FacebookPreview): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(FACEBOOK_COLOUR)
    .setAuthor({ name: "Facebook" })
    .setTitle(preview.title.slice(0, 256))
    .setURL(preview.url);
  if (preview.description) {
    embed.setDescription(tidyCaption(preview.description, DESCRIPTION_MAX_CHARS));
  }
  if (preview.image && /^https?:\/\//i.test(preview.image)) embed.setImage(preview.image);
  return embed;
}
