// src/media/workflow.ts

// Orchestrates media-link handling for a single message. Splits
// responsibilities across match/transform/settings/approval/repost/audit.

import { ChoiceButton, isApproved, requestChoice } from "@/media/approval";
import { findUrls, stripTracking } from "@/media/cleanTracking";
import { facebedProblem, pickInstagramFrontend } from "@/media/embedCheck";
import { buildFacebookEmbed, fetchFacebookPreview } from "@/media/facebookPreview";
import { fetchInstagramCaption, formatCaption } from "@/media/instagramCaption";
import { matchAny } from "@/media/match";
import { loadPref } from "@/media/prefs";
import { repostWithOptionalStub } from "@/media/repost";
import { registerRepostActions } from "@/media/repostActions";
import { loadSettings, resolvePlanFor, resolveTargetChannelId } from "@/media/settings";
import { buildTransformedUrl, instagramPath, rewriteContent } from "@/media/transform";
import { createLogger } from "@/utils/log";
import { ButtonStyle, GuildTextBasedChannel, Message } from "discord.js";

const log = createLogger("media/workflow");

/** What a prompt's go-ahead does, which names its first button. */
type PromptAction = "Move" | "Rewrite" | "Clean";

/**
 * Buttons for every link prompt, in one shape: the go-ahead named for what it
 * does, Copy, then the refusal. On a countdown, where silence already means
 * yes, the go-ahead skips the wait ("Move now") and the refusal reads Cancel.
 * The ids stay "yes"/"copy"/"no" on every prompt, so only the labels differ.
 * @param action - What approving does.
 * @param countdown - Whether the prompt goes ahead on its own when the time runs out.
 * @returns The prompt's buttons, in display order.
 */
export function promptButtons(action: PromptAction, countdown: boolean): ChoiceButton[] {
  return [
    { id: "yes", label: countdown ? `${action} now` : action, style: ButtonStyle.Success },
    { id: "copy", label: "Copy", emoji: "📋", style: ButtonStyle.Secondary },
    { id: "no", label: countdown ? "Cancel" : "No", style: ButtonStyle.Danger },
  ];
}

/**
 * Wording for the tracking-clean prompt. Every tracked link in the message
 * gets cleaned, so the prompt says "links" when there is more than one.
 * @param content - The poster's message.
 * @returns The prompt text.
 */
export function cleanPromptText(content: string): string {
  const tracked = new Set(findUrls(content).filter((url) => stripTracking(url) !== null));
  return `Clean the tracking junk out of your ${tracked.size > 1 ? "links" : "link"}?`;
}

/**
 * Wording for a move that could not be made. The poster approved something
 * that then did not happen, and their message is still sitting where they put
 * it, so silence reads as the bot having ignored them - they answer the next
 * prompt the same way and get the same nothing. A refused target names the
 * permission, since that is the one cause somebody reading can act on.
 * @param target - Channel mention of the destination, or null for a rewrite in place.
 * @param blocked - Whether the destination refused the bot outright.
 * @returns The notice to post under the poster's message.
 */
export function buildFailureNotice(target: string | null, blocked: boolean): string {
  const what = target ? `move that to ${target}` : "rewrite that here";
  const why = blocked ? ` - I'm missing permission to post ${target ? "there" : "here"}` : "";
  return `⚠️ I couldn't ${what}${why}. Your message has been left where it is.`;
}

/**
 * Replies under a Facebook link with an embed built from Facebook's own
 * preview tags, then hides the poster's login-wall embed. Does nothing when
 * Facebook gives the bot a login wall as well. Hiding the poster's embed needs
 * Manage Messages; without it both embeds show, which is still better than the
 * login wall alone.
 * @param message - The poster's message.
 * @param path - The Facebook path matched by FACEBOOK_REGEX.
 */
