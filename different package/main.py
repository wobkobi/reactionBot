import discord
from discord import app_commands
from discord.ext import commands
import json
import random
import re
import os
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
YOUR_ID = int(os.getenv("YOUR_ID"))  # User ID

REGEX_NWORD_HARDR = re.compile(r"\b(n*[1i!l]+[g9]{2,}[3e]+[r5]+s*)", re.IGNORECASE)
REGEX_NWORD = re.compile(r"\b(n*[1i!l]+[g9]{2,}[a4]+s*)", re.IGNORECASE)
DRAMA_LLAMA = re.compile(r"(?:l+|d+r+)a+m+a", re.IGNORECASE)
NWORD = "🇳 🇼 🇴 🇷 🇩"
GIRLS = re.compile(r"t+h+e+ +g+i+r+l+s+ +a+r+e+", re.IGNORECASE)


# Load data for a specific server
def load_data(guild_id, filename):
    path = f"data/{guild_id}/{filename}"
    try:
        with open(path, "r") as file:
            data = json.load(file)  # use json.load to load the json data from the file
        return data
    except FileNotFoundError:
        return {}


# Save data for a specific server
def save_data(guild_id, filename, data):
    directory = f"data/{guild_id}"
    # Ensure the directory exists
    if not os.path.exists(directory):
        os.makedirs(directory)

    path = os.path.join(directory, filename)
    with open(path, "w") as file:
        json.dump(data, file)


bot = commands.Bot(command_prefix="{}", intents=discord.Intents.all())


