// src/commands/deletepost.ts

import { handleDeletePostCommand } from "@/media/repostActions";
import { ContextMenuCommandBuilder } from "@discordjs/builders";
import { ApplicationCommandType, InteractionContextType } from "discord-api-types/v10";
import { MessageContextMenuCommandInteraction } from "discord.js";

/**
 * Right-click entry for taking a moved post down. Works on the post itself and
 * on the pointer stub left in the channel it came from; both go together.
 */
export const data = new ContextMenuCommandBuilder()
  .setName("Delete post")
  .setType(ApplicationCommandType.Message)
  .setContexts(InteractionContextType.Guild);

/**
 * Executes "Delete post": removes the moved post and its stub for the original
 * author.
 * @param interaction - The context-menu interaction.
 * @returns A promise that resolves when the delete is handled.
 */
export async function execute(interaction: MessageContextMenuCommandInteraction): Promise<void> {
  await handleDeletePostCommand(interaction);
}
