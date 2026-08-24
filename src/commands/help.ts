// src/commands/help.ts

import { ADMIN_COMMANDS, ADMIN_SUBCOMMANDS, isAdmin } from "@/utils/permissions";
import { SlashCommandBuilder } from "@discordjs/builders";
import {
  APIEmbedField,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  InteractionContextType,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from "discord.js";

/** Marks a line that needs admin, for commands Discord cannot filter. */
const ADMIN_MARK = "🔒";

/** Slash command definition for `/help`. */
export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show all commands and what they do")
  .setContexts(InteractionContextType.Guild);

/**
 * Builds the embed fields listing commands. Discord filters nothing out of a
 * member's picker any more, so this is the only place an admin-only command or
 * subcommand gets hidden - otherwise `/help` advertises what will only refuse.
 * A member sees neither an {@link ADMIN_COMMANDS} entry nor an
 * {@link ADMIN_SUBCOMMANDS} line; an admin sees both, marked.
 * @param commands - The loaded commands, as Discord registered them.
 * @param admin - Whether the invoker may run admin commands.
 * @returns One field per command the invoker can see.
 */
export function buildHelpFields(
  commands: RESTPostAPIApplicationCommandsJSONBody[],
  admin: boolean,
): APIEmbedField[] {
  const fields: APIEmbedField[] = [];
  for (const json of commands) {
    const adminOnly = ADMIN_COMMANDS.includes(json.name);
    if (adminOnly && !admin) continue;

    // Right-click entries carry no description - Discord rejects one - and an
    // empty field value would be rejected too, so they get a fixed line saying
    // how to reach them instead.
    if (json.type === ApplicationCommandType.Message) {
      fields.push({
        name: json.name,
        value: `Right-click a moved post or its pointer > Apps > \`${json.name}\``,
        inline: false,
      });
      continue;
    }

    const adminSubs = ADMIN_SUBCOMMANDS[json.name] ?? [];
    const allSubs = ("options" in json ? (json.options ?? []) : []).filter(
      (o) => o.type === ApplicationCommandOptionType.Subcommand,
    );
    const subs = admin ? allSubs : allSubs.filter((s) => !adminSubs.includes(s.name));
    // Nothing left once the admin lines go: drop the command rather than fall
    // through to the description, which would advertise it with no way in.
    if (allSubs.length && !subs.length) continue;

    const value = subs.length
      ? subs
          .map((s) => {
            const mark = adminSubs.includes(s.name) ? ` ${ADMIN_MARK}` : "";
            return `\`/${json.name} ${s.name}\`${mark} - ${s.description}`;
          })
          .join("\n")
      : ("description" in json ? json.description : "") || "-";
    // Only an admin ever sees this, and the mark tells them which of the
    // commands listed a member would be refused on.
    const name = adminOnly ? `/${json.name} ${ADMIN_MARK}` : `/${json.name}`;
    fields.push({ name, value, inline: false });
  }
  return fields;
}

/**
 * Executes `/help`: an embed listing every command the invoker can actually
 * run, built from the live command collection.
 * @param interaction - The command interaction context.
 * @returns A promise that resolves when the reply is sent.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const commands = [...interaction.client.commands.values()]
    .map((cmd) => cmd.data.toJSON())
    .sort((a, b) => a.name.localeCompare(b.name));
  const fields = buildHelpFields(commands, isAdmin(interaction));

  const embed = new EmbedBuilder().setTitle("Commands").setColor(0x5865f2).addFields(fields);
  if (fields.some((f) => f.name.includes(ADMIN_MARK) || f.value.includes(ADMIN_MARK))) {
    embed.setFooter({ text: `${ADMIN_MARK} admin only - a member can't run this` });
  }
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
