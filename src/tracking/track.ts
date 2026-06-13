// src/tracking/track.ts

/**
 * @file Per-message tracking: records swears and slurs against the author,
 * publicly shames slurs, and records called-names against the targeted member.
 */

import { countMatches, loadList } from "@/tracking/detect.js";
import { respondToSlur } from "@/tracking/slurResponse.js";
import { getUserTotal, incrementCounts } from "@/tracking/store.js";
import { CALLED, SLURS, SWEARS } from "@/tracking/trackers.js";
import { createLogger } from "@/utils/log.js";
import { Message } from "discord.js";

const log = createLogger("tracking/track");

/**
 * Resolves the members a message is aimed at: everyone mentioned plus the
 * author of the message being replied to. Bots and the author themselves are
 * excluded.
 * @param message - The guild message to inspect.
 * @returns A set of target user IDs.
 */
async function resolveTargets(message: Message<true>): Promise<Set<string>> {
  const authorId = message.author.id;
  const targets = new Set<string>();

  for (const u of message.mentions.users.values()) {
    if (!u.bot && u.id !== authorId) targets.add(u.id);
  }

  if (message.reference?.messageId) {
    const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (ref && !ref.author.bot && ref.author.id !== authorId) targets.add(ref.author.id);
  }

  return targets;
}

/**
 * Scans a guild message for swears, slurs and called-names and records each.
 * Swears and slurs are attributed to the author (slurs also trigger a
 * rate-limited GIF reply); called-names are attributed to the resolved targets.
 * @param message - The message to scan. DMs and bot authors are ignored.
 * @returns A promise that resolves once tracking is complete or skipped.
 */
export async function trackMessage(message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot) return;
  if (!message.channel.isTextBased()) return;

  const guildId = message.guildId;
  const authorId = message.author.id;
  const content = message.content;
  if (!content) return;

  // Author-attributed: swears.
  const swearCounts = countMatches(content, loadList(guildId, SWEARS.listFile));
  if (swearCounts.size > 0) incrementCounts(guildId, SWEARS.storeFile, authorId, swearCounts);

  // Author-attributed: slurs (fuzzy-matched), plus a rate-limited reply.
  const slurList = loadList(guildId, SLURS.listFile, true);
  const slurCounts = countMatches(content, slurList);
  if (slurCounts.size > 0) {
    incrementCounts(guildId, SLURS.storeFile, authorId, slurCounts);
    const total = getUserTotal(guildId, SLURS.storeFile, authorId);
    const categories = [
      ...new Set(
        [...slurCounts.keys()]
          .map((w) => slurList.category.get(w))
          .filter((c): c is string => Boolean(c)),
      ),
    ];
    log.info("slur detected", { guildId, authorId, total, categories });
    await respondToSlur(message, total, categories);
  }

  // Target-attributed: called-names.
  const insultCounts = countMatches(content, loadList(guildId, CALLED.listFile));
  if (insultCounts.size > 0) {
    const targets = await resolveTargets(message);
    for (const targetId of targets) {
      incrementCounts(guildId, CALLED.storeFile, targetId, insultCounts);
    }
    if (targets.size > 0) {
      log.info("called-names recorded", {
        guildId,
        targets: [...targets],
        words: [...insultCounts.keys()],
      });
    }
  }
}
