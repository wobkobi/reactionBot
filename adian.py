import interactions
from interactions import (
    slash_command,
    Client,
    Intents,
    listen,
    OptionType,
    Emoji,
    MessageCreate,
)
import json


TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = int(os.getenv("GUILD_ID"))
YOUR_ID = int(os.getenv("YOUR_ID"))
STINKY_PEOPLE = "stinky.json"
REACTED_MESSAGES_FILE = "reacted_messages.json"


def load_data(filename):
    try:
        with open(filename, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_data(filename, data):
    with open(filename, "w") as f:
        json.dump(data, f)


stinky_people = load_data(STINKY_PEOPLE)
reacted_messages = load_data(REACTED_MESSAGES_FILE)

bot = Client(token=TOKEN, default_scope=GUILD_ID, intents=Intents.DEFAULT)


@bot.event()
async def on_ready():
    print(f"We have logged in as {bot.user}")
    print(f"Connected to {len(bot.guilds)} guilds")


@bot.listen("MessageCreate")
async def on_message_create(event: MessageCreate):
    message = event.message
    if (
        message.guild
        and message.guild.id == GUILD_ID
        and str(message.author.id) in stinky_people
    ):
        emoji_name = stinky_people[str(message.author.id)]

        # Get all emojis of the guild using the provided method
        all_guild_emojis = await Emoji.get_all_of_guild(
            guild_id=message.guild.id, client=bot._http
        )

        # Find the emoji in the list of guild emojis by its name
        emoji = next((e for e in all_guild_emojis if e.name == emoji_name), None)

        if emoji:
            # Use the `format` property of the Emoji model to get a send-able form of the emoji
            sendable_emoji = emoji.format
            await message.add_reaction(sendable_emoji)

            reacted_messages.setdefault(str(message.author.id), []).append(message.id)
            save_data(REACTED_MESSAGES_FILE, reacted_messages)


@slash_command(
    name="set_emoji",
    description="Set an emoji for a specific person",
)
async def set_emoji(
    ctx: interactions.SlashCommandChoice, user: interactions.Member, emoji_name: str
):
    if ctx.user.id == YOUR_ID:
        stinky_people[str(user.id)] = emoji_name
        save_data(STINKY_PEOPLE, stinky_people)
        await ctx.send(f"Emoji for <@{user.id}> has been set to {emoji_name}")
    else:
        await ctx.send(
            "You do not have permission to run this command!", ephemeral=True
        )


@slash_command(
    name="add",
    description="Adds a user to something.",
    options=[
        {
            "name": "user",
            "description": "User to add",
            "type": OptionType.USER,
            "required": True,
        },
        {
            "name": "emoji",
            "description": "Emoji to associate with the user",
            "type": OptionType.STRING,
            "required": False,
        },
    ],
)
async def add(
    ctx: interactions.SlashCommandChoice,
    user: interactions.Member,
    emoji: str = ":mad:",
):
    if ctx.user.id == YOUR_ID:
        stinky_people[str(user.id)] = emoji
        save_data(STINKY_PEOPLE, stinky_people)
        await ctx.send(f"<@{user.id}> is on my list with the emoji {emoji}")
    else:
        await ctx.send(
            "You do not have permission to run this command!", ephemeral=True
        )


@slash_command(
    name="remove",
    description="remove people from my list",
)
async def remove(ctx: interactions.SlashCommandChoice, user: interactions.Member):
    if ctx.user.id == YOUR_ID:
        if str(user.id) in stinky_people:
            stinky_people.pop(str(user.id), None)
            save_data(STINKY_PEOPLE, stinky_people)

            message_ids = reacted_messages.get(str(user.id), [])
            for message_id in message_ids:
                try:
                    msg = await ctx.channel.fetch_message(message_id)
                    for reaction in msg.reactions:
                        if reaction.me:
                            await msg.remove_reaction(reaction.emoji, bot.user)
                except interactions.NotFound:
                    continue

            reacted_messages.pop(str(user.id), None)
            save_data(REACTED_MESSAGES_FILE, reacted_messages)

            await ctx.send(f"<@{user.id}> has been removed from my list")
        else:
            await ctx.send(f"{user.name} is not on the list!", ephemeral=True)
    else:
        await ctx.send(
            "You do not have permission to run this command!", ephemeral=True
        )


@slash_command(name="help", description="Displays all the bot's commands.")
async def _help(ctx: interactions.Member):
    # Creating an embed
    embed = interactions.Embed(
        title="Help Command", color=0xFFFFFF
    )  # Using a hexadecimal value for blue

    # Iterating through the bot's commands
    for command in bot.application_commands:
        # Convert the command name to string directly
        command_name = str(command.name)

        # Check if the command has a description attribute
        command_description = getattr(
            command, "description", "No description available"
        )

        # Add command to the embed
        embed.add_field(name=command_name, value=command_description, inline=False)

    # Send the embed
    await ctx.send(embed=embed)


bot.start()
