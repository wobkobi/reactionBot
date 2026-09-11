// src/commands/setmediachannel.ts

import { loadSettings, saveSettings } from "@/media/settings";
import { createLogger } from "@/utils/log";
import { requireAdmin } from "@/utils/permissions";
import { respond } from "@/utils/respond";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import {
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  TextChannel,
} from "discord.js";

const log = createLogger("cmd/setmediachannel");

/**
 * What the bot needs in a media channel to move a post into it, paired with
 * the name Discord shows in its own permission editor so a refusal names the
 * checkbox to tick rather than a flag.
 */
const MEDIA_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel, label: "View Channel" },
  { flag: PermissionFlagsBits.SendMessages, label: "Send Messages" },
] as const;

/**
 * Names the permissions the bot is short of in a prospective media channel.
 * Storing a channel it cannot post in breaks every move made afterwards, and
 * does so silently at the far end of a flow nobody is watching.
 * @param perms - The bot's resolved permissions in the channel.
 * @returns The missing permission names, empty when the channel is usable.
 */
export function missingMediaPermissions(perms: Readonly<PermissionsBitField>): string[] {
  return MEDIA_PERMISSIONS.filter((p) => !perms.has(p.flag)).map((p) => p.label);
}

/**
 * Command definition for /setmediachannel. The picker only offers text
 * channels, so a category or voice channel can't be chosen by mistake.
 */
export const data = new SlashCommandBuilder()
  .setName("setmediachannel")
  .setDescription("📺 Set where media links get reposted")
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Text channel to post transformed media into")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Executes the `/setmediachannel` command: authorises the invoker, persists
 * the target channel, and confirms to the user.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply has been sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    log.warn("invoked outside guild", { userId: interaction.user.id });
    await respond(interaction, { content: "Use in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = interaction.options.getChannel("channel", true) as TextChannel;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (!(await requireAdmin(interaction))) {
    log.warn("permission denied", { guildId, userId });
    return;
  }

  log.debug("invoked", { guildId, userId, targetChannelId: channel.id });

  // Read the bot's own permissions off the cached channel rather than the
  // option, which Discord resolves without overwrites applied. Being unable to
  // read them is not the same as their being absent, so an unresolvable
  // channel is saved and left to the runtime notice - refusing there would
  // block a legitimate config over the bot's own missing cache.
  const resolved = interaction.guild?.channels.cache.get(channel.id);
  const me = interaction.guild?.members.me;
  const perms = resolved && me ? resolved.permissionsFor(me) : null;
  if (perms) {
    const missing = missingMediaPermissions(perms);
    if (missing.length > 0) {
      log.warn("refused a channel the bot cannot post in", {
        guildId,
        channelId: channel.id,
        missing,
      });
      await respond(interaction, {
        content:
          `❌ I can't post in ${channel} - I'm missing **${missing.join("** and **")}** there.\n` +
          `Grant me those in that channel and run this again.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } else {
    log.warn("could not read own permissions, saving unchecked", {
      guildId,
      channelId: channel.id,
    });
  }

  try {
    const settings = loadSettings(guildId);
    settings.channelId = channel.id;
    saveSettings(guildId, settings);

    log.info("media channel set", { guildId, channelId: channel.id, by: userId });

    await respond(interaction, {
      content: `✅ Media channel set to ${channel}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    log.error("failed to set media channel", {
      guildId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    await respond(interaction, {
      content: "⚠️ There was an error.",
      flags: MessageFlags.Ephemeral,
    });
  }
}
