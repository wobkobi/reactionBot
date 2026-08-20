// src/media/settings.ts

// Loads per-guild media settings and resolves them, together with a member's
// own preference, into the plan for one message.

import { clampPref, resolveLimits } from "@/media/prefs";
import { ApprovalPlan, GraceSetting, MediaSettings, MemberPref } from "@/media/types";
import { loadData, saveData } from "@/utils/file";
import { createLogger } from "@/utils/log";

const log = createLogger("media/settings");

/** Filename for persisted settings. */
export const SETTINGS_FILE = "media_settings.json";

/**
 * Loads settings for a guild. Returns empty defaults if file is missing.
 * @param guildId - Discord guild ID.
 * @returns The stored {@link MediaSettings}.
 */
export function loadSettings(guildId: string): MediaSettings {
  const s = loadData<MediaSettings>(guildId, SETTINGS_FILE, { soft: true });
  log.debug("loaded settings", {
    guildId,
    hasChannel: !!s.channelId,
    hasGrace: s.grace != null,
  });
  return s;
}

/**
 * Saves settings for a guild.
 * @param guildId - Discord guild ID.
 * @param next - The full {@link MediaSettings} object to persist.
 */
export function saveSettings(guildId: string, next: MediaSettings): void {
  saveData(guildId, SETTINGS_FILE, next);
  log.info("saved settings", {
    guildId,
    channelId: next.channelId ?? null,
    grace: next.grace ?? null,
  });
}

/**
 * Resolves the target channel ID for reposting. Falls back to the source channel.
 * @param settings - Stored settings.
 * @param fallbackChannelId - The source channel ID if settings lack `channelId`.
 * @returns The channel ID to use for reposting (settings.channelId or fallback).
 */
export function resolveTargetChannelId(settings: MediaSettings, fallbackChannelId: string): string {
  const id = settings.channelId ?? fallbackChannelId;
  log.debug("resolved target channel", {
    resolved: id,
    usedFallback: !settings.channelId,
  });
  return id;
}

/**
 * Computes the approval plan (text + timing) from settings, with a special
 * case when reposting into the same channel:
 * - prompt text is different
 * - timeout is hard-coded to 15 seconds (overrides "disabled"/numbers)
 * @param grace - The configured {@link GraceSetting}.
 * @param sameChannel - Whether repost target is the same as the source.
 * @returns An {@link ApprovalPlan}.
 */
export function resolveApprovalPlan(
  grace: GraceSetting | undefined,
  sameChannel: boolean,
): ApprovalPlan {
  if (sameChannel) {
    // Special-case per product spec
    const plan: ApprovalPlan = {
      autoApprove: false,
      timeoutMs: 15_000,
      persistIndefinitely: false,
      approveOnTimeout: false,
      promptText: "Rewrite your link here with an embeddable version?",
    };
    log.debug("approval plan (same channel)", { plan });
    return plan;
  }

  const g = grace ?? 10_000;
  let plan: ApprovalPlan;
  if (g === "instant") {
    plan = {
      autoApprove: true,
      timeoutMs: undefined,
      persistIndefinitely: false,
      approveOnTimeout: false,
      promptText: "Move your media link to the media channel?",
    };
  } else if (g === "disabled") {
    plan = {
      autoApprove: false,
      timeoutMs: undefined,
      persistIndefinitely: true,
      approveOnTimeout: false,
      promptText: "Move your media link to the media channel?",
    };
  } else {
    const ms = Number.isFinite(g) && (g as number) >= 0 ? (g as number) : 10_000;
    plan = {
      autoApprove: false,
      timeoutMs: ms,
      persistIndefinitely: false,
      approveOnTimeout: false,
      promptText: "Move your media link to the media channel?",
    };
  }
  log.debug("approval plan", { sameChannel, grace: g, plan });
  return plan;
}

/**
 * Resolves the plan for one message: a member's own preference when it
 * applies, otherwise the guild `/setdelay` default. Member preferences govern
 * cross-channel moves only, so a same-channel rewrite never consults one.
 * @param settings - Stored guild settings.
 * @param pref - The poster's stored preference, if they have one.
 * @param sameChannel - Whether the repost target is the source channel.
 * @returns The {@link ApprovalPlan} to run, or `null` when the poster opted
 * out of moves entirely and nothing should happen.
 */
export function resolvePlanFor(
  settings: MediaSettings,
  pref: MemberPref | undefined,
  sameChannel: boolean,
): ApprovalPlan | null {
  const guildPlan = resolveApprovalPlan(settings.grace, sameChannel);
  if (sameChannel) return guildPlan;

  const effective = clampPref(pref, resolveLimits(settings));
  if (!effective) return guildPlan;

  log.debug("member preference applies", { mode: effective.mode, seconds: effective.seconds });
  switch (effective.mode) {
    case "never":
      return null;
    case "instant":
      return { ...guildPlan, autoApprove: true, timeoutMs: undefined, persistIndefinitely: false };
    case "countdown":
      return {
        autoApprove: false,
        approveOnTimeout: true,
        timeoutMs: (effective.seconds ?? 10) * 1000,
        persistIndefinitely: false,
        promptText: "Moving your media link to the media channel - hit Cancel to keep it here.",
      };
    case "ask":
      return {
        autoApprove: false,
        approveOnTimeout: false,
        timeoutMs: (effective.seconds ?? 10) * 1000,
        persistIndefinitely: false,
        promptText: "Move your media link to the media channel?",
      };
  }
}
