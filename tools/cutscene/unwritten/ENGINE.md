# The Unwritten Page engine

How the cutscene engine works, and how to make a shot with it. The look it serves is in
[STYLE.md](../../../docs/art-direction/anime-op/STYLE.md): the opening is a page in Sera's
book of futures, painted in sepia ink and pale watercolour, and the gold thread is the
only warm light.

**The rule:** every image is generated once. Everything that moves is code. A frame is a
pure function of time on the score's clock, so the exporter can render frames in any order,
in parallel, and a scrub always shows the same frame.

## The pipeline for one frame

```
the page (vellum)                                   compositor.makePaper
  + layers, each at a paint stage, through a camera  view.drawSprite
  + effects (lines, thread, sparks, flashes)         anime.js, fx.js
  + a transition, if two shots overlap                transitions.js
  -> snap to the art bible's ramps                   palette.quantise
```

Everything is drawn at 480×270 (the art-pixel grid). The player scales it up 4× with no
smoothing.

## Files

| File | What it does |
|---|---|
| `engine/stages.js` | One painting becomes four registered **paint stages**: 0 wash (the painting), 1 ink lines, 2 pencil, 3 bare paper. The lines are found in the painting itself (a supersampled difference of Gaussians), so the stages sit exactly on each other. |
| `engine/compositor.js` | The vellum sheet, and `Layer`: a painting's stages plus its dissolve mask (a noise field, so paint comes off in patches). |
| `engine/view.js` | **The camera.** `drawSprite` places a layer by an affine transform (position, scale, rotation, flip, squash) and sees it through a camera (pan, zoom, roll) with a parallax factor. Also: wind warp hook, rim light, silhouette, ink-only ghosts, dithered opacity, clip. `drawSmear` draws motion ghosts. |
| `engine/anime.js` | **The anime vocabulary** in our materials. See the table below. |
| `engine/fx.js` | The first effects: firelight, embers, the sine thread, the Hollow Sun, the drain to unlight, Cinzel titles. |
| `engine/transitions.js` | Two frames into one: page turn (forward and back), ink blot, burning ring, the page cracking into shards, manga panels. |
| `engine/score.js` | "Under the Broken Sun" as events, transcribed from its score: every kick, snare, crash, the bar-28 roll, and the choir's tune. `T(bar, beat)`, `hitsIn`, `pulse`. |
| `engine/piece.js` | `Piece`: loads images, builds and caches layers (`plate`, `figure`), snapshots, the shot timeline with transitions, and the render entry point. |
| `engine/palette.js` | The ramps, a skin ramp for people only, and the ordered-dither snap. |
| `again.js` | "Again", bars 28–56 of the opening (46.4 s, 29 shots). |
| `proof.js` | The first proof, bars 47–56 (kept as a reference; uses the older `drawLayer`). |
| `index.html` | The player: `?piece=again` (default) or `?piece=proof`, `?t=` start time, `?export=1` for the renderer. |

## Paint stages: the core idea

A stage value `s` from 0 to 3 is fractional. At 1.4, each pixel of the layer is at stage 1
or 2, decided by its dissolve mask (fixed noise plus a Bayer dither). So animating `s`
makes paint lift off, or go on, in patches, and never cross-fades.

