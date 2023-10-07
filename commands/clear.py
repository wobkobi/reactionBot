import discord

from function.file import load_data, save_data
from dotenv import load_dotenv
import os


load_dotenv()

YOUR_ID = int(os.getenv("YOUR_ID"))

async def handle_clear(bot, ctx):
    guild_id = ctx.guild.id
    allowed = load_data(guild_id, "allowed.json")
    reacted_messages = load_data(guild_id, "reacted_messages.json")

    if not ctx.user.guild_permissions.administrator and ctx.user.id not in [ctx.guild.owner_id, YOUR_ID, ] or allowed:
        await ctx.response.send_message("You do not have permission to run this command!", ephemeral=True)
        return

    await ctx.response.send_message("Processing request...")

    for message_id in reacted_messages.keys():
        try:
            msg = await ctx.channel.fetch_message(int(message_id))
            for reaction in msg.reactions:
                if reaction.me:
                    try:
                        await msg.remove_reaction(reaction.emoji, bot.user)
                    except discord.Forbidden:
                        print(
                            f"Rate limited or insufficient permissions to remove {reaction.emoji} from message {message_id}.")
                    except discord.HTTPException:
                        print(f"Failed to remove {reaction.emoji} from message {message_id}.")
        except discord.NotFound:
            print(f"Message {message_id} not found.")
            continue

    reacted_messages.clear()
    save_data(guild_id, "reacted_messages.json", reacted_messages)

    await ctx.followup.send("All reactions from people on the list have been removed.")
