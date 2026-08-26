// src/utils/respond.ts

// Answers interactions without ever rejecting. Discord refusing a response is
// routine - an interaction can expire before the gateway delivers it - but a
// rejection escaping an async listener is fatal: discord.js builds its client
// with captureRejections, so the rejection comes back as the client's "error"
// event and, with nothing listening, takes the process down.

import { createLogger } from "@/utils/log";
import {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  RepliableInteraction,
} from "discord.js";

const log = createLogger("utils/respond");

/**
 * API error codes that mean the interaction can no longer be answered: 10062
 * Discord has never heard of it (it expired before the response), 50027 its
 * token has run out. Nothing can be sent after one of these, so they are
 * logged as a warning rather than an error.
 */
const GONE_CODES = new Set<number>([10062, 50027]);

/**
 * Codes meaning the interaction was answered already, by the REST client's own
 * retry of a request whose response was lost or by another handler. The
 * message still has somewhere to go - see {@link sendFollowUp}. Discord's own
 * code is numeric; discord.js refuses locally with a string one.
 */
const ACKNOWLEDGED_CODES = new Set<number | string>([40060, "InteractionAlreadyReplied"]);

/**
 * Reads the error code off a rejection. Anything can be thrown, including
 * `null`, so nothing is assumed about the shape.
 * @param err - The rejection to read.
 * @returns The code, or `null` when the rejection carries none.
 */
function errorCode(err: unknown): number | string | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null;
  const code = (err as { code: unknown }).code;
  return typeof code === "number" || typeof code === "string" ? code : null;
}

/**
 * Converts a reply into an edit of an existing deferral. Ephemeral is fixed
 * when the deferral is sent, so the flag has nothing left to decide here and
 * an edit will not take it.
 * @param options - The reply to convert.
 * @returns The same payload, minus its flags.
 */
function asEdit(options: InteractionReplyOptions): InteractionEditReplyOptions {
  return { ...options, flags: undefined };
}

/**
 * Names an interaction for a log line.
 * @param interaction - The interaction to describe.
 * @returns The command name for a command, the custom ID for a component or
 * modal, and a generic label for anything else.
 */
function describe(interaction: RepliableInteraction): string {
  if (interaction.isCommand()) return `/${interaction.commandName}`;
  if (interaction.isMessageComponent() || interaction.isModalSubmit()) return interaction.customId;
  return "interaction";
}

/**
 * Logs a response Discord would not take.
 *
 * The interaction's age is what separates the two causes: over three seconds
 * old on the first attempt means it expired before the bot ever saw it
 * (gateway lag, or the host stalling), anything less points at the bot's own
 * handling.
 * @param interaction - The interaction that went unanswered.
 * @param err - What Discord (or discord.js) refused with.
 */
function reportRefusal(interaction: RepliableInteraction, err: unknown): void {
  const code = errorCode(err);
  const ctx = {
    interaction: describe(interaction),
    code,
    ageMs: Date.now() - interaction.createdTimestamp,
    error: err instanceof Error ? err.message : String(err),
  };
  if (typeof code === "number" && GONE_CODES.has(code)) {
    log.warn("interaction gone unanswered", ctx);
  } else {
    log.error("failed to answer interaction", ctx);
  }
}

/**
 * Sends the response as a follow-up on an interaction that turns out to have
 * been acknowledged already. Posted through the interaction's webhook rather
 * than `followUp`, which refuses while `replied` is false - and that is
 * exactly the state a reply whose response was lost leaves behind.
 * @param interaction - The interaction to follow up on.
 * @param options - The reply to send.
 * @returns `true` when the follow-up landed.
 */
async function sendFollowUp(
  interaction: RepliableInteraction,
  options: InteractionReplyOptions,
): Promise<boolean> {
  try {
    await interaction.webhook.send(options);
    return true;
  } catch (err) {
    reportRefusal(interaction, err);
    return false;
  }
}

/**
 * Answers an interaction, and swallows whatever Discord says. Use this for
 * anything that must not throw - error paths above all, where the interaction
 * being dead is often the very reason the caller is here, so a second attempt
 * at it would fail again with nothing left to catch it.
 *
 * A deferred interaction is answered by editing its deferral: a follow-up
 * would leave the "thinking" placeholder up for good. Ephemeral is fixed when
 * the deferral is sent, so the flag is dropped on that path rather than
 * fighting a decision already made.
 * @param interaction - The interaction to answer.
 * @param options - The reply to send.
 * @returns `true` when Discord accepted the response, `false` when it did not.
 */
export async function respond(
  interaction: RepliableInteraction,
  options: InteractionReplyOptions,
): Promise<boolean> {
  try {
    if (interaction.deferred) {
      await interaction.editReply(asEdit(options));
    } else if (interaction.replied) {
      await interaction.followUp(options);
    } else {
      await interaction.reply(options);
    }
    return true;
  } catch (err) {
    const code = errorCode(err);
    if (code !== null && ACKNOWLEDGED_CODES.has(code)) return sendFollowUp(interaction, options);
    reportRefusal(interaction, err);
    return false;
  }
}
