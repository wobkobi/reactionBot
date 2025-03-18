// src/handlers/registerCommands.ts
import { Client, Collection } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Extend the Client type to include a commands Collection.
export interface ExtendedClient extends Client {
  commands: Collection<string, any>;
}

/**
 * Dynamically loads all commands from the "src/commands" folder and adds them
 * to the client's commands collection.
 */
export async function loadCommands(client: ExtendedClient): Promise<void> {
  client.commands = new Collection();

  // Compute __dirname in ESM.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Determine the path to the commands folder.
  const commandsPath = join(__dirname, '../commands');
  const commandFiles = readdirSync(commandsPath).filter(
    (file) => file.endsWith('.ts') || file.endsWith('.js'),
  );

  for (const file of commandFiles) {
    const filePath = join(commandsPath, file);
    // Convert the file path to a valid file URL.
    const fileUrl = pathToFileURL(filePath).href;
    try {
      const commandModule = await import(fileUrl);
      // Each command module should export "data" and "execute".
      if (!commandModule.data || !commandModule.execute) {
        console.warn(
          `[WARNING] The command at ${filePath} is missing a required "data" or "execute" export.`,
        );
        continue;
      }
      client.commands.set(commandModule.data.name, commandModule);
      console.debug(
        `[DEBUG] Loaded command: ${commandModule.data.name} from ${file}`,
      );
    } catch (error) {
      console.error(`[ERROR] Failed to load command file ${file}:`, error);
    }
  }
  console.log(`[INFO] Loaded ${client.commands.size} commands.`);
}

/**
 * Registers all loaded slash commands with Discord.
 */
export async function registerSlashCommands(
  client: ExtendedClient,
): Promise<void> {
  // Ensure the application is loaded.
  if (!client.application) {
    throw new Error(
      'Client application is not available. Ensure the client is ready.',
    );
  }

  // Convert each command's data to JSON.
  const commandsData = Array.from(client.commands.values()).map((cmd: any) =>
    cmd.data.toJSON(),
  );
  try {
    // Use non-null assertion since we've fetched the application.
    await client.application!.commands.set(commandsData);
    console.log(
      `[INFO] Registered ${commandsData.length} slash commands with Discord.`,
    );
  } catch (error) {
    console.error(`[ERROR] Failed to register slash commands:`, error);
  }
}
