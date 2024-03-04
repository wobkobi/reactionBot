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
    # Ignore reactions from bots, non-bot messages, or other emojis
    if user.bot or reaction.message.author != bot.user or str(reaction.emoji) != "🗑️":
        return

    # Define the guild and specific channel IDs
    guild_id = str(reaction.message.guild.id) if reaction.message.guild else "DMChannel"
    specified_channel_id = (
        "1208544659643699200"  # The channel ID where special handling is required
    )
    message_id_map = load_data(guild_id, "message_id_map.json")

    # Attempt to find a corresponding pointer message for the reacted message
    pointer_message_info = None
    for pointer_msg_id, details in message_id_map.items():
        if "new_message_id" in details and details["new_message_id"] == str(
            reaction.message.id
        ):
            pointer_message_info = details
            break

    if pointer_message_info:
        # Delete the pointer message if its info was found in the map
        try:
            pointer_channel_id = pointer_message_info["reference_channel_id"]
            pointer_channel = bot.get_channel(int(pointer_channel_id))
            pointer_message = await pointer_channel.fetch_message(int(pointer_msg_id))
            await pointer_message.delete()
            print(
                f"Deleted pointer message ID: {pointer_msg_id} in channel ID: {pointer_channel_id}."
            )
        except discord.NotFound:
            print(f"Pointer message ID: {pointer_msg_id} already deleted or not found.")
        except discord.Forbidden:
            print("Lack of permissions to delete the pointer message.")
        except Exception as e:
            print(f"An error occurred while deleting the pointer message: {e}")

    # Proceed to delete the reacted message regardless of whether it's a "new message" or not
    try:
        await reaction.message.delete()
        print(f"Deleted reacted message ID: {reaction.message.id}.")
    except discord.NotFound:
        print(
            f"Reacted message ID: {reaction.message.id} already deleted or not found."
        )
    except discord.Forbidden:
        print("Lack of permissions to delete the reacted message.")
    except Exception as e:
        print(f"An error occurred while deleting the reacted message: {e}")

    # Cleanup the map if a pointer message was successfully identified and processed
    if pointer_message_info:
        del message_id_map[pointer_msg_id]
        save_data(guild_id, "message_id_map.json", message_id_map)


bot.run(TOKEN)
