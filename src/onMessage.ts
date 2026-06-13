// src/onMessage.ts

/**
 * @file Orchestrates per-message processing.
 * - Records swear/slur/called-names stats in the background.
 * - Delegates media-link detection & relocation to the media workflow.
 *   (See src/media/workflow.ts and submodules.)
 */

import { handleMediaMessage } from "@/media/workflow.js";
import { trackMessage } from "@/tracking/track.js";
import { createLogger } from "@/utils/log.js";
import { Message } from "discord.js";

const log = createLogger("core/onMessage");
/**
 * Handles a newly created message from Discord.
 *
 * Behaviour:
 * - Ignores DMs and bot authors.
 * - Starts swear/slur/called-names tracking (best-effort; errors are logged
 *   and swallowed).
 * - Invokes the media workflow, which matches supported links, rewrites them
 *   to embeddable frontends, asks for approval, reposts with a pointer, and
 *   sets up 🗑️ reactions and the deletion audit.
 * @param message - The Discord.js {@link Message} to process.
 * @returns A promise that resolves when processing is complete.
 */
export async function onMessage(message: Message): Promise<void> {
  // Only process in-guild, non-bot messages
  if (!message.inGuild() || message.author.bot) return;

  // Tracking (swears/slurs/called-names) should never block media handling
  trackMessage(message).catch((err) => {
    log.warn("message tracking failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Media workflow (link detection, approval, repost)
  await handleMediaMessage(message).catch((err) => {
    log.error("media workflow failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
