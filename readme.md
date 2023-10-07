---

# StinkyBot Discord Bot

StinkyBot is a fun and interactive Discord bot that reacts to certain user messages with emojis. The bot uses specific patterns to determine which reaction emoji should be used. It also provides command functionalities for administrators to manage user-specific reactions.

## Features

- Randomly reacts to messages with "💩", "🤡", or "🦙".
- Responds to specific phrases and patterns with appropriate emojis.
- Administrator controls for managing user-specific reactions.
- `add`, `remove`, `clear`, `allow`, `disallow`, and `help` command functionalities.

## Setup & Installation

### Requirements:

- Python 3.8 or newer.
- The `discord.py` library.
- A `.env` file with your bot token and your user ID.

### Installation:

1. Clone this repository.
   ```
   git clone https://github.com/wobkobi/reactionBot.git
   ```

2. Navigate to the repository.
   ```
   cd StinkyBot
   ```

3. Install the required packages.
   ```
   pip install discord.py python-dotenv
   ```

4. Create a `.env` file with the following content:
   ```
   DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN
   YOUR_ID=YOUR_DISCORD_USER_ID
   ```

5. Run the bot.
   ```
   python stinkybot.py
   ```

## Commands

- `add`: Adds or updates the emoji for a specific user.
- `remove`: Removes a user from the bot's reaction list.
- `clear`: Removes all reactions from all users in the bot's list.
- `allow`: Gives special privileges to a specific user.
- `disallow`: Removes special privileges from a specific user.
- `help`: Displays all commands and their descriptions.

## Contribution

Feel free to fork this repository, make changes, and submit pull requests. Feedback and contributions are always welcome!

## License

MIT License

---
