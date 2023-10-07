import json
import os


def load_data(guild_id, filename):
    directory = f"data/{guild_id}"
    if not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)

    path = os.path.join(directory, filename)
    try:
        with open(path, "r") as file:
            data = json.load(file)
        return data
    except FileNotFoundError:
        return {}


def save_data(guild_id, filename, data):
    directory = f"data/{guild_id}"
    if not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)
        print(f"Created directory: {directory}")  # Debug print

    path = os.path.join(directory, filename)
    with open(path, "w") as file:
        json.dump(data, file)
