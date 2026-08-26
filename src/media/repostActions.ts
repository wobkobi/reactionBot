// src/media/repostActions.ts

// Author-only edit/delete of moved messages, reached by right-clicking the post
// or its pointer stub (Apps > Edit post / Delete post). Resolved against the
// persisted repost records, not in-memory collectors, so they keep working
// across restarts. Older posts still carrying a button row are handled here too.

import { appendDeletionLog } from "@/media/audit";
import { findRepostForMessage, removeRepost, RepostRecord, saveRepost } from "@/media/repostStore";
import { createLogger } from "@/utils/log";
import { respond } from "@/utils/respond";
import {
  ActionRowBuilder,
  ButtonInteraction,
  GuildTextBasedChannel,
  Message,
  MessageContextMenuCommandInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  RepliableInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

const log = createLogger("media/repostActions");

/** Custom ID of the Edit button on messages moved before the buttons were dropped. */
export const EDIT_BUTTON_ID = "repost:edit";
/** Custom ID of the Delete button on messages moved before the buttons were dropped. */
export const DELETE_BUTTON_ID = "repost:delete";
/**
 * Prefix of the edit modal's custom ID; the moved message ID is appended. The
 * modal can be opened from a context menu, where the submit interaction is not
 * attached to a message, so the target has to be carried in the ID itself.
 */
export const EDIT_MODAL_PREFIX = "repost:editmodal:";
/** Custom ID of the text input inside the edit modal. */
export const EDIT_INPUT_ID = "repost:editinput";

/** Discord's message content cap, minus headroom for the mention prefix. */
const EDIT_MAX_LENGTH = 1_900;

/** Shown when the target message has no persisted record. */
const NO_RECORD_MESSAGE =
  "⚠️ This isn't a moved post, or its record is gone - it can't be changed.";

/**
 * Sends an ephemeral notice on any repliable interaction, without throwing -
 * see {@link respond}. A delete is acknowledged before it runs (the caller may
 * have right-clicked the very message being removed), so a refused
 * acknowledgement must not take the delete down with it.
 * @param interaction - The interaction to answer.
 * @param content - The message to show.
 * @returns A promise that resolves once the notice is sent or dropped.
 */
async function notify(interaction: RepliableInteraction, content: string): Promise<void> {
  await respond(interaction, {
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

/**
 * Resolves the repost the interaction targets and checks the caller owns it,
 * answering with the reason when either fails.
 * @param interaction - The interaction to authorise and, on failure, answer.
 * @param guildId - Guild the interaction came from.
 * @param messageId - The moved message or its pointer stub.
 * @returns The moved message ID and record, or `null` when refused.
 */
async function resolveOwnedRepost(
  interaction: RepliableInteraction,
  guildId: string,
  messageId: string,
): Promise<{ movedMessageId: string; record: RepostRecord } | null> {
  const found = findRepostForMessage(guildId, messageId);
  if (!found) {
    await notify(interaction, NO_RECORD_MESSAGE);
    return null;
  }
  if (interaction.user.id !== found.record.authorId) {
    // Name the author so the caller knows whose post it is, without pinging
    // them for a stranger's failed attempt.
    await notify(interaction, `Only <@${found.record.authorId}> can edit or delete this post.`);
    return null;
  }
  return found;
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
 * Resolves a channel by ID. Fetched rather than read off the cache: a thread
 * that has since been archived drops out of it, and a cache miss here reads as
 * "the post is gone" on a post that is still sitting there.
 * @param interaction - Any interaction, used for its client.
 * @param channelId - The channel to resolve.
 * @returns The channel, or `null` when it is gone or unreachable.
 */
async function fetchTextChannel(
  interaction: RepliableInteraction,
  channelId: string,
): Promise<GuildTextBasedChannel | null> {
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased() ? (channel as GuildTextBasedChannel) : null;
}

/**
 * Fetches a moved message from the channel its record names.
 * @param interaction - Any interaction, used for its client.
 * @param record - The stored record naming the repost channel.
 * @param movedMessageId - ID of the moved message to fetch.
 * @returns The message, or `null` when it is gone or unreachable.
 */
async function fetchMoved(
  interaction: RepliableInteraction,
  record: RepostRecord,
  movedMessageId: string,
): Promise<Message | null> {
  const channel = await fetchTextChannel(interaction, record.repostChannelId);
  return (await channel?.messages.fetch(movedMessageId).catch(() => null)) ?? null;
}

/**
 * Deletes a moved post and its pointer stub, and records the deletion.
 * @param interaction - The interaction that asked for the delete.
 * @param guildId - Guild the post lives in.
 * @param movedMessageId - ID of the moved message.
 * @param record - Its stored record.
 * @returns A promise that resolves once the deletion is complete.
 */
async function deleteRepost(
  interaction: RepliableInteraction,
  guildId: string,
  movedMessageId: string,
  record: RepostRecord,
): Promise<void> {
  // Remove the record and audit BEFORE deleting: our own delete fires the
  // messageDelete cleanup handler, which must not find the record and
  // double-process it.
  removeRepost(guildId, movedMessageId);
  appendDeletionLog(guildId, {
    originalMessageId: record.originalMessageId,
    originalChannelId: record.sourceChannelId,
    repostMessageId: movedMessageId,
    repostChannelId: record.repostChannelId,
    stubMessageId: record.stubMessageId,
    deletedAt: new Date().toISOString(),
  });

  const moved = await fetchMoved(interaction, record, movedMessageId);
  await moved?.delete().catch(() => {});

  if (record.stubMessageId) {
    const channel = await fetchTextChannel(interaction, record.sourceChannelId);
    const stub = await channel?.messages.fetch(record.stubMessageId).catch(() => null);
    await stub?.delete().catch(() => {});
  }

  log.info("author deleted repost", { guildId, movedId: movedMessageId });
}

/**
 * Opens the edit modal, seeded with the moved message's current text. The
 * moved message ID rides in the modal's custom ID so the submit handler knows
 * what to rewrite.
 * @param interaction - The interaction to show the modal on.
 * @param movedMessageId - ID of the moved message being edited.
 * @param currentText - Text to prefill, already stripped of the prefix line.
 * @returns A promise that resolves once the modal is shown.
 */
async function showEditModal(
  interaction: ButtonInteraction | MessageContextMenuCommandInteraction,
  movedMessageId: string,
  currentText: string,
): Promise<void> {
  const input = new TextInputBuilder()
    .setCustomId(EDIT_INPUT_ID)
    .setLabel("Message")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentText.slice(0, EDIT_MAX_LENGTH))
    .setMaxLength(EDIT_MAX_LENGTH)
    .setRequired(true);
  const modal = new ModalBuilder()
    .setCustomId(`${EDIT_MODAL_PREFIX}${movedMessageId}`)
    .setTitle("Edit your post")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await interaction.showModal(modal);
}

/**
 * Handles the "Delete post" context-menu command: removes the moved post and
 * its stub, for the original author only.
 * @param interaction - The context-menu interaction.
 * @returns A promise that resolves once the delete is handled.
 */
export async function handleDeletePostCommand(
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild()) return;
  const owned = await resolveOwnedRepost(
    interaction,
    interaction.guildId,
    interaction.targetMessage.id,
  );
  if (!owned) return;

  // Acknowledge before deleting: the caller may have right-clicked the very
  // message being removed, and an unanswered interaction shows as failed.
  await notify(interaction, "🗑️ Deleted.");
  await deleteRepost(interaction, interaction.guildId, owned.movedMessageId, owned.record);
}

/**
 * Handles the "Edit post" context-menu command: opens the edit modal for the
 * original author only.
 * @param interaction - The context-menu interaction.
 * @returns A promise that resolves once the modal is shown or the refusal sent.
 */
export async function handleEditPostCommand(
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild()) return;
  const owned = await resolveOwnedRepost(
    interaction,
    interaction.guildId,
    interaction.targetMessage.id,
  );
  if (!owned) return;

  // Right-clicking the stub gives us the stub's text, not the post's, so the
  // moved message is fetched for the prefill either way.
  const moved = await fetchMoved(interaction, owned.record, owned.movedMessageId);
  if (!moved) {
    await notify(interaction, "⚠️ That post is gone, so there's nothing to edit.");
    return;
  }
  await showEditModal(interaction, owned.movedMessageId, splitMovedContent(moved.content).text);
}

/**
 * Handles clicks on the Edit/Delete buttons carried by messages moved before
 * those buttons were dropped. Same rules as the context-menu commands.
 * @param interaction - The button interaction.
 * @returns A promise that resolves once the click is fully handled.
 */
export async function handleRepostButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild()) return;
  const owned = await resolveOwnedRepost(interaction, interaction.guildId, interaction.message.id);
  if (!owned) return;

  if (interaction.customId === DELETE_BUTTON_ID) {
    await notify(interaction, "🗑️ Deleted.");
    await deleteRepost(interaction, interaction.guildId, owned.movedMessageId, owned.record);
    return;
  }
  if (interaction.customId === EDIT_BUTTON_ID) {
    await showEditModal(
      interaction,
      owned.movedMessageId,
      splitMovedContent(interaction.message.content).text,
    );
  }
}

