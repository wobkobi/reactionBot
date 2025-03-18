// src/events/messageCreate.ts
import {
  Client,
  Message,
  TextChannel,
  Snowflake,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { loadData, saveData } from '../utils/file.js';
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
 * Type guard to check if a channel has a send() method.
 */
function canSend(
  channel: any,
): channel is { send: (...args: any[]) => Promise<any> } {
  return typeof channel.send === 'function';
}

export async function handleMessageCreate(
  client: Client,
  message: Message,
): Promise<void> {
  console.debug(
    `[DEBUG] Received message from ${message.author.tag}: "${message.content}"`,
  );
  // Only process non-bot messages in guilds.
  if (message.author.bot) {
    console.debug('[DEBUG] Ignoring message from bot.');
    return;
  }
  if (!message.guild) {
    console.debug('[DEBUG] Message not in a guild.');
    return;
  }

  const guildId: Snowflake = message.guild.id;
  const userId: string = message.author.id;
  console.debug(`[DEBUG] Guild ID: ${guildId}, User ID: ${userId}`);

  // Load data files.
  const stinky = loadData(guildId, 'stinky.json');
  console.debug(`[DEBUG] Loaded stinky data: ${JSON.stringify(stinky)}`);
  const reactedMessages = loadData(guildId, 'reacted_messages.json');
  console.debug(
    `[DEBUG] Loaded reactedMessages data: ${JSON.stringify(reactedMessages)}`,
  );

  let count: any = loadData(guildId, 'count.json');
  if (!count || typeof count !== 'object') {
    console.debug(
      '[DEBUG] count.json not found or invalid. Initializing new count data.',
    );
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
  console.debug(`[DEBUG] Updated count data: ${JSON.stringify(count)}`);

  let slayData: any = loadData(guildId, 'slay.json');
  if (!slayData || typeof slayData !== 'object') {
    console.debug(
      '[DEBUG] slay.json not found or invalid. Initializing new slay data.',
    );
    slayData = {
      last_mention: null,
      mention_interval: null,
      total_count: 0,
      user_counts: {},
    };
  }
  console.debug(`[DEBUG] Loaded slay data: ${JSON.stringify(slayData)}`);

  // Handle SLAY keyword tracking.
  if (SLAY.test(message.content)) {
    console.debug('[DEBUG] SLAY keyword detected.');
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
      console.debug(
        `[DEBUG] Time since last SLAY: ${days} days, ${hours} hours, ${minutes} minutes`,
      );

      if (days >= 7) {
        if (canSend(message.channel)) {
          await message.channel.send(
            "Congratulations everyone! We've gone 7 days without saying slay!",
          );
          console.debug('[DEBUG] Sent 7-day congratulatory message.');
        }
        slayData = {
          last_mention: null,
          mention_interval: null,
          total_count: 0,
          user_counts: {},
        };
        saveData(guildId, 'slay.json', slayData);
        console.debug('[DEBUG] Reset slay data after 7 days.');
        return;
      }

      const timeParts: string[] = [];
      if (days > 0) timeParts.push(`${days} DAY${days > 1 ? 'S' : ''}`);
      if (hours > 0) timeParts.push(`${hours} HOUR${hours > 1 ? 'S' : ''}`);
      if (minutes > 0)
        timeParts.push(`${minutes} MINUTE${minutes > 1 ? 'S' : ''}`);
      if (timeParts.length > 0) durationMessage = timeParts.join(', ');
      console.debug(`[DEBUG] Computed durationMessage: ${durationMessage}`);
    }
    slayData.last_mention = now.toISOString();

    // Helper for ordinal numbers.
    const ordinal = (n: number): string => {
      const suffixes: { [key: number]: string } = { 1: 'st', 2: 'nd', 3: 'rd' };
      if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
      const suffix = suffixes[n % 10] || 'th';
      return `${n}${suffix}`;
    };

    const userMentionCount = slayData.user_counts[userId];
    const totalMentions = slayData.total_count;
    console.debug(
      `[DEBUG] SLAY counts - User: ${userMentionCount}, Total: ${totalMentions}`,
    );
    await message.reply(
      `OH MY FUCKING GOD YOU JUST SAID SLAY FOR THE **${ordinal(
        userMentionCount,
      )}** TIME ${message.author}!
  THIS IS THE **${ordinal(totalMentions)}** TIME TOTAL FOR YOU GUYS. YOU COULD ONLY LAST **${durationMessage}** THIS TIME! WOW. **DO BETTER!**`,
    );
    saveData(guildId, 'slay.json', slayData);
  }

  // Random reactions: 💩.
  if (Math.random() < 0.001 && canSend(message.channel)) {
    console.debug('[DEBUG] Random chance triggered for 💩 reaction.');
    try {
      await message.react('💩');
      console.debug('[DEBUG] Reacted with 💩.');
    } catch (err) {
      console.error('[DEBUG] Error reacting with 💩:', err);
    }
    count.total_poo = (count.total_poo || 0) + 1;
    if (count.last_message_with_poo) {
      const lastReactedLink = `https://discord.com/channels/${guildId}/${message.channel.id}/${count.last_message_with_poo}`;
      try {
        await message.reply({
          content: `Reacted with 💩 after **${count.count_since_last_poo}** messages! Total reactions: **${count.total_poo}**. Last 💩 reaction: ${lastReactedLink}`,
          allowedMentions: { parse: [] },
        });
        console.debug('[DEBUG] Sent reply for 💩 reaction.');
      } catch (err) {
        console.error('[DEBUG] Error sending reply for 💩 reaction:', err);
      }
    }
    count.count_since_last_poo = 0;
    count.last_message_with_poo = message.id;
  }

  // Random reactions: 🤡.
  if (Math.random() < 0.00004) {
    console.debug('[DEBUG] Random chance triggered for 🤡 reaction.');
    const clownEmoji = message.guild.emojis.cache.find(
      (e) => e.name === 'clown',
    );
    try {
      if (clownEmoji) {
        await message.react(clownEmoji);
        console.debug('[DEBUG] Reacted with custom clown emoji.');
      } else {
        await message.react('🤡');
        console.debug('[DEBUG] Reacted with default 🤡 emoji.');
      }
    } catch (err) {
      console.error('[DEBUG] Error reacting with 🤡:', err);
    }
    count.total_clown = (count.total_clown || 0) + 1;
    if (count.last_message_with_clown && canSend(message.channel)) {
      const lastReactedLink = `https://discord.com/channels/${guildId}/${message.channel.id}/${count.last_message_with_clown}`;
      try {
        await message.channel.send(
          `Reacted with 🤡 after **${count.count_since_last_clown}** messages! Total 🤡 reactions: **${count.total_clown}**. Last 🤡 reaction: ${lastReactedLink}`,
        );
        console.debug('[DEBUG] Sent message for 🤡 reaction.');
      } catch (err) {
        console.error('[DEBUG] Error sending message for 🤡 reaction:', err);
      }
    }
    count.count_since_last_clown = 0;
    count.last_message_with_clown = message.id;
  }

  // Transform links for Twitter, TikTok, and Instagram.
  console.debug('[DEBUG] Checking for link transformations...');
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

  // React to drama llama.
  if (DRAMA_LLAMA.test(message.content) || message.content.includes('🦙')) {
    console.debug('[DEBUG] Drama llama detected, reacting with 🦙.');
    try {
      await message.react('🦙');
    } catch (err) {
      console.error('[DEBUG] Error reacting with 🦙:', err);
    }
  }

  // React based on GIRLS and BRITISH regex arrays.
  const girlsMatch = GIRLS.some((regex) => regex.test(message.content));
  const britishMatch = BRITISH.some((regex) => regex.test(message.content));
  console.debug(
    `[DEBUG] GIRLS match: ${girlsMatch}, BRITISH match: ${britishMatch}`,
  );
  try {
    if (girlsMatch && britishMatch) {
      const reaction = Math.random() < 0.5 ? '💅' : '🇬🇧';
      await message.react(reaction);
      console.debug(
        `[DEBUG] Reacted with ${reaction} for both GIRLS and BRITISH.`,
      );
    } else if (girlsMatch) {
      await message.react('💅');
      console.debug('[DEBUG] Reacted with 💅 for GIRLS.');
    } else if (britishMatch) {
      await message.react('🇬🇧');
      console.debug('[DEBUG] Reacted with 🇬🇧 for BRITISH.');
    }
  } catch (err) {
    console.error('[DEBUG] Error reacting based on GIRLS/BRITISH:', err);
  }

  // React with N-word emojis if matching.
  if (
    REGEX_NWORD_HARDR.test(message.content) ||
    REGEX_NWORD.test(message.content)
  ) {
    console.debug(
      '[DEBUG] N-word pattern detected, reacting with N-word emojis.',
    );
    const emojis = NWORD.split(' ');
    for (const emojiChar of emojis) {
      try {
        await message.react(emojiChar);
        console.debug(`[DEBUG] Reacted with ${emojiChar}`);
      } catch (err) {
        console.error('[DEBUG] Error reacting with N-word emoji:', err);
      }
    }
  }

  // React based on user's stinky configuration (if present).
  if (stinky[userId]) {
    console.debug('[DEBUG] User-specific stinky configuration found.');
    // Only react sometimes (10% chance)
    if (Math.floor(Math.random() * 10) !== 0) {
      console.debug('[DEBUG] Stinky reaction chance not met.');
      saveData(guildId, 'count.json', count);
      return;
    }
    const stinkyData = stinky[userId];
    const emojiName: string = stinkyData.value;
    if (!emojiName) {
      console.debug('[DEBUG] Stinky configuration missing emoji value.');
      saveData(guildId, 'count.json', count);
      return;
    }
    try {
      if (stinkyData.type === 'emoji') {
        await message.react(emojiName);
        console.debug(`[DEBUG] Reacted with emoji: ${emojiName}`);
      } else if (stinkyData.type === 'custom_emoji') {
        const customEmoji = message.guild.emojis.cache.find(
          (e) => e.name === emojiName,
        );
        if (customEmoji) {
          await message.react(customEmoji);
          console.debug(`[DEBUG] Reacted with custom emoji: ${emojiName}`);
        }
      } else if (stinkyData.type === 'word') {
        for (const emojiChar of stinkyData.value.split(' ')) {
          try {
            await message.react(emojiChar);
            console.debug(`[DEBUG] Reacted with word emoji: ${emojiChar}`);
          } catch (err) {
            console.error('[DEBUG] Error reacting with word emoji:', err);
          }
        }
      }
      const reactedMessages = loadData(guildId, 'reacted_messages.json');
      reactedMessages[message.id] = true;
      saveData(guildId, 'reacted_messages.json', reactedMessages);
      console.debug('[DEBUG] Updated reactedMessages data.');
    } catch (err) {
      console.error('[DEBUG] Error with stinky configuration reactions:', err);
    }
  }
  saveData(guildId, 'count.json', count);
  console.debug('[DEBUG] Finished processing message.');
}

async function transformAndReplyLinks(
  client: Client,
  message: Message,
  regex: RegExp,
  templateUrl: string,
): Promise<void> {
  const matches = message.content.match(regex);
  if (!matches) {
    console.debug('[DEBUG] No matches found for link transformation.');
    return;
  }

  // Ensure the channel supports sending messages.
  if (!canSend(message.channel)) {
    console.debug('[DEBUG] Channel does not support sending messages.');
    return;
  }
  const textChannel = message.channel as TextChannel;
  console.debug('[DEBUG] Found matches for transformation:', matches);

  const confirmed = await getConfirmation(message.author, textChannel);
  console.debug(`[DEBUG] Link transformation confirmation: ${confirmed}`);
  if (confirmed === true || confirmed === null) {
    try {
      await message.delete();
      console.debug('[DEBUG] Deleted original message for transformation.');
    } catch (err) {
      console.error('[DEBUG] Error deleting original message:', err);
      return;
    }
    let transformedContent = message.content.replace(/<@!?[0-9]+>/g, '').trim();
    transformedContent = transformedContent.replace(regex, (_match) => {
      return templateUrl.replace('{}', _match);
    });
    console.debug('[DEBUG] Transformed message content:', transformedContent);

    // Determine target channel.
    let targetChannelId: Snowflake = textChannel.id;
    const specifiedChannelId: Snowflake = '1208544659643699200';
    if (
      message.guild &&
      message.guild.id === '1113266261619642398' &&
      textChannel.id !== specifiedChannelId
    ) {
      targetChannelId = specifiedChannelId;
      console.debug('[DEBUG] Overriding target channel for specific guild.');
    }
    const targetChannel = client.channels.cache.get(targetChannelId);
    if (!targetChannel || !canSend(targetChannel)) {
      console.debug(
        '[DEBUG] Target channel not found or cannot send messages.',
      );
      return;
    }

    try {
      const newMessage = await targetChannel.send({
        content: transformedContent,
        allowedMentions: { parse: [] },
      });
      console.debug('[DEBUG] Sent transformed message:', newMessage.id);
      await newMessage.react('🗑️');

      // If target differs from original, send a reference message.
      if (targetChannelId !== textChannel.id) {
        const mentions = message.mentions.users.map((user) => user.toString());
        const mentionText = mentions.join(', ');
        const referenceText = `${mentionText ? mentionText + ', ' : ''}${message.author} sent slop for you to see. [Click here](${newMessage.url})`;
        await textChannel.send({
          content: referenceText,
          allowedMentions: { parse: [] },
        });
        console.debug('[DEBUG] Sent reference message in original channel.');

        const messageIdMap = loadData(message.guild!.id, 'message_id_map.json');
        messageIdMap[newMessage.id] = {
          new_message_id: newMessage.id,
          reference_channel_id: textChannel.id,
        };
        saveData(message.guild!.id, 'message_id_map.json', messageIdMap);
        console.debug('[DEBUG] Updated message_id_map data.');
      }
    } catch (err) {
      console.error('[DEBUG] Error sending transformed message:', err);
    }
  } else if (confirmed === false) {
    console.debug('[DEBUG] User declined link transformation.');
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

  let confirmationMessage;
  try {
    confirmationMessage = await channel.send({
      content: `${user}, do you want to replace the original link with a new one?`,
      components: [row],
    });
    console.debug('[DEBUG] Sent confirmation message for link transformation.');
  } catch (err) {
    console.error('[DEBUG] Error sending confirmation message:', err);
    return false;
  }

  try {
    const filter = (interaction: any) => interaction.user.id === user.id;
    const collected = await confirmationMessage.awaitMessageComponent({
      filter,
      componentType: ComponentType.Button,
      time: 30000,
    });
    await collected.deferUpdate();
    await confirmationMessage.delete();
    console.debug(`[DEBUG] Collected confirmation: ${collected.customId}`);
    return collected.customId === 'confirm_yes' ? true : false;
  } catch (err) {
    // On timeout, delete the confirmation message and default to confirmation.
    console.debug('[DEBUG] Confirmation timeout reached.');
    try {
      await confirmationMessage.delete();
    } catch (err2) {
      console.error(
        '[DEBUG] Error deleting confirmation message on timeout:',
        err2,
      );
    }
    return true;
  }
}
