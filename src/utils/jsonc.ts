// src/utils/jsonc.ts

// Every hand-edited config is read through this, so a comment explaining a
// setting can sit next to the setting rather than in a readme someone has to
// go and find. Machine-written files (counters, calm windows, repost records)
// stay on plain JSON.parse: nothing writes comments into those.

/**
 * Parses JSON that may contain JSONC-style comments and trailing commas.
 * words.json is hand-edited, so both are tolerated: line (`//`) and block
 * comments are stripped (string contents are preserved - a "//" inside a
 * quoted value is untouched), then trailing commas before `}`/`]` dropped.
 * @param raw - Raw file contents.
 * @returns The parsed value.
 */
export function parseJsonc<T>(raw: string): T {
  let stripped = "";
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      stripped += ch;
      if (ch === "\\") {
        stripped += raw[++i] ?? "";
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      stripped += ch;
      continue;
    }
    if (ch === "/" && raw[i + 1] === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      stripped += "\n";
      continue;
    }
    if (ch === "/" && raw[i + 1] === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
      i++;
      continue;
    }
    stripped += ch;
  }

  // Drop trailing commas (string-aware: quoted commas stay).
  let out = "";
  inString = false;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += stripped[++i] ?? "";
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ",") {
      let j = i + 1;
      while (j < stripped.length && /\s/.test(stripped[j])) j++;
      if (stripped[j] === "}" || stripped[j] === "]") continue;
    }
    out += ch;
  }
  return JSON.parse(out) as T;
}
