// src/commands/setmediachannel.ts

import { loadSettings, saveSettings } from "@/media/settings";
import { createLogger } from "@/utils/log";
import { requireAdmin } from "@/utils/permissions";
import { respond } from "@/utils/respond";
import {
  ChannelType,
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
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
 * channels, so a category or voice channel can't be chosen by mistake. The
 * channel is optional: leaving it out clears the setting.
 */
export const data = new SlashCommandBuilder()
  .setName("setmediachannel")
  .setDescription("📺 Set or clear where media links get reposted")
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription(
        "Text channel to repost media into - leave empty to rewrite links where posted",
      )
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Removes the guild's media channel. With none stored, the target resolves to
 * the channel each link was posted in, so links get rewritten in place.
 * @param interaction - The command interaction context, already authorised.
 * @param guildId - The guild to clear the setting for.
 * @returns A promise that resolves when the reply has been sent.
 */
async function clearMediaChannel(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  try {
    const settings = loadSettings(guildId);
    const previous = settings.channelId;
    if (!previous) {
      await respond(interaction, {
        content: "ℹ️ No media channel is set - links are already rewritten where they're posted.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    delete settings.channelId;
    saveSettings(guildId, settings);

    log.info(
      "media channel cleared",
      { guildId, by: interaction.user.username },
      { previousId: previous, byId: interaction.user.id },
    );

    await respond(interaction, {
      content: `✅ Media channel cleared (was <#${previous}>). Links now get rewritten in the channel they're posted in.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    log.error("failed to clear media channel", {
      guildId,
      userId: interaction.user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    await respond(interaction, {
      content: "⚠️ There was an error.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Executes the `/setmediachannel` command: authorises the invoker, then
 * persists the target channel, or clears it when none was given, and
 * confirms to the user.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply has been sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    log.warn("invoked outside guild", { userId: interaction.user.id });
    await respond(interaction, { content: "Use in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = interaction.options.getChannel("channel") as TextChannel | null;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (!(await requireAdmin(interaction))) {
    log.warn("permission denied", { guildId, userId });
    return;
  }

  log.debug("invoked", { guildId, userId, targetChannelId: channel?.id ?? null });

  if (!channel) {
    await clearMediaChannel(interaction, guildId);
    return;
  }

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

    log.info(
      "media channel set",
      { guildId, channel: channel.name, by: interaction.user.username },
      { channelId: channel.id, byId: userId },
    );

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
