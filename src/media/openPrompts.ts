// src/media/openPrompts.ts

// Every button prompt still waiting on an answer, held two ways. In memory, so
// shutdown can close each one and wait for it to tidy itself away; on disk, so
// a prompt stranded by a crash, where no shutdown code ran, is taken down at
// the next start instead of sitting in the channel with buttons that only say
// "This interaction failed".

import { loadData, saveData } from "@/utils/file";
import { createLogger } from "@/utils/log";
import type { Client } from "discord.js";

const log = createLogger("media/openPrompts");

/** Per-guild file naming the prompts posted and not yet closed. */
export const OPEN_PROMPTS_FILE = "open_prompts.json";

/**
 * Longest shutdown waits for open prompts to finish tidying away. Each is one
 * delete or edit call, so this only runs out when Discord is not answering.
 */
export const PROMPT_CLOSE_TIMEOUT_MS = 3_000;

/** The reason a prompt's collector is stopped with at shutdown. */
export const PROMPT_SHUTDOWN_REASON = "shutdown";

/** Where a prompt was posted, and how it leaves once it closes. */
export interface PromptRef {
  channelId: string;
  /** Delete the prompt when it closes, rather than strip its buttons. */
  autoDelete: boolean;
}

/** A live prompt: a way to close it, and a promise its cleanup settles. */
export interface LivePrompt {
  stop: () => void;
  closed: Promise<void>;
}

type PromptMap = Record<string, PromptRef>;

/** Live prompts by message ID. */
const live = new Map<string, LivePrompt>();

/**
 * Reads a guild's recorded prompts.
 * @param guildId - Discord guild ID.
 * @returns The prompts by message ID, empty when none are recorded.
 */
function load(guildId: string): PromptMap {
  return loadData<PromptMap>(guildId, OPEN_PROMPTS_FILE, { soft: true, defaultValue: {} });
}

/**
 * Records a prompt as open until {@link untrackPrompt} is called for it.
 * @param guildId - Discord guild ID.
 * @param messageId - The prompt message.
 * @param ref - Where it is and how it should leave.
 * @param handle - How to close it, or null for a record with nothing live
 * behind it.
 */
export function trackPrompt(
  guildId: string,
  messageId: string,
  ref: PromptRef,
  handle: LivePrompt | null,
): void {
  if (handle) live.set(messageId, handle);
  const map = load(guildId);
  map[messageId] = ref;
  saveData(guildId, OPEN_PROMPTS_FILE, map);
}

/**
 * Forgets a prompt once it has closed and tidied itself away.
 * @param guildId - Discord guild ID.
 * @param messageId - The prompt message.
 */
export function untrackPrompt(guildId: string, messageId: string): void {
  live.delete(messageId);
  const map = load(guildId);
  if (!(messageId in map)) return;
  delete map[messageId];
  saveData(guildId, OPEN_PROMPTS_FILE, map);
}

/**
 * Closes every live prompt and waits for each to tidy itself away, used on
 * shutdown. The process exiting would otherwise leave each one in the channel
 * with dead buttons, and a countdown would never move or be taken down.
 * @param timeoutMs - How long to wait before giving up on the rest.
 * @returns How many were still open when it gave up, 0 when all closed.
 */
export async function closeOpenPrompts(timeoutMs: number): Promise<number> {
  if (live.size === 0) return 0;
  const handles = [...live.values()];
  for (const handle of handles) handle.stop();
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.all(handles.map((handle) => handle.closed)),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return live.size;
}

/**
 * Takes down prompts a previous run left open, which only happens when it
 * died without shutting down. Each record is dropped once handled, including
 * when its message has since gone, so a prompt is never swept twice.
 * @param client - The logged-in client.
 * @param guildIds - Guilds to sweep.
 * @returns How many prompts were found and taken down.
 */
export async function sweepStalePrompts(
  client: Client,
  guildIds: Iterable<string>,
): Promise<number> {
  let swept = 0;
  for (const guildId of guildIds) {
    for (const [messageId, ref] of Object.entries(load(guildId))) {
      if (live.has(messageId)) continue;
      const channel = await client.channels.fetch(ref.channelId).catch(() => null);
      const message = channel?.isTextBased()
        ? await channel.messages.fetch(messageId).catch(() => null)
        : null;
      if (message) {
        await (ref.autoDelete ? message.delete() : message.edit({ components: [] })).catch(
          (err: unknown) => {
            log.warn("could not take down stale prompt", {
              guildId,
              messageId,
              error: err instanceof Error ? err.message : String(err),
            });
          },
        );
        swept += 1;
      }
      untrackPrompt(guildId, messageId);
    }
  }
  return swept;
}
