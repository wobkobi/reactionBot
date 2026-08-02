// src/media/cleanTracking.ts

// Strips known tracking parameters from URLs. Deliberately conservative: only
// unambiguous tracker keys are removed, so functional params (YouTube's v/t,
// Reddit's share ids, Amazon paths) survive.

/** Exact query-param names that are always tracking. */
const TRACKING_PARAMS = new Set([
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
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "vero_id",
  "igsh",
  "igshid",
  "cmpid",
  "s_cid",
]);

/** Param-name prefixes that are always tracking (utm_source, _hsenc, ...). */
const TRACKING_PREFIXES = ["utm_", "oly_", "_hs", "pk_", "mtm_"];

/**
 * Removes known tracking parameters from a URL.
 * @param url - The URL to clean.
 * @returns The cleaned URL, or `null` when nothing was stripped (or the
 * string is not a valid URL).
 */
export function stripTracking(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  let removed = 0;
  for (const key of [...parsed.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p))) {
      parsed.searchParams.delete(key);
      removed++;
    }
  }
  if (removed === 0) return null;

  let out = parsed.toString();
  if (out.endsWith("?")) out = out.slice(0, -1);
  return out;
}
