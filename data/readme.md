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
    // "track" feeds a counter: swears > /swears family.
    "swear": { "track": "swears" },
    // Any type can also have a reply pool in responses.json (keyed by this
    // type name). "fuzzy" matches stretched/leetspeak spellings (slaaay,
    // 5l4y) - write the plain word.
    "slur": { "track": "slurs", "fuzzy": true },
    // called > /called family (counted against whoever got called it).
    "insult": { "track": "called" },
    // "reaction" reacts to matching messages with an emoji. Reactions sharing
    // a "pool" compete: one random pick per message (girls vs british).
    "girls": { "reaction": "💅", "pool": "slang", "fuzzy": true },
    "british": { "reaction": "🇬🇧", "pool": "slang", "fuzzy": true },
    // "triggerEmoji": the reaction also fires when the message contains it.
    "llama": { "reaction": "🦙", "fuzzy": true, "triggerEmoji": "🦙" }
  },
  "words": {
    "swear": ["example-swear"],
    "slur": [{ "word": "example-slur", "category": "group", "reaction": "nword" }],
    "insult": ["bender"],
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
| `category` | no       | Groups slurs for `/slurgroups` (e.g. `"black"`, `"LGBT"`).                                                                                   |
| `reaction` | no       | Overrides the type's default reaction: an emoji, or a phrase spelled out in letter/keycap emojis (skipped when it repeats a character).      |

Nothing else is read from an entry. A word may appear under several types
(e.g. `bender` is british + insult).

A spell-out `reaction` takes letters, digits and spaces: letters become
regional-indicator emojis, digits become keycaps, and spaces are dropped
(Discord has no blank reaction), so `"5b to israel"` reacts 5️⃣🇧🇹🇴🇮🇸🇷🇦🇪🇱.
Discord refuses the same reaction twice and caps a message at 20, so a phrase
that repeats a character or runs past 20 emojis is skipped entirely rather than
spelled out in part - the bot logs a warning naming the value.

### Type behaviour (`types` block)

| Field          | Meaning                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `track`        | Counter this type feeds: `swears`, `slurs` or `called`.                                             |
| `reaction`     | Default reaction for the type's words: an emoji, or a phrase spelled out in letter/keycap emojis.   |
| `pool`         | Reactions sharing a pool compete - one random pick per message (the girls-vs-british coin flip).    |
| `fuzzy`        | Match stretched/leetspeak/obfuscated spellings automatically.                                        |
| `triggerEmoji` | Also fire the type's reaction when the message itself contains this emoji (a 🦙 earns a 🦙).        |

## Other files

- `global/responses.json` - reply pools per word type (`responses.example.json`
  is the template; a `responses.json` in `data/<guildId>/` overrides it per
  server). The legacy `slur_responses.json` is still read as a slur-only pool
  when no `responses.json` exists.

  Entries added through `/gif` also carry `id`, `addedBy` (Discord ID) and
  `addedAt` (ISO timestamp), and always land in this global file. The `id` is
  what `/gif remove` looks up, so hand-written entries - which have none - can
  only be changed by editing the file.
- `<guildId>/media_settings.json` - `/setmediachannel` and `/setdelay`
  settings.
- `<guildId>/calm.json` - the calm-mode window (managed by the bot and
  `/calmdown`).
- `<guildId>/*_counts.json` - tracker counters (managed by the bot).
- `<guildId>/reposts.json` + `deleted_links.json` - moved-message records and
  the deletion audit (managed by the bot).
- `<guildId>/bot_replies.json` - links bot replies (e.g. slur GIFs) to the
  message that triggered them, so deleting the trigger deletes the reply too
  (managed by the bot).
