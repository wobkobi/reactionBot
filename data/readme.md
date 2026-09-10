# Bot data

Everything in this folder is runtime data. `data/global/` holds shared config;
each server gets its own `data/<guildId>/` folder for settings, counters and
repost records (all managed by the bot - you normally only edit the global
config).

## How a server overrides the global config

One rule, the same for every config file below:

> A server's own file wins as soon as it exists, whatever it contains. Only an
> absent file falls back to `global/`.

Every file below is read the same way too: comments (`//` and `/* */`) and
trailing commas are fine, so a note explaining a setting can sit next to the
setting. The `.example.jsonc` templates use that rather than a wall of prose at
the top, and are the fastest way to see what a file can hold.

So `data/<guildId>/insults.json` containing `{ "insults": [] }` switches
comebacks off for that server rather than letting the global pool answer, and
the same shape applies to every other file. Overrides are wholesale: the guild
file replaces the global one, it does not merge with it.

Run `npm run check-config` to list any per-server file that declares nothing,
since those are the ones where "off here" and "use global" look the same from
the outside.

## words.json - the word config

All word behaviour lives in `data/global/words.json`. It is gitignored (it
contains the slur list), so on a fresh deploy copy your own file in. It is
re-read on every message, so edits apply without a restart. A `words.json`
inside `data/<guildId>/` overrides the global file wholesale for that server.

### Structure

```jsonc
{
  // Each type defines its behaviour ONCE; the word lists reference them.
  "types": {
    // "track" feeds a counter: swears > /swears family, slurs > /slurs family.
    // Both count against whoever said the word.
    "swear": { "track": "swears" },
    // Any type can also have a reply pool in responses.json (keyed by this
    // type name). "fuzzy" matches stretched/leetspeak spellings (slaaay,
    // 5l4y) - write the plain word.
    "slur": { "track": "slurs", "fuzzy": true },
    // "reaction" reacts to matching messages with an emoji. Reactions sharing
    // a "pool" compete: one random pick per message (girls vs british).
    "girls": { "reaction": "💅", "pool": "slang", "fuzzy": true },
    "british": { "reaction": "🇬🇧", "pool": "slang", "fuzzy": true },
    // "triggerEmoji": the reaction also fires when the message contains it.
    "llama": { "reaction": "🦙", "fuzzy": true, "triggerEmoji": "🦙" }
  },
  "words": {
    "swear": ["example-swear", "bender"],
    "slur": [{ "word": "example-slur", "category": "group", "reaction": "nword" }],
    "girls": ["slay"],
    "british": ["bender", "cheeky"],
    "llama": ["llama"]
  }
}
```

### Adding a word

Find its type under `words` and append it. Every list accepts both forms,
mixed freely:

- **Simple** - just the word as a string: `"cuppa"`
- **Advanced** - an object when it needs extras:
  `{ "word": "...", "category": "black", "reaction": "nword" }`

| Field      | Required | Meaning                                                                                                                                     |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `word`     | yes      | The word or phrase. Write it plainly - fuzzy types match stretched ("slaaay"), leetspeak ("5l4y"), apostrophe and markdown variants for you. |
| `category` | no       | Groups slurs for `/slurs groups` (e.g. `"black"`, `"LGBT"`).                                                                                 |
| `reaction` | no       | Overrides the type's default reaction: an emoji, or a phrase spelled out in letter/keycap emojis (skipped when it repeats a character).      |

Nothing else is read from an entry. A word may appear under several types
(e.g. `bender` is british + swear).

A spell-out `reaction` takes letters, digits and spaces: letters become
regional-indicator emojis, digits become keycaps, and spaces are dropped
(Discord has no blank reaction), so `"5b to israel"` reacts 5️⃣🇧🇹🇴🇮🇸🇷🇦🇪🇱.
Discord refuses the same reaction twice and caps a message at 20, so a phrase
that repeats a character or runs past 20 emojis is skipped entirely rather than
spelled out in part - the bot logs a warning naming the value.

### Type behaviour (`types` block)

| Field          | Meaning                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `track`        | Counter this type feeds: `swears` or `slurs`, counted against whoever said the word.                 |
| `reaction`     | Default reaction for the type's words: an emoji, or a phrase spelled out in letter/keycap emojis.   |
| `pool`         | Reactions sharing a pool compete - one random pick per message (the girls-vs-british coin flip).    |
| `fuzzy`        | Match stretched/leetspeak/obfuscated spellings automatically.                                        |
| `triggerEmoji` | Also fire the type's reaction when the message itself contains this emoji (a 🦙 earns a 🦙).        |

