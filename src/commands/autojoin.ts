// src/commands/autojoin.ts

import { requireAdmin } from "@/utils/permissions";
import { respond } from "@/utils/respond";
import { forgetKicks, refreshGuild } from "@/voice/autojoin";
import { sessionChannelId } from "@/voice/session";
import { setAutojoin } from "@/voice/settings";
import { hasSomethingToPlay, loadSounds } from "@/voice/sounds";
import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("autojoin")
  .setDescription("🔊 Whether the bot joins voice calls on its own")
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub.setName("on").setDescription("Join any voice channel that has people in it"),
  )
  .addSubcommand((sub) =>
    sub.setName("off").setDescription("Stay out of calls unless someone runs /join"),
  );

/**
 * Runs /autojoin. Admin only: it decides whether the bot turns up in calls
 * uninvited, which is the most intrusive thing it does. /join is unaffected.
 * @param interaction - The command interaction.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await respond(interaction, {
      content: "This only works in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!(await requireAdmin(interaction))) return;
  const guildId = interaction.guildId;

  if (interaction.options.getSubcommand() === "on") {
    setAutojoin(guildId, true);
    // Ambient sounds need no triggers, so asking for triggers alone would warn
    // that nothing will play while atmosphere is configured and working.
    const warning = hasSomethingToPlay(loadSounds(guildId))
      ? ""
      : "\n⚠️ Nothing is configured to play yet, so the bot will stay out of voice. See `data/readme.md`.";
    await respond(interaction, {
      content: `🎙️ Autojoin on. The bot joins voice channels that have people in them.${warning}`,
      flags: MessageFlags.Ephemeral,
    });
    // Switching on emits no voice state update, so without this the reply
    // promises a join that nothing carries out until someone moves channel.
    if (interaction.guild) await refreshGuild(interaction.guild);
    return;
  }

  // off: the bot stops turning up on its own but is not thrown out of a call it
  // is already in - /kick does that. Kick records go, so off then on clears
  // both the wait between tosses and the hold a won toss puts on /join.
  setAutojoin(guildId, false);
  forgetKicks(guildId);
  const channelId = sessionChannelId(guildId);
  const staying = channelId
    ? ` It stays in <#${channelId}> until that call ends, or \`/kick\` removes it.`
    : "";
  await respond(interaction, {
    content: `🔇 Autojoin off. The bot only joins on \`/join\` now.${staying}`,
    flags: MessageFlags.Ephemeral,
  });
}
