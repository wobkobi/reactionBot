import discord

from function.file import load_data, save_data
from dotenv import load_dotenv
import os


load_dotenv()

YOUR_ID = int(os.getenv("YOUR_ID"))
async def handle_disallow(ctx, user: discord.Member):
    guild_id = ctx.guild.id

    allowed = load_data(guild_id, "allowed.json")

    if not ctx.user.server_permissions.administrator or ctx.user.id not in [ctx.guild.owner_id, YOUR_ID, ]:
        await ctx.response.send_message("You do not have permission to use this command!")
        return

    if str(user.id) not in allowed:
        await ctx.response.send_message(f"<@{user.id}> is not on allowed list.", ephemeral=True)
        return

    del allowed[str(user.id)]
    save_data(guild_id, "allowed.json", allowed)
    await ctx.response.send_message(f"<@{user.id}> has been removed from the special privileges list.")
