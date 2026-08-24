// src/commands/mydelay.ts

import { clampPref, clearPref, loadPref, resolveLimits, savePref } from "@/media/prefs";
import { loadSettings } from "@/media/settings";
import { GraceSetting, MemberMode, MemberPref, PersonalLimits } from "@/media/types";
import { createLogger } from "@/utils/log";
import { SlashCommandBuilder } from "@discordjs/builders";
import { InteractionContextType } from "discord-api-types/v10";
import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

const log = createLogger("cmd/mydelay");

/**
 * Slash command definition for `/mydelay`. Governs cross-channel moves of the
 * invoker's own links only; same-channel rewrites and tracking cleans keep
 * asking regardless of what is set here.
 */
export const data = new SlashCommandBuilder()
  .setName("mydelay")
  .setDescription("⏱️ How your own media links get handled")
  .addSubcommand((sub) =>
    sub.setName("instant").setDescription("Move mine straight away, no prompt"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("countdown")
      .setDescription("Move mine unless I hit Cancel in time")
      .addIntegerOption((opt) =>
        opt
          .setName("seconds")
          .setDescription("How long you get to cancel (1-300)")
          .setMinValue(1)
          .setMaxValue(300)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("ask")
      .setDescription("Ask me first, and leave it put if I say nothing")
      .addIntegerOption((opt) =>
        opt
          .setName("seconds")
          .setDescription("How long the prompt waits (1-300)")
          .setMinValue(1)
          .setMaxValue(300)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("never").setDescription("Never move mine, and never prompt me"),
  )
  .addSubcommand((sub) => sub.setName("show").setDescription("Show what is set for you right now"))
  .addSubcommand((sub) =>
    sub.setName("clear").setDescription("Drop yours and follow the server default"),
  )
  .setContexts(InteractionContextType.Guild);

/**
 * Builds the preference to persist from the chosen subcommand.
 * @param mode - The subcommand the member ran.
 * @param [seconds] - Seconds supplied with countdown or ask.
 * @returns The {@link MemberPref} to store; `seconds` is dropped for the modes
 * that have no timing of their own.
 */
export function resolvePref(mode: MemberMode, seconds?: number | null): MemberPref {
  if (mode === "instant" || mode === "never") return { mode };
  return { mode, seconds: Number(seconds ?? 10) };
}

/**
 * Describes the guild `/setdelay` behaviour in the second person, for replies
 * that have to name what applies instead of a member's own choice.
 * @param grace - The configured guild grace.
 * @returns A sentence fragment describing it.
 */
function describeGuildDefault(grace: GraceSetting | undefined): string {
  const g = grace ?? 10_000;
  if (g === "instant") return "your links get moved straight away";
  if (g === "disabled") return "you get asked, and the prompt stays up for a day";
  return `you get ${Math.round((g as number) / 1000)}s to hit Yes before the prompt gives up`;
}

/**
 * Describes a member's own setting in the second person.
 * @param pref - The preference in force, after clamping.
 * @returns A sentence fragment describing it.
 */
function describePref(pref: MemberPref): string {
  switch (pref.mode) {
    case "instant":
      return "your links get moved straight away, no prompt";
    case "countdown":
      return `your links get moved after ${pref.seconds}s unless you hit Cancel`;
    case "ask":
      return `you get ${pref.seconds}s to hit Yes before the prompt gives up`;
    case "never":
      return "your links are never moved, and you are never prompted";
  }
}

/**
 * Answers `/mydelay show`: what is actually in force, which is not always what
 * the member set - admin bounds are applied on read, so a stored choice can be
 * clamped or ignored after the fact.
 * @param interaction - The command interaction context.
 * @param guildId - Discord guild ID.
 * @returns A promise that resolves when the reply is sent.
 */
async function replyWithCurrent(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const settings = loadSettings(guildId);
  const stored = loadPref(guildId, interaction.user.id);
  const effective = clampPref(stored, resolveLimits(settings));

  let content: string;
  if (!effective) {
    content = stored
      ? `⚙️ Your setting is not allowed here, so the server default applies: ${describeGuildDefault(settings.grace)}.`
      : `⚙️ You are on the server default: ${describeGuildDefault(settings.grace)}.`;
  } else {
    const clamped = stored?.seconds !== undefined && stored.seconds !== effective.seconds;
    content = `⚙️ In force for you: ${describePref(effective)}.${
      clamped ? ` Your ${stored?.seconds}s was clamped to what this server allows.` : ""
    }`;
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

/**
 * Confirms a stored choice, naming the clamp when the value had to be pulled
 * into the guild's bounds.
 * @param pref - What the member asked for.
 * @param limits - The bounds in force.
 * @returns The confirmation text.
 */
function confirmation(pref: MemberPref, limits: PersonalLimits): string {
  const clamped = clampPref(pref, limits);
  const seconds = clamped?.seconds;
  const wasClamped = seconds !== undefined && seconds !== pref.seconds;
  switch (pref.mode) {
    case "instant":
      return "✅ Your links get moved straight away now, no prompt.";
    case "never":
      return "✅ Your links stay put, and you won't be prompted about them.";
    default: {
      const shown = describePref({ mode: pref.mode, seconds });
      const note = wasClamped ? ` (${pref.seconds}s is over this server's limit.)` : "";
      return `✅ ${shown[0].toUpperCase()}${shown.slice(1)}.${note}`;
    }
  }
}

/**
 * Executes `/mydelay`: stores, shows, or drops the invoker's own preference
 * for how their media links are handled.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply has been sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    log.warn("invoked outside guild", { userId: interaction.user.id });
    await interaction.reply({ content: "Use in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const sub = interaction.options.getSubcommand() as MemberMode | "show" | "clear";

  try {
    const settings = loadSettings(guildId);
    const limits = resolveLimits(settings);

    if (sub === "show") {
      await replyWithCurrent(interaction, guildId);
      return;
    }

    if (sub === "clear") {
      clearPref(guildId, userId);
      await interaction.reply({
        content: `✅ Dropped. You're on the server default now: ${describeGuildDefault(settings.grace)}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!limits.enabled) {
      await interaction.reply({
        content: `❌ This server doesn't let members set their own delay. The server default applies: ${describeGuildDefault(settings.grace)}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "never" && !limits.allowNever) {
      await interaction.reply({
        content: `❌ This server doesn't allow opting out of moves. The server default applies: ${describeGuildDefault(settings.grace)}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const seconds =
      sub === "countdown" || sub === "ask" ? interaction.options.getInteger("seconds", true) : null;
    const pref = resolvePref(sub, seconds);
    savePref(guildId, userId, pref);
    log.info("member preference updated", { guildId, userId, mode: pref.mode, seconds });

    await interaction.reply({
      content: confirmation(pref, limits),
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    log.error("failed to update member preference", {
      guildId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    await interaction.reply({
      content: "⚠️ There was an error.",
      flags: MessageFlags.Ephemeral,
    });
  }
}
