# tools/cutscene — the cutscene pilot

Slice 0 of [docs/specs/cutscenes.md](../../docs/specs/cutscenes.md): a standalone,
offline player that plays a first draft of the **prologue** ("The Night Before") on
the title theme, and exports it to video. Dev tool only: nothing here ships or is
imported by the game.

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
