// src/types/discord.d.ts

// Declares Client.commands, the collection the loader fills. It lives here
// rather than in index.ts so every programme that pulls in a command module
// sees it: the smoke test's tsconfig covers scripts plus whatever they import,
// which never reaches index.ts.

import { ContextMenuCommandBuilder } from "@discordjs/builders";
import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Collection,
  MessageContextMenuCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";

/**
 * Either kind of command Discord dispatches to `execute`: a slash command, or
 * a right-click entry on a message (Apps > Edit post / Delete post).
 */
export type CommandInteractionOfAnyKind =
  ChatInputCommandInteraction | MessageContextMenuCommandInteraction;

/** A loaded command module: its definition plus the handlers the loader wires. */
export interface CommandModule {
  data: SlashCommandBuilder | ContextMenuCommandBuilder;
  execute: (interaction: CommandInteractionOfAnyKind) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

declare module "discord.js" {
  interface Client {
    commands: Collection<string, CommandModule>;
  }
}
