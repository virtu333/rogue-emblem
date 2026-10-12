# tools/sfx — sound effects, synthesized in code

`build.py` writes the coded sound effects (`sfx_miss`, `sfx_turn`, ...) to
`assets/audio/sfx/`. Each cue is one small numpy function: sines, inharmonic metal and
band-passed noise, a fixed seed per cue, so a rebuild writes the same samples. The older
sfx files (weapons, cursor, confirm, ...) are recordings and are not built here;
`sfx_levelup` comes from the music build (`tools/music/build.py --stingers levelup`).

## Rebuild

Needs numpy and ffmpeg with libmp3lame.

```bash
python3 tools/sfx/build.py                   # every cue
python3 tools/sfx/build.py sfx_miss sfx_turn # some cues
python3 tools/sfx/build.py --list            # what each cue is
python3 tools/sfx/build.py --wav /tmp/sfx    # also keep the WAVs to listen to
npm run sync-assets                          # copy to public/
npm run build:audio                          # the hashed audio manifest
npm run check:audio                          # fails while the manifest is stale
```

Each cue declares its loudness as the loudest 400 ms window (K-weighted, BS.1770; how
loud a short sound seems), set against the shipping files: weapons about -25 LUFS, hit
-23, crit -20, cursor -21, confirm -15, gold -16, cancel -28. Every cue keeps 3 dB of
peak headroom; a cue that cannot reach its loudness under that ceiling is refused
(round its first spike off with `soften`). After encoding (44.1 kHz mono, LAME VBR
`-q:a 4`, as the shipping sfx), the MP3 is decoded and checked: loudness, peak, length,
DC offset and silent first and last samples.

## Adding a cue

1. Write `def sfx_<name>():` in `build.py` returning `(signal, loudness)` and add it to
   `CUES`.
2. Build it, then list the key in `src/utils/sfxConfig.js`: `COMBAT_SFX` for battle
   sounds (loaded with the battle sounds), `UI_SFX` for menus and services (never waited
   on at boot; warmed after the title). Give it an `SFX_FALLBACKS` entry when the spot it
   plays at made another sound before, so it is never silent while its file warms.
3. Sync, rebuild the manifest. `tests/SfxCatalog.test.js` fails on a cue with no file, a
   file in no list, a stale public copy or manifest entry, or a generator cue that is not
   registered.
