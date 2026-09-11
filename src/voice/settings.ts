// src/voice/settings.ts

// Per-guild autojoin switch. Defaults to off: turning up in populated channels
// uninvited and transcribing whoever is in them is the most intrusive thing the
// bot does, so a server opts in once with /autojoin on rather than finding the
// bot already sitting in a call. /join works either way.

import { loadData, saveData } from "@/utils/file";
import { createLogger } from "@/utils/log";
import { loadSounds } from "@/voice/sounds";

const log = createLogger("voice/settings");

/** Storage filename for the per-guild autojoin switch. */
export const VOICE_FILE = "voice.json";

/** Stored voice state for one guild. */
export interface VoiceSettings {
  /**
   * Explicit autojoin opt-in or opt-out; absent falls back to the sounds
   * config. Stored as `enabled`, the key the file has always used.
   */
  enabled?: boolean;
}

/**
 * Reads a guild's stored voice settings.
 * @param guildId - Discord guild (server) ID.
 * @returns The stored settings, empty when the guild has never been configured.
 */
export function readVoiceSettings(guildId: string): VoiceSettings {
  return loadData<VoiceSettings>(guildId, VOICE_FILE, { soft: true, defaultValue: {} });
}

/**
 * Checks whether the bot joins calls in a guild on its own. An explicit
 * `/autojoin on` or `/autojoin off` always wins; with neither, the sounds
 * config's own `enabled` decides, which lets someone running their own
 * instance switch it on for every guild at once.
 * @param guildId - Discord guild (server) ID.
 * @returns `true` when the bot may join populated channels uninvited.
 */
export function isAutojoin(guildId: string): boolean {
  const stored = readVoiceSettings(guildId).enabled;
  if (typeof stored === "boolean") return stored;
  return loadSounds(guildId).config.enabled ?? false;
}

/**
 * Stores a guild's autojoin switch.
 * @param guildId - Discord guild (server) ID.
 * @param enabled - Whether the bot may join populated channels uninvited.
 */
export function setAutojoin(guildId: string, enabled: boolean): void {
  saveData<VoiceSettings>(guildId, VOICE_FILE, { ...readVoiceSettings(guildId), enabled });
  log.info("autojoin switch saved", { guildId, enabled });
}
