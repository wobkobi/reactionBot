// src/commands/add.ts
import { Client, CommandInteraction, GuildMember } from 'discord.js';
import { loadData, saveData } from '../utils/file';
import dotenv from 'dotenv';
dotenv.config();

const YOUR_ID = process.env.YOUR_ID; // assumed to be a string

// Checks if the emoji is a standard Unicode emoji by verifying that its first character is part of a surrogate pair.
function isValidEmoji(emoji: string): boolean {
  if (emoji.length === 0) return false;
  const firstCharCode = emoji.charCodeAt(0);
  return firstCharCode >= 0xd800 && firstCharCode <= 0xdbff;
}

// Converts a word into a string of regional indicator emojis (🇦, 🇧, etc.). Returns null if any letter repeats or is invalid.
function wordToEmoji(word: string): string | null {
  const baseEmojiCode = 0x1f1e6; // Unicode code point for regional indicator symbol letter A
  let emojiString = '';
  const seen = new Set<string>();

  for (const char of word) {
    if (seen.has(char)) return null;
    seen.add(char);

    if (char >= 'a' && char <= 'z') {
      const code = baseEmojiCode + (char.charCodeAt(0) - 'a'.charCodeAt(0));
      emojiString += String.fromCodePoint(code) + ' ';
    } else if (char >= 'A' && char <= 'Z') {
      const code = baseEmojiCode + (char.charCodeAt(0) - 'A'.charCodeAt(0));
      emojiString += String.fromCodePoint(code) + ' ';
    } else {
      return null;
    }
  }
  return emojiString.trim();
}

export async function handleAddCommand(
  client: Client,
  interaction: CommandInteraction,
  user: GuildMember,
  emoji: string,
) {
  // Ensure this command is used in a guild
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }
  const guildId = interaction.guild.id;

  // Load allowed users and "stinky" configuration data
  const allowed = loadData(guildId, 'allowed.json');
  const stinky = loadData(guildId, 'stinky.json');

  // Check if the user executing the command has permission
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

  // Prevent the bot from modifying itself
  if (user.id === client.user?.id) {
    await interaction.reply({
      content: "I can't add myself!",
      ephemeral: true,
    });
    return;
  }

  let emojiName: string | null = null;

  // Process custom emojis: format like "<:emojiName:emojiID>" or "<a:emojiName:emojiID>"
  if (
    (emoji.startsWith('<:') || emoji.startsWith('<a:')) &&
    emoji.endsWith('>')
  ) {
    const parts = emoji.split(':');
    if (parts.length >= 2) {
      emojiName = parts[1];
      stinky[user.id] = { type: 'custom_emoji', value: emojiName };
    }
  } else if (isValidEmoji(emoji)) {
    // Standard Unicode emoji
    stinky[user.id] = { type: 'emoji', value: emoji };
    emojiName = emoji;
  } else {
    // Try converting a word to regional indicator emojis
    emojiName = wordToEmoji(emoji);
    if (emojiName) {
      stinky[user.id] = { type: 'word', value: emojiName };
    } else {
      // Check for duplicate letters as in the original logic
      const uniqueLetters = new Set(emoji.split(''));
      if (emoji.length !== uniqueLetters.size) {
        await interaction.reply({
          content: "There can't be any duplicate letters!",
          ephemeral: true,
        });
        return;
      } else {
        await interaction.reply({
          content: `Failed to interpret ${emoji} as an emoji!`,
          ephemeral: true,
        });
        return;
      }
    }
  }

  // Save the updated stinky configuration
  saveData(guildId, 'stinky.json', stinky);

  // Attempt to retrieve a custom emoji object from the guild using the emoji name
  const emojiObj = interaction.guild.emojis.cache.find(
    (e) => e.name === emojiName,
  );
  if (emojiObj) {
    await interaction.reply(
      `<@${user.id}> has been set to the emoji ${emojiObj.toString()}`,
    );
  } else {
    await interaction.reply(
      `<@${user.id}> has been set to the emoji ${emojiName}`,
    );
  }
}
