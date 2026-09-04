# reactionBot

Discord bot that keeps social media links out of the main chat. When someone posts a TikTok,
Twitter/X, Instagram, Reddit, Bluesky, Threads or Tumblr link, the bot offers to move it to a
dedicated media channel, rewritten to an embed-friendly frontend (fixupx, toinstagram, etc.), and
leaves a small pointer in the original channel so the conversation can still find it. It also keeps
per-server counters for swears, slurs, and name-calling.

## Features

- **Media link relocation**: detect link > Yes/Copy/No prompt for the author (configurable grace,
  including instant auto-move, and per-member overrides via `/mydelay`) > delete the original >
  repost the rewritten link in the media channel > leave a pointer "tail" in the source channel.
  **Copy** is the quiet way out: the author gets the embeddable link privately and their message is
  left exactly where it is. The full message text and any attachments are carried over, and anyone
  the message tagged is named on the tail too ("SENT SLOP TO ...") - mentions render without
  pinging. The author can change a moved post by right-clicking it - or its tail - and picking
  **Apps > Edit post** (a popup pre-filled with the text) or **Apps > Delete post** (removes the
  post and its tail together). Records are persisted, so both keep working after bot restarts. Links
  edited into an existing message are caught too.
- **Embed-friendly rewrites**: URLs are swapped to frontends that actually embed in Discord (see
  `FRONTENDS` in [src/media/transform.ts](src/media/transform.ts)).
- **Pre-fixed links move too**: links already on a fixer frontend (fxtwitter, cunnyx, ddinstagram,
  ...) are recognised by their platform path shape on any domain - no mirror list to maintain - and
  moved to the media channel as-is, without rewriting (see `PRE_EMBEDDED_REGEX` in
  [src/regex.ts](src/regex.ts)).
- **Tracking-junk cleaning**: social links get their `?utm_...`/`fbclid`-style tails dropped
  automatically during the rewrite; any other link carrying known trackers gets a Repost/Copy/No
  prompt to clean it in place (it stays in its channel). Functional params (`v=`, timestamps, share
  ids in paths) are never touched - see the conservative list in
  [src/media/cleanTracking.ts](src/media/cleanTracking.ts).
- **Trackers**: per-guild counters for swears (insults included) and slurs (with targeted-group
  breakdown), with leaderboard commands.
- **Phrase reactions**: 🦙 for drama/llama, 💅 for girls slang, 🇬🇧 for Britishisms (reactions
  sharing a pool compete - one random pick per message), and per-word spell-out reactions in letter
  and keycap emojis (e.g. n-word hits spell "NWORD"; phrases with a repeated character are skipped).
