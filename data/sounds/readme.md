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

**Drop in whatever you have** - mp3, wav, m4a, flac, Ogg Vorbis, or Opus in an Ogg (`.ogg`,
`.opus`) or WebM (`.webm`) container. Each one is converted once with ffmpeg, normalised, and
cached in `.cache/`; only the first play pays for it and every play after is a cache hit.

Opus files are converted too, even though Discord takes Opus directly and their container could
just be unwrapped. Normalising a clip means re-encoding it, and a guarantee about volume that
skipped one format would not be worth much. **So ffmpeg is required** - without it no clip plays
at all, and each one is skipped with a warning.

Watch out for Ogg Vorbis: it has the same `.ogg` extension as Ogg Opus but is a different codec, so
the extension alone does not tell you which you have. The bot reads the file header rather than
trusting the name, so a Vorbis file is converted instead of played as silence.

To convert a clip yourself, matching what the bot does:

```sh
ffmpeg -i input.mp3 -vn -c:a libopus -ar 48000 -ac 2 -b:a 96k \
  -frame_duration 20 -application audio output.ogg
```

## Practical notes

- **Volume is not your problem.** Every clip is normalised on the way into the
  cache, so a quiet clip and a clip mastered to full scale come out at the same
  level. Ambient clips are taken lower than trigger clips (-26 LUFS against
  -20), because nobody asked for them and they have to sit under the talking.
  Nothing to mix by hand, and a loud file is not worth re-encoding yourself.
- **Keep clips short.** A trigger fired while a clip is playing is dropped, not queued, so a long
  clip means missing the next few.
- **Nothing here is in git.** This folder is gitignored apart from this file, so clips live only on
  the machine running the bot. Keep a copy somewhere.
