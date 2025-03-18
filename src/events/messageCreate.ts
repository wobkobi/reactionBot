// src/events/messageCreate.ts
import {
  Client,
  Message,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  Snowflake,
} from 'discord.js';
import { loadData, saveData } from '../utils/file';
import {
  DRAMA_LLAMA,
  GIRLS,
  BRITISH,
  REGEX_NWORD_HARDR,
  REGEX_NWORD,
  NWORD,
  TWITTER_DOMAIN_REGEX,
  TIKTOK_DOMAIN_REGEX,
  INSTAGRAM_DOMAIN_REGEX,
  SLAY,
} from '../regex';

/**
 * Handles the messageCreate event.
 */
export async function handleMessageCreate(
  client: Client,
  message: Message,
): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild) return; // Only process messages in guilds

  const guildId: Snowflake = message.guild.id;
  const userId: string = message.author.id;

  // Load data files
  const stinky = loadData(guildId, 'stinky.json');
  const reactedMessages = loadData(guildId, 'reacted_messages.json');

  let count: any = loadData(guildId, 'count.json');
  if (!count || typeof count !== 'object') {
    count = {
      count_since_last_poo: 0,
      count_since_last_clown: 0,
      last_message_with_poo: null,
      last_message_with_clown: null,
      total_poo: 0,
      total_clown: 0,
    };
    saveData(guildId, 'count.json', count);
  } else {
    count.count_since_last_poo++;
    count.count_since_last_clown++;
  }

  let slayData: any = loadData(guildId, 'slay.json');
  if (!slayData || typeof slayData !== 'object') {
    slayData = {
      last_mention: null,
      mention_interval: null,
      total_count: 0,
      user_counts: {},
    };
  }

  // Handle SLAY keyword tracking
  if (SLAY.test(message.content)) {
    const now = new Date();
    slayData.total_count = (slayData.total_count || 0) + 1;
    if (!slayData.user_counts) slayData.user_counts = {};
    slayData.user_counts[userId] = (slayData.user_counts[userId] || 0) + 1;

    let durationMessage = 'LESS THAN A MINUTE';
    if (slayData.last_mention) {
      const lastMentionDate = new Date(slayData.last_mention);
      const timeDelta = now.getTime() - lastMentionDate.getTime();
      const days = Math.floor(timeDelta / (1000 * 60 * 60 * 24));
      const hours = Math.floor((timeDelta / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((timeDelta / (1000 * 60)) % 60);

      if (days >= 7) {
        await message.channel.send(
          "Congratulations everyone! We've gone 7 days without saying slay!",
        );
        slayData = {
          last_mention: null,
          mention_interval: null,
          total_count: 0,
          user_counts: {},
        };
        saveData(guildId, 'slay.json', slayData);
        return;
      }

      const timeParts: string[] = [];
      if (days > 0) timeParts.push(`${days} DAY${days > 1 ? 'S' : ''}`);
      if (hours > 0) timeParts.push(`${hours} HOUR${hours > 1 ? 'S' : ''}`);
      if (minutes > 0)
        timeParts.push(`${minutes} MINUTE${minutes > 1 ? 'S' : ''}`);
      if (timeParts.length > 0) durationMessage = timeParts.join(', ');
    }
    slayData.last_mention = now.toISOString();

    // Helper: ordinal formatting
    const ordinal = (n: number): string => {
      const suffixes: { [key: number]: string } = { 1: 'st', 2: 'nd', 3: 'rd' };
      if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
      const suffix = suffixes[n % 10] || 'th';
      return `${n}${suffix}`;
    };

    const userMentionCount = slayData.user_counts[userId];
    const totalMentions = slayData.total_count;
    await message.reply(
      `OH MY FUCKING GOD YOU JUST SAID SLAY FOR THE **${ordinal(
        userMentionCount,
      )}** TIME ${message.author}!
  THIS IS THE **${ordinal(totalMentions)}** TIME TOTAL FOR YOU GUYS. YOU COULD ONLY LAST **${durationMessage}** THIS TIME! WOW. **DO BETTER!**`,
    );
    saveData(guildId, 'slay.json', slayData);
  }

  // Random reactions: 💩
  if (Math.random() < 0.001) {
    try {
      await message.react('💩');
    } catch (err) {
      console.error(err);
    }
    count.total_poo = (count.total_poo || 0) + 1;
    if (count.last_message_with_poo) {
      const lastReactedLink = `https://discord.com/channels/${guildId}/${message.channel.id}/${count.last_message_with_poo}`;
      try {
        await message.reply({
          content: `Reacted with 💩 after **${count.count_since_last_poo}** messages! Total reactions: **${count.total_poo}**. Last 💩 reaction: ${lastReactedLink}`,
          allowedMentions: { parse: [] },
        });
      } catch (err) {
        console.error(err);
      }
    }
    count.count_since_last_poo = 0;
    count.last_message_with_poo = message.id;
  }

  // Random reactions: 🤡
  if (Math.random() < 0.00004) {
    const clownEmoji = message.guild.emojis.cache.find(
      (e) => e.name === 'clown',
    );
    try {
      if (clownEmoji) {
        await message.react(clownEmoji);
      } else {
        await message.react('🤡');
      }
    } catch (err) {
      console.error(err);
    }
    count.total_clown = (count.total_clown || 0) + 1;
    if (count.last_message_with_clown) {
      const lastReactedLink = `https://discord.com/channels/${guildId}/${message.channel.id}/${count.last_message_with_clown}`;
      try {
        await message.channel.send(
          `Reacted with 🤡 after **${count.count_since_last_clown}** messages! Total 🤡 reactions: **${count.total_clown}**. Last 🤡 reaction: ${lastReactedLink}`,
        );
      } catch (err) {
        console.error(err);
      }
    }
    count.count_since_last_clown = 0;
    count.last_message_with_clown = message.id;
  }

  // Transform links for Twitter, TikTok, and Instagram
  await transformAndReplyLinks(
    client,
    message,
    TWITTER_DOMAIN_REGEX,
    'https://vxtwitter.com/{}',
  );
  await transformAndReplyLinks(
    client,
    message,
    TIKTOK_DOMAIN_REGEX,
    'https://tiktxk.com/{}',
  );
  await transformAndReplyLinks(
    client,
    message,
    INSTAGRAM_DOMAIN_REGEX,
    'https://ddinstagram.com/{}',
  );

  // React to drama llama
  if (DRAMA_LLAMA.test(message.content) || message.content.includes('🦙')) {
    try {
      await message.react('🦙');
    } catch (err) {
      console.error(err);
    }
  }

  // React based on GIRLS and BRITISH regex arrays
  const girlsMatch = GIRLS.some((regex) => regex.test(message.content));
  const britishMatch = BRITISH.some((regex) => regex.test(message.content));
  try {
    if (girlsMatch && britishMatch) {
      const reaction = Math.random() < 0.5 ? '💅' : '🇬🇧';
      await message.react(reaction);
    } else if (girlsMatch) {
      await message.react('💅');
    } else if (britishMatch) {
      await message.react('🇬🇧');
    }
  } catch (err) {
    console.error(err);
  }

  // React with N-word emojis if matching
  if (
    REGEX_NWORD_HARDR.test(message.content) ||
    REGEX_NWORD.test(message.content)
  ) {
    const emojis = NWORD.split(' ');
    for (const emojiChar of emojis) {
      try {
        await message.react(emojiChar);
      } catch (err) {
        console.error(err);
      }
    }
  }

  // React based on user's stinky configuration (if present)
  if (stinky[userId]) {
    // Only react sometimes (10% chance)
    if (Math.floor(Math.random() * 10) !== 0) {
      saveData(guildId, 'count.json', count);
      return;
    }
    const stinkyData = stinky[userId];
    const emojiName: string = stinkyData.value;
    if (!emojiName) {
      saveData(guildId, 'count.json', count);
      return;
    }
    try {
      if (stinkyData.type === 'emoji') {
        await message.react(emojiName);
      } else if (stinkyData.type === 'custom_emoji') {
        const customEmoji = message.guild.emojis.cache.find(
          (e) => e.name === emojiName,
        );
        if (customEmoji) {
          await message.react(customEmoji);
        }
      } else if (stinkyData.type === 'word') {
        for (const emojiChar of stinkyData.value.split(' ')) {
          try {
            await message.react(emojiChar);
          } catch (err) {
            console.error(err);
          }
        }
      }
      reactedMessages[message.id] = true;
      saveData(guildId, 'reacted_messages.json', reactedMessages);
    } catch (err) {
      console.error(err);
    }
  }
  saveData(guildId, 'count.json', count);
}

/**
 * Transforms URLs matching a given regex in the message content and sends a new message.
 */
async function transformAndReplyLinks(
  client: Client,
  message: Message,
  regex: RegExp,
  templateUrl: string,
): Promise<void> {
  const matches = message.content.match(regex);
  if (!matches) return;

  const confirmed = await getConfirmation(
    message.author,
    message.channel as TextChannel,
  );
  if (confirmed === true || confirmed === null) {
    try {
      await message.delete();
    } catch (err) {
      console.error(err);
      return;
    }
    let transformedContent = message.content.replace(/<@!?[0-9]+>/g, '').trim();
    // Replace the first occurrence of the regex match with the transformed link.
    transformedContent = transformedContent.replace(regex, (_match) => {
      return templateUrl.replace('{}', _match);
    });

    // Determine target channel (example: override for a specific guild/channel)
    let targetChannelId: Snowflake = message.channel.id;
    const specifiedChannelId: Snowflake = '1208544659643699200';
    if (
      message.guild &&
      message.guild.id === '1113266261619642398' &&
      message.channel.id !== specifiedChannelId
    ) {
      targetChannelId = specifiedChannelId;
    }
    const targetChannel = client.channels.cache.get(
      targetChannelId,
    ) as TextChannel;
    if (!targetChannel) return;

    try {
      const newMessage = await targetChannel.send({
        content: transformedContent,
        allowedMentions: { parse: [] },
      });
      await newMessage.react('🗑️');

      // If the target channel differs from the original channel, send a reference message.
      if (targetChannelId !== message.channel.id) {
        const mentions = message.mentions.users.map((user) => user.toString());
        const mentionText = mentions.join(', ');
        const referenceText = `${mentionText ? mentionText + ', ' : ''}${message.author} sent slop for you to see. [Click here](${newMessage.url})`;
        await message.channel.send({
          content: referenceText,
          allowedMentions: { parse: [] },
        });
        const messageIdMap = loadData(message.guild.id, 'message_id_map.json');
        messageIdMap[newMessage.id] = {
          new_message_id: newMessage.id,
          reference_channel_id: message.channel.id,
        };
        saveData(message.guild.id, 'message_id_map.json', messageIdMap);
      }
    } catch (err) {
      console.error(err);
    }
  } else if (confirmed === false) {
    // If the user declines, simply do nothing.
  }
}

/**
 * Sends a confirmation message with Yes/No buttons and awaits the user's response.
 * Defaults to "yes" on timeout.
 */
async function getConfirmation(
  user: any,
  channel: TextChannel,
): Promise<boolean | null> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('confirm_yes')
      .setLabel('Yes')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('confirm_no')
      .setLabel('No')
      .setStyle(ButtonStyle.Danger),
  );

  const confirmationMessage = await channel.send({
    content: `${user}, do you want to replace the original link with a new one?`,
    components: [row],
  });

  try {
    const filter = (interaction: any) => interaction.user.id === user.id;
    const collected = await confirmationMessage.awaitMessageComponent({
      filter,
      componentType: ComponentType.Button,
      time: 30000,
    });
    await collected.deferUpdate();
    await confirmationMessage.delete();
    return collected.customId === 'confirm_yes' ? true : false;
  } catch (err) {
    // On timeout, delete the confirmation message and default to confirmation.
    try {
      await confirmationMessage.delete();
    } catch (err2) {
      console.error(err2);
    }
    return true;
  }
}
