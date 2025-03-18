// src/events/messageCreate.ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ComponentType,
  Message,
  Snowflake,
  TextChannel,
} from "discord.js";
import {
  BRITISH,
  DRAMA_LLAMA,
  GIRLS,
  NWORD,
  REGEX_NWORD,
  REGEX_NWORD_HARDR,
  SLAY,
} from "../regex.js";
import { loadData, saveData } from "../utils/file.js";

/**
 * Type guard to check if a channel has a send() method.
 */
function canSend(
  channel: any
): channel is { send: (...args: any[]) => Promise<any> } {
  return typeof channel.send === "function";
}

/**
 * Transforms a Twitter URL.
 * Expects input like: https://x.com/shitpost_2077/status/1901430784483115510
 * Returns: https://vxtwitter.com/shitpost_2077/status/1901430784483115510
 */
function transformTwitterLink(url: string): string {
  const match = url.match(
    /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/(.+)/i
  );
  return match ? "https://vxtwitter.com/" + match[1] : url;
}

/**
 * Transforms an Instagram URL.
 * For reels or posts, extracts the type and ID and returns a URL without query parameters.
 * e.g. https://www.instagram.com/reel/DEsgl4vyuwB/?igsh=... becomes https://ddinstagram.com/reel/DEsgl4vyuwB/
 */
function transformInstagramLink(url: string): string {
  const match = url.match(
    /https?:\/\/(?:www\.)?instagram\.com\/(reel|p)\/([^/?]+)/i
  );
  return match
    ? "https://ddinstagram.com/" + match[1] + "/" + match[2] + "/"
    : url;
}

/**
 * Transforms a TikTok URL.
 * If the URL starts with vt.tiktok.com, returns https://vt.vxtiktok.com/<id>/.
 * Otherwise, if it matches a normal tiktok.com URL, returns https://www.vxtiktok.com/<rest>.
 */
function transformTikTokLink(url: string): string {
  let match = url.match(/https?:\/\/(?:www\.)?vt\.tiktok\.com\/([^/?]+)/i);
  if (match) return "https://vt.vxtiktok.com/" + match[1] + "/";
  match = url.match(/https?:\/\/(?:www\.)?tiktok\.com\/(.+)/i);
  return match ? "https://www.vxtiktok.com/" + match[1] : url;
}

/**
 * Generic link transformer.
 * Finds URLs in the message content, applies transformFn,
 * and if any URL is transformed, asks for confirmation and then
 * deletes the original message and sends the transformed content.
 */
async function transformAndReplyLinks(
  client: Client,
  message: Message,
  transformFn: (url: string) => string
): Promise<void> {
  const urlRegex = /https?:\/\/[^\s]+/gi;
  const matches = message.content.match(urlRegex);
  if (!matches) return;

  const transformedPairs = matches
    .map((url) => {
      const newUrl = transformFn(url);
      return { original: url, transformed: newUrl };
    })
    .filter((pair) => pair.original !== pair.transformed);

  if (transformedPairs.length === 0) return;
  const { original, transformed } = transformedPairs[0];

  if (!canSend(message.channel)) return;
  const textChannel = message.channel as TextChannel;
  const confirmed = await getConfirmation(message.author, textChannel);
  if (confirmed === true || confirmed === null) {
    try {
      await message.delete();
    } catch (err) {
      console.error("Error deleting original message:", err);
      return;
    }
    const transformedContent = message.content.replace(original, transformed);
    let targetChannelId: Snowflake = textChannel.id;
    const specifiedChannelId: Snowflake = "1208544659643699200";
    if (
      message.guild &&
      message.guild.id === "1113266261619642398" &&
      textChannel.id !== specifiedChannelId
    ) {
      targetChannelId = specifiedChannelId;
    }
    const targetChannel = client.channels.cache.get(targetChannelId);
    if (!targetChannel || !canSend(targetChannel)) return;
    try {
      const newMessage = await targetChannel.send({
        content: transformedContent,
        allowedMentions: { parse: [] },
      });
      await newMessage.react("🗑️");
      if (targetChannelId !== textChannel.id) {
        await textChannel.send({
          content: `${message.author} sent a transformed link. [Click here](${newMessage.url})`,
          allowedMentions: { parse: [] },
        });
        const messageIdMap = loadData(message.guild!.id, "message_id_map.json");
        messageIdMap[newMessage.id] = {
          new_message_id: newMessage.id,
          reference_channel_id: textChannel.id,
        };
        saveData(message.guild!.id, "message_id_map.json", messageIdMap);
      }
    } catch (err) {
      console.error("Error sending transformed message:", err);
    }
  }
}

async function getConfirmation(
  user: any,
  channel: TextChannel
): Promise<boolean | null> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("confirm_yes")
      .setLabel("Yes")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("confirm_no")
      .setLabel("No")
      .setStyle(ButtonStyle.Danger)
  );

  let confirmationMessage;
  try {
    confirmationMessage = await channel.send({
      content: `${user}, replace the original link with the transformed one?`,
      components: [row],
    });
  } catch (err) {
    console.error("Error sending confirmation message:", err);
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
    return collected.customId === "confirm_yes" ? true : false;
  } catch (err) {
    try {
      await confirmationMessage.delete();
    } catch (err2) {
      console.error("Error deleting confirmation on timeout:", err2);
    }
    return true;
  }
}

