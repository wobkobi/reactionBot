// src/commands/editpost.ts

import { handleEditPostCommand } from "@/media/repostActions";
import { ContextMenuCommandBuilder } from "@discordjs/builders";
import { ApplicationCommandType, InteractionContextType } from "discord-api-types/v10";
import { MessageContextMenuCommandInteraction } from "discord.js";

/**
 * Right-click entry for rewriting a moved post. Works on the post itself and
 * on the pointer stub left in the channel it came from.
 */
export const data = new ContextMenuCommandBuilder()
  .setName("Edit post")
  .setType(ApplicationCommandType.Message)
  .setContexts(InteractionContextType.Guild);

/**
 * Executes "Edit post": opens the edit modal for the original author.
 * @param interaction - The context-menu interaction.
 * @returns A promise that resolves when the modal is shown or the refusal sent.
 */
export async function execute(interaction: MessageContextMenuCommandInteraction): Promise<void> {
  await handleEditPostCommand(interaction);
}