@bot.event
async def on_ready():
    await bot.change_presence(
        status=discord.Status.online,  # You can change this to idle, dnd, etc.
        activity=discord.Activity(
            type=discord.ActivityType.playing,  # You can change this to other types
            name="",  # Unicode representation of the nerd emoji
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
    if message.author == bot.user:
        return

    guild_id = message.guild.id
    stinky = load_data(guild_id, "stinky.json")
    reacted_messages = load_data(guild_id, "reacted_messages.json")

    if random.random() < 0.001:
        await message.add_reaction("💩")

    # 0.004%
    if random.random() < 0.00004:
        emoji = discord.utils.get(message.guild.emojis, name="clown")
        if emoji:
            await message.add_reaction(emoji)
        else:
            await message.add_reaction("🤡")

    if re.search(DRAMA_LLAMA, message.content) or "🦙" in message.content:
        await message.add_reaction("🦙")

    if re.search(GIRLS, message.content):
        await message.add_reaction("💅")

    if re.search(REGEX_NWORD_HARDR, message.content) or re.search(
        REGEX_NWORD, message.content
    ):
        for emoji_char in NWORD.split(" "):
            await message.add_reaction(emoji_char)

    # Implement a 10% chance for reacting.
    if random.randint(1, 10) != 1:
        return

    user_id = str(message.author.id)
    if user_id in stinky:
        stinky_data = stinky[user_id]

        emoji_name = stinky_data.get("value", None)
        if not emoji_name:
            return

        if stinky_data["type"] == "emoji":
            await message.add_reaction(emoji_name)
        elif stinky_data["type"] == "custom_emoji":
            emoji = discord.utils.get(message.guild.emojis, name=emoji_name)
            if emoji:
                await message.add_reaction(emoji)
        elif stinky_data["type"] == "word":
            for emoji_char in stinky_data["value"].split(" "):
                await message.add_reaction(emoji_char)

        # Save the message ID after reacting.
        reacted_messages[message.id] = True
        save_data(guild_id, "reacted_messages.json", reacted_messages)


def is_valid_emoji(emoji_str):
    # Simple check to determine if the string might be a Unicode emoji.
    return emoji_str.encode("unicode-escape").startswith(b"\\U")


@bot.tree.command(name="add", description="Add a person or update their emoji")
async def add(ctx, user: discord.Member, emoji: str):
    guild_id = ctx.guild.id
    # if ctx.user.id is not in allowed.json
    allowed = load_data(guild_id, "allowed.json")
    stinky = load_data(guild_id, "stinky.json")

    if ctx.user.id not in [ctx.guild.owner_id, YOUR_ID]:
        await ctx.response.send_message(
            "You do not have permission to use this command!", ephemeral=True
        )
        return
    # if user id is the bot
    if user.id == bot.user.id:
        await ctx.response.send_message("I can't add myself!", ephemeral=True)
        return

    # Function to convert a word into its emoji counterpart
    def word_to_emoji(word):
        base_emoji_code = ord("🇦")
        emoji_string = ""
        seen = set()  # To keep track of letters we've seen

        for char in word:
            if char in seen:
                return None  # Return None if we see a duplicate letter
            seen.add(char)

            # Ensure character is an alphabet and append the corresponding emoji
            if "a" <= char <= "z":
                emoji_string += chr(base_emoji_code + ord(char) - ord("a")) + " "
            elif "A" <= char <= "Z":
                emoji_string += chr(base_emoji_code + ord(char) - ord("A")) + " "
            else:
                return (
                    None  # Return None if the word contains non-alphabetical characters
                )

        return emoji_string.strip()  # Remove trailing space

    if emoji.startswith("<:") or emoji.startswith("<a:") and emoji.endswith(">"):
        emoji_name = emoji.split(":")[1]
        stinky[str(user.id)] = {"type": "custom_emoji", "value": emoji_name}
    # elif emoji.startswith(":") and emoji.endswith(":"):
    #     emoji_name = emoji.strip(":")
    #     stinky[str(user.id)] = {"type": "emoji", "value": emoji_name}
    elif is_valid_emoji(emoji):  # Check if it's a Unicode emoji.
        stinky[str(user.id)] = {"type": "emoji", "value": emoji}
        emoji_name = emoji  # Ensure emoji_name is set for further processing
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


@bot.tree.command(name="remove", description="remove people from my list")
async def remove(ctx, user: discord.Member):
    guild_id = ctx.guild_id
    allowed = load_data(guild_id, "allowed.json")
    stinky = load_data(guild_id, "stinky.json")
    
    if str(ctx.user.id) not in allowed:
        await ctx.response.send_message(
            "You do not have permission to run this command!", ephemeral=True
        )
        return
    # if user id is the bot
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
                        continue  # Skip if the bot hasn't reacted with this emoji
            else:
                emoji_value = stinky[str(user.id)]["value"]
                try:
                    await msg.remove_reaction(emoji_value, bot.user)
                except discord.HTTPException:
                    continue  # Skip if the bot hasn't reacted with this emoji
        except discord.NotFound:
            continue

    del stinky[str(user.id)]
    save_data(guild_id, "stinky.json", stinky)
    save_data(guild_id, "reacted_messages.json", reacted_messages)
    await ctx.response.send_message(f"<@{user.id}> has been removed from my list")


@bot.tree.command(
    name="clear", description="Remove all reactions from all people on my list"
)
async def clear(ctx):
    guild_id = ctx.guild.id  # Don't forget to get the guild ID
    allowed = load_data(guild_id, "allowed.json")
    reacted_messages = load_data(guild_id, "reacted_messages.json")

    # Check if the user has administrator permissions or is the owner
    if not ctx.user.guild_permissions.administrator and ctx.user.id not in [
        ctx.guild.owner_id,
        YOUR_ID,
    ]:
        await ctx.response.send_message(
            "You do not have permission to run this command!", ephemeral=True
        )
        return

    # Send an immediate response
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
                            f"Rate limited or insufficient permissions to remove {reaction.emoji} from message {message_id}."
                        )
                    except discord.HTTPException:
                        print(
                            f"Failed to remove {reaction.emoji} from message {message_id}."
                        )
        except discord.NotFound:
            print(f"Message {message_id} not found.")
            continue

    reacted_messages.clear()
    save_data(guild_id, "reacted_messages.json", reacted_messages)

    # Send the completion message as a follow-up
    await ctx.followup.send("All reactions from people on the list have been removed.")


@bot.tree.command(name="allow", description="these people have a special privilege")
async def allow(ctx, user: discord.Member):
    guild_id = ctx.guild.id  # Server's unique ID

    # Load server-specific allowed data
    allowed = load_data(guild_id, "allowed.json")

    # Only allow server owner (or YOUR_ID) to add people to the allowed list
    if not ctx.user.server_permissions.administrator or ctx.user.id not in [
        ctx.guild.owner_id,
        YOUR_ID,
    ]:
        await ctx.response.send_message(
            "You do not have permission to use this command!"
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


@bot.tree.command(
    name="disallow", description="Remove special privileges from these people"
)
async def disallow(ctx, user: discord.Member):
    guild_id = ctx.guild.id  # Server's unique ID

    # Load server-specific allowed data
    allowed = load_data(guild_id, "allowed.json")

    # Only allow server owner (or YOUR_ID) to remove people from the allowed list
    if not ctx.user.server_permissions.administrator or ctx.user.id not in [
        ctx.guild.owner_id,
        YOUR_ID,
    ]:
        await ctx.response.send_message(
            "You do not have permission to use this command!"
        )
        return

    if str(user.id) not in allowed:
        await ctx.response.send_message(
            f"<@{user.id}> is not on allowed list.", ephemeral=True
        )
        return

    del allowed[str(user.id)]
    save_data(guild_id, "allowed.json", allowed)
    await ctx.response.send_message(
        f"<@{user.id}> has been removed from the special privileges list."
    )


@bot.tree.command(name="help", description="Displays bot commands and descriptions")
async def _help(ctx):
    embed = discord.Embed(title="Help Command", color=discord.Color.blue())

    for command in bot.tree.get_commands():
        embed.add_field(name=command.name, value=command.description, inline=False)

    await ctx.response.send_message(embed=embed, ephemeral=True)


bot.run(TOKEN)


bot.run(TOKEN)
