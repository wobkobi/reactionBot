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
  MessageFlags,
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
}

/**
 * Acknowledges a click: a private reply when the button has one to give, else
 * clears the prompt's buttons. Replies rather than updates - `update` makes the
 * prompt this interaction's original response, which the cleanup then deletes,
 * dropping any later `followUp` against it.
 * @param i - The click to acknowledge.
 * @param [privateReply] - Ephemeral text for this button, if it has any.
 * @returns A promise that resolves once the response is sent or logged.
 */
async function answerClick(i: ButtonInteraction, privateReply?: string): Promise<void> {
  if (privateReply === undefined) {
    await i.update({ components: [] }).catch(() => {});
    return;
  }
  await i.reply({ content: privateReply, flags: MessageFlags.Ephemeral }).catch((err: unknown) => {
    log.warn("failed to answer click privately", {
      choice: i.customId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Ask `author` to pick one of `buttons` in `channel`.
 * - Only `author` clicks are accepted; everyone else's are ignored.
 * - `grace: "instant"` resolves to `opts.instantChoice` without showing UI.
 *   `"disabled"` waits indefinitely.
 * - A button in `opts.privateReplies` answers the clicker ephemerally.
 * - On end: deletes the prompt if `autoDelete` and `grace !== "disabled"`,
 *   else strips the buttons so it cannot be clicked later.
 * @param channel - Target channel for the prompt.
 * @param author - The only user whose clicks count.
 * @param buttons - The choices to offer, in display order.
 * @param [opts] - Prompt and behaviour controls.
 * @param [opts.instantChoice] - Choice returned when `grace` is `"instant"`.
 * @returns The chosen button id.
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
    return { choice: opts.instantChoice ?? null };
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
    return { choice: null };
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
  // "end" fires without waiting on "collect", so cleanup would race the click's
  // response. Park it here for "end" to await.
  let answered: Promise<void> = Promise.resolve();

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    max: 1,
    time,
    filter: (i: ButtonInteraction) => i.user.id === author.id && ids.has(i.customId),
  });

  collector.on("collect", (i: ButtonInteraction) => {
    choice = i.customId;
    log.debug("choice click", { userId: i.user.id, choice: i.customId });
    answered = answerClick(i, opts.privateReplies?.[i.customId]);
  });

  return new Promise((resolve) => {
    collector.on("end", async () => {
      await answered;
      if (autoDelete && grace !== "disabled") {
        await msg.delete().catch(() => {});
        log.debug("prompt deleted", { messageId: msg.id });
      } else {
        // If not auto-deleting, strip buttons so it can't be clicked later
        await msg.edit({ components: [] }).catch(() => {});
        log.debug("prompt buttons cleared", { messageId: msg.id });
      }
      resolve({ choice });
    });
  });
}
