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
