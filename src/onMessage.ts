// src/onMessage.ts

/**
 * @file Orchestrates per-message processing.
 * - Records swear stats in the background.
 * - Delegates media-link detection & relocation to the media workflow.
 *   (See src/media/workflow.ts and submodules.)
 */

import { handleMediaMessage } from "@/media/workflow.js";
import { trackSwears } from "@/swears/track.js";
import { createLogger } from "@/utils/log.js";
import { Message } from "discord.js";

const log = createLogger("core/onMessage");
/**
 * Handles a newly created message from Discord.
 *
 * Behavior:
 *  - Ignores DMs and bot authors.
 *  - Starts swear tracking (best-effort; errors are swallowed).
 *  - Invokes the media workflow which:
 *      • matches supported links,
 *      • rewrites to privacy frontends,
 *      • asks for approval (with same-channel special-case text/timeout),
 *      • reposts or edits as needed,
 *      • optionally posts a pointer and sets up 🗑️ reactions & audit.
 * @param message - The Discord.js {@link Message} to process.
 * @returns A promise that resolves when processing is complete.
 */
export async function onMessage(message: Message): Promise<void> {
  // Only process in-guild, non-bot messages
  if (!message.inGuild() || message.author.bot) return;

  // Swear tracking should never block media handling
  trackSwears(message).catch((err) => {
    log.warn("swear tracking failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Media workflow (TikTok/Twitter/Instagram/Reddit)
  await handleMediaMessage(message).catch((err) => {
    log.error("media workflow failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
