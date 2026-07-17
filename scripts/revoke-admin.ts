// scripts/revoke-admin.ts

// One-off maintenance script: the inverse of grant-admin.ts. Deletes the
// dedicated "Bot Admin" role in every guild the bot is in, which strips the
// Administrator grant from whoever held it and removes the role itself in one
// operation - a clean reversal of the grant.
//
// Only works per guild where the bot has Manage Roles and the role sits below
// the bot's own highest role (a bot cannot delete a role at or above its own).
// Guilds where no such role exists, or where it cannot be deleted, are reported
// and skipped rather than aborting the run.
//
// Deleting the role removes it from ALL members that have it, not just one user.
// That is the expected reversal, since grant-admin.ts creates the role solely to
// hold this grant. Pass --user-only to instead unassign it from a single member
// and leave the role in place.
//
// Usage:
//   npx tsx scripts/revoke-admin.ts                  # dry run: preview only
//   npx tsx scripts/revoke-admin.ts --apply          # delete the role
//   npx tsx scripts/revoke-admin.ts --apply --user-only   # just unassign from --user
//   npx tsx scripts/revoke-admin.ts --user <id>      # target member for --user-only
//
// Requires BOT_TOKEN in .env (same token the bot runs with).
//
// Exit codes:
//   0  completed (dry run, or apply with no failures)
//   1  fatal error, or one or more guilds failed during --apply

import { createLogger } from "@/utils/log.js";
import { Client, GatewayIntentBits, Guild, PermissionFlagsBits } from "discord.js";
import * as dotenv from "dotenv";

dotenv.config();

const log = createLogger("script/revoke-admin");

/* --------------------------------------------------------------- constants */

/** Default target user, used only in --user-only mode. */
const DEFAULT_USER_ID = "227685510519324672";

/** Name of the role grant-admin.ts creates; the one this script reverses. */
const ADMIN_ROLE_NAME = "Bot Admin";

const BOT_TOKEN = process.env.BOT_TOKEN_2;

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/* ------------------------------------------------------------------ types */

type Outcome = "deleted" | "unassigned" | "would-revoke" | "not-found" | "skipped" | "failed";

interface GuildResult {
  /** Guild name for the report. */
  guild: string;
  /** What happened for this guild. */
  outcome: Outcome;
  /** Human-readable detail (reason skipped, error message, role acted on). */
  detail: string;
}

/* ---------------------------------------------------------------- helpers */

/**
 * Parses `--flag` / `--user <id>` CLI arguments.
 * @returns Parsed options: apply changes, user-only mode, and the target user ID.
 */
function parseArgs(): { apply: boolean; userOnly: boolean; userId: string } {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const userOnly = argv.includes("--user-only");
  const userFlag = argv.indexOf("--user");
  const userId = userFlag !== -1 ? (argv[userFlag + 1] ?? DEFAULT_USER_ID) : DEFAULT_USER_ID;
  return { apply, userOnly, userId };
}

/**
 * Reverses the grant in a single guild, returning a structured result rather
 * than throwing so one bad guild does not abort the run. In the default mode the
 * "Bot Admin" role is deleted outright; in --user-only mode it is merely removed
 * from the target member and left in place.
 * @param guild - The guild to act on.
 * @param apply - When false, only report what would happen.
 * @param userOnly - When true, unassign from the target member instead of deleting.
 * @param userId - Target member for --user-only mode.
 * @returns The outcome for this guild.
 */
async function revokeInGuild(
  guild: Guild,
  apply: boolean,
  userOnly: boolean,
  userId: string,
): Promise<GuildResult> {
  const base = { guild: guild.name };
  const me = guild.members.me;

  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ...base, outcome: "skipped", detail: "bot lacks Manage Roles here" };
  }

  const role = guild.roles.cache.find(
    (r) => r.name === ADMIN_ROLE_NAME && r.permissions.has(PermissionFlagsBits.Administrator),
  );
  if (!role) {
    return { ...base, outcome: "not-found", detail: `no "${ADMIN_ROLE_NAME}" role here` };
  }

  // The bot can only act on a role positioned below its own highest role.
  if (role.position >= me.roles.highest.position || role.managed) {
    return {
      ...base,
      outcome: "failed",
      detail: role.managed ? "role is integration-managed" : "role sits at/above the bot",
    };
  }

  const verb = userOnly ? "unassign" : "delete";
  if (!apply) {
    return { ...base, outcome: "would-revoke", detail: `would ${verb} "${role.name}"` };
  }

  try {
    if (userOnly) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return { ...base, outcome: "skipped", detail: "user is not a member of this guild" };
      }
      if (!member.roles.cache.has(role.id)) {
        return { ...base, outcome: "not-found", detail: "member does not have the role" };
      }
      await member.roles.remove(role, `revoke-admin script: unassign ${userId}`);
      return { ...base, outcome: "unassigned", detail: `removed "${role.name}" from ${userId}` };
    }

    await role.delete("revoke-admin script: reverse admin grant");
    return { ...base, outcome: "deleted", detail: `deleted "${role.name}"` };
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
    deleted: `${GREEN}✓${RESET}`,
    unassigned: `${GREEN}✓${RESET}`,
    "would-revoke": `${YELLOW}○${RESET}`,
    "not-found": `${DIM}=${RESET}`,
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

  const { apply, userOnly, userId } = parseArgs();
  log.info(apply ? "running in APPLY mode" : "running in DRY-RUN mode (pass --apply to revoke)", {
    mode: userOnly ? "user-only" : "delete-role",
    userId: userOnly ? userId : undefined,
  });

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const results: GuildResult[] = await new Promise((resolve, reject) => {
    client.once("ready", async () => {
      log.info("logged in", { user: client.user!.tag, guilds: client.guilds.cache.size });
      try {
        const out: GuildResult[] = [];
        for (const guild of client.guilds.cache.values()) {
          out.push(await revokeInGuild(guild, apply, userOnly, userId));
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
  const changed = results.filter((r) =>
    apply ? r.outcome === "deleted" || r.outcome === "unassigned" : r.outcome === "would-revoke",
  ).length;
  console.log(
    `\n  ${apply ? "revoked" : "would revoke"} admin in ${changed} guild(s)` +
      (failed ? `, ${RED}${failed} failed${RESET}` : "") +
      (apply ? "" : `  ${DIM}(dry run - re-run with --apply)${RESET}`) +
      "\n",
  );

  process.exit(failed > 0 && apply ? 1 : 0);
})();