/**
 * Handles the edit modal submit: rewrites the moved message with the new text
 * while keeping the mention prefix (still without pinging). The target is read
 * back out of the modal's custom ID, since a modal opened from a context menu
 * carries no message of its own.
 * @param interaction - The modal submit interaction.
 * @returns A promise that resolves once the message is updated.
 */
export async function handleRepostEditModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inGuild()) return;

  const movedMessageId = interaction.customId.slice(EDIT_MODAL_PREFIX.length);
  const owned = await resolveOwnedRepost(interaction, interaction.guildId, movedMessageId);
  if (!owned) return;

  const newText = interaction.fields.getTextInputValue(EDIT_INPUT_ID).trim();
  if (!newText) {
    await notify(interaction, "⚠️ The post can't be empty - use Delete post instead.");
    return;
  }

  const moved = await fetchMoved(interaction, owned.record, owned.movedMessageId);
  if (!moved) {
    await notify(interaction, "⚠️ That post is gone, so there's nothing to edit.");
    return;
  }

  // An unanswered modal submit shows the author a bare "something went wrong",
  // so a failed edit has to be reported rather than thrown past them.
  const { prefix } = splitMovedContent(moved.content);
  try {
    await moved.edit({ content: `${prefix}\n\n${newText}`, allowedMentions: { parse: [] } });
  } catch (err) {
    log.warn("failed to edit repost", {
      guildId: interaction.guildId,
      movedId: owned.movedMessageId,
      error: err instanceof Error ? err.message : String(err),
    });
    await notify(interaction, "⚠️ That edit wouldn't go through - the post is unchanged.");
    return;
  }
  await notify(interaction, "✅ Updated.");
  log.info("author edited repost", {
    guildId: interaction.guildId,
    movedId: owned.movedMessageId,
  });
}
