// src/commands/setdelay.ts

import { INDEFINITE_PROMPT_LABEL } from "@/media/approval";
import { resolveLimits } from "@/media/prefs";
import { loadSettings, saveSettings } from "@/media/settings";
import { MediaSettings, PersonalLimits } from "@/media/types";
import { createLogger } from "@/utils/log";
import { requireAdmin } from "@/utils/permissions";
import { respond } from "@/utils/respond";
import {
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

const log = createLogger("cmd/setdelay");

/** The `/setdelay` subcommands that set the server default. */
export type DelayMode = "instant" | "countdown" | "ask";

/**
 * Slash command definition for `/setdelay`. The modes share their names with
 * `/mydelay`, so a mode means the same thing whoever sets it:
 * - `/setdelay instant` - move links immediately, no prompt
 * - `/setdelay countdown seconds:<1-300>` - move unless the poster hits Cancel in time
 * - `/setdelay ask [seconds:<1-300>]` - ask, and leave the link if nobody
 *   answers; no seconds waits up to {@link INDEFINITE_PROMPT_LABEL}
 *
 * `/setdelay members` sits alongside them, governing what members may pick
 * for themselves with `/mydelay` rather than the default itself.
 */
export const data = new SlashCommandBuilder()
  .setName("setdelay")
  .setDescription("⏱️ How media links get moved by default")
  .addSubcommand((sub) =>
    sub.setName("instant").setDescription("Move links straight away, no prompt"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("countdown")
      .setDescription("Move links unless the poster hits Cancel in time")
      .addIntegerOption((opt) =>
        opt
          .setName("seconds")
          .setDescription("How long they get to cancel (1-300)")
          .setMinValue(1)
          .setMaxValue(300)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("ask")
      .setDescription("Ask the poster first, and leave the link if they don't answer")
      .addIntegerOption((opt) =>
        opt
          .setName("seconds")
          .setDescription(
            `How long the prompt waits (1-300); blank waits up to ${INDEFINITE_PROMPT_LABEL}`,
          )
          .setMinValue(1)
          .setMaxValue(300),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("members")
      .setDescription("What members may set for themselves with /mydelay")
      .addBooleanOption((opt) =>
        opt.setName("enabled").setDescription("Let members set their own delay"),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("max-seconds")
          .setDescription("Longest delay a member may pick (1-300)")
          .setMinValue(1)
          .setMaxValue(300),
      )
      .addBooleanOption((opt) =>
        opt.setName("allow-never").setDescription("Let members opt out of moves entirely"),
      ),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Applies the supplied `/setdelay members` options to the bounds already in
 * force. Every option is optional, so `null` (nothing supplied) leaves the
 * current value alone.
 * @param current - The bounds in force.
 * @param changes - The options as Discord returned them.
 * @param changes.enabled - Whether members may set their own delay.
 * @param changes.maxSeconds - Longest delay a member may pick.
 * @param changes.allowNever - Whether members may opt out of moves entirely.
 * @returns The {@link PersonalLimits} to persist.
 */
export function mergePersonal(
  current: PersonalLimits,
  changes: {
    enabled?: boolean | null;
    maxSeconds?: number | null;
    allowNever?: boolean | null;
  },
): PersonalLimits {
  return {
    enabled: changes.enabled ?? current.enabled,
    maxSeconds: changes.maxSeconds ?? current.maxSeconds,
    allowNever: changes.allowNever ?? current.allowNever,
  };
}

/**
 * Converts the chosen subcommand and seconds into the stored settings.
 * Seconds are stored as milliseconds, the unit the approval pipeline expects.
 * An ask with no seconds is stored as "disabled", the wait-as-long-as-allowed
 * grace.
 * @param mode - The subcommand run.
 * @param [seconds] - Seconds supplied with countdown or ask.
 * @returns The `grace` and `countdown` fields to persist.
 */
export function resolveDelay(
  mode: DelayMode,
  seconds?: number | null,
): Pick<MediaSettings, "grace" | "countdown"> {
  if (mode === "instant") return { grace: "instant", countdown: false };
  if (mode === "countdown") return { grace: Number(seconds ?? 10) * 1000, countdown: true };
  return { grace: seconds == null ? "disabled" : seconds * 1000, countdown: false };
}

/**
 * Confirms a new server default in plain words.
 * @param mode - The subcommand run.
 * @param seconds - Seconds supplied, if any.
 * @returns The confirmation text.
 */
function confirmDelay(mode: DelayMode, seconds: number | null): string {
  if (mode === "instant") return "✅ Links get moved straight away now, no prompt.";
  if (mode === "countdown") {
    return `✅ Links get moved after ${seconds}s unless the poster hits Cancel.`;
  }
  return seconds == null
    ? `✅ Posters get asked first, and the prompt waits up to ${INDEFINITE_PROMPT_LABEL} for an answer.`
    : `✅ Posters get asked first, and have ${seconds}s to hit Move before their link is left where it is.`;
}

/**
 * Executes the `/setdelay` command: authorises the invoker, persists the new
 * grace setting, and confirms what behaviour was configured.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply has been sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    log.warn("invoked outside guild", { userId: interaction.user.id });
    await respond(interaction, { content: "Use in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (!(await requireAdmin(interaction))) {
    log.warn("permission denied", { guildId, userId });
    return;
  }

  const mode = interaction.options.getSubcommand() as DelayMode | "members";

  if (mode === "members") {
    await setPersonal(interaction, guildId);
    return;
  }

  const seconds = mode === "instant" ? null : interaction.options.getInteger("seconds");

  try {
    const settings = loadSettings(guildId);
    const next = resolveDelay(mode, seconds);
    settings.grace = next.grace;
    // Only written when on, so a server that never counts down keeps no key
    if (next.countdown) settings.countdown = true;
    else delete settings.countdown;
    saveSettings(guildId, settings);

    log.info(
      "grace updated",
      { guildId, by: interaction.user.username, mode, seconds },
      { byId: userId },
    );

    await respond(interaction, {
      content: confirmDelay(mode, seconds),
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    log.error("failed to update grace", {
      guildId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    await respond(interaction, {
      content: "⚠️ There was an error.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handles `/setdelay members`: stores the bounds on what members may set for
 * themselves. Tightening them applies to preferences members already saved,
 * since the bounds are re-applied every time a preference is read.
 * @param interaction - The command interaction context.
 * @param guildId - Discord guild ID.
 * @returns A promise that resolves when the reply has been sent.
 */
async function setPersonal(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  try {
    const settings = loadSettings(guildId);
    const next = mergePersonal(resolveLimits(settings), {
      enabled: interaction.options.getBoolean("enabled"),
      maxSeconds: interaction.options.getInteger("max-seconds"),
      allowNever: interaction.options.getBoolean("allow-never"),
    });
    settings.personal = next;
    saveSettings(guildId, settings);

    log.info(
      "personal limits updated",
      { guildId, by: interaction.user.username, ...next },
      { byId: interaction.user.id },
    );

    await respond(interaction, {
      content: next.enabled
        ? `✅ Members can set their own delay with \`/mydelay\`, up to ${next.maxSeconds}s${
            next.allowNever ? ", and can opt out entirely" : ", but cannot opt out entirely"
          }.`
        : "✅ Members can't set their own delay; everyone follows the server default.",
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    log.error("failed to update personal limits", {
      guildId,
      userId: interaction.user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    await respond(interaction, {
      content: "⚠️ There was an error.",
      flags: MessageFlags.Ephemeral,
    });
  }
}
