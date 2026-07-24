// src/media/repostActions.ts

/**
 * @file Author-only Edit/Delete buttons on moved messages.
 * Button and modal interactions are resolved against the persisted repost
 * records (see {@link getRepost}), not in-memory collectors, so they keep
 * working indefinitely and across bot restarts.
 */

import { appendDeletionLog } from "@/media/audit.js";
import { getRepost, removeRepost, saveRepost } from "@/media/repostStore.js";
import { createLogger } from "@/utils/log.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  GuildTextBasedChannel,
  Message,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

const log = createLogger("media/repostActions");

/** Custom ID of the Edit button on a moved message. */
export const EDIT_BUTTON_ID = "repost:edit";
/** Custom ID of the Delete button on a moved message. */
export const DELETE_BUTTON_ID = "repost:delete";
/** Custom ID of the edit modal and its text input. */
export const EDIT_MODAL_ID = "repost:editmodal";

/** Discord's message content cap, minus headroom for the mention prefix. */
const EDIT_MAX_LENGTH = 1_900;

/**
 * Builds the Edit/Delete button row attached to every moved message.
 * @returns An action row with the two author-only buttons.
 */
export function buildRepostButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(EDIT_BUTTON_ID)
      .setLabel("Edit")
      .setEmoji("✏️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(DELETE_BUTTON_ID)
      .setLabel("Delete")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * Persists the record that lets the original author edit/delete the moved
 * message later.
 * @param moved - The moved message in the target channel.
 * @param authorId - The original author, the only user allowed to act on it.
 * @param originalMessageId - ID of the deleted original, for the audit log.
 * @param sourceChannelId - Channel the link came from (where the stub lives).
 * @param [stubId] - Optional pointer stub to delete alongside the repost.
 */
export function registerRepostActions(
  moved: Message<true>,
  authorId: string,
  originalMessageId: string,
  sourceChannelId: string,
  stubId?: string,
): void {
  saveRepost(moved.guildId, moved.id, {
    authorId,
    originalMessageId,
    sourceChannelId,
    repostChannelId: moved.channelId,
    stubMessageId: stubId,
    createdAt: new Date().toISOString(),
  });
  log.debug("registered repost actions", { movedId: moved.id, authorId });
}

/**
 * Splits a moved message's content into the bot's prefix line ("from <@id>")
 * and the author-editable text below it. Relies on the blank line the
 * moved-content builder puts between them.
 * @param content - Full content of the moved message.
 * @returns The prefix line and the author's text.
 */
function splitMovedContent(content: string): { prefix: string; text: string } {
  const [prefix, ...rest] = content.split("\n\n");
  return { prefix, text: rest.join("\n\n") };
}

/**
 * Handles clicks on the Edit/Delete buttons of a moved message. Anyone other
 * than the original poster gets an ephemeral refusal.
 * @param interaction - The button interaction.
 * @returns A promise that resolves once the click is fully handled.
 */
export async function handleRepostButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild()) return;

  const record = getRepost(interaction.guildId, interaction.message.id);
  if (!record) {
    await interaction.reply({
      content: "⚠️ This post has no stored record, so it can't be changed.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.user.id !== record.authorId) {
    await interaction.reply({
      content: "Only the original poster can do that.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.customId === DELETE_BUTTON_ID) {
    // Remove the record and audit BEFORE deleting: our own delete fires the
    // messageDelete cleanup handler, which must not find the record and
    // double-process it.
    removeRepost(interaction.guildId, interaction.message.id);
    appendDeletionLog(interaction.guildId, {
      originalMessageId: record.originalMessageId,
      originalChannelId: record.sourceChannelId,
      repostMessageId: interaction.message.id,
      repostChannelId: record.repostChannelId,
      stubMessageId: record.stubMessageId,
      deletedAt: new Date().toISOString(),
    });

    // Acknowledge first: deleting the message the button lives on would
    // otherwise leave the interaction unanswered ("interaction failed").
    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => {});

    if (record.stubMessageId) {
      const channel = interaction.client.channels.cache.get(record.sourceChannelId) as
        GuildTextBasedChannel | undefined;
      const stub = await channel?.messages.fetch(record.stubMessageId).catch(() => null);
      if (stub) await stub.delete().catch(() => {});
    }

    log.info("author deleted repost", {
      guildId: interaction.guildId,
      movedId: interaction.message.id,
    });
    return;
  }

  if (interaction.customId === EDIT_BUTTON_ID) {
    const input = new TextInputBuilder()
      .setCustomId(EDIT_MODAL_ID)
      .setLabel("Message")
      .setStyle(TextInputStyle.Paragraph)
      .setValue(splitMovedContent(interaction.message.content).text.slice(0, EDIT_MAX_LENGTH))
      .setMaxLength(EDIT_MAX_LENGTH)
      .setRequired(true);
    const modal = new ModalBuilder()
      .setCustomId(EDIT_MODAL_ID)
      .setTitle("Edit your post")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
  }
}

/**
 * Handles the edit modal submit: rewrites the moved message with the new text
 * while keeping the mention prefix (still without pinging).
 * @param interaction - The modal submit interaction.
 * @returns A promise that resolves once the message is updated.
 */
export async function handleRepostEditModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.isFromMessage()) return;

  const record = getRepost(interaction.guildId, interaction.message.id);
  if (!record || interaction.user.id !== record.authorId) {
    await interaction.reply({
      content: "Only the original poster can do that.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const newText = interaction.fields.getTextInputValue(EDIT_MODAL_ID).trim();
  if (!newText) {
    await interaction.reply({
      content: "⚠️ The post can't be empty - use Delete instead.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { prefix } = splitMovedContent(interaction.message.content);
  await interaction.update({
    content: `${prefix}\n\n${newText}`,
    allowedMentions: { parse: [] },
  });
  log.info("author edited repost", {
    guildId: interaction.guildId,
    movedId: interaction.message.id,
  });
}
