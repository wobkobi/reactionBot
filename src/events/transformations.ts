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
  INSTAGRAM_DOMAIN_REGEX,
  TIKTOK_DOMAIN_REGEX,
  TWITTER_DOMAIN_REGEX,
} from "../regex.js";
import { loadData, saveData } from "../utils/file.js";

/**
 * Checks if a given URL's hostname is in the allowed list.
 */
function isAllowedHost(url: string, allowedHosts: string[]): boolean {
  try {
    const parsed = new URL(url);
    return allowedHosts.includes(parsed.hostname.toLowerCase());
  } catch (e) {
    return false;
  }
}

/**
 * Transforms a Twitter URL.
 * Example:
 *   https://x.com/shitpost_2077/status/1901430784483115510
 * becomes:
 *   https://vxtwitter.com/shitpost_2077/status/1901430784483115510
 *
 * Only transforms if the hostname is one of the allowed hosts.
 */
export function transformTwitterLink(url: string): string {
  const allowedHosts = ["x.com", "twitter.com", "www.x.com", "www.twitter.com"];
  if (!isAllowedHost(url, allowedHosts)) return url;

  const match = url.match(TWITTER_DOMAIN_REGEX);
  return match ? "https://vxtwitter.com/" + match[2] : url;
}

/**
 * Transforms an Instagram URL.
 * Example:
 *   https://www.instagram.com/reel/DEsgl4vyuwB/?igsh=...
 * becomes:
 *   https://ddinstagram.com/reel/DEsgl4vyuwB/
 *
 * Only transforms if the hostname is allowed.
 */
export function transformInstagramLink(url: string): string {
  const allowedHosts = ["instagram.com", "www.instagram.com"];
  if (!isAllowedHost(url, allowedHosts)) return url;

  const match = url.match(INSTAGRAM_DOMAIN_REGEX);
  if (match) {
    // match[1] contains the rest of the URL, e.g. "reel/DEsgl4vyuwB/?igsh=..."
    const parts = match[1].split("/");
    if (parts.length >= 2 && (parts[0] === "reel" || parts[0] === "p")) {
      return "https://ddinstagram.com/" + parts[0] + "/" + parts[1] + "/";
    }
  }
  return url;
}

/**
 * Transforms a TikTok URL.
 * If the URL comes from vt.tiktok.com, returns:
 *   https://vt.vxtiktok.com/<id>/
 * Otherwise, for normal tiktok.com URLs, returns:
 *   https://www.vxtiktok.com/<rest>
 *
 * Only transforms if the hostname is one of the allowed hosts.
 */
export function transformTikTokLink(url: string): string {
  const allowedHosts = [
    "tiktok.com",
    "www.tiktok.com",
    "vt.tiktok.com",
    "www.vt.tiktok.com",
  ];
  if (!isAllowedHost(url, allowedHosts)) return url;

  const match = url.match(TIKTOK_DOMAIN_REGEX);
  if (match) {
    if (url.includes("vt.tiktok.com")) {
      return "https://vt.vxtiktok.com/" + match[1] + "/";
    } else {
      return "https://www.vxtiktok.com/" + match[1];
    }
  }
  return url;
}

/**
 * Type guard for channels that can send messages.
 */
function canSend(
  channel: any
): channel is { send: (...args: any[]) => Promise<any> } {
  return typeof channel.send === "function";
}

/**
 * Shows a confirmation message with Yes/No buttons.
 */
export async function getConfirmation(
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

/**
 * Generic link transformer.
 * Finds URLs in the message content, applies transformFn,
 * and if a URL is transformed, asks for confirmation.
 * Upon confirmation, deletes the original message, sends the transformed content,
 * reacts with a trash can, and appends a "Delete" button that allows only the original sender
 * to delete the transformed message.
 */
export async function transformAndReplyLinks(
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
      const newMessage = await (targetChannel as TextChannel).send({
        content: transformedContent,
        allowedMentions: { parse: [] },
      });
      await newMessage.react("🗑️");
      // Append a Delete button that encodes the original sender's ID.
      const deleteRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("delete_transformed:" + message.author.id)
          .setLabel("Delete")
          .setStyle(ButtonStyle.Danger)
      );
      await newMessage.edit({ components: [deleteRow] });
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
