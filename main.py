import os
import discord
from discord.ext import commands
from dotenv import load_dotenv
import os

from commands.add import handle_add_command
from commands.allow import handle_allow
from commands.clear import handle_clear
from commands.disallow import handle_disallow
from commands.help import handle_help
from commands.remove import handle_remove_command
from function.on_message import handle_on_message
from function.file import load_data, save_data

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
YOUR_ID = int(os.getenv("YOUR_ID"))

bot = commands.Bot(command_prefix="{}", intents=discord.Intents.all(), reconnect=True)


@bot.event
async def on_ready():
    await bot.change_presence(
        status=discord.Status.online,
        activity=discord.Activity(
            type=discord.ActivityType.playing,
            name="",
        ),
    )
    print(f"We have logged in as {bot.user}")
    try:
        synced = await bot.tree.sync()
        print(f"Synced {len(synced)} command(s)")
    except Exception as e:
        print(f"Failed to sync commands: {e}")


@bot.event
async def on_message(message):
    await handle_on_message(bot, message)


@bot.tree.command(name="add", description="Add a person or update their emoji")
async def add(ctx, user: discord.Member, emoji: str):
    await handle_add_command(bot, ctx, user, emoji)


@bot.tree.command(name="remove", description="remove people from my list")
async def remove(ctx, user: discord.Member):
    await handle_remove_command(bot, ctx, user)


@bot.tree.command(
    name="clear", description="Remove all reactions from all people on my list"
)
async def clear(ctx):
    await handle_clear(bot, ctx)


@bot.tree.command(name="allow", description="these people have a special privilege")
async def allow(ctx, user: discord.Member):
    await handle_allow(ctx, user)


@bot.tree.command(
    name="disallow", description="Remove special privileges from these people"
)
async def disallow(ctx, user: discord.Member):
    await handle_disallow(ctx, user)


# @bot.tree.command(name="ban", description="Track usage of a specific word")
# async def ban(ctx, word: str, timeframe: int):
#     await handle_ban(bot, ctx, word, timeframe)


@bot.tree.command(name="help", description="Displays bot commands and descriptions")
async def _help(ctx):
    await handle_help(bot, ctx)


@bot.event
async def on_reaction_add(reaction, user):
    if user.bot or reaction.message.author != bot.user or str(reaction.emoji) != "🗑️":
        return

    guild_id = str(reaction.message.guild.id) if reaction.message.guild else "DMChannel"
    message_id_map = load_data(guild_id, "message_id_map.json")

    # Adjusted understanding: the "new message" is the one with the reaction added
    if guild_id == "1113266261619642398":
        for ref_message_id, data in message_id_map.items():
            if data.get("new_message_id") == str(reaction.message.id):
                original_channel_id = data.get("reference_channel_id")
                try:
                    if original_channel_id:
                        original_channel = bot.get_channel(int(original_channel_id))
                        # Attempt to delete the original message pointed by the reference message
                        ref_message = await original_channel.fetch_message(
                            int(ref_message_id)
                        )
                        await ref_message.delete()
                        print(
                            f"Deleted reference message in channel {original_channel_id}."
                        )

                    # Now delete the "new message" where the reaction was added
                    await reaction.message.delete()
                    print(f"Deleted new message with reaction: {reaction.message.id}.")

                    # Cleanup after deletion
                    del message_id_map[ref_message_id]
                    save_data(guild_id, "message_id_map.json", message_id_map)
                except discord.NotFound:
                    print("One of the messages already deleted or not found.")
                except discord.Forbidden:
                    print("Lack of permissions to delete messages.")
                break  # Exit the loop after handling the found message
        else:
            # This else clause belongs to the for loop, executed only if the loop completes normally (no break)
            print(
                f"No original message found for the reacted message ID {reaction.message.id} in the map."
            )
    else:
        # General behavior for other guilds: just delete the reacted message
        try:
            await reaction.message.delete()
            print(f"Deleted message {reaction.message.id} in non-specific guild.")
        except discord.Forbidden:
            print("Lack of permissions to delete messages.")
        except discord.NotFound:
            pass  # Message already deleted


bot.run(TOKEN)
