import discord

from function.file import load_data, save_data
from dotenv import load_dotenv
import os


load_dotenv()

YOUR_ID = int(os.getenv("YOUR_ID"))


def is_valid_emoji(emoji_str):
    return emoji_str.encode("unicode-escape").startswith(b"\\U")


async def handle_add_command(bot, ctx, user: discord.Member, emoji: str):
    guild_id = ctx.guild.id

    allowed = load_data(guild_id, "allowed.json")
    stinky = load_data(guild_id, "stinky.json")

    if not ctx.user.guild_permissions.administrator and ctx.user.id not in [ctx.guild.owner_id, YOUR_ID, ] or allowed:
        await ctx.response.send_message("You do not have permission to run this command!", ephemeral=True)
        return

    if user.id == bot.user.id:
        await ctx.response.send_message("I can't add myself!", ephemeral=True)
        return

    def word_to_emoji(word):
        base_emoji_code = ord("🇦")
        emoji_string = ""
        seen = set()

        for char in word:
            if char in seen:
                return None
            seen.add(char)

            if "a" <= char <= "z":
                emoji_string += chr(base_emoji_code +
                                    ord(char) - ord("a")) + " "
            elif "A" <= char <= "Z":
                emoji_string += chr(base_emoji_code +
                                    ord(char) - ord("A")) + " "
            else:
                return None

        return emoji_string.strip()

    if emoji.startswith("<:") or emoji.startswith("<a:") and emoji.endswith(">"):
        emoji_name = emoji.split(":")[1]
        stinky[str(user.id)] = {"type": "custom_emoji", "value": emoji_name}

    elif is_valid_emoji(emoji):
        stinky[str(user.id)] = {"type": "emoji", "value": emoji}
        emoji_name = emoji
    else:
        emoji_name = word_to_emoji(emoji)
        if emoji_name:
            stinky[str(user.id)] = {"type": "word", "value": emoji_name}
        else:
            if len(emoji) != len(set(emoji)):
                await ctx.response.send_message(
                    "There can't be any duplicate letters!", ephemeral=True
                )
                return
            else:
                await ctx.response.send_message(
                    f"Failed to interpret {emoji} as an emoji!", ephemeral=True
                )
                return

    save_data(ctx.guild.id, "stinky.json", stinky)

    emoji_obj = discord.utils.get(ctx.guild.emojis, name=emoji_name)

    if emoji_obj:
        await ctx.response.send_message(
            f"<@{user.id}> has been set to the emoji {emoji_obj}"
        )
    else:
        await ctx.response.send_message(
            f"<@{user.id}> has been set to the emoji {emoji_name}"
        )
