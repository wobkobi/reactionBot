// src/media/workflow.ts

// Orchestrates media-link handling for a single message. Splits
// responsibilities across match/transform/settings/approval/repost/audit.

import { ChoiceButton, isApproved, requestChoice } from "@/media/approval";
import { buildCopyMessage } from "@/media/copyLink";
import { matchAny } from "@/media/match";
import { loadPref } from "@/media/prefs";
import { repostWithOptionalStub } from "@/media/repost";
import { registerRepostActions } from "@/media/repostActions";
import { loadSettings, resolvePlanFor, resolveTargetChannelId } from "@/media/settings";
import { rewriteContent } from "@/media/transform";
import { createLogger } from "@/utils/log";
import { ButtonStyle, GuildTextBasedChannel, Message } from "discord.js";

const log = createLogger("media/workflow");

/**
 * Buttons on the tracking-clean prompt. "Repost" is the move-and-rewrite path
 * shared with media links.
 */
const CLEAN_BUTTONS: ChoiceButton[] = [
  { id: "yes", label: "Repost", emoji: "♻️", style: ButtonStyle.Primary },
  { id: "copy", label: "Copy", emoji: "📋", style: ButtonStyle.Secondary },
  { id: "no", label: "No", style: ButtonStyle.Danger },
];

/** Buttons on the media prompt, both when moving channels and rewriting in place. */
const MEDIA_BUTTONS: ChoiceButton[] = [
  { id: "yes", label: "Yes", style: ButtonStyle.Success },
  { id: "copy", label: "Copy", emoji: "📋", style: ButtonStyle.Secondary },
  { id: "no", label: "No", style: ButtonStyle.Danger },
];

/**
 * Buttons on a countdown prompt, where silence means yes and the only answer
 * that changes anything is a refusal. Cancel carries the id "no", so the
 * negative answer is one id across both button sets and only the label differs.
 */
const COUNTDOWN_BUTTONS: ChoiceButton[] = [
  { id: "no", label: "Cancel", style: ButtonStyle.Danger },
  { id: "copy", label: "Copy", emoji: "📋", style: ButtonStyle.Secondary },
];

/** Line above the copied link, naming what the bot did to it. */
const COPY_LEAD = {
  tracking: "Here's your link without the tracking junk:",
  media: "Here's your embeddable link:",
} as const;

/** Subtext under a copied link, naming the command that governs the move. */
const MYDELAY_HINT = "-# Tune how this works for you with /mydelay";

/**
 * Picks the subtext for the copy hand-over. `/mydelay` governs cross-channel
 * moves only, so advertising it anywhere else would promise control it does
 * not have.
 * @param isTrackingClean - Whether this is a tracking clean rather than media.
 * @param sameChannel - Whether the repost target is the source channel.
 * @returns The hint line, or `undefined` when there is nothing to offer.
 */
export function copyHintFor(isTrackingClean: boolean, sameChannel: boolean): string | undefined {
  return isTrackingClean || sameChannel ? undefined : MYDELAY_HINT;
}

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

  // Build the approval plan: the poster's own preference on a cross-channel
  // move, else the guild default (which handles the same-channel overrides).
  const plan = resolvePlanFor(
    settings,
    sameChannel ? undefined : loadPref(message.guildId!, message.author.id),
    sameChannel,
  );
  if (!plan) {
    log.debug("poster opted out of moves", {
      guildId: message.guildId!,
      userId: message.author.id,
    });
    return;
  }
  if (isTrackingClean) plan.promptText = "Clean the tracking junk out of your link?";

  // Auto-approve or ask. Every prompt offers a third option: hand the poster
  // the rewritten link privately and leave their message untouched. Tracking
  // cleans always prompt, since the same-channel plan never auto-approves.
  let approved = plan.autoApprove;
  if (!approved) {
    const outcome = await requestChoice(
      source,
      message.author,
      isTrackingClean ? CLEAN_BUTTONS : plan.approveOnTimeout ? COUNTDOWN_BUTTONS : MEDIA_BUTTONS,
      {
        prompt: plan.promptText,
        grace: plan.persistIndefinitely ? "disabled" : (plan.timeoutMs ?? 10_000),
        autoDelete: !plan.persistIndefinitely,
        privateReplies: {
          copy: buildCopyMessage(
            rewrite.newLink,
            isTrackingClean ? COPY_LEAD.tracking : COPY_LEAD.media,
            copyHintFor(isTrackingClean, sameChannel),
          ),
        },
      },
    );
    if (outcome.choice === "copy") {
      log.info("poster copied link", {
        guildId: message.guildId!,
        from: source.id,
        which: match.which,
      });
      return;
    }
    approved = isApproved(plan, outcome);
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
