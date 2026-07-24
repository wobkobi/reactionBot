// src/commands/calmdown.ts

import {
  calmUntil,
  DEFAULT_CALM_MS,
  getAutoCalm,
  setAutoCalm,
  startCalm,
  stopCalm,
} from "@/tracking/calm.js";
import { createLogger } from "@/utils/log.js";
import { requireAdmin } from "@/utils/permissions.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

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
  .setContexts(InteractionContextType.Guild);

/**
 * Executes `/calmdown`: starts or stops the guild's calm window. Admin only.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Use in a server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!(await requireAdmin(interaction))) return;

  const guildId = interaction.guildId;
  if (interaction.options.getSubcommand() === "auto") {
    const current = getAutoCalm(guildId);
    const minutes = interaction.options.getInteger("minutes");
    const messages = interaction.options.getInteger("messages");
    if (minutes === null && messages === null) {
      await interaction.reply(
        `Auto-calm: ${Math.round(current.ms / 60_000)} minutes or ${current.messages} messages, whichever comes first.`,
      );
      return;
    }
    const nextMs = minutes !== null ? minutes * 60_000 : current.ms;
    const nextMessages = messages ?? current.messages;
    setAutoCalm(guildId, nextMs, nextMessages);
    log.info("auto-calm updated via command", { guildId, by: interaction.user.id });
    await interaction.reply(
      `✅ Auto-calm set to ${Math.round(nextMs / 60_000)} minutes or ${nextMessages} messages, whichever comes first.`,
    );
    return;
  }
  if (interaction.options.getSubcommand() === "stop") {
    const wasCalm = calmUntil(guildId) !== null;
    stopCalm(guildId);
    log.info("calm stopped via command", { guildId, by: interaction.user.id });
    await interaction.reply(
      wasCalm ? "GIF replies are back on." : "Calm mode wasn't on - nothing to stop.",
    );
    return;
  }

  const minutes = interaction.options.getInteger("minutes");
  const until = startCalm(guildId, minutes ? minutes * 60_000 : DEFAULT_CALM_MS);
  log.info("calm started via command", { guildId, minutes, by: interaction.user.id });
  await interaction.reply(
    `😌 Calm mode on - no GIF replies until <t:${Math.floor(until / 1000)}:t>.`,
  );
}
