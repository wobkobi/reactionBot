// src/regex.ts
export const REGEX_NWORD_HARDR = new RegExp(
  "\\W*\\b(n*[1i!l]+[g9]{2,}[3e]+[r5]+s*)\\b\\W*",
  "i"
);

export const REGEX_NWORD = new RegExp(
  "\\W*\\b(n*[1i!l]+[g9]{2,}[a4]+s*)\\b\\W*",
  "i"
);

export const DRAMA_LLAMA = new RegExp("\\W*(?:l+|d+r+)a+m+a\\W*", "i");

export const NWORD = "🇳 🇼 🇴 🇷 🇩";

export const TWITTER_DOMAIN_REGEX = new RegExp(
  "https?://(?:www\\.)?(x\\.com|twitter\\.com)/([^\\s]+)",
  "i"
);

export const TIKTOK_DOMAIN_REGEX = new RegExp(
  "https?://(?:www\\.|vt\\.)?tiktok\\.com/([^\\s]+)",
  "i"
);

export const INSTAGRAM_DOMAIN_REGEX = new RegExp(
  "https?://(?:www\\.)?instagram\\.com/([^\\s]+)",
  "i"
);

export const SLAY = new RegExp("(?<!:)\\b\\w*s+?l+?a+?y+\\w*\\b(?!:)", "i");

export const GIRLS: RegExp[] = [
  new RegExp("\\b\\w*s+?l+?a+?y+\\w*\\b", "i"),
  new RegExp("\\W*\\bg+?i+?v+?i+?n+?g+?\\b\\W*", "i"),
  new RegExp("\\W*\\bq+?u+?e+?e+?n+?\\b\\W*", "i"),
  new RegExp("\\W*\\by+?a+?s+?s*?\\b\\W*", "i"),
  new RegExp("\\W*\\bthe\\s+girls\\s+are(n't)?\\s+.*?\\b\\W*", "i"),
  new RegExp("\\W*\\bs+?n+?a+?t+?c+?h+?e+?d+?\\b\\W*", "i"),
  new RegExp("\\W*\\bl+?i+?t+?\\b\\W*", "i"),
  new RegExp("\\W*\\bb+?a+?e+?\\b\\W*", "i"),
  new RegExp("\\W*\\bg+?o+?a+?l+?s+?\\b\\W*", "i"),
  new RegExp("\\W*\\bs+?q+?u+?a+?d+?\\b\\W*", "i"),
  new RegExp("\\W*\\bf+?i+?r+?e+?\\b\\W*", "i"),
  new RegExp("\\W*\\bt+?e+?a+?\\b\\W*", "i"),
  new RegExp("\\W*\\bg+?o+?\\s+o+?f+?f+?\\b\\W*", "i"),
  new RegExp("\\W*\\bp+?o+?p+?\\s+o+?f+?f+?\\b\\W*", "i"),
  new RegExp("\\W*\\bp+?e+?r+?i+?o+?d+?\\b\\W*", "i"),
  new RegExp("\\W*\\bg+?i+?r+?l+?\\s+.*?\\b\\W*", "i"),
  new RegExp("\\W*\\bf+?l+?e+?e+?k+?\\b\\W*", "i"),
  new RegExp("\\W*\\bs+?i+?s+?t+?e+?r+?s+?\\b\\W*", "i"),
  new RegExp("\\W*\\bt+?h+?i+?c+?c+?\\b\\W*", "i"),
  new RegExp("\\W*\\bd+?i+?c+?k+?\\b\\W*", "i"),
];