export async function handleMessageCreate(
  client: Client,
  message: Message
): Promise<void> {
  // Key log for incoming message.
  if (message.author.bot || !message.guild) return;

  const guildId: Snowflake = message.guild.id;
  const userId: string = message.author.id;

  // Load configuration data.
  const stinky = loadData(guildId, "stinky.json");
  const reactedMessages = loadData(guildId, "reacted_messages.json");
  let count: any = loadData(guildId, "count.json") || {
    count_since_last_poo: 0,
    count_since_last_clown: 0,
    last_message_with_poo: null,
    last_message_with_clown: null,
    total_poo: 0,
    total_clown: 0,
  };
  count.count_since_last_poo++;
  count.count_since_last_clown++;

  let slayData: any = loadData(guildId, "slay.json") || {
    last_mention: null,
    total_count: 0,
    user_counts: {},
  };

  // Process SLAY keyword.
  if (SLAY.test(message.content)) {
    const now = new Date();
    slayData.total_count++;
    slayData.user_counts[userId] = (slayData.user_counts[userId] || 0) + 1;
    if (slayData.last_mention) {
      const timeDelta =
        now.getTime() - new Date(slayData.last_mention).getTime();
      const days = Math.floor(timeDelta / (1000 * 60 * 60 * 24));
      if (days >= 7 && canSend(message.channel)) {
        await (message.channel as TextChannel).send(
          "Congratulations everyone! We've gone 7 days without saying slay!"
        );
        slayData = { last_mention: null, total_count: 0, user_counts: {} };
        saveData(guildId, "slay.json", slayData);
        return;
      }
    }
    slayData.last_mention = now.toISOString();
    await message.reply(
      `You just said SLAY for the ${slayData.user_counts[userId]} time! Total: ${slayData.total_count}.`
    );
    saveData(guildId, "slay.json", slayData);
  }

  // Random reactions.
  if (Math.random() < 0.001 && canSend(message.channel)) {
    try {
      await message.react("💩");
    } catch (err) {
      console.error("Error reacting with 💩:", err);
    }
    count.total_poo++;
    if (count.last_message_with_poo) {
      const link = `https://discord.com/channels/${guildId}/${message.channel.id}/${count.last_message_with_poo}`;
      try {
        await message.reply({
          content: `Reacted with 💩 after ${count.count_since_last_poo} messages. Total: ${count.total_poo}. Last reaction: ${link}`,
          allowedMentions: { parse: [] },
        });
      } catch (err) {
        console.error("Error replying for 💩 reaction:", err);
      }
    }
    count.count_since_last_poo = 0;
    count.last_message_with_poo = message.id;
  }
  if (Math.random() < 0.00004) {
    const clownEmoji = message.guild.emojis.cache.find(
      (e) => e.name === "clown"
    );
    try {
      if (clownEmoji) {
        await message.react(clownEmoji);
      } else {
        await message.react("🤡");
      }
    } catch (err) {
      console.error("Error reacting with 🤡:", err);
    }
    count.total_clown++;
    if (count.last_message_with_clown && canSend(message.channel)) {
      const link = `https://discord.com/channels/${guildId}/${message.channel.id}/${count.last_message_with_clown}`;
      try {
        await (message.channel as TextChannel).send(
          `Reacted with 🤡 after ${count.count_since_last_clown} messages. Total: ${count.total_clown}. Last reaction: ${link}`
        );
      } catch (err) {
        console.error("Error sending message for 🤡 reaction:", err);
      }
    }
    count.count_since_last_clown = 0;
    count.last_message_with_clown = message.id;
  }

  // Process link transformations.
  await transformAndReplyLinks(client, message, transformTwitterLink);
  await transformAndReplyLinks(client, message, transformInstagramLink);
  await transformAndReplyLinks(client, message, transformTikTokLink);

  // React to drama llama.
  if (DRAMA_LLAMA.test(message.content) || message.content.includes("🦙")) {
    try {
      await message.react("🦙");
    } catch (err) {
      console.error("Error reacting with 🦙:", err);
    }
  }

  // React based on GIRLS and BRITISH patterns.
  if (
    GIRLS.some((r) => r.test(message.content)) ||
    BRITISH.some((r) => r.test(message.content))
  ) {
    try {
      await message.react(
        GIRLS.some((r) => r.test(message.content)) ? "💅" : "🇬🇧"
      );
    } catch (err) {
      console.error("Error reacting with GIRLS/BRITISH emoji:", err);
    }
  }

  // React with N-word emojis if matching.
  if (
    REGEX_NWORD_HARDR.test(message.content) ||
    REGEX_NWORD.test(message.content)
  ) {
    for (const emoji of NWORD.split(" ")) {
      try {
        await message.react(emoji);
      } catch (err) {
        console.error("Error reacting with N-word emoji:", err);
      }
    }
  }

  // React based on user-specific stinky configuration.
  if (stinky[userId]) {
    if (Math.floor(Math.random() * 10) === 0) {
      const cfg = stinky[userId];
      if (cfg.type === "emoji") {
        try {
          await message.react(cfg.value);
        } catch (err) {
          console.error("Error reacting with stinky emoji:", err);
        }
      } else if (cfg.type === "custom_emoji") {
        const custom = message.guild.emojis.cache.find(
          (e) => e.name === cfg.value
        );
        if (custom) {
          try {
            await message.react(custom);
          } catch (err) {
            console.error("Error reacting with custom stinky emoji:", err);
          }
        }
      } else if (cfg.type === "word") {
        for (const ch of cfg.value.split(" ")) {
          try {
            await message.react(ch);
          } catch (err) {
            console.error("Error reacting with stinky word emoji:", err);
          }
        }
      }
      const reacted = loadData(guildId, "reacted_messages.json");
      reacted[message.id] = true;
      saveData(guildId, "reacted_messages.json", reacted);
    }
  }
  saveData(guildId, "count.json", count);
}
