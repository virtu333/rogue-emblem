# tools/cutscene — cutscene drafts

Dev tools only: nothing here ships or is imported by the game.

- **`hook/` — "The Roll"**, the opening cutscene (draft 1): rotoscoped generated
  clips redrawn as engraved ink, on a score written for it. Storyboard and pipeline:
  [docs/specs/cutscene-the-roll.md](../../docs/specs/cutscene-the-roll.md).
- **`glass/` — "The Far Side of the Glass"**, a second opening prototype (draft 1): a
  narrated story trailer in pixel art traced from anime cels, told by the Lieutenant.
  Storyboard and pipeline: [docs/specs/cutscene-far-side.md](../../docs/specs/cutscene-far-side.md).
- **`pilot/` — "The Night Before"**, slice 0 of
  [docs/specs/cutscenes.md](../../docs/specs/cutscenes.md): the Historia plates on the
  title theme. Superseded as the opening by `hook/`; kept for its pixel techniques.

## The Far Side of the Glass (`glass/`)

```sh
npx vite --port 3290      # open http://localhost:3290/tools/cutscene/glass/
CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/cutscene/render.mjs --piece glass --stills 64,193 --out References/cutscene
CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/cutscene/render.mjs --piece glass --video References/cutscene/far-side.mp4 --workers 4

# regenerate sources (paid; cached by request hash)
node tools/cutscene/glass/tts.mjs [--only l08 --force]     # narration takes
node tools/cutscene/glass/gen.mjs --keys|--clips [--only glass]
node tools/cutscene/glass/trace.mjs [--only glass]         # pixel pass over the frames edit.mjs uses
python3 tools/cutscene/glass/music.py [--mix]              # score + narration mix + cues.json
```

| File | What it is |
|---|---|
| `glass/script.mjs` | The narration, line by line, and the TTS voice and style. |
| `glass/shots.mjs` | The shot list: anime keyframe prompt, PC-98 portrait references, Veo motion prompt. |
| `glass/edit.mjs` | The cut: which clip plays when, from where, how fast. Also what gets traced. |
| `glass/pixel.py` | The pixel pass: a clip becomes palette-indexed 480x270 drawings (lossless WebP sheets in `glass/px/`). |
| `glass/score.py`, `glass/music.py` | The score ("Every Way It Ends", 60 bpm so a beat is a second) and the narration mix; `far_side.mp3`, `cues.json`. |
| `glass/glass.js` | The player: one 480x270 buffer, dither dissolves, pixel text, the thread, the mirror, the Hollow Sun. |
| `glass/judge.py` | Ask Gemini about audio or image files (voice auditions, take QC). |

## The Roll (`hook/`)

```sh
npx vite --port 3290      # open http://localhost:3290/tools/cutscene/hook/
CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/cutscene/render.mjs --piece hook --sheet --out References/cutscene
CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/cutscene/render.mjs --piece hook --video References/cutscene/the-roll.mp4 --workers 4

# regenerate sources (paid; cached by request hash, so re-runs only pay for changes)
node tools/cutscene/hook/gen.mjs --keys [--only hearth,quill]
node tools/cutscene/hook/gen.mjs --clips [--only hearth]
python3 tools/cutscene/hook/trace.py hearth          # needs: pip install opencv-python-headless "rembg[cpu]"
python3 tools/cutscene/hook/music.py                 # needs the tools/music sample libraries
```

| File | What it is |
|---|---|
| `hook/shots.mjs` | The shot list: keyframe prompt, identity references and Veo motion prompt per shot. |
| `hook/gen.mjs` | Keyframes (Gemini 3 Pro Image) and clips (Veo 3.1) into `References/cutscene/hook/` (gitignored). |
| `hook/trace.py` | The rotoscope: a clip becomes layers of polygons per drawing (matte, tones, ink lines, glow, background). |
| `hook/traces/` | The traced drawings (committed; the clips are not). |
| `hook/score.py`, `music.py` | The score, in the game's music engine; renders `the_roll.mp3` and the exact cue sheet `cues.json`. |
| `hook/trace.js` | Redraws a trace as engraved ink in a palette, under a vector camera. |
| `hook/fx.js`, `type.js` | The thread, peeling and converging threads, Sera's branches, the grid, the Hollow Sun, fire, grain; the words. |
| `hook/roll.js` | The timeline: every shot and word on a bar or beat of the score. |

## The Night Before (`pilot/`)

## Run it

```sh
# watch it in a browser, with the music as the clock
npx vite --port 3290
# open http://localhost:3290/tools/cutscene/pilot/  (press "Play with music"; drag to scrub; ?t=40 opens at 40 s)

# stills, a contact sheet of every shot's first and last frame, or the whole video
node tools/cutscene/render.mjs --stills 12.5,40 --out References/cutscene
node tools/cutscene/render.mjs --sheet --out References/cutscene
FFMPEG=/path/to/ffmpeg node tools/cutscene/render.mjs --video References/cutscene/prologue.mp4 --workers 6
```

In the cloud container set `CHROMIUM_PATH=/opt/pw-browsers/chromium` (the pinned
Playwright wants a newer headless shell than the image has). ffmpeg is not on the
image; `pip install imageio-ffmpeg` provides a static one.

Regenerate the cue sheet after changing the score:

```sh
python3 tools/cutscene/cuesheet.py title --bars 34 --parts solo,celesta,bells \
  > tools/cutscene/pilot/cues/music_title.json
```

## Files

| File | What it is |
|---|---|
| `cuesheet.py` | Bar, beat and note times straight from a score in `tools/music/scores` (`Score.seconds`). No audio analysis. |
| `pilot/engine.js` | The pixel layer: indexed plates with palette cycling (water glints, fire flicker, corona pulses), ordered-dither dissolves, deterministic particles, the cue-sheet clock. |
| `pilot/hands.js` | The type layer: the three hands (ceremony capitals, speech with a portrait, the pen written glyph by glyph; red strikes and stamps). |
| `pilot/prologue.js` | The draft script: eight shots and their words, every time a bar and beat of `music_title`. |
| `pilot/index.html` | The page: playback clocked by the audio element; `window.cutscene.frame(t)` for the exporter. |
| `pilot/plates/` | The six Historia chapter plates from PR 119 (`docs/lore/historia/art/`), PC-98-treated by `tools/art/icons/lib/sceneTreat.mjs`. Copied here so the pilot runs before that PR lands. |
| `render.mjs` | Playwright + an in-process Vite server: stills, contact sheets, and parallel, resumable frame export muxed with the music by ffmpeg. |

## What it proves

- **The look holds at motion.** Palette cycling, whole-pixel pans and Bayer dissolves
  keep the plates pixel-honest; nothing is smeared or glowed over.
- **The music can be the clock.** Every cut and word is a bar/beat of the score; the
  Oath lands on the horn's entries, the Edict's stamp on a timpani stroke, the red
  line on the silent bar's bell. Re-score, re-export the cue sheet, and it follows.
- **The pen works** as the set's signature: gold for names held, red for the Roll,
  struck through on the beat.
- **Frames are a pure function of t**: parallel export, scrubbing and stills come
  free, and the same code would run in the game.

## What it does not prove

- No new art: the plates are the Historia's, one per shot, with no layer splits, so
  there is no parallax and no figure animation.
- No video-model motion reference yet (the spec's two-shot pilot).
- Not the in-game player: no skip, reduced-motion, seen flags, resize or audio
  ducking. Those are slice 1, in `src/cutscene/`.
- The title theme is a temp score. Its form fits the story bar for bar, but the
  title may want to keep its own music.
