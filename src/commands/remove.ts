// src/commands/remove.ts
import {
  Client,
  CommandInteraction,
  GuildMember,
  TextBasedChannel,
} from 'discord.js';
import { loadData, saveData } from '../utils/file';
import dotenv from 'dotenv';
dotenv.config();

const YOUR_ID = process.env.YOUR_ID;

export async function handleRemoveCommand(
  client: Client,
  interaction: CommandInteraction,
  user: GuildMember,
) {
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

  if (user.id === client.user?.id) {
    await interaction.reply({
      content: "I can't remove myself!",
      ephemeral: true,
    });
    return;
  }

  if (!stinky[user.id]) {
    await interaction.reply({
      content: `${user.displayName} is not on the list!`,
      ephemeral: true,
    });
    return;
  }

  // Assume reactedMessages stores an array of message IDs per user ID
  const userReactedMessages: string[] = reactedMessages[user.id] || [];
  const channel = interaction.channel as TextBasedChannel;
  for (const messageId of userReactedMessages) {
    try {
      const msg = await channel.messages.fetch(messageId);
      const userData = stinky[user.id];
      if (userData.type === 'word') {
        const emojis = userData.value.split(' ');
        for (const emojiChar of emojis) {
          try {
            await msg.reactions.resolve(emojiChar)?.remove();
          } catch (error) {
            continue;
          }
        }
      } else {
        const emojiValue = userData.value;
        try {
          await msg.reactions.resolve(emojiValue)?.remove();
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      continue;
    }
  }

  delete stinky[user.id];
  saveData(guildId, 'stinky.json', stinky);
  saveData(guildId, 'reacted_messages.json', reactedMessages);
  await interaction.reply({
    content: `<@${user.id}> has been removed from my list`,
  });
}
