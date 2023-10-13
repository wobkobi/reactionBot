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

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
YOUR_ID = int(os.getenv("YOUR_ID"))

bot = commands.Bot(command_prefix="{}", intents=discord.Intents.all(), reconnect=True)


@bot.event
async def on_ready():
    await bot.change_presence(status=discord.Status.online, activity=discord.Activity(type=discord.ActivityType.playing, name="", ), )
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


@bot.tree.command(name="clear", description="Remove all reactions from all people on my list")
async def clear(ctx):
    await handle_clear(bot, ctx)


@bot.tree.command(name="allow", description="these people have a special privilege")
async def allow(ctx, user: discord.Member):
    await handle_allow(ctx, user)


@bot.tree.command(name="disallow", description="Remove special privileges from these people")
async def disallow(ctx, user: discord.Member):
    await handle_disallow(ctx, user)


@bot.tree.command(name="help", description="Displays bot commands and descriptions")
async def _help(ctx):
    await handle_help(bot, ctx)


bot.run(TOKEN)
