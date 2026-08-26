// src/commands/setdelay.ts

import { resolveLimits } from "@/media/prefs";
import { loadSettings, saveSettings } from "@/media/settings";
import { GraceSetting, PersonalLimits } from "@/media/types";
import { createLogger } from "@/utils/log";
import { requireAdmin } from "@/utils/permissions";
import { respond } from "@/utils/respond";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

const log = createLogger("cmd/setdelay");

/**
 * Slash command definition for `/setdelay`. Subcommands make the input
 * self-explanatory - no mode/value combination to get wrong:
 * - `/setdelay instant` - move links immediately, no prompt
 * - `/setdelay seconds seconds:<1-300>` - prompt that times out
 * - `/setdelay disabled` - prompt that stays up for a day
 *
 * `/setdelay personal` sits alongside them, governing what members may pick
 * for themselves with `/mydelay` rather than the default itself.
 */
export const data = new SlashCommandBuilder()
  .setName("setdelay")
  .setDescription("⏱️ How long posters get before their link is moved")
  .addSubcommand((sub) =>
    sub.setName("instant").setDescription("No prompt - links get moved straight away"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("seconds")
      .setDescription("Give the poster a few seconds to hit Yes or No")
      .addIntegerOption((opt) =>
        opt
          .setName("seconds")
          .setDescription("How long they get (1-300)")
          .setMinValue(1)
          .setMaxValue(300)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("disabled").setDescription("Always ask, and leave the prompt up for a day"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("personal")
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
 * Applies the supplied `/setdelay personal` options to the bounds already in
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
 * Converts the chosen subcommand/value into the persisted grace
 * representation.
 * @param mode - "instant", "disabled", or "seconds".
 * @param seconds - Optional seconds value when mode is "seconds".
 * @returns The {@link GraceSetting} to persist (milliseconds when mode is "seconds").
 */
export function resolveGrace(
  mode: "instant" | "disabled" | "seconds",
  seconds?: number | null,
): GraceSetting {
  if (mode === "instant" || mode === "disabled") return mode;
  // Stored as milliseconds: the approval pipeline treats a numeric grace as ms.
  return Number(seconds ?? 10) * 1000;
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

  const mode = interaction.options.getSubcommand() as
    "instant" | "disabled" | "seconds" | "personal";

  if (mode === "personal") {
    await setPersonal(interaction, guildId);
    return;
  }

  const seconds = mode === "seconds" ? interaction.options.getInteger("seconds", true) : null;

  try {
    const settings = loadSettings(guildId);
    settings.grace = resolveGrace(mode, seconds);
    saveSettings(guildId, settings);

    log.info("grace updated", { guildId, by: userId, mode, seconds });

    const confirmations: Record<"instant" | "seconds" | "disabled", string> = {
      instant: "✅ Links get moved straight away now, no prompt.",
      seconds: `✅ Posters get ${seconds}s to hit Yes or No before the prompt gives up.`,
      disabled: "✅ Posters always get asked, and the prompt stays up for a day.",
    };
    await respond(interaction, { content: confirmations[mode], flags: MessageFlags.Ephemeral });
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
 * Handles `/setdelay personal`: stores the bounds on what members may set for
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

    log.info("personal limits updated", { guildId, by: interaction.user.id, ...next });

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
