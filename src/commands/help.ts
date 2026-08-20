// src/commands/help.ts

import { ADMIN_SUBCOMMANDS, isAdmin } from "@/utils/permissions";
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
 * Builds the embed fields listing commands. Commands carrying default
 * permissions are the ones Discord keeps out of a member's picker, so they are
 * left out here too for anyone who cannot run them - otherwise `/help`
 * advertises commands that are not there to be found. Commands that mix open
 * and admin subcommands stay listed, with the admin ones marked.
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
    if (json.default_member_permissions && !admin) continue;

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
    const subs = ("options" in json ? (json.options ?? []) : []).filter(
      (o) => o.type === ApplicationCommandOptionType.Subcommand,
    );
    const value = subs.length
      ? subs
          .map((s) => {
            const mark = adminSubs.includes(s.name) ? ` ${ADMIN_MARK}` : "";
            return `\`/${json.name} ${s.name}\`${mark} - ${s.description}`;
          })
          .join("\n")
      : ("description" in json ? json.description : "") || "-";
    fields.push({ name: `/${json.name}`, value, inline: false });
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
  if (fields.some((f) => f.value.includes(ADMIN_MARK))) {
    embed.setFooter({ text: `${ADMIN_MARK} needs Manage Server` });
  }
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