- **Mention comebacks**: ping the bot and it fires back with a playground insult ("you're a poopy
  head") - rate-limited per person, silent during calm mode, and skipped when the message already
  earned a word reply.
- **"Define your terms"**: words with an innocent second meaning earn a button prompt asking which
  one was meant ("homo or sticks?"), and the bot posts the definition of whichever is picked. Only
  the author's clicks count, and how long they get follows `/setdelay` scaled into minutes rather
  than seconds (`disabled` means the question never expires). Configured in
  `data/global/definitions.json` (see [data/readme.md](data/readme.md)); it runs alongside the word
  replies rather than instead of them, and picking a meaning never changes what was counted.
- **Voice sound bites**: the bot can sit in a voice channel, listen to what people say, and play a
  clip back when it hears a trigger word - say "swag", get told to shut up. Speech is transcribed
  locally with Whisper, so no audio leaves the machine, and neither the audio nor the transcript is
  written to disk. Off until `/voice enable`; after that it joins any channel with people in it and
  leaves when the channel empties. Triggers and clip pools live in `data/global/sounds.json` (see
  [data/readme.md](data/readme.md)).

## Requirements

- Node.js >= 20
- A Discord application with a bot token, invited with the `bot` and `applications.commands` scopes
  and message content intent enabled.
- For voice sound bites: `Connect` and `Speak` in the channels it should join. No extra privileged
  intent is required. The Whisper model (a few hundred MB) downloads on first use into
  `data/models/`. ffmpeg is optional, and only needed for clips that are not already Ogg Opus.

## Setup

```sh
git clone https://github.com/wobkobi/reactionBot.git
cd reactionBot
cp .env.example .env   # fill in BOT_TOKEN and CLIENT_ID
npm ci
npm run build
npm start              # or: npm run dev (watch mode)
```

npm 11.16 and later block dependency install scripts unless the package is listed in `allowScripts`
in package.json, so both packages that ask for one have a decision recorded there. esbuild is denied
because tsx runs fine without its postinstall. simple-git-hooks is approved rather than denied: a
denied package gets installed but not linked into `node_modules/.bin` on npm 11.16, which would
break the root `prepare` script that calls it.

Per-guild data (settings, counters, audit logs) is stored as JSON under `data/<guildId>/`, relative
to the working directory. The two message-keyed stores age out rather than growing forever: a moved
post stays editable/deletable by its author for 90 days, and a bot reply stays linked to the message
that triggered it for 30. Both are pruned on write, off the message ID's own timestamp. All word
behaviour (trackers + reactions) lives in one file, `data/global/words.json` - see
[data/readme.md](data/readme.md) for the full format, a template, and how to add words. It's
gitignored (it contains the slur list), so copy your own file in on a fresh deploy.

## Commands

### Media

Admin commands (settings and the nukes) require the bot owner (the `YOUR_ID` env var), the guild
owner, or the Manage Server permission. Everything else works for anyone, in any channel.

Nothing is registered with a default member permission. Discord applies those before dispatching an
interaction, which would shut the bot owner out of the very commands the `YOUR_ID` grant exists for,
so every admin command is authorised at runtime instead - once centrally, before dispatch, and again
inside the command. The trade-off is that `/setdelay`, `/setmediachannel`, and `/calmdown` sit in
everyone's slash-command picker; a member who runs one is refused. `/help` does the hiding Discord
no longer does: a member sees neither those commands nor the admin subcommands of an otherwise open
one (`/slurs nuke`, `/swears nuke`), and an admin sees both, marked 🔒.

- `/setmediachannel` - set which text channel media links get reposted into.
- `/setdelay instant` - move links straight away without asking.
- `/setdelay seconds seconds:<1-300>` - give the poster that long to hit Yes or No.
- `/setdelay disabled` - always ask, and leave the prompt up for a day (unanswered = left alone).
- `/setdelay personal [enabled] [max-seconds] [allow-never]` - what members may set for themselves
  with `/mydelay`. Every option is optional; only the ones you supply change. Defaults to on, up to
  300s, opt-out allowed.

  `/setdelay` also sizes the "define your terms" prompt, scaled from seconds into minutes - see that
  section below.

- `/mydelay instant|countdown|ask|never|show|clear` - anyone, for their own links only. `instant`
  moves yours straight away; `countdown seconds:<1-300>` moves yours when the timer runs out unless
  you hit Cancel; `ask seconds:<1-300>` is the usual Yes/Copy/No prompt; `never` leaves yours alone
  without prompting; `show` reports what is actually in force (admin bounds are applied when the
  setting is read, so it is not always what you typed); `clear` drops yours. Governs moves to the
  media channel only - same-channel rewrites and tracking cleans still ask.
- `/calmdown start [minutes]`, `/calmdown stop` - pause the configured GIF/text replies (default 30
  minutes); reactions and counting keep going. Also kicks in automatically after a spam-escalation
  reply fires (5 hits in 30s across all users, sent once per episode), so a flood gets one "enough"
  and then quiet for 5 minutes or 20 messages, whichever comes first - tune per server with
  `/calmdown auto [minutes] [messages]`.
- `/help` - list the commands you can run. An admin also sees the admin-only ones, marked 🔒.

### Right-click a moved post

Under **Apps** when you right-click a moved post, or the pointer tail it left behind. Both are
author-only - anyone else gets told whose post it is.

- **Edit post** - opens a popup pre-filled with the current text and rewrites the post.
- **Delete post** - removes the post and its tail, and records the deletion in the audit log.

### Trackers

Each tracker is one command with subcommands:

- `/swears count|top|words|nuke` - swear counters (insults count as swears).
- `/slurs count|top|words|groups|nuke` - slur counters and targeted-group breakdown.

`count [user]` is a member's total, `top [word] [limit]` is the people leaderboard (with each
person's favourite word, or ranked by one specific word - it autocompletes from what has actually
been said), `words [limit]` is the most-used words, and `nuke [user]` resets stats (admin only).
Both trackers count against whoever said the word.

### Reply GIFs

`/gif` manages the GIFs the bot replies with when it catches a slur. Adding is open to everyone - no
admin rights needed - and a new GIF is live from the next message, with no restart.

- `/gif add category:<category> url:<link>` - add a GIF. `category` autocompletes from the slur
  categories in `words.json`, plus `generic` for one that fires on any slur. Up to 25 per category.
- `/gif list [category]` - show what is in the pool and who added each entry.
- `/gif remove entry:<gif>` - remove one you added; admins can remove anyone's.

