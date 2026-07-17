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
    // slurs also trigger the rate-limited GIF reply. "fuzzy" matches
    // stretched/leetspeak spellings (slaaay, 5l4y) - write the plain word.
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
| `reaction` | no       | Overrides the type's default reaction: an emoji, or a lowercase word spelled out in letter emojis (skipped when it repeats a letter).       |

Nothing else is read from an entry. A word may appear under several types
(e.g. `bender` is british + insult).

### Type behaviour (`types` block)

| Field          | Meaning                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `track`        | Counter this type feeds: `swears`, `slurs` (also triggers the GIF reply) or `called`.               |
| `reaction`     | Default reaction for the type's words: an emoji, or a word spelled out in letter emojis.            |
| `pool`         | Reactions sharing a pool compete - one random pick per message (the girls-vs-british coin flip).    |
| `fuzzy`        | Match stretched/leetspeak/obfuscated spellings automatically.                                        |
| `triggerEmoji` | Also fire the type's reaction when the message itself contains this emoji (a 🦙 earns a 🦙).        |

## Other files

- `global/slur_responses.json` - GIF reply pools for slur hits (gitignored;
  `slur_responses.example.json` is the template).
- `<guildId>/media_settings.json` - `/setmediachannel`, `/setdelay`,
  `/setbotchannel` settings.
- `<guildId>/allowed.json` - users granted bot-admin via `/allow`.
- `<guildId>/*_counts.json` - tracker counters (managed by the bot).
- `<guildId>/reposts.json` + `deleted_links.json` - moved-message records and
  the deletion audit (managed by the bot).
