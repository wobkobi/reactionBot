// src/commands/join.ts

import { isAdmin } from "@/utils/permissions";
import { respond } from "@/utils/respond";
import { forceRejoin, rejoinGuild, type JoinOutcome } from "@/voice/autojoin";
import { sessionChannelId } from "@/voice/session";
import { offerSkip } from "@/voice/skipWait";
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
 * Whether this caller may summon the bot. Sitting in a call is what earns it,
 * the same bar as /kick sets: otherwise someone outside every call can
 * drop the bot into one they are not part of, and undo a kick the people in it
 * just won. An admin is trusted with it from anywhere, and then the bot picks
 * the busiest channel as autojoin would.
 * @param callerChannelId - The voice channel the caller is in, or null.
 * @param admin - Whether the caller may run admin commands.
 * @returns `true` when the join may go ahead.
 */
export function mayJoin(callerChannelId: string | null, admin: boolean): boolean {
  return admin || callerChannelId !== null;
}

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
 * Runs /join. Open to anyone in a call, as the counterpart of /kick, and to an
 * admin from anywhere - see {@link mayJoin}. An admin never faces the toss and
 * gets a button to skip the wait - see {@link offerSkip}. Lifts a kick and has
 * the bot pick a channel now, whether or not autojoin is on for the server.
 * The caller's own channel wins the choice, so asking from a quiet call does
 * not send the bot to the busiest one instead. A recent kick wins, and a call
 * that has kicked enough is left alone - see {@link rejoinGuild}.
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
  const admin = isAdmin(interaction);
  if (!mayJoin(wanted, admin)) {
    await respond(interaction, {
      content: "❌ You can't do this. Be in Voice first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // The reply waits for the outcome, and a connection can take longer to
  // become ready than an unacknowledged interaction lives.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const before = sessionChannelId(guildId);
  const guild = interaction.guild;
  const outcome: JoinOutcome = guild
    ? await rejoinGuild(guild, wanted, admin)
    : { verdict: "allowed", remainingMs: 0 };
  if (admin && guild && outcome.verdict === "cooldown") {
    const content = joinOutcome(outcome, wanted, before, sessionChannelId(guildId));
    await offerSkip(interaction, content, outcome.remainingMs, async () => {
      // Read again at the click, since the admin may have moved call while the
      // button was up and their own channel is still the one to prefer.
      const sittingIn = guild.voiceStates.cache.get(interaction.user.id)?.channelId ?? null;
      const was = sessionChannelId(guildId);
      await forceRejoin(guild, sittingIn);
      return joinOutcome(
        { verdict: "allowed", remainingMs: 0 },
        sittingIn,
        was,
        sessionChannelId(guildId),
      );
    });
    return;
  }
  await respond(interaction, {
    content: joinOutcome(outcome, wanted, before, sessionChannelId(guildId)),
    flags: MessageFlags.Ephemeral,
  });
}