async function postFacebookFallback(message: Message<true>, path: string): Promise<void> {
  const preview = await fetchFacebookPreview(path);
  if (!preview) {
    log.info("facebook gave no preview either", { guildId: message.guildId, path });
    return;
  }
  try {
    await message.reply({
      embeds: [buildFacebookEmbed(preview)],
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (err) {
    log.warn("facebook fallback send failed", {
      guildId: message.guildId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  await message.suppressEmbeds(true).catch((err: unknown) => {
    log.debug("could not hide poster's facebook embed", {
      guildId: message.guildId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  log.info("posted facebook fallback preview", { guildId: message.guildId, path });
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
  // Fetched rather than read off the cache: an uncached media channel would
  // fall back to the source and quietly turn a move into a same-channel
  // rewrite, which is a different prompt and a different outcome.
  const configured =
    isTrackingClean || targetId === source.id
      ? null
      : await message.client.channels.fetch(targetId).catch(() => null);
  const target = (configured as GuildTextBasedChannel | null) ?? source;

  const sameChannel = source.id === target.id;

  // Pre-embedded links have nothing to rewrite; without a separate media
  // channel to move them to, there is nothing to do.
  if (match.which === "pre-embedded" && sameChannel) return;

  // Instagram mirrors often half-work, so the mirror is picked per link by
  // what each one really serves. When none can embed it, the poster's link is
  // left alone: moving it would only repost a broken embed somewhere else.
  // The caption is fetched alongside, since the picked mirror's embed may
  // show none (ins.so's never does); the bot then carries it in the header.
  let caption: string | undefined;
  if (match.which === "instagram") {
    // Checked on the exact slide that will be posted, not just the post
    const path = instagramPath(match.captures);
    const [pick, details] = await Promise.all([
      pickInstagramFrontend(path),
      fetchInstagramCaption(match.captures[0]),
    ]);
    if (!pick) {
      log.info("no instagram mirror can embed link", { guildId: message.guildId!, path });
      return;
    }
    match.frontend = pick.host;
    if (!pick.showsCaption && details) caption = formatCaption(details);
  }

  // Facebed cannot read every Facebook link (a share link can lead to a
  // marketplace listing). Discord's own preview of those is Facebook's login
  // wall too, so the bot builds the embed itself from Facebook's tags instead
  // of moving the link.
  if (match.which === "facebook") {
    const problem = await facebedProblem(buildTransformedUrl(match));
    if (problem) {
      log.info("facebed cannot embed link", { guildId: message.guildId!, problem });
      await postFacebookFallback(message, match.captures[0]);
      return;
    }
  }

  // Prepare rewrite
  const rewrite = rewriteContent(message.content, match, message.author.id);

  // Build the approval plan from the poster's own preference and the guild
  // default. Tracking cleans skip the preference so they always ask.
  const plan = resolvePlanFor(
    settings,
    isTrackingClean ? undefined : loadPref(message.guildId!, message.author.id),
    sameChannel,
  );
  if (!plan) {
    log.debug("poster opted out of moves", {
      guildId: message.guildId!,
      userId: message.author.id,
    });
    return;
  }
  if (isTrackingClean) plan.promptText = cleanPromptText(message.content);

  // Auto-approve or ask. Every prompt offers a third option: hand the poster
  // the rewritten link privately and leave their message untouched. Tracking
  // cleans always prompt: they skip the poster's preference, and the guild's
  // same-channel plan never auto-approves.
  let approved = plan.autoApprove;
  if (!approved) {
    const outcome = await requestChoice(
      source,
      message.author,
      promptButtons(
        isTrackingClean ? "Clean" : sameChannel ? "Rewrite" : "Move",
        plan.approveOnTimeout,
      ),
      {
        prompt: plan.promptText,
        grace: plan.persistIndefinitely ? "disabled" : (plan.timeoutMs ?? 10_000),
        // The bare link alone, so long-press > Copy Text on mobile grabs
        // exactly the URL with nothing to trim.
        privateReplies: { copy: rewrite.newLink },
      },
    );
    if (outcome.choice === "copy") {
      log.info(
        "poster copied link",
        { guildId: message.guildId!, which: match.which },
        { from: source.id },
      );
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
    caption,
  );

  // A move that did not happen is not a complete one, and the poster is owed
  // the reason. The notice is a reply so it sits under the message it is about,
  // and pings nobody - not even through the reply itself.
  if (!outcome.moved) {
    log.warn("repost did not happen", {
      guildId: message.guildId!,
      from: source.id,
      to: target.id,
      failure: outcome.failure ?? "failed",
    });
    await message
      .reply({
        content: buildFailureNotice(
          sameChannel ? null : `<#${target.id}>`,
          outcome.failure === "blocked",
        ),
        allowedMentions: { parse: [], repliedUser: false },
      })
      .catch((err: unknown) => {
        log.warn("failure notice send failed", {
          sourceId: source.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return;
  }

  log.info(
    "repost complete",
    { guildId: message.guildId!, by: message.author.username, from: source.name, to: target.name },
    {
      fromId: source.id,
      toId: target.id,
      movedId: outcome.moved.id,
      stubId: outcome.stub?.id ?? null,
    },
  );

  // Author-only Edit/Delete buttons with audit + stub cleanup (persisted, so
  // they keep working after restarts)
  registerRepostActions(outcome.moved, message.author.id, message.id, source.id, outcome.stub?.id);
}
