// src/media/instagramCaption.ts

// Author, stats and caption for an Instagram post, read from the link-preview
// tags Instagram serves to crawlers, and formatted as a quote block for the
// repost when the picked mirror's embed shows no text of its own.

import { DISCORD_UA, type FetchLike, readMetaTags } from "@/media/embedCheck";
import { createLogger } from "@/utils/log";
import { escapeMarkdown } from "discord.js";

const log = createLogger("media/instagramCaption");

/** Longest caption shown, in characters, before it is cut with an ellipsis. */
export const CAPTION_MAX_CHARS = 300;

/** Instagram answers a crawler in about half a second; past this, skip the caption. */
const CAPTION_TIMEOUT_MS = 6_000;

/** What Instagram's preview tags say about a post. */
export interface InstagramCaption {
  /** Display name, absent when the account shows only its handle. */
  name?: string;
  handle: string;
  /** Counts as Instagram abbreviates them ("1M", "2,531"). Absent when hidden. */
  likes?: string;
  comments?: string;
  /** The caption, decoded, possibly empty. */
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};

/**
 * Decodes the HTML entities Instagram uses in tag content: numeric ones for
 * every emoji and "@" ("&#x1f36b;", "&#064;") plus the common named few.
 * @param text - Entity-encoded text.
 * @returns The decoded text; unknown or out-of-range entities are left as-is.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1].toLowerCase() === "x";
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Parses Instagram's preview tags. og:description carries everything but the
 * display name, in the shape
 *   1M likes, 2,531 comments - itsmejuliette on September 28, 2026: "caption".
 * where either count drops out when the owner hides it and the caption part
 * is absent on a post without one. The display name comes from og:title
 * ("Juliette Moreno on Instagram: ..."), which starts with "@handle" instead
 * when the account has no display name.
 * @param html - The Instagram page body.
 * @returns The parsed post details, or `null` when the tags are not in that shape.
 */
export function parseInstagramMeta(html: string): InstagramCaption | null {
  const tags = readMetaTags(html);
  const description = decodeEntities(tags.get("og:description") ?? "");
  // The caption's closing quote is optional in case Instagram trims long ones
  const m =
    /^(?:(?<likes>[\d.,]+[KMB]?) likes?, )?(?:(?<comments>[\d.,]+[KMB]?) comments? - )?(?<handle>[\w.]+) on [^:]+?(?:: "(?<text>[\s\S]*?)"?)?\.?\s*$/i.exec(
      description,
    );
  if (!m?.groups) return null;
  const { likes, comments, handle, text } = m.groups;

  const title = decodeEntities(tags.get("og:title") ?? "");
  const name = /^(.+?) on Instagram/.exec(title)?.[1];
  return {
    name: name && !name.startsWith("@") ? name : undefined,
    handle,
    likes,
    comments,
    text: text ?? "",
  };
}

/**
 * Tidies a caption for the quote block: drops the dot-only spacer lines
 * Instagram users put between text and hashtags, collapses runs of blank
 * lines, and cuts it to `maxChars` by code point so an emoji is never split
 * in half.
 * @param text - The decoded caption.
 * @param maxChars - Longest result before the ellipsis.
 * @returns The tidied caption.
 */
export function tidyCaption(text: string, maxChars = CAPTION_MAX_CHARS): string {
  const lines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => !/^\s*[.·•_-]+\s*$/.test(line));
  const tidy = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const chars = [...tidy];
  return chars.length > maxChars
    ? `${chars
        .slice(0, maxChars - 1)
        .join("")
        .trimEnd()}…`
    : tidy;
}

/**
 * Escapes Discord markdown in caption text, and wraps each URL in angle
 * brackets instead so it stays a working link that adds no embed of its own.
 * @param text - Plain caption text.
 * @returns Text safe to drop into a message.
 */
function escapeCaption(text: string): string {
  return text
    .split(/(https?:\/\/\S+)/)
    .map((part, i) =>
      i % 2
        ? `<${part}>`
        : escapeMarkdown(part, {
            heading: true,
            bulletedList: true,
            numberedList: true,
            maskedLink: true,
          }),
    )
    .join("");
}

/**
 * Formats post details as a quote block: a header line with name, handle and
 * counts, then the caption. Every line, blank ones included, starts with ">"
 * so the block never holds a blank line - the edit flow splits the repost at
 * its first blank line, and the caption has to stay on the fixed side of it.
 * @param caption - Parsed post details.
 * @returns The quote block.
 */
export function formatCaption(caption: InstagramCaption): string {
  const handle = `@${escapeMarkdown(caption.handle)}`;
  const who = caption.name ? `**${escapeMarkdown(caption.name)}** (${handle})` : `**${handle}**`;
  const header = [
    who,
    caption.likes && `❤️ ${caption.likes}`,
    caption.comments && `💬 ${caption.comments}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const body = escapeCaption(tidyCaption(caption.text));
  return [header, ...(body ? body.split("\n") : [])]
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

/**
 * Fetches a post's preview tags from Instagram as Discord's crawler, which
 * Instagram answers with the author, counts and caption without a login.
 * @param path - The Instagram path, e.g. "reel/AbC" or "p/AbC".
 * @param fetchImpl - Network stand-in; the global fetch by default.
 * @returns The post details, or `null` when Instagram did not give them.
 */
export async function fetchInstagramCaption(
  path: string,
  fetchImpl: FetchLike = fetch,
): Promise<InstagramCaption | null> {
  try {
    const res = await fetchImpl(`https://www.instagram.com/${path}/`, {
      headers: { "user-agent": DISCORD_UA },
      signal: AbortSignal.timeout(CAPTION_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.debug("instagram caption fetch failed", { path, status: res.status });
      return null;
    }
    return parseInstagramMeta(await res.text());
  } catch (err) {
    log.debug("instagram caption fetch failed", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
