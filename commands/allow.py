import discord

from function.file import load_data, save_data
from dotenv import load_dotenv
import os


load_dotenv()

YOUR_ID = int(os.getenv("YOUR_ID"))


async def handle_allow(ctx, user: discord.Member):
    guild_id = ctx.guild.id

    allowed = load_data(guild_id, "allowed.json")

    if ctx.user.id not in [ctx.guild.owner_id, YOUR_ID] and ctx.user.id not in allowed:
        await ctx.response.send_message(
            "You do not have permission to run this command!", ephemeral=True
        )
        return

    if str(user.id) in allowed:
        await ctx.response.send_message(
            f"<@{user.id}> is already allowed.", ephemeral=True
        )
        return

    allowed[str(user.id)] = True
    save_data(guild_id, "allowed.json", allowed)
    await ctx.response.send_message(f"<@{user.id}> has been given special privileges.")
