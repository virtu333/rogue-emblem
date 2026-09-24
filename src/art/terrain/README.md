# Procedural battlefield terrain (`src/art/terrain`)

Runtime renderer for battle terrain, productionized from the terrain study
(`docs/art-direction/board/terrain/`). It paints the whole battlefield from
the map layout — no atlas images — in the approved Ink & Ember palette.

Pure ES modules. There are no Phaser, DOM or Node dependencies in
`index.js` and the modules it imports. Browser helpers live in `canvas.js`,
and the Worker entry is `terrain.worker.js`. It is deterministic: the same
layout, biome and seed give the same pixels. It never calls `Math.random`.

Reviews, captures, metrics and the preview page are in
`docs/art-direction/build/terrain/`. The capture tool is
`tools/art/procedural-terrain/`, which imports this folder, so there is a
single source of truth.

## Sizes and coordinates

| Unit | Size |
|---|---|
| World cell (Grid `TILE_SIZE`) | 32 px |
| Art cell (the renderer's pixel grid) | 24 art px |
| Output cell (`cellPx`, default) | 48 px, i.e. each art pixel is a 2×2 block, the weathered texture size |
| Output image | `cols*cellPx × rows*cellPx` (20×13 → 960×624) |

`cellPx` can be any multiple of 24 (24, 48, 72, 96), and scaling is always
by whole pixels. Draw the output at world size `cols*32 × rows*32`, which is
a scale of `32 / cellPx`. The game's `pixelArt: true` config gives this
nearest filtering.

## API

```js
import {
  renderBattlefieldTerrain, // sync full paint
  createTerrainJob,         // prepare, then step it yourself
  repaintCells,             // mid-battle changes, 3x3 neighbourhoods only
  syncTerrainLayout,        // diff a whole layout and repaint what changed
  disposeTerrain,           // drop repaint buffers when done
  resolveBiome, namesFromLayout, seedFrom,
  OBJECT_LIMITS, PAINTED_TERRAIN, BIOME_NAMES, PALETTE,
} from './art/terrain/index.js';
import {
  paintTerrainCanvasAsync,  // worker first, else time-sliced; resolves {canvas, result}
  paintTerrainCanvas,       // sync, returns {canvas, result}
  repaintTerrainCanvas,     // repaintCells + dirty-rect upload into the canvas
  syncTerrainCanvas,        // syncTerrainLayout + dirty-rect upload
  createShimmerOverlay,     // optional liquid palette cycling
  disposeTerrainWorker,
} from './art/terrain/canvas.js';
```

### Inputs

```js
renderBattlefieldTerrain({
  mapLayout,   // grid.mapLayout: terrain indices [row][col]
  terrainData, // grid.terrainData: data/terrain.json rows (only .name is read)
  // or: names: string[][] of terrain names instead of mapLayout + terrainData
  biome,       // grid.biome; null / unknown -> 'grassland'
  seed,        // number or string; see "Seed" below
  cellPx: 48,
}) // -> { width, height, cellPx, scale, cols, rows, biome, seed,
   //      pixels: Uint8ClampedArray (RGBA), state }
```

It paints every name in `data/terrain.json`, plus `River`. Unknown names
fall back to the biome's open ground. The biomes are `grassland`, `tundra`,
`volcano`, `swamp`, `castle` and `void`.

### Seed

Use a seed that is stable for the battle, so that Resume shows exactly the
same terrain. For example, `seedFrom(`${runSeed}:${nodeId}`)`, or the
battle's own RNG seed captured before any actions. The seed only affects
looks, never gameplay.

### Painting at battle start

```js
const abort = new AbortController(); // abort in scene shutdown
const { canvas, result } = await paintTerrainCanvasAsync(
  { mapLayout: grid.mapLayout, terrainData: grid.terrainData, biome: grid.biome, seed },
  { signal: abort.signal }, // mode: 'auto' | 'worker' | 'sliced', budgetMs: 8
);
```

- **`auto`** paints in one long-lived module Worker. The pixels and repaint
  buffers are transferred back without copying, and the main thread only
  does a `putImageData` (under 3 ms even at 4× throttling). If module
  workers are unavailable, it falls back to **time-sliced** painting on the
  main thread, with at most about `budgetMs` of work per slice between
  yields.
- `result.stats` reports how the paint ran: `{ mode, workMs, wallMs, maxSliceMs? }`.
- The first paint in a session runs cold code (it is slower in the Worker
  too). Later battles reuse the warm worker.
- Show the existing tiles, or the camera background, until the promise
  resolves. It does not block input.

### Wiring into Phaser (for the `BattlefieldArt` entry point)

The simplest integration uses one image under everything. Phaser gives
nearest filtering through `pixelArt: true`.

```js
const key = `battle-terrain-${scene.sys.settings.key}`;
const texture = scene.textures.addCanvas(key, canvas);          // CanvasTexture
const image = scene.add.image(grid.offsetX, grid.offsetY, key)
  .setOrigin(0, 0)
  .setDisplaySize(grid.cols * TILE_SIZE, grid.rows * TILE_SIZE)
  .setDepth(tileDepth);                                          // where tiles draw today
for (const row of grid.tiles) for (const tile of row) tile.setVisible(false);
```

The alternative keeps `BattlefieldLab.paintTerrain`'s shape: slice the
canvas into one 48×48 texture per cell. Take the cell's rectangle
(`cellRect(result, col, row)`) of the **full** canvas. Canopy and cap
overhangs (≤ 2 art px) are already baked into the neighbouring cells'
rectangles, so slicing loses nothing.

Movement, danger and attack highlights, fog, the night light layer
(`BattleLightLayer`), rings and units all draw above the terrain as they do
today. The terrain is a flat, static image, so objects never cover units.

### Mid-battle terrain changes

Every buffer value at a pixel depends only on its cell's 3×3 neighbourhood.
This is enforced by tests. Because of that, a change repaints only the 3×3
neighbourhoods of the changed cells, and the result is bit-identical to a
full repaint.

```js
// after Grid.setTerrainAt / setTemporaryTerrain / clearTemporaryTerrainAt,
// VillageController visits, ballista capture, BattleSnapshotState restore...
const rects = syncTerrainCanvas(canvas, result, grid.mapLayout, grid.terrainData);
if (rects.length) texture.refresh();   // CanvasTexture re-upload (~1 ms)
```

- `repaintTerrainCanvas(canvas, result, [{ col, row }], { mapLayout, terrainData })`
  does the same for known cells. `name` in a cell entry overrides the layout.
- Cost: about 1.5 to 3 ms CPU per changed cell (it repaints 72×72 art px).
  No-op edits cost nothing.
- `syncTerrainCanvas` diffs the whole layout, which costs microseconds. Use
  it after snapshot restores so the terrain can never drift from the grid.
- If a shimmer overlay is running, call `overlay.refresh()` after a repaint.

### Shimmer (optional, cheap)

```js
const overlay = createShimmerOverlay(result, { fps: 8, onFrame: () => shimmerTexture.refresh() });
// null when prefers-reduced-motion is set or nothing on the map animates
if (overlay) {
  const shimmerTexture = scene.textures.addCanvas(`${key}-shimmer`, overlay.canvas);
  scene.add.image(grid.offsetX, grid.offsetY, `${key}-shimmer`).setOrigin(0, 0)
    .setDisplaySize(grid.cols * TILE_SIZE, grid.rows * TILE_SIZE).setDepth(tileDepth + 0.1);
  overlay.start();                      // overlay.stop() on pause/sleep, destroy() on shutdown
}
```

This is SNES-style palette cycling. Water glints, live lava seams and
vents, and acid scum are tagged while painting. Each tick recolours only
those pixels on a transparent overlay at art resolution, which is 480×312
for 20×13 maps.

- Measured cost is under 0.1 ms per frame for up to about 1,500 animated
  pixels, plus a small texture upload at 8 fps.
- The overlay pauses while the document is hidden.
- Pass `reducedMotion: true` to force it off. Do this when the Atmosphere
  setting is Off, and on the Canvas renderer.

### Memory and cleanup

- The output pixels take `4 × width × height` bytes: 2.4 MB for 20×13 at
  48 px.
- The repaint state holds 11 art-resolution buffers of about 150 KB each for
  20×13 (`owner` is 2 bytes per pixel). The noise lattices and per-cell
  object cache add about 1 to 2 MB.
- `disposeTerrain(result)` drops the state. The pixels stay valid, but after
  that `repaintCells` throws. Only dispose if no terrain can change any more.
- In scene shutdown, abort any pending paint, `overlay?.destroy()`, and
  remove the textures. Call `disposeTerrainWorker()` if battles are over for
  good. Otherwise keep the worker, since it is idle and warm.

## Guarantees (tests/ProceduralTerrain.test.js)

- **Determinism.** The same inputs give the same pixels, and there is a
  snapshot hash per biome.
- **Palette purity.** Every pixel is an Ink & Ember ramp colour.
- **Coverage.** Every terrain in `data/terrain.json` renders in every biome.
  Every `mapTemplates.json` template also renders through the real
  `generateBattle`, which covers all six biomes.
- **Owner rule, objects fit their cells.** Every opaque object pixel stays
  within `OBJECT_LIMITS` of its own cell:
  - trees: canopy up to 2 art px on the sides and top, and nothing below the
    cell;
  - peaks: 1 px on the sides and 2 px on top;
  - column capitals: 1 px on top;
  - structures: none.

  Shapes are planned to fit, so the safety clip removes under 4% of any
  sprite. An object below never reaches the lower half of the cell above
  it, where a unit's feet and ring sit.
- **Locality.** Changing one cell changes only its 3×3 neighbourhood, in
  every intermediate buffer. Incremental repaint equals a full render for
  single, clustered, far-apart and edge edits.
- **Borders stay on the grid.** Soft materials drift at most 3 art px off
  the true cell line, which is ≤ 3 CSS px at phone scale.
- **Consistency across paths.** Time-sliced painting equals the sync paint,
  aborting works, and a Worker-packed result repaints like a local one.

## How it works

`pipeline.js` runs region passes over art pixels:

1. `materials`: per-pixel ground material from a box-blurred (radius 5)
   cell indicator plus world-space noise, followed by two 1-px spur
   clean-ups.
2. `edges`: directional distance to a different material class, capped at
   12.
3. `ground`: the painters (open ground, water, sand, ice, lava, swamp, bog,
   flagstones, walls) and the emissive spill from lava.
4. `decals`: clumps, tufts, pebbles, flowers, ripples, reeds, lily pads,
   puddles and bubbles. Every stamp is within 5 px of its origin.
5. `bridges`: decks derived from the cell's own 3×3 neighbourhood.
6. `objects`: wall and object shadows toward the bottom-right, then the
   per-cell sprites, back to front.

The locality budget is 7 + 12 + 5 ≤ 24 art px. A full render runs each pass
over row bands, which makes the time slicing possible. A repaint runs each
pass over the dirty rectangles.

## Limits and follow-ups

- Landmark masks (fort, village, throne, ballista, pillar, bridge ends) are
  hand-pixelled in code. A pixel artist's pass would still add charm.
- The `void` biome only has a palette so far (ink floor and unlight walls).
  Its own material language is future work.
- There is an indexed buffer (`result.state.idx`) with `PALETTE`, so
  per-act grading can be a palette swap. That is not wired yet.
