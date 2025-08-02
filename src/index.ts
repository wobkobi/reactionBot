// src/index.ts

/**
 * @file src/index.ts
 * @description Entry point for initializing and running the Discord bot.
 * Dynamically discovers and registers slash commands, sets up message and interaction handlers.
 * Uses REST API to register slash commands globally on startup.
 * @module index
 */

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

dotenv.config();

// Required environment variables
const BOT_TOKEN = process.env.BOT_TOKEN!;
const CLIENT_ID = process.env.CLIENT_ID!;

// Extend Client to include commands collection
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

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// Prepare REST client for command registration
const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

// Compute __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Type definitions for command modules
interface SlashCommandModule {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}
type JSONCommand = ReturnType<SlashCommandBuilder["toJSON"]>;

// Load and register command modules dynamically
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
        console.warn(`⚠️ Command file ${file} is invalid.`);
      }
    } catch (err) {
      console.error(`❌ Failed to load command ${file}:`, err);
    }
  }

  // Register commands once the client is ready
  client.once("ready", async () => {
    console.log(`🤖 Logged in as ${client.user!.tag}`);
    try {
      console.log(`🌐 Registering ${commandData.length} command(s)...`);
      await rest.put(Routes.applicationCommands(CLIENT_ID), {
        body: commandData,
      });
      console.log("✅ Commands registered.");
    } catch (err) {
      console.error("❌ Failed to register commands:", err);
    }
  });
}

// Handle incoming messages
client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;
  await onMessage(message);
});

// Dispatch slash-command interactions
client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction as ChatInputCommandInteraction);
  } catch (err) {
    console.error(`Error executing /${interaction.commandName}:`, err);
    const reply = { content: "⚠️ There was an error.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// Login to Discord
client.login(BOT_TOKEN).catch((err) => console.error("❌ Login failed:", err));
