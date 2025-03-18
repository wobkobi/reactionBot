// src/events/reactions.ts
import { Message, Snowflake, TextChannel } from "discord.js";
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
 * Processes the SLAY keyword.
 */
export async function handleSlay(message: Message): Promise<void> {
  if (!SLAY.test(message.content)) return;
  const guildId: Snowflake = message.guild!.id;
  const userId: string = message.author.id;
  let slayData: any = loadData(guildId, "slay.json") || {
    last_mention: null,
    total_count: 0,
    user_counts: {},
  };
  const now = new Date();
  slayData.total_count++;
  slayData.user_counts[userId] = (slayData.user_counts[userId] || 0) + 1;
  if (slayData.last_mention) {
    const timeDelta = now.getTime() - new Date(slayData.last_mention).getTime();
    const days = Math.floor(timeDelta / (1000 * 60 * 60 * 24));
    if (days >= 7 && message.channel) {
      // Cast to TextChannel since we're in a guild channel.
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

/**
 * Handles random reactions such as 💩 and 🤡.
 */
export async function handleRandomReactions(message: Message): Promise<void> {
  const guildId: Snowflake = message.guild!.id;
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

  // 💩 reaction.
  if (Math.random() < 0.001 && message.channel) {
    try {
      await message.react("💩");
    } catch (err) {
      console.error("Error reacting with 💩:", err);
    }
    count.total_poo++;
    if (count.last_message_with_poo) {
      const link = `https://discord.com/channels/${guildId}/${message.channel.id}/${count.last_message_with_poo}`;
      try {
        // Cast channel to TextChannel for send method.
        await (message.channel as TextChannel).send({
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

  // 🤡 reaction.
  if (Math.random() < 0.00004 && message.channel) {
    const clownEmoji = message.guild!.emojis.cache.find(
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
    if (count.last_message_with_clown && message.channel) {
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
  saveData(guildId, "count.json", count);
}

/**
 * Handles other reactions such as DRAMA_LLAMA, GIRLS/BRITISH, and N-word emojis.
 */
export async function handleOtherReactions(message: Message): Promise<void> {
  // DRAMA_LLAMA reaction.
  if (DRAMA_LLAMA.test(message.content) || message.content.includes("🦙")) {
    try {
      await message.react("🦙");
    } catch (err) {
      console.error("Error reacting with 🦙:", err);
    }
  }

  // GIRLS/BRITISH reaction.
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

  // N-word reaction.
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
}