## definitions.json - "define your terms"

`data/global/definitions.json` lists words with an innocent second meaning. Say
one and the bot asks which you meant, then posts that meaning's definition.
`definitions.example.jsonc` is the template; a copy in `data/<guildId>/`
overrides it per server. Gitignored like the files above; an empty
one switches prompts off for that server rather than letting the global file
answer.

```jsonc
{
  "entries": [
    {
      // Matched leniently, so write them plainly: "f4ggot" and "||fag||" are
      // caught for you, and the word inside a longer one (or in a link) is not.
      "words": ["faggot", "fag"],
      "prompt": "{user} homo or sticks?",
      // Up to five - Discord refuses a longer row of buttons.
      "options": [
        { "id": "homo", "label": "Homo", "emoji": "🏳️‍🌈", "reply": "Thought so." },
        { "id": "sticks", "label": "Sticks", "emoji": "🪵", "reply": "**faggot** - a bundle of sticks." }
      ]
    }
  ]
}
```

| Field             | Required | Meaning                                                                        |
| ----------------- | -------- | ------------------------------------------------------------------------------ |
| `words`           | yes      | Spellings that earn the question. The first entry that matches a message wins. |
| `prompt`          | yes      | The question put to the author.                                                |
| `options`         | yes      | The meanings on offer, in button order; at most five.                          |
| `options[].id`    | yes      | Button ID, unique within the entry.                                            |
| `options[].label` | yes      | Text on the button.                                                            |
| `options[].emoji` | no       | Emoji shown before the label.                                                  |
| `options[].reply` | yes      | Posted when that meaning is picked.                                            |

`{user}` is the author mention in both the prompt and the replies. Only the
author's clicks count, and saying the word again while they still owe an answer
does not stack a second question. How long they get follows the guild's
`/setdelay`, scaled up by ten and held between 5 minutes and an hour - a
question is not the reflex a link prompt is. `/setdelay disabled` is taken at
face value, so the question never expires and picking a meaning is the only way
out; `instant` takes the floor instead of skipping the question. Personal
`/mydelay` settings do not apply. This is separate from `responses.json` - a
word can
earn a reply *and* the question, and picking a meaning never changes what was
counted against them.

## sounds.json - voice sound bites

The bot can sit in a voice channel, listen to what people say, and play a clip
back when it hears a trigger. Speech is transcribed locally with Whisper; no
audio and no transcript leaves the machine or is written to disk.

Off until someone runs `/voice enable` in the server. Once on, the bot joins any
voice channel that has people in it and leaves when the channel empties.

`sounds.example.jsonc` is the template, and it explains every setting inline.
Copy it to `sounds.json` here, or to `data/<guildId>/sounds.json` for one
server. Comments and trailing commas are fine.

**A pool is a folder.** Put clips in `data/sounds/shutup/` and write
`"pool": "shutup"`. There is no list to keep in step with the files, and adding
a clip needs no edit at all. The smallest useful config is:

```jsonc
{
  "triggers": [{ "words": ["swag"], "pool": "shutup" }]
}
```

For a one-off, name the file directly with `"sounds": ["bruh.ogg"]` instead of
making a folder for it. An explicit `"pools"` block still works if you want one
folder's clips split across several pools, and it wins over a folder of the
same name.

**Run `/voice check`** to see what resolves and what does not - missing folders,
empty pools, and clip names that point at nothing all come back in Discord
rather than sitting in the log.

| Field | Meaning |
| --- | --- |
| `triggers[].words` | What to listen for. The first trigger that matches wins. |
| `triggers[].pool` | Folder under `data/sounds/` (or a key in `pools`) to draw from. |
| `triggers[].sounds` | Clips named directly, instead of a pool. |
| `triggers[].cooldownMs` | Overrides the server gap for this trigger alone. |
| `triggers[].phonetic` | Overrides the global `phonetic` for this trigger. |
| `triggers[].fuzzy` | Stretched-spelling tolerance, as in `words.json`. Rarely useful for speech. |
| `ambient.pool` / `.sounds` | Where the unprompted sounds come from. Remove the block to switch them off. |
| `ambient.minMinutes` / `maxMinutes` | Gap either side of each sound, re-rolled every time. Defaults to 5 and 20; under 10 seconds is refused. |
| `minMembers` | People a channel needs before the bot joins. Default 1. |
| `guildCooldownMs` | Minimum gap between clips for the whole server. Defaults to 30 seconds. The per-speaker gap is fixed at 20 seconds and cannot be set here. |
| `phonetic` | Automatic soundalike matching. Default true. |
| `ignore` | Phrases that never count. |
| `logTranscripts` | Echo what was heard at debug level. |
| `enabled` | Config-wide default for the per-guild switch. `/voice enable` overrides it. |

