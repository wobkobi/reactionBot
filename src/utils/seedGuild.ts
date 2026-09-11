// src/utils/seedGuild.ts

// Gives a server a folder it can be configured from the moment the bot joins,
// without any of it changing what the bot does there.

import { guildDataDir } from "@/utils/file";
import { createLogger } from "@/utils/log";
import fs from "fs";
import path from "path";

const log = createLogger("utils/seed");

/** Suffix marking a config template. No loader ever asks for one by name. */
export const TEMPLATE_SUFFIX = ".example.jsonc";

/** Filename of the note dropped alongside the templates. */
export const GUILD_README = "readme.md";

/**
 * The note left in a new server's folder. It leads with the rule that catches
 * people out: activating a template is also opting that server out of the
 * global config, which is invisible from the file itself.
 */
const README_TEXT = `# Server data

Runtime data for this server. The bot writes and manages everything here; the
only reason to edit it by hand is to override the shared config in
\`data/global/\`.

## Turning a template on

The \`${TEMPLATE_SUFFIX}\` files are templates. Nothing reads them. To use one for
this server, rename it without the \`.example\` part:

    sounds${TEMPLATE_SUFFIX} > sounds.json

One rule covers every config file:

> A server's own file wins as soon as it exists, whatever it contains. Only an
> absent file falls back to \`global/\`.

So an empty \`sounds.json\` here means "no sounds in this server", not "use the
global ones". Delete the file to go back to the global config.

Comments (\`//\` and \`/* */\`) and trailing commas are fine in any of them.

\`words.json\` is configurable the same way but ships no template. See
\`data/readme.md\` for its shape, and for everything else the bot keeps in here.
`;

/**
 * Lists the config templates available to copy. Read from disk rather than
 * hardcoded, so a template added to `data/global/` later reaches new servers
 * without a change here.
 * @returns Template filenames, empty when the global folder has none or cannot
 * be read.
 */
function availableTemplates(): string[] {
  try {
    return fs
      .readdirSync(guildDataDir("global"))
      .filter((name) => name.endsWith(TEMPLATE_SUFFIX))
      .sort();
  } catch {
    // A missing or unreadable data/global is not this function's problem to
    // report: the bot runs perfectly well on its built-in defaults.
    return [];
  }
}

/**
 * Writes `source` to `target` unless something is already there.
 * @param target - Absolute path to write to.
 * @param contents - What to write when the path is free.
 * @returns `true` when the file was created, `false` when it already existed
 * or could not be written.
 */
function createIfAbsent(target: string, contents: string): boolean {
  if (fs.existsSync(target)) return false;
  try {
    fs.writeFileSync(target, contents, "utf-8");
    return true;
  } catch (err) {
    log.warn("could not write seed file", {
      target,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Gives a guild a data folder holding a readme and a copy of every config
 * template, so somebody can configure the server by renaming a file rather
 * than by knowing what to create.
 *
 * Only ever creates what is missing, so it is safe to run against a server
 * that has been configured for months: a hand-edited file is never touched,
 * and running it twice does nothing the second time.
 *
 * Nothing it writes is read by the bot. Templates carry
 * {@link TEMPLATE_SUFFIX} and every config loader asks for an exact filename,
 * which matters more than it looks: a real config file here would switch the
 * server off the global config entirely, whatever the file contained.
 * @param guildId - Discord guild (server) ID.
 * @returns Names of the files created, empty when everything was already there.
 */
export function seedGuildData(guildId: string): string[] {
  const dir = guildDataDir(guildId);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    log.warn("could not create guild data folder", {
      guildId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const created: string[] = [];
  if (createIfAbsent(path.join(dir, GUILD_README), README_TEXT)) created.push(GUILD_README);

  for (const name of availableTemplates()) {
    const source = path.join(guildDataDir("global"), name);
    let contents: string;
    try {
      contents = fs.readFileSync(source, "utf-8");
    } catch (err) {
      log.warn("could not read template", {
        name,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (createIfAbsent(path.join(dir, name), contents)) created.push(name);
  }

  if (created.length > 0) log.info("seeded guild data folder", { guildId, created });
  return created;
}

/**
 * Seeds every guild the bot is in, skipping anything already present. Joining
 * a server emits an event, but being in one already does not, so without this
 * the servers the bot joined before this existed never get a folder.
 * @param guildIds - Guild IDs to seed.
 * @param inScope - Guild filter, so a dev instance leaves the real bot's
 * servers alone.
 * @returns How many guilds had something written for them.
 */
export function seedAllGuilds(
  guildIds: Iterable<string>,
  inScope: (id: string) => boolean,
): number {
  let seeded = 0;
  for (const guildId of guildIds) {
    if (!inScope(guildId)) continue;
    if (seedGuildData(guildId).length > 0) seeded += 1;
  }
  return seeded;
}
