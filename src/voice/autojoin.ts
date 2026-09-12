// src/voice/autojoin.ts

// Decides which voice channel the bot should be sitting in, and enforces every
// guard that keeps auto-joining from being expensive or obnoxious.
//
// The decision itself is one pure function, pickChannel, so the guards are
// testable without a gateway. Everything impure around it - debounce, rejoin
// cooldown, the session cap - only decides when to ask.

import { createLogger } from "@/utils/log";
import { noteJoin } from "@/voice/entrance";
import {
  activeSessions,
  closeAllSessions,
  closeSession,
  joiningChannelId,
  openSession,
  sessionChannelId,
  sessionConnection,
} from "@/voice/session";
import { isAutojoin } from "@/voice/settings";
import { hasSomethingToPlay, loadSounds } from "@/voice/sounds";
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

/**
 * /kick and /join runs in one server, inside {@link CONTEST_WINDOW_MS}, that
 * still do as they are told. Asking the bot to come or go is normal; asking
 * this many times over is two people using it to tug at each other, and past
 * here the coin decides instead of the caller.
 */
export const CONTEST_THRESHOLD = 3;

/**
 * How far back those runs are counted. Has to stay comfortably above
 * {@link CONTEST_COOLDOWN_MS}: if the wait between attempts outlived this, the
 * runs that made a call contested would age out while people waited, and the
 * coin would never be tossed at all.
 */
export const CONTEST_WINDOW_MS = 5 * 60_000;

/** Gap between attempts once a call is contested, so the coin cannot be rushed. */
export const CONTEST_COOLDOWN_MS = 2.5 * 60_000;

/** Chance a contested /kick or /join gets its way. */
export const COIN_ODDS = 0.5;

/** Gap between periodic re-sweeps, which is what notices a config edit. */
export const VOICE_SWEEP_INTERVAL_MS = 60_000;

/**
 * A /join. Its presence is what lets the bot enter a call with autojoin off,
 * and it names the channel to prefer.
 */
export interface JoinRequest {
  /**
   * The voice channel the caller was sitting in, preferred over the busiest
   * one, or null when they were not in a call themselves.
   */
  channelId: string | null;
}

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
 * Channels a kick is keeping the bot out of, per guild. A kick holds until
 * someone runs /join or the call ends, so the setting is untouched and the
 * next call there still gets the bot. Kept per channel so two hostile calls
 * both stay kicked rather than the bot hopping between them.
 */
const kickedFrom = new Map<string, Set<string>>();

/**
 * When /kick and /join last ran in each guild, newest last and pruned to
 * {@link CONTEST_WINDOW_MS}. Both commands share the count: a tug of war is
 * made of the two together, and counting them apart would miss it.
 */
const recentCommands = new Map<string, number[]>();

/**
 * The reconcile in flight per guild, so a second one waits its turn. Two at
 * once both see no session and both open one on the same connection, which
 * captures every speaker twice.
 */
const reconciling = new Map<string, Promise<void>>();

/** The periodic re-sweep, cleared by {@link shutdownVoice}. */
let sweepTimer: NodeJS.Timeout | null = null;

/**
 * Chooses the channel the bot should be in, or null for none.
 *
 * The current channel wins any tie it qualifies for. Following the busiest
 * channel instead would make the bot hop as people move, which thrashes the
 * connection and is maddening to sit in.
 * @param snapshots - One entry per voice channel in the guild.
 * @param minMembers - Humans a channel needs before it is worth joining.
 * @param currentChannelId - Where the bot is now, or null.
 * @param requestedChannelId - The channel a /join caller was sitting in, which
 * wins outright when it is joinable, or null when nobody asked.
 * @returns The channel to be in, or null to leave.
 */
