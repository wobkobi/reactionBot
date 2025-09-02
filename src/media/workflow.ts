// src/media/workflow.ts

/**
 * @file Orchestrates media-link handling for a single message.
 * Splits responsibilities across match/transform/settings/approval/repost/audit.
 */

import { GuildTextBasedChannel, Message, TextChannel } from "discord.js";
import { createLogger } from "../utils/log.js";
import { requestApproval } from "./approval.js";
import { matchAny } from "./match.js";
import { enableAuthorDelete, repostWithOptionalStub } from "./repost.js";
import {
  loadSettings,
  resolveApprovalPlan,
  resolveTargetChannelId,
} from "./settings.js";
import { rewriteContent } from "./transform.js";

const log = createLogger("media/workflow");

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
  const target = (message.client.channels.cache.get(targetId) ??
    source) as GuildTextBasedChannel;

  const sameChannel = source.id === target.id;

  // Prepare rewrite
  const rewrite = rewriteContent(message.content, match);

  // Build approval plan (handles same-channel overrides)
  const plan = resolveApprovalPlan(settings.grace, sameChannel);

  // Auto-approve or ask
  let approved = plan.autoApprove;
  if (!approved) {
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
    !sameChannel
  );
  log.info("repost complete", {
    guildId: message.guildId!,
    from: source.id,
    to: target.id,
    movedId: outcome.moved?.id ?? null,
    stubId: outcome.stub?.id ?? null,
  });

  // Author-only delete with audit + optional stub cleanup
  if (outcome.moved) {
    await enableAuthorDelete(
      outcome.moved,
      message.author,
      message.guildId!,
      source.id,
      outcome.stub?.id
    );
  }

  // Optional watchers note — only when moved to a different channel and no mentions
  if (!sameChannel && outcome.moved && message.mentions?.users?.size === 0) {
    try {
      await (target as TextChannel).send({
        content: `New media moved: ${outcome.moved.url}`,
        allowedMentions: { parse: [] },
      });
      log.trace("watchers note sent", { channelId: target.id });
    } catch {
      log.warn("failed to send watchers note", { channelId: target.id });
    }
  }
}
