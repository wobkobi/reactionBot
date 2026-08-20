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

## Requirements

- Node.js >= 20
- A Discord application with a bot token, invited with the `bot` and `applications.commands` scopes
  and message content intent enabled.

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
to the working directory. All word behaviour (trackers + reactions) lives in one file,
`data/global/words.json` - see [data/readme.md](data/readme.md) for the full format, a template, and
how to add words. It's gitignored (it contains the slur list), so copy your own file in on a fresh
deploy.

## Commands

### Media

Admin commands (settings and the nukes) require the bot owner (the `YOUR_ID` env var), the guild
owner, or the Manage Server permission. Everything else works for anyone, in any channel.

`/setdelay`, `/setmediachannel`, and `/calmdown` are registered with Manage Server as their default
permission, so Discord keeps them out of the slash-command picker for everyone else and `/help`
leaves them out to match. It is a default, not a lock - a server admin can grant them per role,
member, or channel under Server Settings > Integrations, and the runtime check still applies either
way. Two consequences worth knowing: the `YOUR_ID` owner grant cannot beat the picker, so in a
server where the bot owner holds neither ownership nor Manage Server those commands are out of
reach; and Discord filters per command rather than per subcommand, so commands that mix open and
admin subcommands (`/slurs nuke`, `/swears nuke`) stay visible to everyone and are marked 🔒 in
`/help` instead.

- `/setmediachannel` - set which text channel media links get reposted into.
- `/setdelay instant` - move links straight away without asking.
- `/setdelay seconds seconds:<1-300>` - give the poster that long to hit Yes or No.
- `/setdelay disabled` - always ask, and wait forever for an answer.
- `/setdelay personal [enabled] [max-seconds] [allow-never]` - what members may set for themselves
  with `/mydelay`. Every option is optional; only the ones you supply change. Defaults to on, up to
  300s, opt-out allowed.
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
- `/help` - list the commands you can run, with 🔒 on admin-only subcommands.

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
