// src/commands/add.ts
import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { loadData, saveData } from '../utils/file.js';
import dotenv from 'dotenv';
import { CustomOptions } from '../types/CustomOptions';
dotenv.config();

export const data = new SlashCommandBuilder()
  .setName('add')
  .setDescription('Sets a custom emoji for a user.')
  .addUserOption((option) =>
    option.setName('user').setDescription('User to update').setRequired(true),
  )
  .addStringOption((option) =>
    option.setName('emoji').setDescription('Emoji or word').setRequired(true),
  );

function isValidEmoji(emojiStr: string): boolean {
  return emojiStr.codePointAt(0)! > 0xffff;
}

function wordToEmoji(word: string): string | null {
  const baseEmojiCode = 0x1f1e6; // Regional indicator 'A'
  let emojiString = '';
  const seen = new Set<string>();
  for (const char of word) {
    if (seen.has(char)) return null;
    seen.add(char);
    if (char.toLowerCase() >= 'a' && char.toLowerCase() <= 'z') {
      const code =
        baseEmojiCode + (char.toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0));
      emojiString += String.fromCodePoint(code) + ' ';
    } else {
      return null;
    }
  }
  return emojiString.trim();
}

export async function execute(interaction: CommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a guild.',
      ephemeral: true,
    });
    return;
  }
  const guildId = interaction.guild.id;
  const allowed = loadData(guildId, 'allowed.json');
  const stinky = loadData(guildId, 'stinky.json');
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

  // Cast options to our CustomOptions type.
  const options = interaction.options as unknown as CustomOptions;
  const user = options.getUser('user', true);
  const emojiInput = options.getString('emoji', true);

  if (user.id === interaction.client.user?.id) {
    await interaction.reply({
      content: "I can't add myself!",
      ephemeral: true,
    });
    return;
  }

  let emojiName: string | null = null;
  if (
    (emojiInput.startsWith('<:') || emojiInput.startsWith('<a:')) &&
    emojiInput.endsWith('>')
  ) {
    const parts = emojiInput.split(':');
    if (parts.length >= 2) {
      emojiName = parts[1];
      stinky[user.id] = { type: 'custom_emoji', value: emojiName };
    }
  } else if (isValidEmoji(emojiInput)) {
    stinky[user.id] = { type: 'emoji', value: emojiInput };
    emojiName = emojiInput;
  } else {
    emojiName = wordToEmoji(emojiInput);
    if (emojiName) {
      stinky[user.id] = { type: 'word', value: emojiName };
    } else {
      if (emojiInput.length !== new Set(emojiInput).size) {
        await interaction.reply({
          content: "There can't be any duplicate letters!",
          ephemeral: true,
        });
        return;
      } else {
        await interaction.reply({
          content: `Failed to interpret ${emojiInput} as an emoji!`,
          ephemeral: true,
        });
        return;
      }
    }
  }
  saveData(guildId, 'stinky.json', stinky);

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
