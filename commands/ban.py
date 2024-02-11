import discord

from function.file import load_data, save_data
from dotenv import load_dotenv
import os

load_dotenv()

YOUR_ID = int(os.getenv("YOUR_ID"))


async def handle_ban(ctx, word: str, timeframe: int):
    guild_id = ctx.guild.id

    if timeframe <= 0:
        await ctx.send("Timeframe must be a positive number of days.")
        return
    regex_pattern = re.compile(r"(?<!:)\b\w*" + "+?".join(word) + r"+\w*\b(?!:)", re.IGNORECASE)
    word_data = {
            "regex": regex_pattern.pattern,
            "last_mention": None,
            "total_count": 0,
            "user_counts": {},
            "timeframe": timeframe  # in days
        }
   save_data(guild_id, f"blocked/{word}_blocked.py", word_data)
    await ctx.send(f"Tracking for the word '{word}' has been added for {timeframe} days.")

   