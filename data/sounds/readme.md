# Sound clips

Drop clip files in this folder. `sounds.json` groups them into pools and says which spoken words
play them - see [../readme.md](../readme.md) for that side.

## Layout

**A folder is a pool.** Make a folder, drop clips in it, and name it from
`sounds.json`. Nothing lists the files, so adding one is just adding a file:

```
data/sounds/
  shutup/           <- "pool": "shutup"
    oi-shut-up.ogg
    be-quiet.ogg
  ambience/         <- "ambient": { "pool": "ambience" }
    creak.ogg
  bruh.ogg          <- "sounds": ["bruh.ogg"] for a one-off
  .cache/           converted copies, made automatically, safe to delete
```

Only audio files count (`.ogg .opus .webm .mp3 .wav .m4a .flac`), so a readme or
a stray artwork file in a pool folder is ignored rather than queued up to fail.

To override one clip, or a whole pool, for a single server, put the same name
under `data/<guildId>/sounds/`. That is checked first.

Run `/voice check` in Discord to see which pools resolve and which come back
empty.

## Formats

**Opus plays as-is**, in either an Ogg (`.ogg`, `.opus`) or a WebM (`.webm`) container. Discord
accepts Opus and nothing else, so a file that already holds Opus frames just has its container
unwrapped: no conversion, no ffmpeg, nothing to wait for.

Anything else - mp3, wav, m4a, and Ogg **Vorbis** - has to be decoded and re-encoded, so it is
converted once with ffmpeg and cached in `.cache/`. Only the first play pays for it. That needs
ffmpeg installed; without it those files are skipped with a warning and only Opus works.

Watch out for Ogg Vorbis: it has the same `.ogg` extension as Ogg Opus but is a different codec, so
the extension alone does not tell you which you have. The bot reads the file header rather than
trusting the name, so a Vorbis file is converted instead of played as silence.

To convert a clip yourself, matching what the bot does:

```sh
ffmpeg -i input.mp3 -vn -c:a libopus -ar 48000 -ac 2 -b:a 96k \
  -frame_duration 20 -application audio output.ogg
```

## Practical notes

- **Ambient clips want to be quiet.** A pool used by the `ambient` block plays
  unprompted, so anything loud stops being atmosphere and becomes an
  interruption. Mix them lower than the trigger clips.
- **Keep clips short.** A trigger fired while a clip is playing is dropped, not queued, so a long
  clip means missing the next few.
- **Match the volume across clips.** There is no normalisation at playback. If one is much louder
  than the rest, fix the file: add `-af loudnorm` to the ffmpeg command above.
- **Nothing here is in git.** This folder is gitignored apart from this file, so clips live only on
  the machine running the bot. Keep a copy somewhere.
