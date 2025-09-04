// src/handlers/approval.ts
/**
 * @file Generic approval prompt with grace handling.
 * - Shows Yes/No buttons to the intended author
 * - Respects grace: "instant" | "disabled" | number (ms)
 * - Optionally auto-deletes the prompt on resolve/timeout
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  GuildTextBasedChannel,
  User,
} from "discord.js";
import { createLogger } from "../utils/log.js";
import { ApprovalOptions } from "./types";

const log = createLogger("handlers/approval");
/**
 * Grace period behavior for the approval prompt.
 * - `"instant"`: auto-approve immediately with no UI
 * - `"disabled"`: wait indefinitely (no timeout)
 * - `number`: time in **milliseconds** to wait before the collector ends
 */
export type GraceSetting = "instant" | "disabled" | number;

/**
 * Request in-channel approval from a user via Yes/No buttons.
 * - Only `author` clicks are accepted.
 * - Resolves `true` on "Yes"; `false` on "No" or timeout.
 * - `grace: "instant"` returns `true` without sending UI. `"disabled"` waits indefinitely.
 * - On end: deletes the prompt if `autoDelete` and `grace !== "disabled"`, else clears buttons.
 * @param channel Target channel for the prompt.
 * @param author Allowed responder.
 * @param [opts] Prompt and behavior controls.
 * @param [opts.prompt] Custom text. Default: `"{author}, proceed?"`.
 * @param [opts.grace] Timeout in ms or special modes.
 * @param [opts.autoDelete] Delete prompt on end. Default: true unless grace is "disabled".
 * @returns Approval result.
 */
export async function requestApproval(
  channel: GuildTextBasedChannel,
  author: User,
  opts: ApprovalOptions = {}
): Promise<boolean> {
  const promptText = opts.prompt ?? `${author}, proceed?`;
  const grace: GraceSetting = opts.grace ?? 10_000; // ms default
  const autoDelete = opts.autoDelete ?? grace !== "disabled";

  // Instant path: approve without showing UI
  if (grace === "instant") {
    log.debug("instant approval", { channelId: channel.id, userId: author.id });
    return true;
  }

  // Compose buttons
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

  // Send prompt
  const msg = await channel
    .send({
      content: promptText,
      components: [row],
      allowedMentions: { parse: [] }, // avoid accidental pings
    })
    .catch(() => null);
  if (!msg) {
    log.warn("failed to send approval prompt", {
      channelId: channel.id,
      userId: author.id,
    });
    return false;
  }

  // Collector config
  const time =
    typeof grace === "number" && Number.isFinite(grace) && grace >= 0
      ? grace
      : grace === "disabled"
        ? undefined
        : 10_000;

  let approved = false;

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    max: 1,
    time,
    filter: (i: ButtonInteraction) => i.user.id === author.id, // only author can decide
  });

  collector.on("collect", async (i: ButtonInteraction) => {
    approved = i.customId === "yes";
    log.debug("approval click", { userId: i.user.id, approved });
    await i.update({ components: [] }).catch(() => {});
  });

  return new Promise((resolve) => {
    collector.on("end", async () => {
      if (autoDelete && grace !== "disabled") {
        await msg.delete().catch(() => {});
        log.trace("prompt deleted", { messageId: msg.id });
      } else {
        // If not auto-deleting, strip buttons so it can't be clicked later
        await msg.edit({ components: [] }).catch(() => {});
        log.trace("prompt buttons cleared", { messageId: msg.id });
      }
      resolve(approved);
    });
  });
}
