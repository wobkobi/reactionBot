// src/commands/remove.ts
import {
  SlashCommandBuilder,
  CommandInteraction,
  TextChannel,
} from 'discord.js';
import { loadData, saveData } from '../utils/file.js';
import dotenv from 'dotenv';
import { CustomOptions } from '../types/CustomOptions';
dotenv.config();

export const data = new SlashCommandBuilder()
  .setName('remove')
  .setDescription('Removes a user from the stinky list.')
  .addUserOption((option) =>
    option.setName('user').setDescription('User to remove').setRequired(true),
  );

export async function execute(interaction: CommandInteraction) {
  if (!interaction.guild || !interaction.channel) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }
  const guildId = interaction.guild.id;
  const allowed = loadData(guildId, 'allowed.json');
  const stinky = loadData(guildId, 'stinky.json');
  const reactedMessages = loadData(guildId, 'reacted_messages.json');
  const options = interaction.options as unknown as CustomOptions;
  const user = options.getUser('user', true);
  const YOUR_ID = process.env.YOUR_ID;

  if (
    interaction.user.id !== interaction.guild.ownerId &&
    interaction.user.id !== YOUR_ID &&
    !allowed[interaction.user.id]
  ) {
    await interaction.reply({
      content: 'You do not have permission to run this command!',
      ephemeral: true,
    });
    return;
  }

  if (user.id === interaction.client.user?.id) {
    await interaction.reply({
      content: "I can't remove myself!",
      ephemeral: true,
    });
    return;
  }

  if (!stinky[user.id]) {
    await interaction.reply({
      content: `<@${user.id}> is not on the list!`,
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.channel as TextChannel;
  const userMessages: string[] = reactedMessages[user.id] || [];
  for (const messageId of userMessages) {
    try {
      const msg = await channel.messages.fetch(messageId);
      if (stinky[user.id].type === 'word') {
        const emojis = stinky[user.id].value.split(' ');
        for (const emojiChar of emojis) {
          try {
            await msg.reactions.resolve(emojiChar)?.remove();
          } catch (error) {
            console.error(error);
          }
        }
      } else {
        const emojiValue = stinky[user.id].value;
        try {
          await msg.reactions.resolve(emojiValue)?.remove();
        } catch (error) {
          console.error(error);
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  delete stinky[user.id];
  saveData(guildId, 'stinky.json', stinky);
  saveData(guildId, 'reacted_messages.json', reactedMessages);
  await interaction.reply({
    content: `<@${user.id}> has been removed from my list`,
  });
}