**Several words, one sound.** Point as many triggers as you like at the same
pool. Three unrelated words sharing one set of clips is the normal case, not a
workaround.

**You do not list mishearings by hand.** Whisper writes down what it thinks it
heard, and for short words it usually gets the vowels wrong: "swig" or "sweg"
for "swag". With `phonetic` on (the default), those match anyway, because the
matcher compares how a word sounds rather than how it is spelled.

It is deliberately conservative about this, and only accepts a soundalike when
it shares the trigger's first letter and is not an everyday English word.
Without those guards a "drip" trigger fires on "trip", and a "swag" trigger
fires on "sick", "sock", "sack", "seek" and "soak". Set `"phonetic": false` on a
trigger to demand the exact word, and add spellings to `words` for anything the
guards turn away.

**Ambient sounds.** With an `ambient` block the bot also plays a clip now and
then on its own, at a random gap inside the range, re-rolled each time so it
never settles into a rhythm. It does not wait for a gap in conversation, but it
will not talk over a clip already playing, and calm mode silences it. It never
touches the trigger cooldowns, so an ambient sound cannot swallow a trigger
someone earned.

**Clip files.** They live in `data/sounds/`, and
[sounds/readme.md](sounds/readme.md) covers the formats and how to convert one.
The short version: Opus in an Ogg or WebM container plays as-is, anything else
is converted once with ffmpeg and cached.

## Other files

- `global/responses.json` - reply pools per word type (`responses.example.jsonc`
  is the template; a `responses.json` in `data/<guildId>/` overrides it per

  Entries added through `/gif` also carry `id`, `addedBy` (Discord ID) and
  `addedAt` (ISO timestamp), and always land in this global file. The `id` is
  what `/gif remove` looks up, so hand-written entries - which have none - can
  only be changed by editing the file.
- `global/insults.json` - the comebacks fired at anyone who mentions the bot,
  text or GIF/image links (`insults.example.jsonc` is the template; a copy in
  `data/<guildId>/` overrides it per server). Gitignored like the files above,
  and there is no built-in pool - with no file the bot takes the ping in
  silence. An `insults` array is what makes a file count, empty or not, so an
  empty one switches comebacks off for that server instead of letting the
  global file answer. `{user}` is the author mention and `{count}` is how many
  times they have pinged the bot. Only a deliberate ping counts - a role the bot holds,
  an `@everyone` and a reply's implicit ping are ignored - and a message that
  already earned a `responses.json` reply gets that one instead.
- `global/definitions.json` - the "define your terms" prompts, documented
  above.
- `global/sounds.json` - the voice triggers and clip pools, documented above
  (`sounds.example.jsonc` is the template; a copy in `data/<guildId>/` overrides
  it per server).
- `sounds/` - the clip files themselves, plus a `.cache/` of clips converted to
  Ogg Opus. Safe to delete; it is rebuilt on demand.
- `models/` - the downloaded Whisper model (a few hundred MB, fetched on first
  use). Safe to delete; it is re-downloaded. Set `VOICE_MODEL_DIR` to move it.
- `<guildId>/voice.json` - whether voice listening is on for that server
  (managed by `/voice enable` and `/voice disable`).
- `<guildId>/media_settings.json` - `/setmediachannel` and `/setdelay`
  settings.
- `<guildId>/calm.json` - the calm-mode window (managed by the bot and
  `/calmdown`).
- `<guildId>/*_counts.json` - tracker counters, including
  `mention_counts.json` for `{count}` in the comebacks (managed by the bot).
- `<guildId>/reposts.json` + `deleted_links.json` - moved-message records and
  the deletion audit (managed by the bot).
- `<guildId>/bot_replies.json` - links bot replies (slur GIFs, mention
  comebacks) to the message that triggered them, so deleting the trigger
  deletes the reply too (managed by the bot).
