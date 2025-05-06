// src/index.ts
import { Client, GatewayIntentBits, Partials } from "discord.js";
import dotenv from "dotenv";
import { handleMessageCreate } from "./events/messageCreate.js";
import {
  ExtendedClient,
  loadCommands,
  registerSlashCommands,
} from "./handlers/registerCommands.js";
import { setupButtonHandler } from "./interactions/buttonHandler.js";

dotenv.config();

const client: ExtendedClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // required to read message content
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
}) as ExtendedClient;

client.once("ready", async () => {
  console.log(`Logged in as ${client.user?.tag}!`);
  // Dynamically load and register slash commands.
  await loadCommands(client);
  await registerSlashCommands(client);
});

client.on("messageCreate", async (message) => {
  await handleMessageCreate(client, message);
});

setupButtonHandler(client);

client.login(process.env.TOKEN);