export function pickChannel(
  snapshots: ChannelSnapshot[],
  minMembers: number,
  currentChannelId: string | null,
  requestedChannelId: string | null = null,
): string | null {
  // The guards a channel cannot talk its way out of: the bot either can sit
  // there and be heard, or it cannot.
  const joinable = (s: ChannelSnapshot): boolean =>
    !s.isAfk &&
    !s.isStage &&
    s.canConnect &&
    s.canSpeak &&
    (!s.isFull || s.channelId === currentChannelId);

  // Someone asking from their own channel outranks the head count and the
  // busiest-wins tie-break: minMembers is there to keep the bot out of quiet
  // channels nobody invited it to, and this is an invitation. It still has to
  // have somebody in it, since the caller can leave before this runs.
  const requested = requestedChannelId
    ? snapshots.find((s) => s.channelId === requestedChannelId)
    : undefined;
  if (requested && requested.humans > 0 && joinable(requested)) return requested.channelId;

  const eligible = snapshots.filter((s) => joinable(s) && s.humans >= Math.max(1, minMembers));
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
 * The channels kicks keep the bot out of, dropping any record whose call has
 * ended (the channel emptied, or is gone) first.
 * @param guildId - Discord guild (server) ID.
 * @param snapshots - The guild's voice channels as they stand now.
 * @returns The channels to leave out of the choice.
 */
function kickedChannels(guildId: string, snapshots: ChannelSnapshot[]): Set<string> {
  const kicked = kickedFrom.get(guildId);
  if (!kicked) return new Set<string>();
  for (const channelId of [...kicked]) {
    const still = snapshots.find((s) => s.channelId === channelId);
    if (!still || still.humans === 0) {
      kicked.delete(channelId);
      log.debug("kick lifted, call ended", { guildId, channelId });
    }
  }
  if (kicked.size === 0) kickedFrom.delete(guildId);
  return kicked;
}

/**
 * Re-evaluates where the bot should be in one guild, and moves it if needed.
 * @param guild - The guild to evaluate.
 * @param request - The /join behind this run, which autojoin being off does
 * not refuse, or null for the bot's own re-evaluation.
 */
async function reconcile(guild: Guild, request: JoinRequest | null = null): Promise<void> {
  const guildId = guild.id;
  const current = sessionChannelId(guildId);

  // With autojoin off the bot only enters a call on request, but once in one
  // it is kept there like any other: it leaves when the channel empties and
  // does not follow people to the next.
  const mayJoin = isAutojoin(guildId) || request !== null;
  if (!mayJoin && !current) return;

  const compiled = loadSounds(guildId);
  if (!hasSomethingToPlay(compiled)) {
    if (current) closeSession(guildId, "nothing configured to play");
    return;
  }

  const channels = [...guild.channels.cache.values()].filter(
    (channel): channel is VoiceBasedChannel =>
      channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice,
  );
  const snapshots = channels.map(snapshot).filter((s): s is ChannelSnapshot => s !== null);
  // Whoever kicked the bot is still in that call, so it is not a candidate
  // even when it is the busiest channel.
  const kicked = kickedChannels(guildId, snapshots);
  const candidates = kicked.size ? snapshots.filter((s) => !kicked.has(s.channelId)) : snapshots;
  const target = pickChannel(
    candidates,
    compiled.config.minMembers ?? 1,
    current,
    request?.channelId ?? null,
  );

  if (target === current) return;

  if (current) {
    closeSession(guildId, target && mayJoin ? "moving channel" : "channel empty");
    leftAt.set(guildId, Date.now());
  }
  if (!target || !mayJoin) return;

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
 * Runs {@link reconcile} for a guild after any run already in flight for it.
 * Callers get their own run's outcome; the queue only tracks that it settled.
 * @param guild - The guild to evaluate.
 * @param request - Passed through to {@link reconcile}.
 * @returns Resolves when this run has finished.
 */
function queueReconcile(guild: Guild, request: JoinRequest | null = null): Promise<void> {
  const previous = reconciling.get(guild.id) ?? Promise.resolve();
  const run = previous.then(() => reconcile(guild, request));
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  reconciling.set(guild.id, settled);
  void settled.then(() => {
    if (reconciling.get(guild.id) === settled) reconciling.delete(guild.id);
  });
  return run;
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
    void queueReconcile(guild).catch((err: unknown) => {
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

  // Arriving somewhere, rather than leaving: an entrance is owed either to the
  // channel the bot is already in, or to the one this join is about to bring it
  // to. The reconcile below is what does the bringing.
  const userId = newState.member?.id;
  if (newState.channelId && userId && !newState.member?.user.bot) {
    const here = sessionChannelId(guild.id) === newState.channelId;
    void noteJoin(guild, userId, newState.channelId, here ? sessionConnection(guild.id) : null);
  }
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
    await queueReconcile(guild).catch((err: unknown) => {
      log.warn("startup voice sweep failed", {
        guildId: guild.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

/**
 * Re-evaluates one guild now, for a change the gateway cannot announce.
 * @param guild - The guild to re-evaluate.
 * @param request - The /join behind this refresh, or null for a settings
 * change the gateway cannot announce.
 */
export async function refreshGuild(
  guild: Guild,
  request: JoinRequest | null = null,
): Promise<void> {
  await queueReconcile(guild, request).catch((err: unknown) => {
    log.warn("voice refresh failed", {
      guildId: guild.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Where the bot is in a guild, counting a call it is still connecting to: a
 * kick aimed at that one has to land as well, rather than reading as "not in a
 * voice channel" for the second or two the connection takes.
 * @param guildId - Discord guild (server) ID.
 * @returns The channel ID, or null when it is neither in a call nor joining one.
 */
export function botChannelId(guildId: string): string | null {
  return sessionChannelId(guildId) ?? joiningChannelId(guildId);
}

/**
 * What a /kick or /join came to. `"allowed"` is the ordinary case, where the
 * command simply does as it is told. The rest only happen once a server is
 * using the pair to tug the bot about.
 */
export type ContestVerdict = "allowed" | "cooldown" | "won" | "lost";

/**
 * Decides whether a /kick or /join does as it is told, and once a server is
 * past {@link CONTEST_THRESHOLD}, tosses for it instead.
 *
 * Randomising a contested call is what takes the point out of a tug of war:
 * neither side can have the bot on demand, so there is nothing to win by
 * asking again. Pure, so the threshold, the window and the odds are testable
 * without a gateway.
 * @param recent - When /kick and /join last ran here, newest last.
 * @param now - Current time, epoch ms.
 * @param roll - A number in [0, 1), as from `Math.random()`.
 * @returns What the command should do.
 */
export function contestVerdict(recent: number[], now: number, roll: number): ContestVerdict {
  const inWindow = recent.filter((t) => now - t < CONTEST_WINDOW_MS);
  if (inWindow.length < CONTEST_THRESHOLD) return "allowed";
  const last = inWindow[inWindow.length - 1] ?? 0;
  if (now - last < CONTEST_COOLDOWN_MS) return "cooldown";
  return roll < COIN_ODDS ? "won" : "lost";
}

/**
 * The guild's /kick and /join runs still inside the window.
 * @param guildId - Discord guild (server) ID.
 * @param now - Current time, epoch ms.
 * @returns The timestamps, oldest first.
 */
function recentFor(guildId: string, now: number): number[] {
  return (recentCommands.get(guildId) ?? []).filter((t) => now - t < CONTEST_WINDOW_MS);
}

/**
 * Records a /kick or /join against the guild's contest count, dropping runs
 * that have aged out. A refused attempt is not recorded: the wait would never
 * end if being turned away counted as asking.
 * @param guildId - Discord guild (server) ID.
 * @param now - Current time, epoch ms.
 */
function noteCommand(guildId: string, now: number): void {
  recentCommands.set(guildId, [...recentFor(guildId, now), now]);
}

/** What a /kick did, and what to tell the caller. */
export interface KickOutcome {
  /** Which way it went. */
  verdict: ContestVerdict;
  /** The channel the bot is in, or was removed from. */
  channelId: string;
  /** Wait before the next attempt, on `"cooldown"`. */
  remainingMs: number;
}

/**
 * Removes the bot from the guild's current channel, or cancels the join in
 * flight. Closing the session alone is not a kick: the next sweep would put
 * the bot straight back with the people who asked it to go, so the channel is
 * held against it until {@link rejoinGuild} or the call ending lifts it.
 *
 * Ordinarily this just works. Only a server already tugging the bot back and
 * forth gets a toss instead - see {@link contestVerdict}.
 * @param guildId - Discord guild (server) ID.
 * @param roll - The toss, defaulting to a fresh one; injectable for tests.
 * @returns What happened, or null when the bot was not in or joining a channel.
 */
export function kickFromChannel(guildId: string, roll: number = Math.random()): KickOutcome | null {
  const channelId = botChannelId(guildId);
  if (!channelId) return null;

  const now = Date.now();
  const recent = recentFor(guildId, now);
  const verdict = contestVerdict(recent, now, roll);
  if (verdict === "cooldown") {
    const last = recent[recent.length - 1] ?? now;
    return { verdict, channelId, remainingMs: CONTEST_COOLDOWN_MS - (now - last) };
  }

  noteCommand(guildId, now);
  if (verdict === "lost") {
    log.info("kick lost the toss", { guildId, channelId });
    return { verdict, channelId, remainingMs: 0 };
  }

  const kicked = kickedFrom.get(guildId) ?? new Set<string>();
  kickedFrom.set(guildId, kicked);
  kicked.add(channelId);
  closeSession(guildId, "kicked by command");
  return { verdict, channelId, remainingMs: 0 };
}

/**
 * Drops a guild's kicks and its contest count, so nothing is held against the
 * bot and the commands answer plainly again. /autojoin off calls this.
 * @param guildId - Discord guild (server) ID.
 */
export function forgetKicks(guildId: string): void {
  kickedFrom.delete(guildId);
  recentCommands.delete(guildId);
}

/** What a /join did, and what to tell the caller. */
export interface JoinOutcome {
  /** Which way it went. */
  verdict: ContestVerdict;
  /** Wait before the next attempt, on `"cooldown"`. */
  remainingMs: number;
}

/**
 * Lifts every kick and re-evaluates the guild now.
 *
 * Ordinarily this just works. Only a server already tugging the bot back and
 * forth gets a toss instead - see {@link contestVerdict}. The rejoin cooldown
 * is a different thing, there to stop the bot flapping on its own, and someone
 * asking for it is not flapping, so that one is cleared.
 * @param guild - The guild to rejoin.
 * @param requestedChannelId - The channel the caller was sitting in, preferred
 * over the busiest one, or null when they were not in a call.
 * @param roll - The toss, defaulting to a fresh one; injectable for tests.
 * @returns What happened; on `"allowed"` or `"won"` the caller reads where the
 * bot landed from the session.
 */
export async function rejoinGuild(
  guild: Guild,
  requestedChannelId: string | null = null,
  roll: number = Math.random(),
): Promise<JoinOutcome> {
  const now = Date.now();
  const recent = recentFor(guild.id, now);
  const verdict = contestVerdict(recent, now, roll);
  if (verdict === "cooldown") {
    const last = recent[recent.length - 1] ?? now;
    return { verdict, remainingMs: CONTEST_COOLDOWN_MS - (now - last) };
  }

  noteCommand(guild.id, now);
  if (verdict === "lost") {
    log.info("join lost the toss", { guildId: guild.id });
    return { verdict, remainingMs: 0 };
  }

  kickedFrom.delete(guild.id);
  leftAt.delete(guild.id);
  await refreshGuild(guild, { channelId: requestedChannelId });
  return { verdict, remainingMs: 0 };
}

/**
 * Starts the periodic re-sweep, replacing one already running.
 *
 * Whether a channel is worth joining depends on sounds.json as much as on who
 * is in it, and a config edit emits no gateway event. Without this the bot
 * only reconsiders at startup or when someone moves between channels, so
 * adding the first trigger to a live bot appears to do nothing until it is
 * restarted. The sweep is a few stat calls per guild, so it can afford to run
 * on the minute.
 * @param client - The logged-in client.
 * @param inScope - Guild filter, so a dev instance stays in its own server.
 */
export function startVoiceSweep(client: Client, inScope: (guildId: string) => boolean): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = setInterval(() => {
    void sweepGuilds(client, inScope);
  }, VOICE_SWEEP_INTERVAL_MS);
  // Unref'd so a sweep pending on an otherwise idle bot never holds the
  // process open on its own.
  sweepTimer.unref();
}

/**
 * Leaves every channel and stops the transcriber.
 */
export function shutdownVoice(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  for (const timer of debounces.values()) clearTimeout(timer);
  debounces.clear();
  closeAllSessions("shutting down");
  stopStt();
}
