# The Unwritten Page engine (proof)

Cutscenes in the Unwritten Page style (`docs/art-direction/anime-op/STYLE.md`): a few
generated paintings, and code for everything that moves. Proof: bars 47–56 of
"Under the Broken Sun" (16 s).

```sh
npm run dev                         # then open /tools/cutscene/unwritten/  (?t=9.6 to start there)
node tools/cutscene/render.mjs --piece unwritten --stills 4.4,9.4 --out References/cutscene/unwritten/stills
node tools/cutscene/render.mjs --piece unwritten --video References/cutscene/unwritten/proof.mp4 --workers 4
```

The music is a local copy of the battle theme from the music branch (not committed):

```sh
mkdir -p References/cutscene/unwritten
git show origin/claude/anime-op-broken-sun:public/assets/audio/music/music_battle_broken_sun.mp3 \
  > References/cutscene/unwritten/broken_sun.mp3
```

| File | What it does |
|---|---|
| `engine/stages.js` | One painting becomes four registered paint stages: wash, ink lines, pencil, paper. The lines come from the painting itself (supersampled difference of Gaussians), so the stages sit exactly on each other. Figures also get a silhouette contour. |
| `engine/compositor.js` | The page: a procedural vellum sheet, and layers drawn at a paint stage. Stage changes flip pixel by pixel through a noise field broken by an ordered dither, so paint lifts off, or goes on, in patches. No cross-fades. |
| `engine/fx.js` | Firelight, embers, the gold thread, the Hollow Sun, the drain toward unlight, and Cinzel titles snapped to the grid. All pure functions of t. |
| `engine/palette.js` | The art bible's ramps and a lookup-table snap with ordered dither: the pixel-art finish. |
| `engine/raster.js` | Blur, noise, Bayer, hashing. |
| `proof.js` | The proof's timeline, on the score's clock (bar/beat helpers). |
| `index.html` | Player with scrub, pixel toggle, a tuning panel for the line settings, and the exporter's `window.cutscene` contract. |

A frame is a pure function of t, so the exporter renders frames in any order and in
parallel.
