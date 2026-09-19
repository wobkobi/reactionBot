// src/voice/skipWait.ts

// The button an admin gets when a /kick or /join lands in the contest wait,
// to push it through anyway.

import { createLogger } from "@/utils/log";
import { respond } from "@/utils/respond";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";

const log = createLogger("voice/skipWait");

/**
 * Custom ID of the skip button. Only the collector on its own reply reads it,
 * so index.ts has nothing to route.
 */
const SKIP_BUTTON_ID = "voice-skip-wait";

/**
 * Answers a /kick or /join that hit the contest wait with a button that skips
 * it, and runs `act` if the caller clicks in time.
 *
 * The button lives exactly as long as the wait it skips: after that the
 * caller can simply run the command again, and a stale button clicked minutes
 * later could move the bot on a call that has since changed. The reply is
 * ephemeral, so only the caller ever sees it.
 * @param interaction - The command that hit the wait, unanswered or only
 * deferred.
 * @param content - The cooldown message to show above the button.
 * @param remainingMs - How long the wait has left.
 * @param act - Does the kick or join, and returns the text to replace the
 * reply with.
 */
export async function offerSkip(
  interaction: ChatInputCommandInteraction,
  content: string,
  remainingMs: number,
  act: () => Promise<string>,
): Promise<void> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SKIP_BUTTON_ID)
      .setLabel("Skip the wait")
      .setEmoji("⏩")
      .setStyle(ButtonStyle.Danger),
  );
  const sent = await respond(interaction, {
    content,
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
  if (!sent) return;
  const reply = await interaction.fetchReply().catch(() => null);
  if (!reply) return;

  const click = await reply
    .awaitMessageComponent({
      componentType: ComponentType.Button,
      time: remainingMs,
      filter: (i) => i.user.id === interaction.user.id && i.customId === SKIP_BUTTON_ID,
    })
    .catch(() => null);
  if (!click) {
    await interaction.editReply({ components: [] }).catch(() => undefined);
    return;
  }

  // Deferred first, since a join waits on the voice connection and can outlast
  // the three seconds a click has to be answered in.
  await click.deferUpdate().catch(() => undefined);
  log.info("admin skipped the contest wait", {
    command: interaction.commandName,
    guildId: interaction.guildId,
    userId: interaction.user.id,
  });
  // Ephemeral only matters if the deferral failed and this becomes a fresh
  // reply, which would otherwise post the outcome to the whole channel.
  await respond(click, { content: await act(), components: [], flags: MessageFlags.Ephemeral });
}
