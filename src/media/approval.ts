// src/media/approval.ts

// Button prompts with grace handling: requestChoice takes any button set and
// returns which one was clicked. Only the intended author's clicks count.

import { ApprovalOptions, GraceSetting } from "@/media/types";
import { createLogger } from "@/utils/log";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  GuildTextBasedChannel,
  User,
} from "discord.js";

const log = createLogger("media/approval");

/** One button in a {@link requestChoice} prompt. */
export interface ChoiceButton {
  /** Custom ID, unique within this prompt; returned as the choice. */
  id: string;
  /** Text shown on the button. */
  label: string;
  /** Optional emoji shown before the label. */
  emoji?: string;
  /** Discord button styling. */
  style: ButtonStyle;
}

/** Outcome of a {@link requestChoice} prompt. */
export interface ChoiceOutcome {
  /** The clicked button's id, or null on timeout or send failure. */
  choice: string | null;
  /**
   * The click interaction, so callers can answer the clicker privately. Null
   * when nothing was clicked. Already acknowledged by the collector, so use
   * `followUp` rather than `reply`.
   */
  interaction: ButtonInteraction | null;
}

/**
 * Ask `author` to pick one of `buttons` in `channel`.
 * - Only `author` clicks are accepted; everyone else's are ignored.
 * - `grace: "instant"` resolves to `opts.instantChoice` without showing UI.
 *   `"disabled"` waits indefinitely.
 * - On end: deletes the prompt if `autoDelete` and `grace !== "disabled"`,
 *   else strips the buttons so it cannot be clicked later.
 * @param channel - Target channel for the prompt.
 * @param author - The only user whose clicks count.
 * @param buttons - The choices to offer, in display order.
 * @param [opts] - Prompt and behaviour controls.
 * @param [opts.instantChoice] - Choice returned when `grace` is `"instant"`.
 * @returns The chosen button id and the click interaction.
 */
export async function requestChoice(
  channel: GuildTextBasedChannel,
  author: User,
  buttons: ChoiceButton[],
  opts: ApprovalOptions & { instantChoice?: string } = {},
): Promise<ChoiceOutcome> {
  const promptText = opts.prompt ?? `${author}, proceed?`;
  const grace: GraceSetting = opts.grace ?? 10_000; // ms default
  const autoDelete = opts.autoDelete ?? grace !== "disabled";

  // Instant path: resolve without showing UI
  if (grace === "instant") {
    log.debug("instant choice", { channelId: channel.id, userId: author.id });
    return { choice: opts.instantChoice ?? null, interaction: null };
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    buttons.map((b) => {
      const button = new ButtonBuilder().setCustomId(b.id).setLabel(b.label).setStyle(b.style);
      if (b.emoji) button.setEmoji(b.emoji);
      return button;
    }),
  );

  const msg = await channel
    .send({
      content: promptText,
      components: [row],
      allowedMentions: { parse: [] }, // avoid accidental pings
    })
    .catch(() => null);
  if (!msg) {
    log.warn("failed to send choice prompt", {
      channelId: channel.id,
      userId: author.id,
    });
    return { choice: null, interaction: null };
  }

  // Collector config
  const time =
    typeof grace === "number" && Number.isFinite(grace) && grace >= 0
      ? grace
      : grace === "disabled"
        ? undefined
        : 10_000;

  const ids = new Set(buttons.map((b) => b.id));
  let choice: string | null = null;
  let clicked: ButtonInteraction | null = null;

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    max: 1,
    time,
    filter: (i: ButtonInteraction) => i.user.id === author.id && ids.has(i.customId),
  });

  collector.on("collect", async (i: ButtonInteraction) => {
    choice = i.customId;
    clicked = i;
    log.debug("choice click", { userId: i.user.id, choice: i.customId });
    await i.update({ components: [] }).catch(() => {});
  });

  return new Promise((resolve) => {
    collector.on("end", async () => {
      if (autoDelete && grace !== "disabled") {
        await msg.delete().catch(() => {});
        log.debug("prompt deleted", { messageId: msg.id });
      } else {
        // If not auto-deleting, strip buttons so it can't be clicked later
        await msg.edit({ components: [] }).catch(() => {});
        log.debug("prompt buttons cleared", { messageId: msg.id });
      }
      resolve({ choice, interaction: clicked });
    });
  });
}
