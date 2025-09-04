// src/index.ts
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import {
  ChatInputCommandInteraction,
  Client,
  Collection,
  GatewayIntentBits,
  Interaction,
  Message,
  Partials,
  SlashCommandBuilder,
} from "discord.js";
import * as dotenv from "dotenv";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { onMessage } from "./onMessage.js";
import { createLogger } from "./utils/log.js";

dotenv.config();

const log = createLogger("core/index");
const boot = (msg: string, extra?: Record<string, unknown>) =>
  console.log(`[BOOT] ${msg}${extra ? " " + JSON.stringify(extra) : ""}`);

const BOT_TOKEN = process.env.BOT_TOKEN!;
const CLIENT_ID = process.env.CLIENT_ID!;

declare module "discord.js" {
  interface Client {
    commands: Collection<
      string,
      {
        data: SlashCommandBuilder;
        execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
      }
    >;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction,
    Partials.User,
  ],
});

const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SlashCommandModule {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}
type JSONCommand = ReturnType<SlashCommandBuilder["toJSON"]>;

{
  const commandsDir = path.join(__dirname, "commands");
  const files = readdirSync(commandsDir).filter(
    (f) => f.endsWith(".js") || f.endsWith(".ts")
  );
  client.commands = new Collection<string, SlashCommandModule>();
  const commandData: JSONCommand[] = [];

  for (const file of files) {
    try {
      const moduleURL = pathToFileURL(path.join(commandsDir, file)).href;
      const mod = (await import(moduleURL)) as Partial<SlashCommandModule>;
      if (
        mod.data &&
        typeof mod.data.toJSON === "function" &&
        typeof mod.execute === "function"
      ) {
        client.commands.set(mod.data.name, {
          data: mod.data,
          execute: mod.execute,
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
  await onMessage(message);
});

client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction as ChatInputCommandInteraction);
  } catch (err) {
    log.error("command execution error", {
      command: interaction.commandName,
      error: err instanceof Error ? err.message : String(err),
    });
    const reply = { content: "⚠️ There was an error.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

boot("Starting login");
client.login(BOT_TOKEN).catch((err) =>
  log.error("login failed", {
    error: err instanceof Error ? err.message : String(err),
  })
);
