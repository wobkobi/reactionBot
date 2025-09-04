// src/media/settings.ts

/**
 * @file Loads and resolves per-guild media settings.
 */

import { loadData, saveData } from "../utils/file.js";
import { createLogger } from "../utils/log.js";
import { ApprovalPlan, GraceSetting, MediaSettings } from "./types.js";

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
export function resolveTargetChannelId(
  settings: MediaSettings,
  fallbackChannelId: string
): string {
  const id = settings.channelId ?? fallbackChannelId;
  log.trace("resolved target channel", {
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
  sameChannel: boolean
): ApprovalPlan {
  if (sameChannel) {
    // Special-case per product spec
    const plan: ApprovalPlan = {
      autoApprove: false,
      timeoutMs: 15_000,
      persistIndefinitely: false,
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
      promptText: "Move your media link to the media channel?",
    };
  } else if (g === "disabled") {
    plan = {
      autoApprove: false,
      timeoutMs: undefined,
      persistIndefinitely: true,
      promptText: "Move your media link to the media channel?",
    };
  } else {
    const ms =
      Number.isFinite(g) && (g as number) >= 0 ? (g as number) : 10_000;
    plan = {
      autoApprove: false,
      timeoutMs: ms,
      persistIndefinitely: false,
      promptText: "Move your media link to the media channel?",
    };
  }
  log.debug("approval plan", { sameChannel, grace: g, plan });
  return plan;
}
