// src/commands/calmdown.ts

import {
  calmUntil,
  DEFAULT_CALM_MS,
  getAutoCalm,
  getReplyLimit,
  setAutoCalm,
  setReplyLimit,
  startCalm,
  stopCalm,
} from "@/tracking/calm";
import { createLogger } from "@/utils/log";
import { requireAdmin } from "@/utils/permissions";
import { respond } from "@/utils/respond";
import {
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

const log = createLogger("cmd/calmdown");

/** Slash command definition for `/calmdown` and its subcommands. */
export const data = new SlashCommandBuilder()
  .setName("calmdown")
  .setDescription("😌 Pause the GIF replies for a while (reactions keep going)")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("Stop replying with GIFs for a while")
      .addIntegerOption((opt) =>
        opt
          .setName("minutes")
          .setDescription("How long to stay calm (1-1440, default 30)")
          .setMinValue(1)
          .setMaxValue(1440),
      ),
  )
  .addSubcommand((sub) => sub.setName("stop").setDescription("Resume GIF replies now"))
  .addSubcommand((sub) =>
    sub
      .setName("auto")
      .setDescription("Show or change the automatic calm after a spam escalation")
      .addIntegerOption((opt) =>
        opt
          .setName("minutes")
          .setDescription("Auto-calm time limit (1-1440)")
          .setMinValue(1)
          .setMaxValue(1440),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("messages")
          .setDescription("Auto-calm message limit (1-1000)")
          .setMinValue(1)
          .setMaxValue(1000),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("limit")
      .setDescription("Show or change how many GIF replies the whole server gets per window")
      .addIntegerOption((opt) =>
        opt
          .setName("replies")
          .setDescription("Replies allowed per window, across everyone (1-100)")
          .setMinValue(1)
          .setMaxValue(100),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("minutes")
          .setDescription("Window length (1-1440)")
          .setMinValue(1)
          .setMaxValue(1440),
      ),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Describes a reply limit for a reply, e.g. "3 GIF replies per 2 minutes".
 * @param replies - Replies allowed per window.
 * @param ms - Window length in milliseconds.
 * @returns The phrase.
 */
function describeLimit(replies: number, ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return `${replies} GIF ${replies === 1 ? "reply" : "replies"} per ${minutes === 1 ? "minute" : `${minutes} minutes`}`;
}

/**
 * Executes `/calmdown limit`: shows the guild's reply limit, or changes
 * whichever of its two parts were given.
 * @param interaction - The command interaction context.
 * @param guildId - Discord guild (server) ID.
 * @returns A promise that resolves when the reply is sent.
 */
async function executeLimit(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const current = getReplyLimit(guildId);
  const replies = interaction.options.getInteger("replies");
  const minutes = interaction.options.getInteger("minutes");
  if (replies === null && minutes === null) {
    await respond(interaction, {
      content: `Reply limit: ${describeLimit(current.replies, current.ms)}, across the whole server.`,
    });
    return;
  }
  const nextReplies = replies ?? current.replies;
  const nextMs = minutes !== null ? minutes * 60_000 : current.ms;
  setReplyLimit(guildId, nextReplies, nextMs);
  log.info(
    "reply limit updated via command",
    { guildId, by: interaction.user.username, replies: nextReplies, minutes: nextMs / 60_000 },
    { byId: interaction.user.id },
  );
  await respond(interaction, {
    content: `✅ Reply limit set to ${describeLimit(nextReplies, nextMs)}, across the whole server.`,
  });
}

/**
 * Executes `/calmdown`: starts or stops the guild's calm window, or shows and
 * changes the auto-calm and reply limit settings. Admin only.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await respond(interaction, { content: "Use in a server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!(await requireAdmin(interaction))) return;

  const guildId = interaction.guildId;
  if (interaction.options.getSubcommand() === "limit") {
    await executeLimit(interaction, guildId);
    return;
  }
  if (interaction.options.getSubcommand() === "auto") {
    const current = getAutoCalm(guildId);
    const minutes = interaction.options.getInteger("minutes");
    const messages = interaction.options.getInteger("messages");
    if (minutes === null && messages === null) {
      await respond(interaction, {
        content: `Auto-calm: ${Math.round(current.ms / 60_000)} minutes or ${current.messages} messages, whichever comes first.`,
      });
      return;
    }
    const nextMs = minutes !== null ? minutes * 60_000 : current.ms;
    const nextMessages = messages ?? current.messages;
    setAutoCalm(guildId, nextMs, nextMessages);
    log.info(
      "auto-calm updated via command",
      { guildId, by: interaction.user.username, minutes: nextMs / 60_000, messages: nextMessages },
      { byId: interaction.user.id },
    );
    await respond(interaction, {
      content: `✅ Auto-calm set to ${Math.round(nextMs / 60_000)} minutes or ${nextMessages} messages, whichever comes first.`,
    });
    return;
  }
  if (interaction.options.getSubcommand() === "stop") {
    const wasCalm = calmUntil(guildId) !== null;
    stopCalm(guildId);
    log.info(
      "calm stopped via command",
      { guildId, by: interaction.user.username },
      { byId: interaction.user.id },
    );
    await respond(interaction, {
      content: wasCalm ? "GIF replies are back on." : "Calm mode wasn't on - nothing to stop.",
    });
    return;
  }

  const minutes = interaction.options.getInteger("minutes");
  const until = startCalm(guildId, minutes ? minutes * 60_000 : DEFAULT_CALM_MS);
  log.info(
    "calm started via command",
    { guildId, minutes, by: interaction.user.username },
    { byId: interaction.user.id },
  );
  await respond(interaction, {
    content: `😌 Calm mode on - no GIF replies until <t:${Math.floor(until / 1000)}:t>.`,
  });
}
