# Map sprites v2: the pixel budget

Measured 2026-09-24 in the running game (`tools/art/sprite-trace/dev/measure-budget.mjs`,
dev server, Chromium, `?devScene=battle&preset=battle_smoke`, phone cases with
`mobilePreview=1`). This decides the art resolution of the traced sprites.

## What a tile and a sprite occupy today

| Case | Canvas backing | Canvas CSS size | Camera zoom | Canvas px / tile | CSS px / tile | Device px / tile | Device px per canvas px |
|---|---|---|---|---|---|---|---|
| Phone 844×390, DPR 3 | 766×480 | 622×390 | 1.40 | 44.8 | 36.4 | 109.1 | 2.44 |
| Phone 844×390, DPR 1 | 766×480 | 622×390 | 1.40 | 44.8 | 36.4 | 36.4 | 0.81 |
| Phone 667×375, DPR 2 | 570×480 | 445×375 | 1.36 | 43.5 | 34.0 | 68.0 | 1.56 |
| Phone 667×375, DPR 3 | 570×480 | 445×375 | 1.36 | 43.5 | 34.0 | 101.9 | 2.34 |
| Desktop 1280×720, DPR 1 | 640×480 | 960×720 | 1.00 | 32.0 | 48.0 | 48.0 | 1.50 |
| Desktop 1920×1080, DPR 1 | 640×480 | 1440×1080 | 1.00 | 32.0 | 72.0 | 72.0 | 2.25 |
| Desktop 1440×900, DPR 2 | 640×480 | 1200×900 | 1.00 | 32.0 | 60.0 | 120.0 | 3.75 |

A unit is a 64×64 world-px texture centred on its 32 px tile (feet on world row 44),
so a sprite spans 2 tiles of texture and about 34 world px of figure.

Three findings:

1. **The canvas backing store is the bottleneck, not the screen.** The phone battlefield
   is always 480 canvas rows (`BattlefieldLab.resize`), whatever the panel. At the
   tactical zoom a tile is ~44 canvas px, which the browser then stretches 2.3–2.4× with
   `image-rendering: pixelated` to reach ~102–109 device px. Every texel is sampled twice
   by nearest neighbour at non-integer ratios: today's 1-texel-per-world-px sprite pixel is
   1.4 canvas px (1 or 2), then 2.44× (2 or 3 device px), so on a Retina phone one art
   pixel is drawn 2, 3, 4 or 5 device pixels wide. That unevenness, not the art alone, is
   part of why the current sprites look soft and "toylike" at 3×.
2. **Desktop has even less canvas per tile** (32 px at zoom 1), stretched 1.5–3.75×.
3. **The terrain is 24 art px per cell**, doubled to 48 texels per cell
   (`proceduralTerrainRenderer`, `cellPx: 48`). A terrain art pixel is 1.33 world px; the
   current sprite texel (1 world px) is incommensurate with it (a 4:3 mixel ratio).

## Options

"D" = sprite art pixels per world pixel (texture = 64·D px, shown at 64 world px).

| | D = 1 (today's grid) | **D = 1.5 (chosen)** | D = 2 |
|---|---|---|---|
| Texture | 64 px | 96 px | 128 px |
| Figure height (infantry body) | 34 px | 51 px | 68 px |
| Relation to terrain | 4:3, incommensurate | **one sprite px = one terrain texel = ½ terrain art px** (same 48-per-cell lattice) | 8:3, incommensurate |
| Reduction scale from the references (native figures 45–144 px tall) | 0.24–0.64 (median 0.40) | 0.37–0.98 (median 0.60) | 0.50–1.32 (median 0.81; some upscale) |
| Device px per art px, phone DPR 3 (109 px/tile) | 3.4 | 2.27 | 1.7 |
| Device px per art px, phone DPR 2 (68 px/tile) | 2.1 | 1.42 | 1.06 |
| Device px per art px, 720p desktop (48 px/tile) | 1.5 | **1.0 exactly** | 0.75 (undersampled) |
| Sampled without loss at today's backing? | phone yes, desktop yes | phone 93 % (44.8 canvas px for 48 texels), desktop 67 % | no |
| Comparable to the A board's map figures (~36 px tall, ~3 screen px each) | same pixel count, cruder | ~40 % more pixels, same discipline | illustration-like |

Evidence: [`density_dpr3.webp`](density_dpr3.webp) shows the same traced figures at D = 1,
1.5 and 2 next to today's rebuilt texture, each sampled the way a DPR 3 phone shows a
64-world-px texture window (218 device px, nearest).

- **D = 1** keeps the chunky look but forces a 2.5–4× reduction of the references. Faces
  collapse to 1–2 px, straps and trims turn into confetti, and no cleanup pass can put back
  what the grid cannot hold. This is the current budget and the root of the "toylike" read.
- **D = 2** traces most beautifully (near 1:1 with several references), but its pixels
  are finer than a 720p desktop can show (0.75 device px each), it is incommensurate with the
  terrain, and at 1.7 device px per pixel on phones it reads as a small illustration, not
  as pixel art.
- **D = 1.5** is the only density that sits on the terrain's own lattice (a sprite pixel is
  one terrain texel, exactly half a terrain art pixel, so there are no fractional mixels),
  maps 1:1 onto a 720p desktop, and gives ~2.3 device px per pixel on a Retina phone: fine
  enough for faces with eyes, hands, gold thread and weapon lines, coarse enough to stay
  pixel art. The references reduce by ~0.6, which the tracer can do well.