- `s` 0 → 3: the rewind (a future is scraped off the page).
- `s` 3 → 1 → 0: a shot inks itself in (pencil, then lines, then colour).
- `inkOnly` at stage 1 with low opacity: the ghost of an earlier painting under a new one
  (Edric's falls, each painted over the last).

Quantise progress into steps (`step(u, n)` in `again.js`) so the change stutters on the
beat instead of flowing. Anime holds; it doesn't tween.

Layer build settings: `plate()` gets broader lines and higher floors than `figure()`,
because painted texture turns into speckle. `lift` raises the floors more, for a busy plate
(the camp). `grain` is the patch size of the dissolve (44 for plates: big flakes read as
paint coming off; small ones read as noise).

## The camera

```js
const c = cam(x, y, zoom, rot);             // looks at page point (x, y)
this.draw(f, layer, stage, xf, c, opts);    // xf: { x, y, ax, ay, scale, rot, flip, sx, sy }
```

- **Parallax:** `opts.par` from 0 (fixed to the screen) to 1 (moves with the page). Plates
  at 0.2–0.6 behind figures at 1 give depth to a pan.
- **Build size:** sampling is nearest-pixel, so it stays crisp. Build a layer at about the
  size it is seen at. A plate for a push-in is built larger (`zoom: 1.2`) and drawn at
  `scale: 1/zoom`.
- **Pivot:** `ax, ay` are the anchor in layer pixels. Figures default to the feet. A fall
  pivots at the waist (`ay: h * 0.55`), or the body swings out of frame.
- **Shake:** `shake(t, hits, amp, decay, rotAmp)` gives `[dx, dy, rot]` from a list of hit
  times; add it to the camera.
- **Zoom punch:** `1 + k * pulse(t, [hitTime], 0.2)`.

## The anime vocabulary (`engine/anime.js`)

Drawn things take a drawing index, `twos(t)`, so they change 12 times a second and boil
like hand-drawn effects. The camera moves on ones (24). That split is most of the anime
feel.

| Technique | Function | Notes |
|---|---|---|
| Focus lines (shuchūsen) | `focusLines(f, W, H, cx, cy, twos(t), o)` | Tapered wedges to a point, clear ellipse in the middle. |
| Speed lines | `speedLines(f, W, H, t, o)` | Horizontal or vertical streaks. Negative speed moves left. Use a band for the ground only. |
| Impact frame | `impact(f, W, H, { mode, light })` | Two tones. Negative, 1–3 frames on the hit. Crimson `light` for the Empire's blows. |
| Flash | `flash(f, W, H, k, colour)` | Dithered, so pixels go over; nothing fades. |
| Smear | `drawSmear(...)` in view.js | Ghosts of the layer behind it along its velocity. |
| Slash | `slash(...)` | The Empire's crimson stroke with spatter, drawn over two frames. |
| Blade glint | `glint(...)` | Runs along a blade and brightens only the steel; a star at the tip. |
| Sparks, splash, dust | `sparks`, `splash` (`colors`) | Deterministic particles born at a time. Steel white, never gold. |
| Ash, motes | `ash` | Wraps around the frame; flips on twos. |
| Paint flakes | `flakes` | Colour sampled from a frame, blown away (the rewind). |
| Glow | `glow` | Gold pixels thinning out by dither. No blending (it muddies at 480×270). |
| The thread | `threadPath`, `wavePts`, `threadSnap`, `threadTunnel` | Draws itself (`p`), snaps with a spring, or becomes a tunnel we rush down. |
| Rim light | `opts.rim` in `drawSprite` | Pixels whose neighbour toward the light is outside the figure. Gold from the thread or the Hollow Sun. |
| Silhouette | `opts.silhouette` | One colour, with rim: a figure against the Hollow Sun. |
| Hollow Sun rays | `hollowSunRays` | Ink rays; with `hollowSun` from fx.js. |

## Transitions

A shot can declare `enter: { kind, dur, ...opts }`. During `dur` the previous shot keeps
drawing (its time runs on), both are drawn into buffers, and the transition combines them.

| Kind | Use |
|---|---|
| `page` | A page turn. `dir: 'back'` turns back (the rewind riffle). The leaf shows its paper back with the ink faintly through it. |
| `ink` | An ink blot from a point (a match cut: Edric's pupil into the fray panels). |
| `burn` | A burning ring from a point, gold-white edge: the Reality Marble move (into the army at first light). |

Also in `transitions.js`: `shatter` (the page cracks from an impact point, gold light
through the cracks, then pieces part and fall onto `under`), and `copyPanel` (a convex
polygon with an ink border: manga panels, split screens).

## Timing on the score

`engine/score.js` has the song as data, so there are no guesses from the audio:

```js
at(33, 3)                        // piece-local time of bar 33, beat 3
local('snare', 43, 44)           // every snare in bar 43, piece-local
pulse(t, [at(29)], 0.2)          // 1 on the crash, decaying
```

The drum patterns come from `tools/music/scores/battle_broken_sun.py` on the music branch.
If the score changes, update `score.js` to match.

## Making a shot

```js
shot('hilt', at(30), at(30, 3), (f, t) => {
  const lt = t - at(30);                                 // shot-local time
  const c = cam(240, 135, 1 + 0.06 * easeOut(lt / 0.8)); // a slow push
  this.draw(f, this.L('hilt'), 0, null, c);              // a plate at full wash
  glint(f, W, H, ...blade, (lt - 0.12) / 0.5);           // a glint down the blade
});
```

1. Add the image to `SRC` and a case in `L()` (plates) or use `this.fig(name, h)` (keyed
   figures) or `this.head(sheet, col, row, cols, rows, h)` (one head from a sheet).
2. Set the in and out times from `at()`. Cut on a crash, a kick or a phrase start.
3. Draw back to front: plate, back ranks, figures, effects, flashes.
4. Look at stills (below) at the start, middle and end of the shot, then at a frame strip.

**Snapshots:** `this.snapshot(name, t)` freezes a shot; `this.snapLayer(name, t)` turns it
into a layer that has paint stages of its own. The rewind pages, the drifting cards in the
hymn, the falls' ghosts and the frozen frame that cracks are all snapshots.

**Scratch buffers:** a shot that composes in passes (panels) uses `this.scratch(name)`,
never the shared `bufs`, because a snapshot can render it while another shot holds those.

## People and the palette

The art bible's ramps have no skin tone, so faces snapped to the olive earth ramp and read
green. `palette.js` adds a skin ramp, but only for pixels a person was drawn on:
`drawSprite` marks them in the frame's alpha (`SKIN_ALPHA`), and `quantise` offers the skin
ramp to those pixels only. So a warm-grey sky never turns peach. Figures are people by
default; mark a plate with `skin: true` when it is a close-up of a face or hands.

## Render and check

```sh
npm run dev   # then open /tools/cutscene/unwritten/  (?piece=again&t=24)
node tools/cutscene/render.mjs --piece again --stills 2.4,8.85,25.8 --out References/cutscene/unwritten/stills
node tools/cutscene/render.mjs --piece again --video References/cutscene/unwritten/again.mp4 --workers 6
```

The full piece renders in about 40 s with 6 workers. The music is a local copy of the
battle track (see [README.md](README.md)).

## What the reference openings taught

Measured frame by frame (Demon Slayer "Gurenge", Fate/Zero "Oath Sign"), with Hologram and
Brave Shine from memory:

- **Cut rhythm:** 98 and 134 shots in 89 s and 127 s; the median shot is 0.21–0.29 s, and
  about 60% of shots are shorter than half a second. But each has 6–7 holds of 3 s or more.
  Density comes from the contrast between bursts and holds.
- **Drawings on twos, camera on ones.** Most motion alternates a changed frame with a held
  one; camera moves change every frame.
- **One accent colour:** Gurenge opens monochrome with only red eyes; Fate/Zero grades
  everything blue with a red lance and gold light. That is our paper-and-gold.
- **Full-frame effects as transitions:** Gurenge's ukiyo-e water carries whole cuts. Ours
  are ink, burning paper and the thread.
- **Impact frames and flashes** mark the hits, 1–3 frames long.
- **A breath after the climax:** Fate/Zero slows to long still landscapes after its peak.
  Ours is the hymn.
- **Lines becoming a solid thing** (Brave Shine's traced swords, Hologram's transmutation
  circles drawing themselves): our paint stages do this to whole shots.
