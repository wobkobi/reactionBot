// src/media/workflow.ts

// Orchestrates media-link handling for a single message. Splits
// responsibilities across match/transform/settings/approval/repost/audit.

import { ChoiceButton, requestApproval, requestChoice } from "@/media/approval.js";
import { buildCopyMessage } from "@/media/cleanTracking.js";
import { matchAny } from "@/media/match.js";
import { repostWithOptionalStub } from "@/media/repost.js";
import { registerRepostActions } from "@/media/repostActions.js";
import { loadSettings, resolveApprovalPlan, resolveTargetChannelId } from "@/media/settings.js";
import { rewriteContent } from "@/media/transform.js";
import { createLogger } from "@/utils/log.js";
import { ButtonStyle, GuildTextBasedChannel, Message, MessageFlags } from "discord.js";

const log = createLogger("media/workflow");

/**
 * Buttons on the tracking-clean prompt. "Copy" hands the poster the cleaned
 * link privately and leaves their message alone; "Repost" is the move-and-
 * rewrite path shared with media links.
 */
const CLEAN_BUTTONS: ChoiceButton[] = [
  { id: "repost", label: "Repost", emoji: "♻️", style: ButtonStyle.Primary },
  { id: "copy", label: "Copy", emoji: "📋", style: ButtonStyle.Secondary },
  { id: "no", label: "No", style: ButtonStyle.Danger },
];

/**
 * Handles a message: detect media links, get approval, and repost/notify.
 *
 * Special-case when target == source:
 * - Different prompt text
 * - 15s timeout
 * - No stub/pointer
 * - No channel "watchers" message
 * @param message - The Discord message to process (must be in-guild).
 */
export async function handleMediaMessage(message: Message): Promise<void> {
  if (!message.inGuild()) return;
  const match = matchAny(message.content);
  if (!match) return;

  const settings = loadSettings(message.guildId!);
  const targetId = resolveTargetChannelId(settings, message.channelId);

  const source = message.channel as GuildTextBasedChannel;
  // Tracking cleans are not media: the link stays in its channel, cleaned.
  const isTrackingClean = match.which === "tracking";
  const target = isTrackingClean
    ? source
    : ((message.client.channels.cache.get(targetId) ?? source) as GuildTextBasedChannel);

  const sameChannel = source.id === target.id;

  // Pre-embedded links have nothing to rewrite; without a separate media
  // channel to move them to, there is nothing to do.
  if (match.which === "pre-embedded" && sameChannel) return;

  // Prepare rewrite
  const rewrite = rewriteContent(message.content, match, message.author.id);

  // Build approval plan (handles same-channel overrides)
  const plan = resolveApprovalPlan(settings.grace, sameChannel);
  if (isTrackingClean) plan.promptText = "Clean the tracking junk out of your link?";

  // Auto-approve or ask. Tracking cleans offer a third option: hand the poster
  // the cleaned link privately and leave their message untouched. They always
  // prompt, since the same-channel plan never auto-approves.
  let approved = plan.autoApprove;
  if (isTrackingClean) {
    const { choice, interaction } = await requestChoice(source, message.author, CLEAN_BUTTONS, {
      prompt: plan.promptText,
      grace: plan.timeoutMs ?? 15_000,
      autoDelete: true,
    });
    if (choice === "copy") {
      // followUp, not reply: the collector already acknowledged the click.
      await interaction
        ?.followUp({
          content: buildCopyMessage(rewrite.newLink),
          flags: MessageFlags.Ephemeral,
        })
        .catch((err: unknown) => {
          log.warn("failed to hand over cleaned link", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      log.info("poster copied cleaned link", { guildId: message.guildId!, from: source.id });
      return;
    }
    approved = choice === "repost";
  } else if (!approved) {
    approved = await requestApproval(source, message.author, {
      prompt: plan.promptText,
      grace: plan.persistIndefinitely ? "disabled" : (plan.timeoutMs ?? 10_000),
      autoDelete: !plan.persistIndefinitely,
    });
  }

  log.debug("approval result", { approved, sameChannel, targetId });
  if (!approved) return;

  // Repost (or rewrite in same channel), with stub only when moving across channels
  const outcome = await repostWithOptionalStub(
    message as Message<true>,
    rewrite.rewrittenText,
    source,
    target,
    !sameChannel,
  );
  log.info("repost complete", {
    guildId: message.guildId!,
    from: source.id,
    to: target.id,
    movedId: outcome.moved?.id ?? null,
    stubId: outcome.stub?.id ?? null,
  });

  // Author-only Edit/Delete buttons with audit + stub cleanup (persisted, so
  // they keep working after restarts)
  if (outcome.moved) {
    registerRepostActions(
      outcome.moved,
      message.author.id,
      message.id,
      source.id,
      outcome.stub?.id,
    );
  }
}