Entries added this way are shared across every server the bot is in, since they are written to
`data/global/responses.json`. The hand-written entries in that file carry no id, so `/gif remove`
cannot reach them - edit the JSON to change those.

### Mention comebacks

Mention the bot and it answers with a random playground insult. Only a deliberate ping counts - a
role the bot happens to hold, an `@everyone`, and the implicit ping a reply carries are all somebody
talking to the channel, so none of them set it off. A message that already earned a `responses.json`
reply gets that one instead, so "@bot you \<slur\>" is answered once, not twice.

The pool lives in `insults.json` - the server's data folder first, then `data/global/`. There is no
built-in pool, so on a fresh deploy copy
[data/global/insults.example.json](data/global/insults.example.json) to `data/global/insults.json`;
with neither file the bot takes the ping in silence. Each entry is text or a GIF/image link - a link
on its own embeds, so the bot can answer a ping with a reaction GIF the same way it does a slur.
`{user}` is the author mention and `{count}` is how many times they have pinged the bot. Comebacks
are rate-limited per person (10s), silenced while calm mode is on, and ping-spam gets a single
"that's enough" before the bot goes calm by itself. An `insults` array is what makes a file count,
empty or not: an empty one switches comebacks off for that server rather than letting `global`
answer for it.

### Voice sound bites

| Command          | What it does                                                            |
| ---------------- | ----------------------------------------------------------------------- |
| `/voice enable`  | Let the bot join voice channels in this server and listen (admin)       |
| `/voice disable` | Stop listening here (admin)                                             |
| `/voice leave`   | Leave the current channel for now, without changing the setting (admin) |
| `/voice status`  | Show what it is doing: channel, model, decoder, trigger count (admin)   |

Once enabled the bot joins any voice channel that has people in it, transcribes what it hears with a
local Whisper model, and plays a clip when someone says a trigger word. It leaves when the channel
empties. Nothing plays during calm mode, and both the server and each speaker get a cooldown, so it
cannot be spammed.

Expect a second or two between the word and the clip: the bot waits for the speaker to stop before
transcribing, which is what makes the transcript worth reading.

Several trigger words can share one clip pool, and mishearings are handled automatically - Whisper
writing "swig" for "swag" still fires - without listing variants by hand. Triggers, pools and the
tuning knobs are documented in [data/readme.md](data/readme.md).

### "Define your terms"

Some words have a perfectly innocent second meaning, so the bot gives the benefit of the doubt and
asks: say one and it posts a row of buttons ("homo or sticks?"), then replies with the definition of
whichever meaning gets picked. Only the author's clicks count, and saying the word again while they
still owe an answer does not stack a second question - they answer the one they have. An unanswered
question is left standing with its buttons stripped.

How long they get follows `/setdelay`, but not to the second: a link prompt is a reflex, while this
asks them to own a meaning they may not come back to for a while, so the setting is scaled up by ten
and held between 5 minutes and an hour. A default `/setdelay seconds seconds:10` gives 5 minutes,
`60` gives 10, and the `300` maximum gives 50. `/setdelay disabled` is the one value taken at face
value - the question then never expires, so the only way out is picking a meaning.
`/setdelay instant` can't be: there is nothing to go ahead and do without an answer, so it takes the
5-minute floor rather than skipping the question. Personal `/mydelay` settings don't apply - they
govern your own media links, and letting someone set `never` would just be a way of dodging the
question.

The word list lives in `definitions.json` - the server's data folder first, then `data/global/`. On
a fresh deploy copy [data/global/definitions.example.json](data/global/definitions.example.json) to
`data/global/definitions.json`; with neither file no word ever earns a prompt. Each entry gives the
`words` that trigger it (matched leniently, so `f4ggot` and `||fag||` are caught, while a link or a
longer word containing it is not), the `prompt`, and up to five `options` to pick from - see
[data/readme.md](data/readme.md) for the full shape. Prompts are rate-limited per person (10s) and
silenced while calm mode is on.

This runs alongside the word replies rather than instead of them: a slur still earns its
`responses.json` reply and still gets counted, whatever meaning the author then claims.

## Development

- Set `DEV_GUILD_ID` in `.env` to restrict a dev instance to one test server - it ignores messages
  and commands everywhere else. Only honoured under `npm run dev`; production runs (`npm start`)
  serve every guild regardless.
- `npm run lint` - ESLint (flat config, type-aware) with autofix.
- `npm run format` - Prettier.
- `npm run smoke` - offline smoke test of the media pipeline.
- Pre-commit runs lint-staged; pre-push runs build + smoke.

## License

MIT
