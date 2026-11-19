// src/media/embedStyle.ts

// Embed-style options a poster can switch their moved link between. Each
// frontend family reads its mode off the link itself (a subdomain flag, and
// for FxEmbed a language segment), so the current style is parsed back out of
// the posted URL and nothing extra is stored per post.

import {
  FRONTENDS,
  FXEMBED_TRANSLATE_TO,
  TWITTER_HOSTS,
  twitterFrontendFor,
} from "@/media/transform";

/** Frontend families with switchable styles. */
export type StyleFamily = "x" | "bluesky" | "tiktok";

/** One choice in the style menu. `value` is the subdomain flag, "" for none. */
export interface StyleOption {
  value: string;
  label: string;
  description: string;
}

/**
 * FxEmbed's subdomain flags (fixupx, fxbsky). The cunnyx mirror serves none
 * of them, so a cunnyx link that leaves the full embed moves to fixupx.
 */
const FXEMBED_STYLES: readonly StyleOption[] = [
  { value: "", label: "Full embed", description: "Text, media and author" },
  { value: "g", label: "Media only", description: "Media and author, no text" },
  { value: "t", label: "Text only", description: "No photos or videos" },
  { value: "m", label: "Combined images", description: "Several images stitched into one" },
  { value: "d", label: "Direct media", description: "Just the file, no embed card" },
  {
    value: "o",
    label: "Old embed",
    description: "Discord's older style, for videos that won't play",
  },
];

/**
 * fxTikTok's subdomain flags. Direct and caption can't be combined, so they
 * are one choice; high quality is the separate toggle.
 */
const TIKTOK_STYLES: readonly StyleOption[] = [
  { value: "d", label: "Video only", description: "Just the video" },
  { value: "a", label: "With caption", description: "Adds the caption Discord hides on videos" },
  { value: "", label: "Full embed", description: "Author, caption and stats" },
];

/**
 * The style menu for a family.
 * @param family - The link's frontend family.
 * @returns The choices, in menu order.
 */
export function styleOptions(family: StyleFamily): readonly StyleOption[] {
  return family === "tiktok" ? TIKTOK_STYLES : FXEMBED_STYLES;
}

/**
 * Label for a family's on/off switch, shown on its button.
 * @param family - The link's frontend family.
 * @returns The switch's name.
 */
export function toggleLabel(family: StyleFamily): string {
  return family === "tiktok" ? "High quality" : "Translate to English";
}

/** A styled frontend link found in a post, split into its parts. */
export interface StyledLink {
  /** The URL exactly as it appears in the post. */
  url: string;
  family: StyleFamily;
  /** The active style flag, "" for the full embed. */
  style: string;
  /** Translation (FxEmbed) or high quality (TikTok). */
  toggle: boolean;
  /** Path after the host, without the language segment, e.g. "u/status/1". */
  path: string;
}

/**
 * Splits a hostname into its flag labels and the frontend it sits on, when it
 * is one of the styled frontends.
 * @param hostname - e.g. "hq.a.tnktok.com".
 * @returns The family, base host and flag labels, or `null` for other hosts.
 */
function splitHost(hostname: string): { family: StyleFamily; flags: string[] } | null {
  const bases: Array<[StyleFamily, string]> = [
    ...TWITTER_HOSTS.map((h): [StyleFamily, string] => ["x", h]),
    ["bluesky", FRONTENDS.bluesky],
    ["tiktok", FRONTENDS.tiktok],
  ];
  for (const [family, base] of bases) {
    if (hostname === base) return { family, flags: [] };
    if (hostname.endsWith(`.${base}`)) {
      return { family, flags: hostname.slice(0, -base.length - 1).split(".") };
    }
  }
  return null;
}

/**
 * Finds the first link in a post that sits on a styled frontend and reads its
 * current style. A link with flags the menu doesn't offer is skipped, so the
 * menu never misreports what the post shows.
 * @param text - The moved post's text.
 * @returns The link and its style, or `null` when the post has none.
 */
export function findStyledLink(text: string): StyledLink | null {
  for (const [url] of text.matchAll(/https?:\/\/\S+/g)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    const host = splitHost(parsed.hostname.toLowerCase());
    if (!host) continue;
    const segments = parsed.pathname.split("/").filter(Boolean);

    if (host.family === "tiktok") {
      const toggle = host.flags.includes("hq");
      const rest = host.flags.filter((f) => f !== "hq");
      const style = rest[0] ?? "";
      if (rest.length > 1 || !TIKTOK_STYLES.some((o) => o.value === style)) continue;
      return { url, family: "tiktok", style, toggle, path: segments.join("/") };
    }

    const style = host.flags[0] ?? "";
    if (host.flags.length > 1 || !FXEMBED_STYLES.some((o) => o.value === style)) continue;
    const toggle = segments.at(-1) === FXEMBED_TRANSLATE_TO;
    if (toggle) segments.pop();
    return { url, family: host.family, style, toggle, path: segments.join("/") };
  }
  return null;
}

/**
 * Builds the link for a chosen style. An X link on the full embed goes back
 * to the poster's own frontend (their cunnyx override, say); any other style
 * needs fixupx, the only X frontend serving the flags.
 * @param link - The link as found by {@link findStyledLink}.
 * @param style - The style flag to switch to, "" for the full embed.
 * @param toggle - Whether translation (FxEmbed) or high quality (TikTok) is on.
 * @param [authorId] - Discord ID of the poster, for their X frontend.
 * @returns The new URL.
 */
export function buildStyledUrl(
  link: StyledLink,
  style: string,
  toggle: boolean,
  authorId?: string,
): string {
  if (link.family === "tiktok") {
    const host = [toggle ? "hq" : "", style, FRONTENDS.tiktok].filter(Boolean).join(".");
    return `https://${host}/${link.path}`;
  }
  const base =
    link.family === "bluesky"
      ? FRONTENDS.bluesky
      : style
        ? FRONTENDS.twitter
        : twitterFrontendFor(authorId);
  const host = style ? `${style}.${base}` : base;
  return `https://${host}/${link.path}${toggle ? `/${FXEMBED_TRANSLATE_TO}` : ""}`;
}
