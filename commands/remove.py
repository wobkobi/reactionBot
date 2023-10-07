import discord

from function.file import load_data, save_data
from dotenv import load_dotenv
import os


load_dotenv()

async def handle_remove_command(bot, ctx, user: discord.Member):
    guild_id = ctx.guild_id
    allowed = load_data(guild_id, "allowed.json")
    stinky = load_data(guild_id, "stinky.json")
    reacted_messages = load_data(guild_id, "reacted_messages.json")

    if ctx.user.id not in [ctx.guild.owner_id, YOUR_ID] and ctx.user.id not in allowed:
        await ctx.response.send_message("You do not have permission to run this command!", ephemeral=True)
        return

    if user.id == bot.user.id:
        await ctx.response.send_message("I can't remove myself!", ephemeral=True)
        return

    if str(user.id) not in stinky:
        await ctx.response.send_message(
            f"{user.name} is not on the list!", ephemeral=True
        )
        return

    for message_id in reacted_messages.pop(str(user.id), []):
        try:
            msg = await ctx.channel.fetch_message(message_id)
            if stinky[str(user.id)]["type"] == "word":
                for emoji_char in stinky[str(user.id)]["value"].split(" "):
                    try:
                        await msg.remove_reaction(emoji_char, bot.user)
                    except discord.HTTPException:
                        continue
            else:
                emoji_value = stinky[str(user.id)]["value"]
                try:
                    await msg.remove_reaction(emoji_value, bot.user)
                except discord.HTTPException:
                    continue
        except discord.NotFound:
            continue

    del stinky[str(user.id)]
    save_data(guild_id, "stinky.json", stinky)
    save_data(guild_id, "reacted_messages.json", reacted_messages)
    await ctx.response.send_message(f"<@{user.id}> has been removed from my list")
