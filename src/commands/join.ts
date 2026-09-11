// src/commands/join.ts

import { respond } from "@/utils/respond";
import { rejoinGuild, type JoinOutcome } from "@/voice/autojoin";
import { sessionChannelId } from "@/voice/session";
import { hasSomethingToPlay, loadSounds } from "@/voice/sounds";
import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("join")
  .setDescription("📥 Bring the bot into a voice call, autojoin or not")
  .setContexts(InteractionContextType.Guild);

/**
 * Words the outcome for the caller. Each ending has its own line because the
 * causes want different things done about them: waiting, giving up, fixing a
 * permission, or nothing at all.
 * @param outcome - What the join came to.
 * @param wanted - The channel the caller was sitting in, or null when they
 * were not in a call.
 * @param before - Where the bot was before the attempt, or null.
 * @param after - Where the bot is now, or null.
 * @returns The reply text.
 */
function joinOutcome(
  outcome: JoinOutcome,
  wanted: string | null,
  before: string | null,
  after: string | null,
): string {
  if (outcome.verdict === "cooldown") {
    return `⏳ The bot is being fought over, so it is deciding by coin. Next toss in ${Math.ceil(outcome.remainingMs / 1000)}s.`;
  }
  if (outcome.verdict === "lost") {
    return "🪙 Tails. The bot is being fought over, so it tossed for it, and it is staying put.";
  }
  const tossed = outcome.verdict === "won" ? "🪙 Heads. " : "";
  // Asked from a channel the bot did not end up in: name that channel, since
  // the cause is something about it rather than about the server.
  if (wanted && after !== wanted) {
    const elsewhere = after ? ` It is in <#${after}>.` : "";
    return `Couldn't join <#${wanted}>. Check the bot can Connect and Speak there, and that the channel is not full.${elsewhere}`;
  }
  if (!after) {
    return "Couldn't join: no voice channel here has people in it, or the bot is already in as many calls as it can be.";
  }
  if (after === before) return `${tossed}Already in <#${after}>.`;
  return `${tossed}🎙️ Joined <#${after}>.`;
}

/**
 * Runs /join. Open to everyone, as the counterpart of /kick: lifts a kick and
 * has the bot pick a channel now, whether or not autojoin is on for the
 * server. The caller's own channel wins the choice, so asking from a quiet
 * call does not send the bot to the busiest one instead. A recent kick wins,
 * and a call that has kicked enough is left alone - see {@link rejoinGuild}.
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

  // The one reason a join can never happen gets its own answer, since
  // "nothing to join" would send someone looking at the channels instead.
  if (!hasSomethingToPlay(loadSounds(guildId))) {
    await respond(interaction, {
      content:
        "⚠️ Nothing is configured to play, so the bot stays out of voice. See `data/readme.md`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Read from the voice state cache, the same thing the auto-join watches, so
  // a caller who has just moved is placed where the rest of the bot has them.
  const wanted = interaction.guild?.voiceStates.cache.get(interaction.user.id)?.channelId ?? null;

  // The reply waits for the outcome, and a connection can take longer to
  // become ready than an unacknowledged interaction lives.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const before = sessionChannelId(guildId);
  const outcome: JoinOutcome = interaction.guild
    ? await rejoinGuild(interaction.guild, wanted)
    : { verdict: "allowed", remainingMs: 0 };
  await respond(interaction, {
    content: joinOutcome(outcome, wanted, before, sessionChannelId(guildId)),
    flags: MessageFlags.Ephemeral,
  });
}
