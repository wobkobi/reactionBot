import re

REGEX_NWORD_HARDR = re.compile(
    r"\W*\b(n*[1i!l]+[g9]{2,}[3e]+[r5]+s*)\b\W*", re.IGNORECASE
)
REGEX_NWORD = re.compile(r"\W*\b(n*[1i!l]+[g9]{2,}[a4]+s*)\b\W*", re.IGNORECASE)
DRAMA_LLAMA = re.compile(r"\W*(?:l+|d+r+)a+m+a\W*", re.IGNORECASE)
NWORD = "🇳 🇼 🇴 🇷 🇩"
TWITTER_DOMAIN_REGEX = re.compile(
    r"https?://(?:www\.)?(x\.com|twitter\.com)/([^\s]+)", re.IGNORECASE
)
TIKTOK_DOMAIN_REGEX = re.compile(
    r"https?://(?:www\.|vt\.)?tiktok\.com/([^\s]+)", re.IGNORECASE
)
INSTAGRAM_DOMAIN_REGEX = re.compile(
    r"https?://(?:www\.)?instagram\.com/([^\s]+)", re.IGNORECASE
)
SLAY = re.compile(r"(?<!:)\b\w*s+?l+?a+?y+\w*\b(?!:)", re.IGNORECASE)
GIRLS = [
    re.compile(r"\b\w*s+?l+?a+?y+\w*\b", re.IGNORECASE),
    re.compile(r"\W*\bg+?i+?v+?i+?n+?g+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bq+?u+?e+?e+?n+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\by+?a+?s+?s*?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bthe\s+girls\s+are(n't)?\s+.*?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bs+?n+?a+?t+?c+?h+?e+?d+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bl+?i+?t+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bb+?a+?e+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bg+?o+?a+?l+?s+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bs+?q+?u+?a+?d+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bf+?i+?r+?e+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bt+?e+?a+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bg+?o+?\s+o+?f+?f+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bp+?o+?p+?\s+o+?f+?f+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bp+?e+?r+?i+?o+?d+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bg+?i+?r+?l+?\s+.*?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bf+?l+?e+?e+?k+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bs+?i+?s+?t+?e+?r+?s+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bt+?h+?i+?c+?c+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bd+?i+?c+?k+?\b\W*", re.IGNORECASE),
]

BRITISH = [
    re.compile(r"\W*\bb+?e+?v+?v+?y+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bb+?e+?v+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bb+?i+?r+?d+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bb+?l+?i+?m+?e+?y+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bb+?l+?o+?o+?d+?y+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bb+?o+?g+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bb+?o+?g+?\s+r+?o+?l+?l+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bb+?o+?n+?k+?e+?r+?s+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bb+?u+?z+?z+?i+?n+?g+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bc+?a+?n+?t+?\s+b+?e+?\s+a+?r+?s+?e+?d+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bc+?h+?a+?v+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bc+?h+?e+?e+?k+?y+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bc+?h+?u+?f+?f+?e+?d+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bc+?o+?c+?k+?\s+u+?p+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bc+?r+?a+?c+?k+?i+?n+?g+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bc+?u+?p+?p+?a+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bd+?a+?f+?t+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bd+?o+?d+?g+?y+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bf+?a+?f+?f+?i+?n+?g+?\s+a+?r+?o+?u+?n+?d+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bf+?i+?v+?e+?r+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bg+?i+?t+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bg+?o+?b+?s+?m+?a+?c+?k+?e+?d+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bg+?r+?a+?f+?t+?i+?n+?g+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bk+?e+?r+?f+?u+?f+?f+?l+?e+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bk+?n+?a+?c+?k+?e+?r+?e+?d+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bl+?a+?d+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bl+?o+?s+?t+?\s+t+?h+?e+?\s+p+?l+?o+?t+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\ble+?g+?\s+i+?t+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bm+?i+?n+?g+?i+?n+?g+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bm+?u+?g+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bm+?u+?p+?p+?e+?t+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bn+?i+?c+?k+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bp+?i+?e+?d+?\s+o+?f+?f+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bp+?i+?s+?s+?e+?d+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bp+?l+?a+?s+?t+?e+?r+?e+?d+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bp+?r+?o+?p+?e+?r+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bs+?k+?i+?n+?t+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bs+?l+?a+?g+?\s+o+?f+?f+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bs+?o+?d+?\b\W*", re.IGNORECASE),
    re.compile(
        r"\W*\bt+?a+?k+?i+?n+?g+?\s+t+?h+?e+?\s+p+?i+?s+?s+?\b\W*", re.IGNORECASE
    ),
    re.compile(r"\W*\bt+?e+?n+?n+?e+?r+?\b\W*", re.IGNORECASE),
    re.compile(
        r"\W*\bt+?h+?r+?o+?w+?i+?n+?g+?\s+a+?\s+w+?o+?b+?b+?l+?y+?\b\W*", re.IGNORECASE
    ),
    re.compile(r"\W*\bt+?r+?o+?l+?l+?i+?e+?d+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bb+?l+?o+?k+?e+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\be+?l+?l+?o+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bt+?e+?a+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bc+?r+?u+?m+?p+?e+?t+?s+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bd+?a+?r+?l+?i+?n+?g+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bg+?a+?n+?d+?e+?r+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bp+?o+?s+?h+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bb+?l+?i+?g+?h+?t+?y+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bb+?e+?n+?d+?e+?r+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bt+?o+?s+?s+?e+?r+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bw+?a+?n+?k+?e+?r+?\b\W*", re.IGNORECASE),
    re.compile(r"\W*\bb+?u+?g+?g+?e+?r+?\b\W*", re.IGNORECASE),
    re.compile(r".+\W*\bl+?o+?v+?e+?\b[.,!?]*$", re.IGNORECASE),
    re.compile(r"\W*\bi+?n+?n+?i+?t+?\b\W*", re.IGNORECASE),
]
