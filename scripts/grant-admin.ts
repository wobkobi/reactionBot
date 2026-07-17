// scripts/grant-admin.ts

// One-off maintenance script: grant a single user the Administrator permission
// in every guild the bot is currently in. Discord has no "make user admin"
// primitive, so this ensures a dedicated "Bot Admin" role (with Administrator)
// exists in each guild, raises it as high as the hierarchy allows (just below
// the bot's own top role - a bot cannot place a role at or above its own), and
// assigns it to the target member. Top placement matters because Administrator
// overrides permissions but not role position: a user can only kick/ban/edit
// members ranked below them.
//
// Only works per guild where the bot has Manage Roles and its own highest role
// sits above the role being assigned; guilds that fail either check, or where
// the target is not a member, are reported and skipped. Run it yourself against
// your own servers - auto-granting a fixed user admin everywhere is a backdoor
// pattern, so this stays a manual, opt-in script and never runs from the bot.
//
// Usage:
//   npx tsx scripts/grant-admin.ts                 # dry run: preview only
//   npx tsx scripts/grant-admin.ts --apply         # actually grant admin
//   npx tsx scripts/grant-admin.ts --user <id>     # override the target user
//
// Requires BOT_TOKEN in .env (same token the bot runs with).
//
// Exit codes:
//   0  completed (dry run, or apply with no failures)
//   1  fatal error, or one or more guilds failed during --apply

import { createLogger } from "@/utils/log.js";
import { Client, GatewayIntentBits, Guild, PermissionFlagsBits, Role } from "discord.js";
import * as dotenv from "dotenv";

dotenv.config();

const log = createLogger("script/grant-admin");

/* --------------------------------------------------------------- constants */

/** Default target user: the account to be made admin in every guild. */
const DEFAULT_USER_ID = "227685510519324672";

/** Name of the dedicated role this script creates/reuses per guild. */
const ADMIN_ROLE_NAME = "Bot Admin";

const BOT_TOKEN = process.env.BOT_TOKEN_2;

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/* ------------------------------------------------------------------ types */

type Outcome = "granted" | "would-grant" | "already-admin" | "skipped" | "failed";

interface GuildResult {
  /** Guild name for the report. */
  guild: string;
  /** What happened for this guild. */
  outcome: Outcome;
  /** Human-readable detail (reason skipped, error message, role used). */
  detail: string;
}

/* ---------------------------------------------------------------- helpers */

/**
 * Parses `--flag` / `--user <id>` CLI arguments.
 * @returns Parsed options: whether to apply changes and the target user ID.
 */
function parseArgs(): { apply: boolean; userId: string } {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const userFlag = argv.indexOf("--user");
  const userId = userFlag !== -1 ? (argv[userFlag + 1] ?? DEFAULT_USER_ID) : DEFAULT_USER_ID;
  return { apply, userId };
}

/**
 * Finds an existing assignable "Bot Admin" role or creates one, so the grant is
 * idempotent across repeated runs. A role is reusable only when it already
 * carries Administrator and sits below the bot's highest role.
 * @param guild - The guild to ensure the role in.
 * @param apply - When false, skip creating a role (dry run).
 * @returns The role to assign, or null when none exists and none can be made.
 */
async function ensureAdminRole(guild: Guild, apply: boolean): Promise<Role | null> {
  const me = guild.members.me;
  if (!me) return null;
  const botTop = me.roles.highest.position;

  const existing = guild.roles.cache.find(
    (r) =>
      r.name === ADMIN_ROLE_NAME &&
      r.permissions.has(PermissionFlagsBits.Administrator) &&
      r.position < botTop,
  );
  if (existing) return existing;

  if (!apply) {
    // Signal "creatable" without mutating: any non-null role means the caller
    // can proceed. Reuse the bot's own top role as a stand-in for the preview.
    return me.roles.highest;
  }

  return guild.roles.create({
    name: ADMIN_ROLE_NAME,
    permissions: [PermissionFlagsBits.Administrator],
    reason: `grant-admin script: administrator role for ${DEFAULT_USER_ID}`,
  });
}

/**
 * Raises the role to the highest position the bot may set - directly below the
 * bot's own top role. Best-effort: a bot cannot move a role to or above its own,
 * so the ceiling is `botTop - 1`. Returns whether the role now sits at that
 * ceiling so the caller can report placement without failing the grant.
 * @param guild - The guild the role lives in.
 * @param role - The admin role to raise.
 * @returns True when the role sits just below the bot's top role afterwards.
 */
