// src/voice/settings.ts

// Per-guild switch for voice listening. Defaults to off: the bot auto-joins
// populated channels and transcribes whoever is in them, which is the most
// intrusive thing it does, so a server opts in once with /voice enable rather
// than finding the bot already sitting in a call.

import { loadData, saveData } from "@/utils/file";
import { createLogger } from "@/utils/log";
import { loadSounds } from "@/voice/sounds";

const log = createLogger("voice/settings");

/** Storage filename for the per-guild voice switch. */
export const VOICE_FILE = "voice.json";

/** Stored voice state for one guild. */
export interface VoiceSettings {
  /** Explicit opt-in or opt-out; absent falls back to the sounds config. */
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
 * Checks whether the bot may listen in a guild. An explicit `/voice enable` or
 * `/voice disable` always wins; with neither, the sounds config's own `enabled`
 * decides, which lets someone running their own instance switch it on for every
 * guild at once.
 * @param guildId - Discord guild (server) ID.
 * @returns `true` when voice listening is on for the guild.
 */
export function isVoiceEnabled(guildId: string): boolean {
  const stored = readVoiceSettings(guildId).enabled;
  if (typeof stored === "boolean") return stored;
  return loadSounds(guildId).config.enabled ?? false;
}

/**
 * Stores a guild's voice switch.
 * @param guildId - Discord guild (server) ID.
 * @param enabled - Whether the bot may listen.
 */
export function setVoiceEnabled(guildId: string, enabled: boolean): void {
  saveData<VoiceSettings>(guildId, VOICE_FILE, { ...readVoiceSettings(guildId), enabled });
  log.info("voice switch saved", { guildId, enabled });
}