## Decision

1. **Sprite art density D = 1.5**: 96×96 textures displayed at 64×64 world px, so every
   tile-centre, HP-bar, faction-ring, acted-tint and rewind path is unchanged. The sizing
   rules scale with D: feet on texture row 66 (lowest opaque row 65 = world row 44), per-kind
   bounds ×1.5 (infantry body 51 px, max 57 wide; mage 45; heavy 54; mounted 60×69; flyer
   51×60; thief crouch 41), scale fitted to the body so weapons overhang instead of
   shrinking the wielder (`tools/art/sprite-trace/lib/place.mjs`).
2. **Raise the phone canvas backing to device pixels** before shipping D = 1.5
   (dev flag today: `?renderScale=device`, `BattlefieldLab.battleRenderScale`). The
   backing becomes CSS height × DPR (1170 rows on an 844×390 @3× phone), the world camera
   zoom and the pinned UI camera scale by the same factor, and the browser no longer
   stretches the canvas (measured 1.00 device px per canvas px). Without it, D = 1.5 on a
   phone at the tactical zoom samples 44.8 canvas px per 48 texels and drops ~7 % of pixel
   rows; with it, each sprite pixel is drawn once at 2.27 device px. Compare the second and
   third rows of each [`ingame/`](ingame) capture.
3. **Desktop** needs the same change in its (non-lab) path: a 640×480 canvas at zoom 1 has
   32 canvas px per tile, so D = 1.5 art is sampled at 67 % there today. Raising the desktop
   backing by the window's device-pixel ratio to the design size (for example 960×720 on a
   720p window) fixes it. It is not implemented in this study: the desktop HUD and menus
   are Phaser objects laid out in 640×480 space, and moving them onto a scaled UI camera is
   its own change.
4. Later: snapping the tactical zoom so a tile is an integer number of device pixels per
   sprite pixel (for example 96 device px per tile = 2 px per sprite pixel on DPR 3) would
   remove the remaining 2/3 px alternation. The gain is small next to steps 1–2.

## Costs and risks

- **Fill rate.** A device-resolution phone canvas is ~2.2 Mpx instead of 0.37 Mpx (×5.9).
  2D sprite batches are cheap, but the WebGL atmosphere post-process (`AtmosphereFX`)
  scales with it; the Art Bible already defaults Atmosphere to Reduced on phones. Cap the
  backing at DPR 3 (as the flag does) and consider 2× on thermally constrained devices.
- **Pinned Phaser UI** on the phone battle (rare; the HUD is DOM) is magnified by the UI
  camera. Objects positioned from `cameras.main.width/height` would need the logical size.
  The flag is dev-only until that audit is done.
- **Texture memory.** The traced atlas is 1728×1920 (13 MB of RGBA once uploaded). The
  runtime copies each sprite into its own strip canvas (another ~13 MB); production should
  cut frames straight from the atlas texture instead.
- **Overview zoom.** Below zoom 1 every density is undersampled by nearest sampling; the
  map overview shimmers today and will with traced sprites too.

## Reproduce

```bash
npx vite --port 3302 --strictPort --host 127.0.0.1 &
node tools/art/sprite-trace/dev/measure-budget.mjs                      # the table above
node tools/art/sprite-trace/dev/measure-budget.mjs http://127.0.0.1:3302 '&renderScale=device'
node tools/art/sprite-trace/review.mjs --only density                   # density_dpr3.webp
```

With `&renderScale=device` the phone rows read: 844×390 @3 → canvas 1866×1170, 109.2
canvas px per tile, 1.00 device px per canvas px; 667×375 @2 → 890×750, 68.0; 667×375 @3 →
1335×1125, 102.0.
