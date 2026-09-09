// scripts/check-config.ts

// Reports per-server config files that changed meaning when scoped configs
// moved to one rule: a file wins as soon as it exists, so one declaring
// nothing now means "off here" rather than falling through to global.
//
// Reads only, unless --fix is passed to delete exactly those files.
//
//   npx tsx scripts/check-config.ts [--fix]

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "data");
const FIX = process.argv.slice(2).includes("--fix");

/** A scoped config, and what counts as it declaring something. */
interface ScopedConfig {
  file: string;
  /** Reads the parsed file and says whether it declares anything usable. */
  declares: (cfg: Record<string, unknown>) => boolean;
  /** What the old rule did with a file that declared nothing. */
  wasIgnored: string;
}

const CONFIGS: ScopedConfig[] = [
  {
    file: "words.json",
    declares: (c) => Object.keys((c.words as object) ?? {}).length > 0,
    wasIgnored: "fell through to global/words.json",
  },
  {
    file: "responses.json",
    declares: (c) => Object.keys((c.types as object) ?? {}).length > 0,
    wasIgnored: "fell through to global/responses.json",
  },
  {
    file: "insults.json",
    declares: (c) => Array.isArray(c.insults),
    wasIgnored: "fell through to global/insults.json",
  },
  {
    file: "definitions.json",
    declares: (c) => Array.isArray(c.entries),
    wasIgnored: "fell through to global/definitions.json",
  },
  {
    file: "sounds.json",
    declares: (c) => ((c.triggers as unknown[]) ?? []).length > 0 || Boolean(c.ambient),
    wasIgnored: "fell through to global/sounds.json",
  },
];

/**
 * Strips comments and trailing commas so words.json and sounds.json parse the
 * same way the bot reads them.
 * @param raw - File contents.
 * @returns Something JSON.parse will accept.
 */
function stripJsonc(raw: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const next = raw[i + 1];
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += raw[++i] ?? "";
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Lists the per-server data folders, skipping the shared ones.
 * @returns Guild IDs that have a data folder.
 */
function guildDirs(): string[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT).filter((name) => {
    if (["global", "sounds", "models"].includes(name)) return false;
    return statSync(path.join(ROOT, name)).isDirectory();
  });
}

let changed = 0;
let checked = 0;

console.log(FIX ? "Checking per-server config (will fix)\n" : "Checking per-server config\n");

for (const guildId of guildDirs()) {
  for (const config of CONFIGS) {
    const filePath = path.join(ROOT, guildId, config.file);
    if (!existsSync(filePath)) continue;
    checked++;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stripJsonc(readFileSync(filePath, "utf-8"))) as Record<string, unknown>;
    } catch (err) {
      console.log(`  ! ${guildId}/${config.file} does not parse, so it is ignored either way`);
      console.log(`      ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (config.declares(parsed)) continue;

    changed++;
    console.log(`  * ${guildId}/${config.file}`);
    console.log(`      was: ${config.wasIgnored}`);
    console.log(`      now: counts as present, so the feature is off for this server`);
    if (FIX) {
      rmSync(filePath, { force: true });
      console.log(`      removed, so it falls through again`);
    }
  }
}

console.log("");
if (checked === 0) {
  console.log("No per-server config files found. Nothing to migrate.");
} else if (changed === 0) {
  console.log(`${checked} per-server file(s) checked; none change meaning.`);
} else if (FIX) {
  console.log(`${changed} file(s) removed so they fall through as before.`);
} else {
  console.log(`${changed} of ${checked} file(s) change meaning. Re-run with --fix to remove them,`);
  console.log("or leave them if switching the feature off for that server is what you want.");
}
