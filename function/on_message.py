import random
import re
import discord
import datetime
from function.file import load_data, save_data
from regex import DRAMA_LLAMA, GIRLS, BRITISH, REGEX_NWORD_HARDR, REGEX_NWORD, NWORD, TWITTER_DOMAIN_REGEX, SLAY


async def handle_on_message(bot, message):
    if message.author == bot.user:
        return
    guild_id = message.guild.id
    user_id = str(message.author.id)

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

    slay_data = load_data(guild_id, "slay.json")
    if not slay_data or not isinstance(slay_data, dict):
        slay_data = {
            "last_mention": None,
            "mention_interval": None
        }

    if re.search(SLAY, message.content):
        now = datetime.datetime.utcnow()

        # Update the collective 'slay' count for the server
        slay_data.setdefault("total_count", 0)
        slay_data["total_count"] += 1

        # Update the 'slay' count for the individual user
        slay_data.setdefault("user_counts", {})
        slay_data["user_counts"].setdefault(user_id, 0)
        slay_data["user_counts"][user_id] += 1

        # Process the last mention and duration
        last_mention = slay_data.get("last_mention")
        duration_message = "LESS THAN A MINUTE"  # default message
        if last_mention:
            last_mention_date = datetime.datetime.fromisoformat(last_mention)
            time_delta = now - last_mention_date
            
            if time_delta.days >= 7:
                # Send congratulatory message and turn off the tracker
                await message.channel.send(
                    "Congratulations everyone! We've gone 7 days without saying slay!")
                # Reset the slay data
                slay_data = {
                    "last_mention": None,
                    "mention_interval": None,
                    "total_count": 0,
                    "user_counts": {}
                }
                save_data(guild_id, "slay.json", slay_data)
                return  # Exit the function early
        
            days = time_delta.days
            hours, remainder = divmod(time_delta.seconds, 3600)
            minutes, seconds = divmod(remainder, 60)

            time_parts = []
            if days > 0:
                time_parts.append(f"{days} DAY{'S' if days > 1 else ''}")
            if hours > 0:
                time_parts.append(f"{hours} HOUR{'S' if hours > 1 else ''}")
            if minutes > 0:
                time_parts.append(
                    f"{minutes} MINUTE{'S' if minutes > 1 else ''}")

            if time_parts:
                duration_message = ", ".join(time_parts)

        # Reset the timer
        slay_data["last_mention"] = now.isoformat()

        # Construct and send the response message
        user_mention_count = slay_data["user_counts"][user_id]
        total_mentions = slay_data["total_count"]
        await message.reply(
            f"OH MY FUCKING GOD YOU JUST SAID SLAY FOR THE **{ordinal(user_mention_count)}** TIME {message.author.mention}! "
            f"THIS IS THE **{ordinal(total_mentions)}** TIME TOTAL FOR YOU GUYS. YOU COULD ONLY LAST **{duration_message}** THIS TIME! WOW. **DO BETTER!**"
        )

        save_data(guild_id, "slay.json", slay_data)

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


def ordinal(n):
    """Return the ordinal number of a count"""
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"
