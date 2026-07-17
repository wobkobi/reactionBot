// src/onMessage.ts

/**
 * @file Orchestrates per-message processing.
 * - Records swear/slur/called-names stats in the background.
 * - Delegates media-link detection & relocation to the media workflow.
 *   (See src/media/workflow.ts and submodules.)
 */

import { matchAny } from "@/media/match.js";
import { handleMediaMessage } from "@/media/workflow.js";
import { trackMessage } from "@/tracking/track.js";
import { createLogger } from "@/utils/log.js";
import { Message, PartialMessage } from "discord.js";

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

  // Tracking + configured reactions (words.json) should never block media
  // handling
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

/**
 * Handles an edited message: catches links added after posting, which
 * messageCreate never saw. Runs only the media workflow (not tracking, which
 * already counted the original text).
 *
 * Skipped when:
 * - The content is unchanged (Discord fires messageUpdate when embeds
 *   resolve, without an actual edit).
 * - The pre-edit content already contained a supported link (it was handled
 *   - or declined - on creation; re-prompting on every edit would nag).
 * @param oldMessage - The message before the edit (possibly partial).
 * @param newMessage - The message after the edit (possibly partial).
 * @returns A promise that resolves when processing is complete.
 */
export async function onMessageEdit(
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
): Promise<void> {
  const fresh = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
  if (!fresh || !fresh.inGuild() || fresh.author.bot) return;

  // Old content is null for uncached (partial) messages - process those, at
  // the cost of a rare duplicate prompt when the link was already declined.
  const oldContent = oldMessage.partial ? null : oldMessage.content;
  if (oldContent !== null) {
    if (oldContent === fresh.content) return;
    if (matchAny(oldContent)) return;
  }

  await handleMediaMessage(fresh).catch((err) => {
    log.error("media workflow failed on edit", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
