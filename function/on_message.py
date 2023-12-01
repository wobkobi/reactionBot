import random
import re

import discord

from function.file import load_data, save_data
from regex import DRAMA_LLAMA, GIRLS, BRITISH, REGEX_NWORD_HARDR, REGEX_NWORD, NWORD, TWITTER_DOMAIN_REGEX


async def handle_on_message(bot, message):
    if message.author == bot.user:
        return
    guild_id = message.guild.id
    stinky = load_data(guild_id, "stinky.json")
    reacted_messages = load_data(guild_id, "reacted_messages.json")
    count = load_data(guild_id, "count.json")
    if not count or not isinstance(count, dict):
        count = {
            "count_since_last_poo": 0,
            "count_since_last_clown": 0,
            "last_message_with_poo": None,
            "last_message_with_clown": None,
            "total_poo": 0,
            "total_clown": 0,
        }
        save_data(guild_id, "count.json", count)
    else:
        count["count_since_last_poo"] += 1
        count["count_since_last_clown"] += 1

    if random.random() < 0.001:
        await message.add_reaction("💩")
        count["total_poo"] += 1
        if count["last_message_with_poo"]:
            last_reacted_link = f"https://discord.com/channels/{message.guild.id}/{message.channel.id}/{count['last_message_with_poo']}"
            await message.reply(
                f"Reacted with 💩 after **{count['count_since_last_poo']}** messages! Total reactions: **{count['total_poo']}**. Last 💩 reaction: {last_reacted_link}",
                mention_author=False)

        count["count_since_last_poo"] = 0
        count["last_message_with_poo"] = message.id

    if random.random() < 0.00004:
        emoji = discord.utils.get(message.guild.emojis, name="clown")
        if emoji:
            await message.add_reaction(emoji)
        else:
            await message.add_reaction("🤡")
        count["total_clown"] += 1
        if count["last_message_with_clown"]:
            last_reacted_link = f"https://discord.com/channels/{message.guild.id}/{message.channel.id}/{count['last_message_with_clown']}"
            await message.channel.send(
                f"Reacted with 🤡 after **{count['count_since_last_clown']}** messages! Total 🤡 reactions: **{count['total_clown']}**. Last 🤡 reaction: {last_reacted_link}")
        count["count_since_last_clown"] = 0
        count["last_message_with_clown"] = message.id

    twitter_links = re.findall(TWITTER_DOMAIN_REGEX, message.content)
    if twitter_links:
        for domain, path in twitter_links:
            new_link = f'https://vxtwitter.com/{path}'
            await message.reply(f"{new_link}", mention_author=False)

    if re.search(DRAMA_LLAMA, message.content) or "🦙" in message.content:
        await message.add_reaction("🦙")

    girls_match = any(re.search(pattern, message.content) for pattern in GIRLS)
    british_match = any(re.search(pattern, message.content)
                        for pattern in BRITISH)

    if girls_match and british_match:
        reaction = random.choice(["💅", "🇬🇧"])
        await message.add_reaction(reaction)
    elif girls_match:
        await message.add_reaction("💅")
    elif british_match:
        await message.add_reaction("🇬🇧")

    if re.search(REGEX_NWORD_HARDR, message.content) or re.search(
            REGEX_NWORD, message.content
    ):
        for emoji_char in NWORD.split(" "):
            await message.add_reaction(emoji_char)

    user_id = str(message.author.id)
    if user_id in stinky:

        if random.randint(1, 10) != 1:
            save_data(guild_id, "count.json", count)
            return

        stinky_data = stinky[user_id]

        emoji_name = stinky_data.get("value", None)
        if not emoji_name:
            save_data(guild_id, "count.json", count)
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

        reacted_messages[message.id] = True
        save_data(guild_id, "reacted_messages.json", reacted_messages)
    save_data(guild_id, "count.json", count)
