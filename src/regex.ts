// src/regex.ts
export const TIKTOK_SHORT_REGEX: RegExp =
  /https?:\/\/(?:(?:vt|vm)\.tiktok\.com)\/(?<id>[A-Za-z0-9]+)\/?/i;

export const TIKTOK_FULL_REGEX: RegExp =
  /https?:\/\/(?:www\.)?tiktok\.com\/(?<id>@[^/\s]+\/(?:video|photo)\/\d+)/i;

export const TWITTER_X_REGEX: RegExp =
  /https?:\/\/(?:mobile\.)?(?:twitter|x)\.com\/(?<id>(?:[^/\s]+\/status|i\/web\/status)\/\d+)/i;

export const INSTAGRAM_REGEX: RegExp =
  /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/(?<id>(?:p|reel|tv)\/[\w-]+)\/?/i;

export const REDDIT_COMMENTS_REGEX: RegExp =
  /https?:\/\/(?:(?:www|old|new)\.)?reddit\.com\/(?<id>r\/[^/\s]+\/comments\/[a-z0-9]+[^?\s]*)/i;

export const REDDIT_SHORT_REGEX: RegExp =
  /https?:\/\/redd\.it\/(?<id>[a-z0-9]+)\/?/i;

export const REDDIT_MEDIA_REGEX: RegExp =
  /https?:\/\/(?<host>(?:i|v)\.redd\.it)\/(?<id>[A-Za-z0-9][\w.-]*)/i;
