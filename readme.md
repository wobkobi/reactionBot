# README.md for Discord Bot

This README provides a basic overview and guide on how to use the Discord bot. The bot contains a number of commands that allow administrators and privileged users to perform actions such as adding, removing, allowing, or disallowing users, as well as adding reactions to messages.

## Table of Contents

- [Features](#features)
- [Setup](#setup)
- [Commands](#commands)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Automated Reactions**: Adds random reactions to messages.
- **User Management**: Allows you to add or remove users from a list, and react to their messages with custom emojis.
- **Privilege Management**: Allows or disallows users to use certain commands.
- **Custom Commands**: Includes commands for clearing all reactions and displaying all bot commands.

## Setup

1. Ensure you have Python and the necessary libraries installed.
2. Set up your bot on the [Discord Developer Portal](https://discord.com/developers/applications) and note down your token.
3. Create a `.env` file in the same directory as your bot file and add your bot token and user ID like so:

```plaintext
DISCORD_TOKEN=<Your Bot Token>
YOUR_ID=<Your User ID>
```

4. Run your bot by executing the Python file.

## Commands

1. **add**
   - **Usage**: `add <user> <emoji>`
   - **Description**: Adds a user to the list and assigns them a specific emoji. Only the server owner or users with special privileges can use this command.
   - **Example**: `add @user 😃`
   
2. **remove**
   - **Usage**: `remove <user>`
   - **Description**: Removes a user from the list. Only the server owner or users with special privileges can use this command.
   - **Example**: `remove @user`
   
3. **clear**
   - **Usage**: `clear`
   - **Description**: Removes all reactions from all messages. Only the server owner or users with special privileges can use this command.

4. **allow**
   - **Usage**: `allow <user>`
   - **Description**: Grants a user special privileges. Only the server owner can use this command.
   - **Example**: `allow @user`
   
5. **disallow**
   - **Usage**: `disallow <user>`
   - **Description**: Removes special privileges from a user. Only the server owner can use this command.
   - **Example**: `disallow @user`
   
6. **help**
   - **Usage**: `help`
   - **Description**: Displays all bot commands and their descriptions.

## Troubleshooting

If you encounter any issues or have questions, please check the [Issues](https://github.com/wobkobi/reactionBot/issues) tab on the GitHub repository, or create a new issue if your problem is not listed.

## Contributing

Contributions are welcome! Please read the [Contributing Guidelines](CONTRIBUTING.md) for information on how to contribute.

## License

This project is open source and available under the [MIT License](LICENSE.md).

---