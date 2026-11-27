// src/media/cleanTracking.ts

// Strips known tracking parameters from URLs. Deliberately conservative: only
// unambiguous tracker keys are removed everywhere, and short keys a site could
// mean something by (si, ref, feature) are only removed on the hosts where
// they are known to be share tracking. Functional params (YouTube's v/t,
// Reddit's share ids, Amazon's variant picks) survive.

/** Exact query-param names that are tracking on every site. */
const TRACKING_PARAMS = new Set([
  // Ad click ids
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "wbraid",
  "gbraid",
  "msclkid",
  "yclid",
  "ttclid",
  "twclid",
  "li_fat_id",
  "epik",
  "rdt_cid",
  "sccid",
  "irclickid",
  "rb_clickid",
  "gad_source",
  "gad_campaignid",
  "srsltid",
  // Analytics cross-domain linkers
  "_ga",
  "_gl",
  // Email and marketing platforms
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "vero_id",
  "_kx",
  "ml_subscriber",
  "ml_subscriber_hash",
  "_branch_match_id",
  "_branch_referrer",
  // Share ids
  "igsh",
  "igshid",
  "cmpid",
  "s_cid",
]);

/** Param-name prefixes that are tracking on every site (utm_source, _hsenc, ...). */
const TRACKING_PREFIXES = ["utm_", "oly_", "_hs", "__hs", "hsa_", "pk_", "mtm_"];

/**
 * Extra keys that are only tracking on particular hosts. `host` matches the
 * hostname itself or any subdomain of it.
 */
const HOST_RULES: Array<{
  host: RegExp;
  params: Set<string>;
  prefixes: string[];
  /** Also drop a trailing /ref=... path segment. */
  refSegment?: boolean;
}> = [
  {
    // si = share id, feature = where the share came from, pp = search-click blob
    host: /(?:^|\.)(?:youtube\.com|youtu\.be)$/,
    params: new Set(["si", "feature", "pp"]),
    prefixes: [],
  },
  {
    host: /(?:^|\.)spotify\.com$/,
    params: new Set(["si"]),
    prefixes: [],
  },
  {
    // Search/click bookkeeping only; psc/th pick the product variant and stay
    host: /(?:^|\.)amazon\.(?:com|ca|com\.au|co\.uk|de|fr|it|es|nl|se|pl|co\.jp|in|com\.mx|com\.br|sg|ae|sa|com\.tr)$/,
    params: new Set([
      "ref",
      "ref_",
      "_encoding",
      "qid",
      "sr",
      "crid",
      "sprefix",
      "dib",
      "dib_tag",
      "content-id",
      "linkcode",
      "linkid",
      "camp",
      "creative",
      "creativeasin",
    ]),
    prefixes: ["pd_rd_", "pf_rd_"],
    refSegment: true,
  },
];

/** Amazon's path-embedded tracking segment, as in /dp/B0XXXX/ref=sr_1_1. */
const AMAZON_REF_SEGMENT = /\/ref=[^/?#]*$/;

/**
 * Decodes a query key for comparison, falling back to the raw text when it is
 * not valid percent-encoding.
 * @param raw - The key as it appears in the URL.
 * @returns The lowercased, decoded key.
 */
function decodeKey(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " ")).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/**
 * Removes known tracking parameters from a URL. The query is edited as raw
 * text, segment by segment, so every kept param stays byte-for-byte as the
 * poster had it (no re-encoding through URLSearchParams).
 * @param url - The URL to clean.
 * @param [alsoDrop] - Extra keys to treat as tracking for this call, given
 * the lowercased, decoded key.
 * @returns The cleaned URL, or `null` when nothing was stripped (or the
 * string is not a valid URL).
 */
export function stripTracking(url: string, alsoDrop?: (key: string) => boolean): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const rule = HOST_RULES.find((r) => r.host.test(host));
  const isTracker = (key: string): boolean =>
    TRACKING_PARAMS.has(key) ||
    TRACKING_PREFIXES.some((p) => key.startsWith(p)) ||
    alsoDrop?.(key) === true ||
    (rule !== undefined && (rule.params.has(key) || rule.prefixes.some((p) => key.startsWith(p))));

  // Split into base ? query # fragment. The fragment is kept untouched.
  const hashAt = url.indexOf("#");
  const fragment = hashAt === -1 ? "" : url.slice(hashAt);
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  let base = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? "" : beforeHash.slice(queryAt + 1);

  let removed = 0;
  const kept = query.split("&").filter((segment) => {
    if (segment === "") return false;
    const eq = segment.indexOf("=");
    const key = decodeKey(eq === -1 ? segment : segment.slice(0, eq));
    if (isTracker(key)) {
      removed++;
      return false;
    }
    return true;
  });

  if (rule?.refSegment && AMAZON_REF_SEGMENT.test(base)) {
    base = base.replace(AMAZON_REF_SEGMENT, "");
    removed++;
  }
  if (removed === 0) return null;

  return `${base}${kept.length ? `?${kept.join("&")}` : ""}${fragment}`;
}