export const BRITISH: RegExp[] = [
  new RegExp("\\W*\\bb+?e+?v+?v+?y+?\\b\\W*", "i"),
  new RegExp("\\W*\\bb+?e+?v+?\\b\\W*", "i"),
  new RegExp("\\W*\\bb+?i+?r+?d+?\\b\\W*", "i"),
  new RegExp("\\W*\\bb+?l+?i+?m+?e+?y+?\\b\\W*", "i"),
  new RegExp("\\W*\\bb+?l+?o+?o+?d+?y+?\\b\\W*", "i"),
  new RegExp("\\W*\\bb+?o+?g+?\\b\\W*", "i"),
  new RegExp("\\W*\\bb+?o+?g+?\\s+r+?o+?l+?l+?\\b\\W*", "i"),
  new RegExp("\\W*\\bb+?o+?n+?k+?e+?r+?s+?\\b\\W*", "i"),
  new RegExp("\\W*\\bb+?u+?z+?z+?i+?n+?g+?\\b\\W*", "i"),
  new RegExp("\\W*\\bc+?a+?n+?t+?\\s+b+?e+?\\s+a+?r+?s+?e+?d+?\\b\\W*", "i"),
  new RegExp("\\W*\\bc+?h+?a+?v+?\\b\\W*", "i"),
  new RegExp("\\W*\\bc+?h+?e+?e+?k+?y+?\\b\\W*", "i"),
  new RegExp("\\W*\\bc+?h+?u+?f+?f+?e+?d+?\\b\\W*", "i"),
  new RegExp("\\W*\\bc+?o+?c+?k+?\\s+u+?p+?\\b\\W*", "i"),
  new RegExp("\\W*\\bc+?r+?a+?c+?k+?i+?n+?g+?\\b\\W*", "i"),
  new RegExp("\\W*\\bc+?u+?p+?p+?a+?\\b\\W*", "i"),
  new RegExp("\\W*\\bd+?a+?f+?t+?\\b\\W*", "i"),
  new RegExp("\\W*\\bd+?o+?d+?g+?y+?\\b\\W*", "i"),
  new RegExp("\\W*\\bf+?a+?f+?f+?i+?n+?g+?\\s+a+?r+?o+?u+?n+?d+?\\b\\W*", "i"),
  new RegExp("\\W*\\bf+?i+?v+?e+?r+?\\b\\W*", "i"),
  new RegExp("\\W*\\bg+?i+?t+?\\b\\W*", "i"),
  new RegExp("\\W*\\bg+?o+?b+?s+?m+?a+?c+?k+?e+?d+?\\b\\W*", "i"),
  new RegExp("\\W*\\bg+?r+?a+?f+?t+?i+?n+?g+?\\b\\W*", "i"),
  new RegExp("\\W*\\bk+?e+?r+?f+?u+?f+?f+?l+?e+?\\b\\W*", "i"),
  new RegExp("\\W*\\bk+?n+?a+?c+?k+?e+?r+?e+?d+?\\b\\W*", "i"),
  new RegExp("\\W*\\bl+?a+?d+?\\b\\W*", "i"),
  new RegExp("\\W*\\bl+?o+?s+?t+?\\s+t+?h+?e+?\\s+p+?l+?o+?t+?\\b\\W*", "i"),
  new RegExp("\\W*\\ble+?g+?\\s+i+?t+?\\b\\W*", "i"),
  new RegExp("\\W*\\bm+?i+?n+?g+?i+?n+?g+?\\b\\W*", "i"),
  new RegExp("\\W*\\bm+?u+?g+?\\b\\W*", "i"),
  new RegExp("\\W*\\bm+?u+?p+?p+?e+?t+?\\b\\W*", "i"),
  new RegExp("\\W*\\bn+?i+?c+?k+?\\b\\W*", "i"),
  new RegExp("\\W*\\bp+?i+?e+?d+?\\s+o+?f+?f+?\\b\\W*", "i"),
  new RegExp("\\W*\\bp+?i+?s+?s+?e+?d+?\\b\\W*", "i"),
  new RegExp("\\W*\\bp+?l+?a+?s+?t+?e+?r+?e+?d+?\\b\\W*", "i"),
  new RegExp("\\W*\\bp+?r+?o+?p+?e+?r+?\\b\\W*", "i"),
  new RegExp("\\W*\\bs+?k+?i+?n+?t+?\\b\\W*", "i"),
  new RegExp("\\W*\\bs+?l+?a+?g+?\\s+o+?f+?f+?\\b\\W*", "i"),
  new RegExp("\\W*\\bs+?o+?d+?\\b\\W*", "i"),
  new RegExp(
    "\\W*\\bt+?a+?k+?i+?n+?g+?\\s+t+?h+?e+?\\s+p+?i+?s+?s+?\\b\\W*",
    "i"
  ),
  new RegExp("\\W*\\bt+?e+?n+?n+?e+?r+?\\b\\W*", "i"),
  new RegExp(
    "\\W*\\bt+?h+?r+?o+?w+?i+?n+?g+?\\s+a+?\\s+w+?o+?b+?b+?l+?y+?\\b\\W*",
    "i"
  ),
  new RegExp("\\W*\\bt+?r+?o+?l+?l+?i+?e+?d+?\\b\\W*", "i"),
  new RegExp("\\W*\\bb+?l+?o+?k+?e+?\\b\\W*", "i"),
  new RegExp("\\W*\\be+?l+?l+?o+?\\b\\W*", "i"),
  new RegExp("\\W*\\bt+?e+?a+?\\b\\W*", "i"),
  new RegExp("\\W*\\bc+?r+?u+?m+?p+?e+?t+?s+?\\b\\W*", "i"),
  new RegExp("\\W*\\bd+?a+?r+?l+?i+?n+?g+?\\b\\W*", "i"),
  new RegExp("\\W*\\bg+?a+?n+?d+?e+?r+?\\b\\W*", "i"),
  new RegExp("\\W*\\bp+?o+?s+?h+?\\b\\W*", "i"),
  new RegExp("\\W*\\bb+?l+?i+?g+?h+?t+?y+?\\b\\W*", "i"),
  new RegExp("\\W*\\bb+?e+?n+?d+?e+?r+?\\b\\W*", "i"),
  new RegExp("\\W*\\bt+?o+?s+?s+?e+?r+?\\b\\W*", "i"),
  new RegExp("\\W*\\bw+?a+?n+?k+?e+?r+?\\b\\W*", "i"),
  new RegExp("\\W*\\bb+?u+?g+?g+?e+?r+?\\b\\W*", "i"),
  new RegExp(".+\\W*\\bl+?o+?v+?e+?\\b[.,!?]*$", "i"),
  new RegExp("\\W*\\bi+?n+?n+?i+?t+?\\b\\W*", "i"),
];
