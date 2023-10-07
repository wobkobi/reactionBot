import discord


async def handle_help(bot, ctx):
    embed = discord.Embed(title="Help Command", color=discord.Color.blue())

    for command in bot.tree.get_commands():
        embed.add_field(name=command.name, value=command.description, inline=False)

    await ctx.response.send_message(embed=embed, ephemeral=True)
