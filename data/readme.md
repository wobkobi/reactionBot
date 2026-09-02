# Bot data

Everything in this folder is runtime data. `data/global/` holds shared config;
each server gets its own `data/<guildId>/` folder for settings, counters and
repost records (all managed by the bot - you normally only edit the global
config).

## words.json - the word config

All word behaviour lives in `data/global/words.json`. It is gitignored (it
contains the slur list), so on a fresh deploy copy your own file in. It is
re-read on every message, so edits apply without a restart. A `words.json`
inside `data/<guildId>/` overrides the global file wholesale for that server.

Comments (`//` and `/* */`) and trailing commas are tolerated - the bot strips
them when reading.

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
`definitions.example.json` is the template; a copy in `data/<guildId>/`
overrides it per server. Gitignored like the files above, and an `entries`
array is what makes a file count, empty or not - an empty one switches prompts
off for that server instead of letting the global file answer.

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

## Other files

- `global/responses.json` - reply pools per word type (`responses.example.json`
  is the template; a `responses.json` in `data/<guildId>/` overrides it per
  server). The legacy `slur_responses.json` is still read as a slur-only pool
  when no `responses.json` exists.

  Entries added through `/gif` also carry `id`, `addedBy` (Discord ID) and
  `addedAt` (ISO timestamp), and always land in this global file. The `id` is
  what `/gif remove` looks up, so hand-written entries - which have none - can
  only be changed by editing the file.
- `global/insults.json` - the comebacks fired at anyone who mentions the bot,
  text or GIF/image links (`insults.example.json` is the template; a copy in
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
