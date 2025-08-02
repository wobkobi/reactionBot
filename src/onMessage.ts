// src/onMessage.ts

/**
 * Message handler for transforming and reposting media links via button confirmation.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Message,
  TextChannel,
} from "discord.js";
import {
  INSTAGRAM_REGEX,
  REDDIT_COMMENTS_REGEX,
  REDDIT_MEDIA_REGEX,
  REDDIT_SHORT_REGEX,
  TIKTOK_FULL_REGEX,
  TIKTOK_SHORT_REGEX,
  TWITTER_X_REGEX,
} from "./regex.js";
import { loadData } from "./utils/file.js";

/**
 * Handles incoming messages and transforms supported media links.
 * Prompts the user to confirm relocation, then reposts with a proxy URL.
 * @param message - The Discord message to process.
 */
export async function onMessage(message: Message): Promise<void> {
  if (message.author.bot || !message.guild) return;

  const guildId = message.guild.id;
  const mediaCfg = loadData(guildId, "media_channel.json") as {
    channelId?: string;
  };
  const defaultChannelId = mediaCfg.channelId;

  /**
   * Attempts to match, confirm, transform, and repost a link.
   * @param regex - The RegExp to extract capture groups.
   * @param makeUrl - Function that returns the new URL given the capture groups.
   */
  async function transformAndPost(
    regex: RegExp,
    makeUrl: (...captures: string[]) => string
  ): Promise<void> {
    const match = regex.exec(message.content);
    if (!match) return;

    // Confirmation buttons
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("yes")
        .setLabel("Yes")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("no")
        .setLabel("No")
        .setStyle(ButtonStyle.Danger)
    );

    const confirmMsg = await (message.channel as TextChannel).send({
      content: `${message.author}, relocate your link?`,
      components: [row],
    });

    const collector = confirmMsg.createMessageComponentCollector({
      max: 1,
      time: 10_000,
    });

    let approved: boolean | null = null;
    collector.on("collect", async (interaction: ButtonInteraction) => {
      approved = interaction.customId === "yes";
      await interaction.update({ components: [] });
    });

    collector.on("end", async () => {
      if (approved === null) approved = true; // assume yes on timeout
      if (approved) {
        try {
          await message.delete();
        } catch {
          // ignore delete errors
        }
        // Construct new content
        const captures = match.slice(1);
        const newLink = makeUrl(...captures);
        const content = message.content.replace(regex, newLink);

        const channelId = defaultChannelId ?? message.channel.id;
        const channel = message.client.channels.cache.get(
          channelId
        ) as TextChannel;
        const sent = await channel.send({
          content,
          allowedMentions: { parse: [] },
        });
        await sent.react("🗑️");
      }
      try {
        await confirmMsg.delete();
      } catch {
        // ignore
      }
    });
  }

  await transformAndPost(
    TIKTOK_SHORT_REGEX,
    (id) => `https://vt.vxtiktok.com/${id}`
  );
  await transformAndPost(
    TIKTOK_FULL_REGEX,
    (id) => `https://www.vxtiktok.com/${id}`
  );
  await transformAndPost(
    TWITTER_X_REGEX,
    (id) => `https://vxtwitter.com/${id}`
  );
  await transformAndPost(
    INSTAGRAM_REGEX,
    (id) => `https://ddinstagram.com/${id}`
  );
  await transformAndPost(
    REDDIT_COMMENTS_REGEX,
    (id) => `https://libredd.it/${id}`
  );
  await transformAndPost(
    REDDIT_SHORT_REGEX,
    (id) => `https://libredd.it/comments/${id}`
  );
  await transformAndPost(REDDIT_MEDIA_REGEX, (_first, host, mediaId) =>
    host === "v.redd.it"
      ? `https://libredd.it/v/${mediaId}`
      : `https://libredd.it/i/${mediaId}`
  );
}
