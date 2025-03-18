// src/index.ts
import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import {
  loadCommands,
  registerSlashCommands,
  ExtendedClient,
} from './handlers/registerCommands.js';

dotenv.config();

const client: ExtendedClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
}) as ExtendedClient;

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}!`);
  await loadCommands(client);
  await registerSlashCommands(client);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }
  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing ${interaction.commandName}:`, error);
    await interaction.reply({
      content: 'There was an error executing that command!',
      ephemeral: true,
    });
  }
});

client.login(process.env.TOKEN);
