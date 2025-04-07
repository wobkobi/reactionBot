import { Client } from "discord.js";

/**
 * Sets up a global button interaction handler.
 * It listens for button interactions with a customId starting with "delete_transformed:".
 * Only the original sender (whose ID is encoded in the customId) is allowed to delete the message.
 */
export function setupButtonHandler(client: Client): void {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith("delete_transformed:")) {
      const parts = interaction.customId.split(":");
      const allowedId = parts[1];
      if (interaction.user.id !== allowedId) {
        await interaction.reply({
          content: "You cannot delete this message.",
          ephemeral: true,
        });
        return;
      }
      try {
        await interaction.message.delete();
        await interaction.reply({
          content: "Transformed message deleted.",
          ephemeral: true,
        });
      } catch (error) {
        console.error("Error deleting transformed message:", error);
      }
    }
  });
}
