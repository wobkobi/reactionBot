// src/regex.ts
export const TIKTOK_SHORT_REGEX: RegExp =
  /https?:\/\/(?<sub>vt|vm)\.tiktok\.com\/(?<id>[A-Za-z0-9]+)\/?/i;

export const TIKTOK_FULL_REGEX: RegExp =
  /https?:\/\/(?:www\.)?tiktok\.com\/(?<id>@[^/\s]+\/(?:video|photo)\/\d+)/i;

export const TWITTER_X_REGEX: RegExp =
  /https?:\/\/(?:mobile\.)?(?:twitter|x)\.com\/(?<id>(?:[^/\s]+\/status|i\/web\/status)\/\d+)/i;

export const INSTAGRAM_REGEX: RegExp =
  /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/(?<id>(?:p|reel|reels|tv)\/[\w-]+)\/?/i;

export const REDDIT_COMMENTS_REGEX: RegExp =
  /https?:\/\/(?:(?:www|old|new)\.)?reddit\.com\/(?<id>r\/[^/\s]+\/comments\/[a-z0-9]+[^?\s]*)/i;

export const REDDIT_SHARE_REGEX: RegExp =
  /https?:\/\/(?:(?:www|old|new)\.)?reddit\.com\/(?<id>r\/[^/\s]+\/s\/[A-Za-z0-9]+)/i;

export const REDDIT_SHORT_REGEX: RegExp = /https?:\/\/redd\.it\/(?<id>[a-z0-9]+)\/?/i;

export const BLUESKY_REGEX: RegExp =
  /https?:\/\/(?:www\.)?bsky\.app\/(?<id>profile\/[^/\s]+\/post\/[A-Za-z0-9]+)/i;

export const THREADS_REGEX: RegExp =
  /https?:\/\/(?:www\.)?threads\.(?:net|com)\/(?<id>@[^/\s]+\/post\/[A-Za-z0-9_-]+)/i;

export const TUMBLR_REGEX: RegExp =
  /https?:\/\/(?:www\.)?tumblr\.com\/(?<id>[^/\s]+\/\d+(?:\/[^\s?]*)?)/i;

export const TUMBLR_SUB_REGEX: RegExp =
  /https?:\/\/(?!www\.)(?<sub>[a-z0-9-]+)\.tumblr\.com\/post\/(?<id>\d+(?:\/[^\s?]*)?)/i;

// Links already on an embed-fixer frontend (fxtwitter, cunnyx, ddinstagram,
// whichever mirror the poster used). These need no rewriting - they only get
// moved to the media channel. Fixer mirrors come and go, so instead of
// enumerating domains this matches the platform-distinctive PATH SHAPE on any
// domain: /user/status/<digits> is X, /p|reel/<code> is Instagram,
// /@user/post/<id> is Threads, /profile/<handle>/post/<id> is Bluesky,
// /r/<sub>/comments|s/<id> is Reddit, /@user/video|photo/<digits> is TikTok.
// Canonical platform links never reach this regex - matchAny tries it last.
// The second alternative is a small domain list for mirrors whose paths are
// not distinctive (TikTok vm/vt short IDs, Reddit short IDs, Tumblr blogs).
// Captures the whole URL so the transform can return it unchanged.
export const PRE_EMBEDDED_REGEX: RegExp =
  /(?<url>https?:\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}\/(?:i\/web\/status\/\d+|[A-Za-z0-9_]+\/status\/\d+|@[^/\s]+\/(?:video|photo)\/\d+|@[^/\s]+\/post\/[A-Za-z0-9_-]+|(?:p|reel|reels|tv)\/[\w-]+|profile\/[^/\s]+\/post\/[A-Za-z0-9]+|r\/[^/\s]+\/(?:comments|s)\/[a-z0-9]+)\S*|https?:\/\/(?:[a-z0-9-]+\.)*(?:tnktok\.com|vxtiktok\.com|tiktxk\.com|rxddit\.com|vxreddit\.com|tpmblr\.com|fxtumblr\.com)\/[^\s?]\S*)/i;
