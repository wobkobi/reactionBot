# reactionBot

A Discord bot for a group chat that has opinions. It moves social media links to a dedicated channel
rewritten so they actually embed, keeps per-server counters for swears and slurs, reacts to phrases,
and answers people who ping it. It can also sit in a voice channel and play a sound bite when it
hears a word.

## Features

- **Media links** - TikTok, Twitter/X, Instagram, Reddit, Bluesky, Threads and Tumblr links get a
  Yes/Copy/No prompt, then move to the media channel rewritten to an embed-friendly frontend, with a
  pointer left behind. Authors can edit or delete a moved post by right-clicking it.
- **Tracking junk** - `?utm_...` and `fbclid` tails are stripped on the way through. Functional
  parameters are left alone.
- **Trackers** - per-server counters for swears and slurs, with leaderboards and a targeted-group
  breakdown.
- **Reactions and replies** - phrase reactions, spell-out reactions in letter emojis, and GIF or
  text replies to slurs.
- **Mention comebacks** - ping the bot, get a playground insult back.
- **"Define your terms"** - words with an innocent second meaning earn a button prompt asking which
  was meant, and the bot posts that definition.
- **Voice sound bites** - the bot listens in voice channels, transcribes locally with Whisper, and
  plays a clip when it hears a trigger word.
- **Entrances** - a configured member gets a clip played as they join voice, and a video or message
  posted in a text channel the first time the bot hears them speak. Once a day each.

Replies are rate-limited per person and go quiet during calm mode. Reactions and counting carry on
regardless.

## Setup

Needs Node.js 24 and a Discord application with a bot token, the `bot` and `applications.commands`
scopes, and the message content intent enabled.

```sh
git clone https://github.com/wobkobi/reactionBot.git
cd reactionBot
cp .env.example .env   # BOT_TOKEN and CLIENT_ID
npm ci
npm start              # or: npm run dev
```

Configuration and per-server data live in `data/`, as JSON, relative to the working directory. Word
lists, replies, voice triggers and entrances are all hand-edited files, picked up without a restart.
See [data/readme.md](data/readme.md) for every file and its format.

`data/global/words.json` is gitignored because it contains the slur list, so bring your own on a
fresh deploy.

### Docker

```sh
cp .env.example .env
mkdir -p data/sounds
chown -R 1000:1000 ./data
docker compose up -d --build
```

Logs go to `docker compose logs -f`, timestamped, with warnings and errors on stderr so they can be
read on their own. Everything is logged, per-utterance voice decisions included, so a log of a run
where something misbehaved already says why; there is no level to have had turned on first.
`LOG_FORMAT=json` switches to one JSON object per line for a collector.

The image sets `ONNXRUNTIME_NODE_INSTALL=skip`. Without it, the speech recognition package downloads
a CUDA execution provider on linux/x64 that nothing here uses, since transcription runs on the CPU.

`data/` must be a volume: it holds the configuration, the counters, the sound clips and the Whisper
model cache. The image is Debian-based because the speech recognition library ships no musl build,
so voice silently fails to load on Alpine.

On **TrueNAS SCALE 24.10+**, paste [deploy/truenas.yaml](deploy/truenas.yaml) into Apps > Discover
Apps > Install via YAML. Its header comment has the dataset setup, which matters: create the dataset
with a POSIX ACL, or the bot cannot write its own config.

**Updating.** Merging to `main` builds and pushes `ghcr.io/wobkobi/reactionbot`, tagged `latest`,
the version, and the commit. Nothing pulls it on its own - a tag is not a subscription - so the
deploy updates when the container is restarted, which re-pulls because `pull_policy: always` is set.
Pin the version tag instead of `latest` if you would rather choose when that happens, and to have
something to roll back to.

Config is not code: `words.json`, `sounds.json` and the clips are read from the volume and picked up
without a restart, and the Whisper model cache survives an update rather than downloading again.

Voice wants roughly 4 GB and 4 cores. The default model is `whisper-tiny.en`, chosen for how quickly
a clip arrives after the word; set `VOICE_MODEL=Xenova/whisper-base.en` to mishear less at about
400ms more delay. Without voice the bot is happy in a few hundred MB.

## Commands

Admin commands need the bot owner (`YOUR_ID`), the server owner, or Manage Server. They are visible
to everyone in the slash-command picker and refuse anyone else; `/help` lists only what you can
actually run, marking admin entries 🔒.

### Media

| Command                                                | What it does                                           |
| ------------------------------------------------------ | ------------------------------------------------------ |
| `/setmediachannel`                                     | Where media links get reposted (admin)                 |
| `/setdelay instant\|seconds\|disabled`                 | How long the author gets to answer the prompt (admin)  |
| `/setdelay personal`                                   | What members may set for themselves (admin)            |
| `/mydelay instant\|countdown\|ask\|never\|show\|clear` | Your own links only                                    |
| `/calmdown start\|stop\|auto`                          | Pause replies; reactions and counting continue (admin) |
| `/help`                                                | List the commands you can run                          |

Right-click a moved post or its pointer, then **Apps > Edit post** or **Delete post**. Author only.

### Trackers and replies

| Command                                  | What it does                                           |
| ---------------------------------------- | ------------------------------------------------------ |
| `/swears count\|top\|words\|nuke`        | Swear counters (`nuke` is admin)                       |
| `/slurs count\|top\|words\|groups\|nuke` | Slur counters and group breakdown (`nuke` is admin)    |
| `/gif add\|list\|remove`                 | Manage the GIFs the bot replies with; open to everyone |

`/gif` entries are shared across every server and are live from the next message.

### Voice

| Command             | What it does                                                           |
| ------------------- | ---------------------------------------------------------------------- |
| `/autojoin on\|off` | Whether the bot joins calls on its own (admin)                         |
| `/voice status`     | Autojoin state, channel, model, decoder and trigger count (admin)      |
| `/voice check`      | Report any sound config that does not resolve (admin)                  |
| `/kick`             | Throw the bot out of your call; a tug of war gets settled by coin toss |
| `/join`             | Bring the bot into your own call, autojoin or not                      |

With autojoin on it joins any channel with people in it and leaves when they go. Speech is
transcribed in short chunks as it arrives, so a word inside a long sentence fires about a second
after it is said rather than after the sentence ends. Several trigger words can share one clip pool,
and mishearings are handled automatically, so there is no list of variants to maintain.

## Development

```sh
npm run dev        # watch mode
npm run lint       # ESLint, type-aware, autofix
npm run format     # Prettier
npm run smoke      # offline test suite, no token needed
npm run typecheck
```

Set `DEV_GUILD_ID` in `.env` to confine a dev instance to one server. Only honoured under
`npm run dev`. Pre-commit runs lint-staged and typecheck; pre-push runs lint, build and the smoke
test.

## License

MIT
