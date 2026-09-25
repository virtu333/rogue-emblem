# tools/music — the score, composed in code

The game's soundtrack is written here as Python scores and rendered to MP3 by a
small orchestral engine. See `SCORE.md` for the music itself (leitmotifs, cue list,
the adaptive battle layers).

## Setup

```bash
pip install numpy scipy numba soundfile pyloudnorm mido matplotlib
sudo apt-get install ffmpeg fluidsynth          # mp3 encoding, SoundFont rendering
bash tools/music/fetch_libraries.sh              # CC0 / free sample libraries -> References/music-libs/
```

The first run also needs `sfizz_render` (build it from https://github.com/sfztools/sfizz
with `-DSFIZZ_RENDER=ON`) for the drum kit, bass guitar and grand piano.

## Build

```bash
python3 tools/music/build.py battle_act1 --preview   # one score, + jump previews
python3 tools/music/build.py --all                   # every score
```

This writes `assets/audio/music/<key>.mp3` (plus `<key>_calm.mp3` for adaptive
battle themes) and regenerates `src/utils/musicLoops.js`. Then run `npm run sync-assets`
to copy the files to `public/`. `--preview` also writes files to `References/music-preview/`
that play through the loop jump, so you can listen to the seam.

## Tools

| Script | Purpose |
|---|---|
| `build.py` | Render scores and export game-ready loops |
| `lint.py <score>` | Symbolic check: sustained semitone clashes between parts, for catching typos and wrong octaves |
| `analyze.py <score> [--png]` | Per-part levels in each mix variant, tonal balance, width, spectrogram |
| `solo.py <score> <parts…>` | Audition a subset of parts |
| `listen.py <files…> --prompt` | Ask a Gemini audio model for a critique. It is useful for glaring problems only; its detailed perception is unreliable |
| `ab.py` | Blind A/B test of an engine tweak through the critic |

## Engine (`engine/`)

- `score.py`: the note-string notation (`D5q F#4e. [D4 F4 A4]h~ @mf %spic`), parts,
  tempo map, loop structure and mix variants.
- `patterns.py`: chord charts to pads with voice leading, arpeggios, ostinati, bass
  lines, drum grids and the split `Kit`.
- `sampler.py`: an SFZ sampler for VSCO-2 CE. It adds velocity-layer crossfades,
  velocity-to-tone, attack sharpening for slow samples, legato transitions with a pitch
  glide, bow and breath swells, brass blare and round-robin emulation.
- `sfzrender.py` / `sf2render.py`: full-spec SFZ through `sfizz_render` (drums, bass,
  piano) and SoundFonts through FluidSynth (choir, celesta, nylon guitar, accordion).
- `synth.py`: sub, the thread shimmer, the Entity's drone, risers, booms.
- `render.py`: per-part rendering with auto-calibrated levels and onset pre-roll, role
  leveling, expression lanes, loop-periodic performance drift, sends to a synthetic
  hall and a drum room, kick sidechain, lead ducking, master glue, loudness and a
  true-peak limiter, and loop export with a seam check.

## Libraries (all free for commercial music)

| Library | License | Used for |
|---|---|---|
| VSCO-2 Community Edition (Versilian Studios) | CC0 | the orchestra |
| Virtuosity Drums | CC0 | drum kit |
| Karoryfer Growlybass | CC0 | bass guitar |
| Splendid Grand Piano (AKAI) | Public domain | piano |
| GeneralUser GS (S. Christian Collins) | Free for commercial music | choir, celesta, nylon guitar, accordion |
