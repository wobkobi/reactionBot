// src/commands/kick.ts

import { isAdmin } from "@/utils/permissions";
import { respond } from "@/utils/respond";
import { botChannelId, kickFromChannel, type KickOutcome } from "@/voice/autojoin";
import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("kick")
  .setDescription("👋 Throw the bot out of the voice call you are in")
  .setContexts(InteractionContextType.Guild);

/**
 * Whether this caller may toss for the bot's call. Sitting in it is what earns
 * the right: otherwise anyone in the server can throw the bot out of a call
 * they are not part of, which is the griefing this command would invite. An
 * admin is trusted with it from anywhere, so removing the bot never means
 * barging into someone's call first.
 * @param callerChannelId - The voice channel the caller is in, or null.
 * @param inCall - The channel the bot is in, or on its way to.
 * @param admin - Whether the caller may run admin commands.
 * @returns `true` when the toss may go ahead.
 */
export function mayKick(callerChannelId: string | null, inCall: string, admin: boolean): boolean {
  return admin || callerChannelId === inCall;
}

/**
 * Words the outcome for the caller. A contested call says so, since "the coin
 * said no" is only fair if people can tell the bot has started tossing.
 * @param kick - What the kick came to.
 * @returns The reply text.
 */
function kickOutcome(kick: KickOutcome): string {
  switch (kick.verdict) {
    case "cooldown":
      return `⏳ The bot is being fought over, so it is deciding by coin. Next toss in ${Math.ceil(kick.remainingMs / 1000)}s.`;
    case "lost":
      return `🪙 Tails. The bot is being fought over, so it tossed for it, and it is staying in <#${kick.channelId}>.`;
    case "won":
      return `🪙 Heads. The bot is being fought over, so it tossed for it, and it is out of <#${kick.channelId}>.`;
    default:
      return `👋 Left <#${kick.channelId}>.`;
  }
}

/**
 * Runs /kick. Open to everyone in the call: whoever is in it decides whether
 * the bot belongs there. The autojoin setting is left alone, so the next call
 * still gets the bot - see {@link kickFromChannel} for what happens once two
 * people start tugging at it.
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
  const guildId = interaction.guildId;

  const inCall = botChannelId(guildId);
  if (!inCall) {
    await respond(interaction, {
      content: "Not in a voice channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Read from the voice state cache, the same thing the auto-join watches, so
  // a caller who has just moved is placed where the rest of the bot has them.
  const caller = interaction.guild?.voiceStates.cache.get(interaction.user.id)?.channelId ?? null;
  if (!mayKick(caller, inCall, isAdmin(interaction))) {
    await respond(interaction, {
      content: `❌ The bot is in <#${inCall}>. Join that call to have a go at it.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Nothing has been awaited since the channel was read, so this cannot have
  // gone away underneath; the guard is here because the types allow it.
  const kick = kickFromChannel(guildId);
  await respond(interaction, {
    content: kick ? kickOutcome(kick) : "Not in a voice channel.",
    flags: MessageFlags.Ephemeral,
  });
}
