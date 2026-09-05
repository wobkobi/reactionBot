// src/voice/autojoin.ts

// Decides which voice channel the bot should be sitting in, and enforces every
// guard that keeps auto-joining from being expensive or obnoxious.
//
// The decision itself is one pure function, pickChannel, so the guards are
// testable without a gateway. Everything impure around it - debounce, rejoin
// cooldown, the session cap - only decides when to ask.

import { createLogger } from "@/utils/log";
import {
  activeSessions,
  closeAllSessions,
  closeSession,
  openSession,
  sessionChannelId,
} from "@/voice/session";
import { isVoiceEnabled } from "@/voice/settings";
import { loadSounds } from "@/voice/sounds";
import { stopStt } from "@/voice/stt";
import type { Client, Guild, VoiceBasedChannel, VoiceState } from "discord.js";
import { ChannelType, PermissionFlagsBits } from "discord.js";

const log = createLogger("voice/autojoin");

/** Channels the bot will listen in at once, across every guild. */
export const MAX_SESSIONS = 4;

/** Delay before acting on voice state changes, to coalesce a burst into one move. */
export const JOIN_DEBOUNCE_MS = 1_500;

/** How long a guild is left alone after the bot leaves a channel. */
export const REJOIN_COOLDOWN_MS = 10_000;

/** What pickChannel needs to know about one candidate channel. */
export interface ChannelSnapshot {
  channelId: string;
  humans: number;
  isAfk: boolean;
  isStage: boolean;
  isFull: boolean;
  canConnect: boolean;
  canSpeak: boolean;
}

const debounces = new Map<string, NodeJS.Timeout>();
const leftAt = new Map<string, number>();

/**
 * Chooses the channel the bot should be in, or null for none.
 *
 * The current channel wins any tie it qualifies for. Following the busiest
 * channel instead would make the bot hop as people move, which thrashes the
 * connection and is maddening to sit in.
 * @param snapshots - One entry per voice channel in the guild.
 * @param minMembers - Humans a channel needs before it is worth joining.
 * @param currentChannelId - Where the bot is now, or null.
 * @returns The channel to be in, or null to leave.
 */
export function pickChannel(
  snapshots: ChannelSnapshot[],
  minMembers: number,
  currentChannelId: string | null,
): string | null {
  const eligible = snapshots.filter(
    (s) =>
      !s.isAfk &&
      !s.isStage &&
      s.canConnect &&
      s.canSpeak &&
      s.humans >= Math.max(1, minMembers) &&
      (!s.isFull || s.channelId === currentChannelId),
  );
  if (eligible.length === 0) return null;

  const staying = eligible.find((s) => s.channelId === currentChannelId);
  if (staying) return staying.channelId;

  // Busiest first, then by ID so the choice is stable rather than dependent on
  // whatever order the cache happened to hand back.
  const best = [...eligible].sort(
    (a, b) => b.humans - a.humans || a.channelId.localeCompare(b.channelId),
  )[0];
  return best?.channelId ?? null;
}

/**
 * Counts real people in a channel; bots do not make a channel worth joining.
 * @param channel - The voice channel to inspect.
 * @returns How many non-bot members are connected.
 */
export function countHumans(channel: VoiceBasedChannel): number {
  return channel.members.filter((member) => !member.user.bot).size;
}

/**
 * Describes a channel for {@link pickChannel}.
 * @param channel - The voice channel to describe.
 * @returns The snapshot, or null when the bot's own permissions cannot be read.
 */
function snapshot(channel: VoiceBasedChannel): ChannelSnapshot | null {
  const me = channel.guild.members.me;
  if (!me) return null;
  const perms = channel.permissionsFor(me);
  return {
    channelId: channel.id,
    humans: countHumans(channel),
    isAfk: channel.id === channel.guild.afkChannelId,
    isStage: channel.type === ChannelType.GuildStageVoice,
    isFull: channel.userLimit > 0 && channel.members.size >= channel.userLimit,
    canConnect: perms?.has(PermissionFlagsBits.Connect) ?? false,
    canSpeak: perms?.has(PermissionFlagsBits.Speak) ?? false,
  };
}

/**
 * Re-evaluates where the bot should be in one guild, and moves it if needed.
 * @param guild - The guild to evaluate.
 */
async function reconcile(guild: Guild): Promise<void> {
  const guildId = guild.id;
  const current = sessionChannelId(guildId);

  if (!isVoiceEnabled(guildId)) {
    if (current) closeSession(guildId, "voice disabled");
    return;
  }

  const compiled = loadSounds(guildId);
  if (compiled.triggers.length === 0) {
    if (current) closeSession(guildId, "no triggers configured");
    return;
  }

  const channels = [...guild.channels.cache.values()].filter(
    (channel): channel is VoiceBasedChannel =>
      channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice,
  );
  const snapshots = channels.map(snapshot).filter((s): s is ChannelSnapshot => s !== null);
  const target = pickChannel(snapshots, compiled.config.minMembers ?? 1, current);

  if (target === current) return;

  if (current) {
    closeSession(guildId, target ? "moving channel" : "channel empty");
    leftAt.set(guildId, Date.now());
  }
  if (!target) return;

  const since = Date.now() - (leftAt.get(guildId) ?? 0);
  if (since < REJOIN_COOLDOWN_MS) {
    log.debug("rejoin on cooldown", { guildId, since });
    return;
  }

  // The cap is process-wide and existing sessions win, so a busy evening in one
  // server cannot push the bot out of channels it is already sitting in.
  if (activeSessions() >= MAX_SESSIONS) {
    log.info("session cap reached, not joining", { guildId, cap: MAX_SESSIONS });
    return;
  }

  const channel = channels.find((c) => c.id === target);
  if (channel) await openSession(channel);
}

/**
 * Queues a re-evaluation for a guild, coalescing a burst of voice state changes
 * (which arrive several at a time when a call fills up) into one decision.
 * @param guild - The guild to re-evaluate.
 */
function scheduleReconcile(guild: Guild): void {
  const existing = debounces.get(guild.id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    debounces.delete(guild.id);
    void reconcile(guild).catch((err: unknown) => {
      log.warn("voice reconcile failed", {
        guildId: guild.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, JOIN_DEBOUNCE_MS);
  timer.unref();
  debounces.set(guild.id, timer);
}

/**
 * Reacts to someone joining, leaving or moving between voice channels.
 * @param oldState - The member's previous voice state.
 * @param newState - The member's current voice state.
 */
export async function onVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  // Mutes, deafens and camera toggles fire this event too and change nothing
  // about which channel is worth being in.
  if (oldState.channelId === newState.channelId) return;
  const guild = newState.guild ?? oldState.guild;
  if (!guild) return;
  if (newState.member?.user.bot && oldState.member?.user.bot) return;
  scheduleReconcile(guild);
}

/**
 * Evaluates every guild once at startup. People already sitting in a call when
 * the bot restarts never emit a voice state update, so without this the bot
 * waits for the next person to move before it joins anything.
 * @param client - The logged-in client.
 * @param inScope - Guild filter, so a dev instance stays in its own server.
 */
export async function sweepGuilds(
  client: Client,
  inScope: (guildId: string) => boolean,
): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    if (!inScope(guild.id)) continue;
    await reconcile(guild).catch((err: unknown) => {
      log.warn("startup voice sweep failed", {
        guildId: guild.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

/**
 * Leaves every channel and stops the transcriber.
 */
export function shutdownVoice(): void {
  for (const timer of debounces.values()) clearTimeout(timer);
  debounces.clear();
  closeAllSessions("shutting down");
  stopStt();
}
