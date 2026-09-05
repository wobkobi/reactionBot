# Sound clips

Drop clip files in this folder. `sounds.json` groups them into pools and says which spoken words
play them - see [../readme.md](../readme.md) for that side.

## Layout

Names in `sounds.json` are relative to this folder, and subfolders are fine:

```
data/sounds/
  airhorn.ogg
  shutup/
    oi-shut-up.ogg
    be-quiet.ogg
  .cache/          # converted copies, made automatically, safe to delete
```

```json
"pools": {
  "shutup": ["shutup/oi-shut-up.ogg", "shutup/be-quiet.ogg"],
  "airhorn": ["airhorn.ogg"]
}
```

To override one clip for a single server without copying the whole set, put a file with the same
name in `data/<guildId>/sounds/`. That is checked first.

## Formats

**Ogg Opus (`.ogg`, `.opus`) plays as-is** and is what to use if you can.

Anything else - mp3, wav, m4a, and Ogg **Vorbis** - is converted once with ffmpeg and cached in
`.cache/`, so only the first play is slow. That needs ffmpeg installed; without it those files are
skipped with a warning and only Ogg Opus works.

Watch out for Ogg Vorbis: it has the same `.ogg` extension as Ogg Opus but is a different codec, so
the extension alone does not tell you which you have. The bot checks the file itself, so a Vorbis
file is converted rather than played as silence.

To convert a clip yourself, matching what the bot does:

```sh
ffmpeg -i input.mp3 -vn -c:a libopus -ar 48000 -ac 2 -b:a 96k \
  -frame_duration 20 -application audio output.ogg
```

## Practical notes

- **Keep clips short.** A trigger fired while a clip is playing is dropped, not queued, so a long
  clip means missing the next few.
- **Match the volume across clips.** There is no normalisation at playback. If one is much louder
  than the rest, fix the file: add `-af loudnorm` to the ffmpeg command above.
- **Nothing here is in git.** This folder is gitignored apart from this file, so clips live only on
  the machine running the bot. Keep a copy somewhere.
