// src/index.ts
import {
  DELETE_BUTTON_ID,
  EDIT_BUTTON_ID,
  EDIT_MODAL_PREFIX,
  handleRepostButton,
  handleRepostEditModal,
} from "@/media/repostActions";
import { onMessage, onMessageEdit } from "@/onMessage";
import { onMessageDelete } from "@/onMessageDelete";
import type { CommandModule } from "@/types/discord";
import { createLogger } from "@/utils/log";
import { REST } from "@discordjs/rest";
import { RESTPostAPIApplicationCommandsJSONBody, Routes } from "discord-api-types/v10";
import {
  Client,
  Collection,
  GatewayIntentBits,
  Interaction,
  InteractionReplyOptions,
  Message,
  MessageFlags,
  Partials,
} from "discord.js";
import * as dotenv from "dotenv";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

dotenv.config();

const log = createLogger("core/index");
const boot = (msg: string, extra?: Record<string, unknown>): void =>
  console.log(`[BOOT] ${msg}${extra ? " " + JSON.stringify(extra) : ""}`);

const BOT_TOKEN = process.env.BOT_TOKEN!;
const CLIENT_ID = process.env.CLIENT_ID!;

// While developing, DEV_GUILD_ID restricts the bot to one server so a dev
// instance never reacts in the guilds the real bot serves. Honoured only when
// launched via `npm run dev` - production runs (npm start, plain node)
// serve every guild even with the variable set in .env.
const DEV_GUILD_ID =
  process.env.npm_lifecycle_event === "dev" ? process.env.DEV_GUILD_ID : undefined;

/**
 * Checks whether an event from a guild should be handled, honouring the
 * {@link DEV_GUILD_ID} restriction when set.
 * @param guildId - Guild the event came from (null for DMs).
 * @returns `true` when the event should be processed.
 */
const guildInScope = (guildId: string | null): boolean => !DEV_GUILD_ID || guildId === DEV_GUILD_ID;

if (!BOT_TOKEN || !CLIENT_ID) {
  log.error("missing required environment variables", {
    hasToken: !!BOT_TOKEN,
    hasClientId: !!CLIENT_ID,
  });
  boot("Missing BOT_TOKEN or CLIENT_ID; set them in .env. Exiting.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type JSONCommand = RESTPostAPIApplicationCommandsJSONBody;

{
  const commandsDir = path.join(__dirname, "commands");
  const files = readdirSync(commandsDir).filter((f) => f.endsWith(".js") || f.endsWith(".ts"));
  client.commands = new Collection<string, CommandModule>();
  const commandData: JSONCommand[] = [];

  for (const file of files) {
    try {
      const moduleURL = pathToFileURL(path.join(commandsDir, file)).href;
      const mod = (await import(moduleURL)) as Partial<CommandModule>;
      if (mod.data && typeof mod.data.toJSON === "function" && typeof mod.execute === "function") {
        client.commands.set(mod.data.name, {
          data: mod.data,
          execute: mod.execute,
          autocomplete: mod.autocomplete,
        });
        commandData.push(mod.data.toJSON());
      } else {
        log.warn("invalid command file", { file });
      }
    } catch (err) {
      log.error("failed to load command", {
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const names = [...client.commands.keys()];
  log.info("commands loaded", { count: names.length, names });
  boot("Commands loaded", { count: names.length, names });

  client.once("ready", async () => {
    log.info("logged in", { user: client.user!.tag });
    boot("Running", {
      user: client.user!.tag,
      guilds: client.guilds.cache.size,
    });

    try {
      log.info("registering commands", { count: commandData.length });
      await rest.put(Routes.applicationCommands(CLIENT_ID), {
        body: commandData,
      });
      log.info("commands registered");
      boot("Commands registered", { count: commandData.length });
    } catch (err) {
      log.error("failed to register commands", {
        error: err instanceof Error ? err.message : String(err),
      });
      boot("Command registration failed");
    }
  });
}

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;
  if (!guildInScope(message.guildId)) return;
  await onMessage(message);
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  if (!guildInScope(newMessage.guildId)) return;
  await onMessageEdit(oldMessage, newMessage);
});

client.on("messageDelete", async (message) => {
  if (!guildInScope(message.guildId)) return;
  await onMessageDelete(message).catch((err) => {
    log.error("message-delete cleanup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
});

client.on("interactionCreate", async (interaction: Interaction) => {
  if (!guildInScope(interaction.guildId)) return;
  // Edit/Delete buttons + edit modal on moved messages. Approval buttons are
  // handled by their own per-message collectors, not here.
  if (interaction.isButton()) {
    if (interaction.customId === EDIT_BUTTON_ID || interaction.customId === DELETE_BUTTON_ID) {
      await handleRepostButton(interaction).catch((err) => {
        log.error("repost button handling failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    return;
  }
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith(EDIT_MODAL_PREFIX)) {
      await handleRepostEditModal(interaction).catch((err) => {
        log.error("repost edit modal handling failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    return;
  }
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    await cmd?.autocomplete?.(interaction).catch((err) => {
      log.error("autocomplete failed", {
        command: interaction.commandName,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return;
  }
  if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
  } catch (err) {
    log.error("command execution error", {
      command: interaction.commandName,
      error: err instanceof Error ? err.message : String(err),
    });
    const reply: InteractionReplyOptions = {
      content: "⚠️ There was an error.",
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

if (DEV_GUILD_ID) boot("Dev guard active: only serving one guild", { guild: DEV_GUILD_ID });
boot("Starting login");
client.login(BOT_TOKEN).catch((err) =>
  log.error("login failed", {
    error: err instanceof Error ? err.message : String(err),
  }),
);