async function raiseToTop(guild: Guild, role: Role): Promise<boolean> {
  const me = guild.members.me;
  if (!me) return false;
  const ceiling = me.roles.highest.position - 1;
  // No headroom (bot's top role is @everyone-adjacent) or already at ceiling.
  if (ceiling < 1) return false;
  if (role.position >= ceiling) return true;
  await role.setPosition(ceiling);
  return true;
}

/**
 * Grants (or previews granting) admin to the target user in a single guild,
 * returning a structured result rather than throwing so one bad guild does not
 * abort the run.
 * @param guild - The guild to act on.
 * @param userId - The target user's ID.
 * @param apply - When false, only report what would happen.
 * @returns The outcome for this guild.
 */
async function grantInGuild(guild: Guild, userId: string, apply: boolean): Promise<GuildResult> {
  const base = { guild: guild.name };
  const me = guild.members.me;

  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ...base, outcome: "skipped", detail: "bot lacks Manage Roles here" };
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    return { ...base, outcome: "skipped", detail: "user is not a member of this guild" };
  }

  if (member.id === guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator)) {
    return { ...base, outcome: "already-admin", detail: "already has admin" };
  }

  const role = await ensureAdminRole(guild, apply).catch(() => null);
  if (!role) {
    return {
      ...base,
      outcome: "failed",
      detail: "could not create/find an assignable admin role (check role hierarchy)",
    };
  }

  if (!apply) {
    return {
      ...base,
      outcome: "would-grant",
      detail: `would assign "${ADMIN_ROLE_NAME}" and raise it below the bot`,
    };
  }

  try {
    // Raise the role first (best-effort) so the member inherits top placement
    // the moment the role is added; a positioning failure must not void the grant.
    const atTop = await raiseToTop(guild, role).catch(() => false);
    await member.roles.add(role, `grant-admin script: make ${userId} administrator`);
    const placement = atTop ? "just below the bot" : "not raised (hierarchy limit)";
    return { ...base, outcome: "granted", detail: `assigned "${role.name}", ${placement}` };
  } catch (err) {
    return { ...base, outcome: "failed", detail: (err as Error)?.message ?? "unknown error" };
  }
}

/**
 * Prints a colour-coded results table grouped by outcome.
 * @param results - Per-guild outcomes to render.
 */
function printTable(results: GuildResult[]): void {
  const icon: Record<Outcome, string> = {
    granted: `${GREEN}✓${RESET}`,
    "would-grant": `${YELLOW}○${RESET}`,
    "already-admin": `${DIM}=${RESET}`,
    skipped: `${DIM}-${RESET}`,
    failed: `${RED}✗${RESET}`,
  };
  const col = Math.max(...results.map((r) => r.guild.length), 5) + 2;
  const header = `  ${"Guild".padEnd(col)}Outcome`;
  console.log(`\n${header}`);
  console.log("  " + "─".repeat(header.length));
  for (const r of results) {
    console.log(
      `  ${icon[r.outcome]} ${r.guild.padEnd(col - 2)}${r.outcome}  ${DIM}${r.detail}${RESET}`,
    );
  }
  console.log("  " + "─".repeat(header.length));
}

/* ------------------------------------------------------------------ main */

void (async () => {
  if (!BOT_TOKEN) {
    log.error("missing BOT_TOKEN; set it in .env");
    process.exit(1);
  }

  const { apply, userId } = parseArgs();
  log.info(apply ? "running in APPLY mode" : "running in DRY-RUN mode (pass --apply to grant)", {
    userId,
  });

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const results: GuildResult[] = await new Promise((resolve, reject) => {
    client.once("ready", async () => {
      log.info("logged in", { user: client.user!.tag, guilds: client.guilds.cache.size });
      try {
        const out: GuildResult[] = [];
        for (const guild of client.guilds.cache.values()) {
          out.push(await grantInGuild(guild, userId, apply));
        }
        resolve(out);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    client.login(BOT_TOKEN).catch(reject);
  });

  await client.destroy();

  printTable(results);

  const failed = results.filter((r) => r.outcome === "failed").length;
  const changed = results.filter((r) => r.outcome === (apply ? "granted" : "would-grant")).length;
  console.log(
    `\n  ${apply ? "granted" : "would grant"} admin in ${changed} guild(s)` +
      (failed ? `, ${RED}${failed} failed${RESET}` : "") +
      (apply ? "" : `  ${DIM}(dry run - re-run with --apply)${RESET}`) +
      "\n",
  );

  process.exit(failed > 0 && apply ? 1 : 0);
})();