/**
 * Share-tracking keys the social platforms (and the fixer mirrors that copy
 * their URLs) add when a post is shared. Short keys like s and t are only safe
 * to drop because these links have a known post shape: on a status link they
 * are always share tokens, never a timestamp or a search.
 */
const SOCIAL_SHARE_PARAMS = new Set([
  // X / Twitter
  "s",
  "t",
  "ref_src",
  "ref_url",
  // Reddit
  "share_id",
  "rdt",
  // TikTok
  "is_from_webapp",
  "sender_device",
  "sender_web_id",
  "web_id",
  "is_copy_url",
  "u_code",
  "preview_pb",
  "tt_from",
  "_r",
  "_t",
  "lang",
  // Facebook
  "mibextid",
  "rdid",
  "sfnsn",
  "__tn__",
  // Threads
  "xmt",
  "slof",
  // Tumblr
  "source",
]);

/**
 * Puts a rewritten social link into one shape, whatever platform or mirror it
 * is on: share and tracking params stripped (functional ones such as
 * Facebook's story_fbid/id and Instagram's img_index stay), no fragment and no
 * trailing slash.
 * @param url - A transformed or already-fixed social link.
 * @returns The normalised link.
 */
export function normaliseSocialLink(url: string): string {
  const cleaned =
    stripTracking(url, (k) => SOCIAL_SHARE_PARAMS.has(k) || k.startsWith("__cft__")) ?? url;
  const hashAt = cleaned.indexOf("#");
  const noHash = hashAt === -1 ? cleaned : cleaned.slice(0, hashAt);
  const queryAt = noHash.indexOf("?");
  const path = queryAt === -1 ? noHash : noHash.slice(0, queryAt);
  const query = queryAt === -1 ? "" : noHash.slice(queryAt);
  // Only a slash after a path segment goes, never the one after the host
  const trimmed = /^https?:\/\/[^/]+\/.+\/$/i.test(path) ? path.slice(0, -1) : path;
  return trimmed + query;
}

/**
 * Trailing characters that are sentence punctuation, markdown or a closing
 * angle bracket, not URL. "_" is left alone: Threads and fixer ids can end in it.
 */
const TRAILING_JUNK = /[.,!?;:'"*~|<>]$/;

/**
 * Trims the punctuation and markdown a URL usually sits next to off its end.
 * A closing ")" is only trimmed when it is unbalanced, so Wikipedia-style
 * /Foo_(bar) links stay whole while "(see https://x.com)" loses its ")".
 * @param url - A URL as it was pulled out of message text.
 * @returns The URL without the trailing junk.
 */
export function trimUrlEnd(url: string): string {
  let out = url;
  for (;;) {
    if (TRAILING_JUNK.test(out)) {
      out = out.slice(0, -1);
      continue;
    }
    if (out.endsWith(")") && out.split(")").length > out.split("(").length) {
      out = out.slice(0, -1);
      continue;
    }
    return out;
  }
}

/**
 * Pulls every http(s) URL out of message text, each passed through
 * {@link trimUrlEnd}.
 * @param content - Raw message text.
 * @returns The URLs in the order they appear.
 */
export function findUrls(content: string): string[] {
  return urlSpans(content).map((s) => s.url);
}

/**
 * Every http(s) URL in message text with where it starts, each passed through
 * {@link trimUrlEnd}. A URL inside another link's query is part of that link's
 * match, never a span of its own.
 * @param content - Raw message text.
 * @returns The URLs and their start offsets, in order.
 */
function urlSpans(content: string): Array<{ url: string; start: number }> {
  // < and > are excluded so <https://...> (embed-suppressed links) come out clean
  return [...content.matchAll(/https?:\/\/[^\s<>]+/g)].map((m) => ({
    url: trimUrlEnd(m[0]),
    start: m.index,
  }));
}

/**
 * Cleans tracking params out of every link in a piece of text. Each link is
 * replaced at its own position, so a copy of it nested in another link's
 * query (a signed redirect's u= value) is left alone.
 * @param content - Text that may hold any number of links.
 * @returns The text with each tracked link replaced by its cleaned form.
 */
export function cleanAllTracking(content: string): string {
  let out = "";
  let at = 0;
  for (const { url, start } of urlSpans(content)) {
    const cleaned = stripTracking(url);
    if (!cleaned) continue;
    out += content.slice(at, start) + cleaned;
    at = start + url.length;
  }
  return out + content.slice(at);
}
