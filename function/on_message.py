from discord import ui, ButtonStyle
import random
import re
import discord
import datetime
from function.file import load_data, save_data
from regex import (
    DRAMA_LLAMA,
    GIRLS,
    BRITISH,
    REGEX_NWORD_HARDR,
    REGEX_NWORD,
    NWORD,
    TWITTER_DOMAIN_REGEX,
    SLAY,
    INSTAGRAM_DOMAIN_REGEX,
    TIKTOK_DOMAIN_REGEX,
)


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
        slay_data = {"last_mention": None, "mention_interval": None}

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
                    "Congratulations everyone! We've gone 7 days without saying slay!"
                )
                # Reset the slay data
                slay_data = {
                    "last_mention": None,
                    "mention_interval": None,
                    "total_count": 0,
                    "user_counts": {},
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
                time_parts.append(f"{minutes} MINUTE{'S' if minutes > 1 else ''}")

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
                mention_author=False,
            )

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
                f"Reacted with 🤡 after **{count['count_since_last_clown']}** messages! Total 🤡 reactions: **{count['total_clown']}**. Last 🤡 reaction: {last_reacted_link}"
            )
        count["count_since_last_clown"] = 0
        count["last_message_with_clown"] = message.id

    await transform_and_reply_links(
        bot, message, TWITTER_DOMAIN_REGEX, "https://vxtwitter.com/{}"
    )

    await transform_and_reply_links(
        bot, message, TIKTOK_DOMAIN_REGEX, "https://tiktxk.com/{}"
    )

    await transform_and_reply_links(
        bot, message, INSTAGRAM_DOMAIN_REGEX, "https://ddinstagram.com/{}"
    )

    if re.search(DRAMA_LLAMA, message.content) or "🦙" in message.content:
        await message.add_reaction("🦙")

    girls_match = any(re.search(pattern, message.content) for pattern in GIRLS)
    british_match = any(re.search(pattern, message.content) for pattern in BRITISH)

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
        try:
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
        except discord.errors.NotFound:
            pass
        except discord.HTTPException as e:
            print(e)
            return
    save_data(guild_id, "count.json", count)


def ordinal(n):
    """Return the ordinal number of a count"""
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


class ConfirmationView(discord.ui.View):
    def __init__(self, user, *, timeout=30):
        super().__init__(timeout=timeout)
        self.user = user
        self.value = None  # This will be True to proceed, False to cancel, and None for no response
        self.message = None

    async def on_timeout(self):
        self.value = True  # Assume consent on timeout
        for item in self.children:
            item.disabled = True
        # Update the message to show the buttons as disabled
        await self.message.edit(view=self)
        self.stop()

    @discord.ui.button(label="Yes", style=discord.ButtonStyle.success)
    async def confirm_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        if interaction.user != self.user:
            await interaction.response.send_message(
                "You're not allowed to interact with this button.", ephemeral=True
            )
            return

        self.value = True
        await interaction.response.defer()
        for item in self.children:
            item.disabled = True
        await self.message.edit(view=self)
        self.stop()

    @discord.ui.button(label="No", style=discord.ButtonStyle.danger)
    async def cancel_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        if interaction.user != self.user:
            await interaction.response.send_message(
                "You're not allowed to interact with this button.", ephemeral=True
            )
            return

        self.value = False
        await interaction.response.defer()
        for item in self.children:
            item.disabled = True
        await self.message.edit(view=self)
        self.stop()
        try:
            await self.message.delete()
        except discord.NotFound:
            pass  # The message was already deleted or not found.


TRANSFORMED_BASE_URLS = [
    "https://vxtwitter.com/",
    "https://tiktxk.com/",
    "https://ddinstagram.com/",
]


async def transform_and_reply_links(bot, message, regex, template_url):
    matches = re.findall(regex, message.content)
    if not matches:
        return

    view = ConfirmationView(user=message.author)
    confirmation_message = await message.channel.send(
        f"{message.author.mention}, do you want to replace the original link with a new one?",
        view=view,
    )
    view.message = confirmation_message
    await view.wait()

    if view.value in [True, None]:
        try:
            await message.delete()
        except (discord.NotFound, discord.Forbidden):
            await confirmation_message.delete()
            return

        # Prepare text for new message by removing user mentions
        non_mention_content = re.sub(r"<@!?[0-9]+>", "", message.content).strip()

        transformed_message_content = non_mention_content
        for match in matches:
            path = match if isinstance(match, str) else "".join(match)
            new_link = template_url.format(path)
            transformed_message_content = re.sub(
                regex, new_link, transformed_message_content, 1
            )

        guild_id = str(message.guild.id) if message.guild else "DMChannel"
        target_channel_id = message.channel.id
        if message.guild and message.guild.id == 1113266261619642398:
            target_channel_id = 1208544659643699200

        target_channel = bot.get_channel(target_channel_id)
        # Send the transformed message without pinging the mentioned users
        new_message = await target_channel.send(
            transformed_message_content, allowed_mentions=discord.AllowedMentions.none()
        )
        await new_message.add_reaction("🗑️")

        if target_channel_id != message.channel.id:
            mentions = [user.mention for user in message.mentions]
            mention_text = ", ".join(mentions)
            if mentions:
                reference_message_text = f"{mention_text}, {message.author.mention} sent slop for you to see. [Click here]({new_message.jump_url})"
            else:
                reference_message_text = f"{message.author.mention} sent slop for you to see. [Click here]({new_message.jump_url})"

            reference_message = await message.channel.send(
                reference_message_text, allowed_mentions=discord.AllowedMentions.none()
            )
            message_id_map = load_data(guild_id, "message_id_map.json")
            message_id_map[str(reference_message.id)] = {
                "new_message_id": str(new_message.id),
                "reference_channel_id": str(reference_message.channel.id),
            }
            save_data(guild_id, "message_id_map.json", message_id_map)

        await confirmation_message.delete()

    elif view.value is False:
        await confirmation_message.delete()
