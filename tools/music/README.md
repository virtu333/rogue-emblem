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
python3 tools/music/build.py --stingers levelup      # one ceremony cue, in every key
python3 tools/music/build.py --stingers              # every ceremony cue
```

This writes `assets/audio/music/<key>.mp3` (plus `<key>_calm.mp3` for adaptive
battle themes and `<key>_enrage_<boss>.mp3` for boss themes) and regenerates
`src/utils/musicLoops.js`. Stingers go to `assets/audio/stingers/` and
`src/utils/musicStingers.js`: a keyed stinger (`KEYED = True`) is written in D and
rendered once per tonic the scores declare; an unkeyed one may name a fixed `TONIC`.
A hinge cue declares `HANDOFF_BARS`: the build records `handoff`, the time the next
track's first downbeat falls (the Entity's finale starts there, sample-aligned). A score
can also ship a stem as its own variant (the finale's `_hum`), which the game plays as
an additive layer.
Before rendering, a form check refuses any score with a bar in which nothing sounds
(declare intended silences in `score.silent_ok`). Then run `npm run sync-assets`
to copy the files to `public/`. `--preview` also writes files to `References/music-preview/`
that play through the loop jump, so you can listen to the seam.

## Tools

| Script | Purpose |
|---|---|
| `build.py` | Render scores and export game-ready loops |
| `lint.py <score> [--variant v]` | Symbolic check: sustained semitone clashes between parts, for catching typos and wrong octaves |
| `pitchcheck.py <file.mp3>` | The strongest pitch classes per window of a rendered file: is the cue in the key it should be? |
| `analyze.py <score> [--png]` | Per-part levels in each mix variant, tonal balance, width, spectrogram |
| `solo.py <score> <parts…>` | Audition a subset of parts |
| `listen.py <files…> --prompt` | Ask a Gemini audio model for a critique. It is useful for glaring problems only; its detailed perception is unreliable |
| `ab.py` | Blind A/B test of an engine tweak through the critic |

## Engine (`engine/`)

- `score.py`: the note-string notation (`D5q F#4e. [D4 F4 A4]h~ @mf %spic`), parts,
  tempo map, meter changes (`s.meter_change(bar, (5, 8))`: bars from `bar` on are in the
  new meter; `bar()`, the form check, drum grids and lint follow it), loop structure and
  mix variants.
- `patterns.py`: chord charts to pads with voice leading, arpeggios, ostinati, bass
  lines, drum grids and the split `Kit`.
- `sampler.py`: an SFZ sampler for VSCO-2 CE. It adds velocity-layer crossfades,
  velocity-to-tone, attack sharpening for slow samples, legato transitions with a pitch
  glide, bow and breath swells, brass blare and round-robin emulation.
- `sfzrender.py` / `sf2render.py`: full-spec SFZ through `sfizz_render` (drums, bass,
  piano) and SoundFonts through FluidSynth (choir, celesta, nylon guitar, accordion).
  The sfizz instruments render from a copy of their program with the needed samples held
  in memory (written to a temporary folder for the render, then deleted). Left to itself,
  `sfizz_render` streams sample data from a thread it does not reliably wait for, and on
  a busy machine notes longer than about 0.19 s can fall silent part-way. The in-memory
  render is bit-identical to a clean streamed render. `MUSIC_SFIZZ_RAM=0` turns it off
  (plain streaming, for comparison).
- `synth.py`: sub, the thread shimmer, the Entity's drone, risers, booms.
- `render.py`: per-part rendering with auto-calibrated levels and onset pre-roll, role
  leveling, expression lanes, loop-periodic performance drift, sends to a synthetic
  hall and a drum room, kick sidechain, lead ducking, master glue, loudness and a
  true-peak limiter, and loop export with a seam check.

## Sound lab (alternative palette, off by default)

`engine/palette.py` can swap instruments at render time for candidates from other free
libraries (Sonatina Symphonic Orchestra 4, Virtual Playing Orchestra 3, VCSL). Nothing
changes unless you ask for it: with the switch off, every stem, cache key and mix renders
bit-identically.

```bash
python3 tools/music/solo.py --list-palette                       # the candidates
python3 tools/music/solo.py title solo --bars 5 13 --out a.mp3   # an excerpt, current palette
python3 tools/music/solo.py title solo --bars 5 13 --palette lab:solo_violin=sso --why --out b.mp3
python3 tools/music/solo.py boss_emperor '*' --variant full --bars 5 17 \
    --palette lab:choir=sso_mixed,horns,trumpets,trombones,tuba --bitrate 192 --out c.mp3
MUSIC_PALETTE=lab:choir python3 tools/music/build.py battle_act3   # writes to References/music-lab/out
```

- Syntax: `lab` (every first candidate), `lab:choir,solo_violin` (first candidate of
  each), or `lab:choir=vpo_mixed` (a named candidate).
- Lab instruments are `kind: 'lab'` (`engine/labrender.py`). Each one plays one or more
  SFZ programs through `sfizz_render`. The programs are flattened and tweaked copies of the
  library's own (`engine/sfzlab.py`), written to `References/music-lab/sfz/`. Dynamics and
  the part's expression lane go to the program's CC1. Each stream is calibrated like the
  default palette (an mf note at -20 dBFS). A lab instrument keeps the seat of the part it
  replaces (pan, depth, bus, role levelling), so only the sound source changes.
- `engine/perform.py` is the performer: an articulation state machine for solo lines
  (legato, new bows, spiccato/staccato, round robins on repeats, phrase dynamics,
  humanised entrances). `--why` prints its decision for each note.
- `--bars A B` renders bars A to B-1 as a one-shot excerpt (`engine/excerpt.py`). This
  saves CPU on a shared machine. Lab renders keep their own stem cache
  (`References/music-lab/cache`, or `MUSIC_CACHE`).
- A build with a lab palette never writes game assets or the loop tables.
- The lab's own programs always load their samples into memory (see `sfzrender.py` above).
- Licences differ from the default palette's CC0 set. Read the licence notes before
  shipping anything rendered with a lab candidate. VPO3's brass, viola and cello sections
  carry CC BY-SA sources, and SSO4 is CC Sampling Plus (attribution, no advertising).

## Libraries (all free for commercial music)

| Library | License | Used for |
|---|---|---|
| VSCO-2 Community Edition (Versilian Studios) | CC0 | the orchestra |
| Virtuosity Drums | CC0 | drum kit |
| Karoryfer Growlybass | CC0 | bass guitar |
| Splendid Grand Piano (AKAI) | Public domain | piano |
| GeneralUser GS (S. Christian Collins) | Free for commercial music | choir, celesta, nylon guitar, accordion |
