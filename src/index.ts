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
import { gateAutocomplete, gateCommand } from "@/utils/permissions";
import { respond } from "@/utils/respond";
import { onVoiceStateUpdate, shutdownVoice, sweepGuilds } from "@/voice/autojoin";
import { REST } from "@discordjs/rest";
import { RESTPostAPIApplicationCommandsJSONBody, Routes } from "discord-api-types/v10";
import {
  Client,
  Collection,
  GatewayIntentBits,
  Interaction,
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
    // Voice states drive the auto-join: without this the bot never learns that
    // a channel has people in it. GuildMembers is not needed, as
    // channel.members is derived from the voice state cache.
    GatewayIntentBits.GuildVoiceStates,
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

      // Anyone already sitting in a call when the bot restarts emits no voice
      // state update, so without this sweep the bot waits for the next person
      // to move before it joins anything.
      void sweepGuilds(client, guildInScope).catch((err: unknown) => {
        log.warn("startup voice sweep failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
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

client.on("voiceStateUpdate", async (oldState, newState) => {
  if (!guildInScope(newState.guild?.id ?? oldState.guild?.id ?? null)) return;
  await onVoiceStateUpdate(oldState, newState).catch((err: unknown) => {
    log.warn("voice state handling failed", {
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
    if (!gateAutocomplete(interaction)) {
      await interaction.respond([]).catch(() => undefined);
      return;
    }
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
    if (interaction.isChatInputCommand() && !(await gateCommand(interaction))) {
      log.warn("command refused", {
        command: interaction.commandName,
        guildId: interaction.guildId,
        userId: interaction.user.id,
      });
      return;
    }
    await cmd.execute(interaction);
  } catch (err) {
    log.error("command execution error", {
      command: interaction.commandName,
      error: err instanceof Error ? err.message : String(err),
    });
    await respond(interaction, {
      content: "⚠️ There was an error.",
      flags: MessageFlags.Ephemeral,
    });
  }
});

/**
 * Logs a failure that would otherwise end the process. These handlers are the
 * only record left of failures that used to crash with a full trace, so the
 * stack is kept alongside the message.
 * @param what - Where the failure came from.
 * @param err - The error to record.
 */
const logSurvived = (what: string, err: unknown): void => {
  log.error(what, {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
};

// discord.js builds the client with captureRejections, so a rejection from any
// async listener above is re-emitted here instead of reaching Node. Without a
// listener Node rethrows it and the bot dies over one refused request. Gateway
// failures arrive on shardError; nothing else emits the client's own "error"
// in a single-process bot.
client.on("error", (err) => logSurvived("client error", err));
client.on("shardError", (err) => logSurvived("shard error", err));

// Capture only covers the client's own listeners. Message-component collectors
// (the approval prompts) are plain emitters, so a rejection in one of their
// handlers reaches Node, which ends the process on it by default.
process.on("unhandledRejection", (reason) => logSurvived("unhandled rejection", reason));

// A voice connection outlives the process from Discord's side, so without this
// a restart (a tsx watch reload especially) leaves a ghost bot sitting in the
// channel until the gateway times it out. The transcriber's worker also has to
// be told to stop, or it keeps the event loop alive.
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    boot(`Received ${signal}, shutting down`);
    shutdownVoice();
    void client.destroy();
    process.exit(0);
  });
}

if (DEV_GUILD_ID) boot("Dev guard active: only serving one guild", { guild: DEV_GUILD_ID });
boot("Starting login");
client.login(BOT_TOKEN).catch((err) =>
  log.error("login failed", {
    error: err instanceof Error ? err.message : String(err),
  }),
);
