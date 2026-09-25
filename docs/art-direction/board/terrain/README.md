# Procedural terrain study

> Captures in this folder are a curated subset; see [CAPTURES.md](../../CAPTURES.md) for the full sets.

> **Productionized.** The runtime renderer now lives in `src/art/terrain/`, which includes the
> owner fixes: objects fit their cells, the ground is quieter and lighter, the wetland is
> reworked, peaks are faceted, and borders are tighter. `tools/art/procedural-terrain/generate.mjs`
> imports it and writes to `docs/art-direction/build/terrain/`. That folder has before/after
> captures, metrics, perf numbers and a preview page. The images in this folder are the frozen
> study record; the commands below describe the study as it was.

**Question:** should battle terrain move from the AI-generated weathered atlases (`assets/terrain/weathered/*.png`) to terrain painted procedurally in code?

**What this is:** a working generator that paints all 19 terrain types, with no atlas images. It renders six real layouts from the game's own `MapGenerator` next to the same layouts drawn by the current atlas renderer. It is a static art study. The game code is untouched.

## Run it

```bash
node tools/art/procedural-terrain/generate.mjs              # everything -> this folder (~6 s)
node tools/art/procedural-terrain/generate.mjs --maps river,castle --out /tmp/x
node tools/art/procedural-terrain/generate.mjs --phone-mode nearest   # alt phone resample
#   --no-weathered   skip the atlas comparison     --no-sheet   skip terrain_sheet.png
```

Requires only `sharp` (already in node_modules). The output is deterministic: the same seeds give the same pixels.

## Files in this folder

| File | What it shows |
|---|---|
| `<map>_procedural.png` | Whole map, 48 px per cell (the weathered texture size) |
| `<map>_phone.png` | 16×10-cell crop at **exactly 34 px per cell**, with real unit sprites, faction rings and HP bars |
| `<map>_weathered.png` | The **same layout** drawn by the game's real `drawWeatheredTile()` + `softenGrassTexture` (mobile path), 48 px per cell |
| `<map>_weathered_phone.png` | The same crop and units, weathered |
| `<map>_compare_phone.png` | Procedural and weathered side by side at phone scale. **Start here.** |
| `terrain_sheet.png` | All 19 types × 3 in-context variants plus an isolated instance, and 7 transition studies (shore corners and island, river bend with both bridge orientations, castle room with wall faces, forest canopy cluster and mountain range, swamp/bog/acid blending, lava edge, ice on snow). Shown at 2× |

Maps come from `generateBattle()` with fixed seeds and templates:

| Key | Template | Act | Biome | What it exercises |
|---|---|---|---|---|
| river | river_crossing (+village) | act3 | grassland | water, bridges, sand, fort, village, ballista |
| chokepoint | chokepoint | act3 | grassland | walls on grass, mountains |
| castle | great_hall | act3 | castle | floor, walls, pillars, forts |
| mire | mire_crossing | act3 | swamp | swamp, bog, acidic swamp and bog |
| caldera | caldera | act4 | volcano | lava crack, basalt mountains |
| frozen | glacier_fortress | act4 | tundra | ice, snow, pines, walls |

## How it works

The code is in `tools/art/procedural-terrain/`: `generate.mjs` plus `lib/`.

- **Art grid.** Each cell is 24 art px, upscaled 2× to 48 px, so every art pixel is a clean 2×2 block. That is GBA/SNES density and matches the unit sprites (48 px texture on a 32 px tile). One-pixel detail at 48 px turned to mush at phone scale.
- **Palette-pure.** The buffer stores palette indices, not RGB (`lib/palette.mjs`). It uses the brief's 8 ramps plus a few added hue-shifted ramps: `meadow`, `foliage`, `soil`, `rock`, `snow`, `ash`, `acid`. Shading steps along a ramp: shadows go cooler, toward violet, and highlights go warmer. Nothing is multiplied in RGB, so nothing can leave the palette. The same indexing makes SNES-style palette-cycling animation almost free (see below).
- **Passes** (`lib/render.mjs`):
  1. **Materials.** Each pixel's ground material comes from box-blurred cell indicators plus world-space noise. Corners round, borders wobble, and hard materials (floor, wall) keep exact squares. Borders stay within about ±3–5 art px of the cell line, so which cell is which terrain stays readable.
  2. **Edge distances.** Directional distance to a different material *class*. Swamp and acid swamp count as one water, so no bank is drawn between them.
  3. **Ground painters.** Low-frequency value patches, shores (north bank earth face and its shadow, a dark lip on the west bank, broken foam on south and east shores), a deep channel, horizontal water sheen, sand ripples, ice gleams and a partial crack network, lava crust plates with live seams, murky swamp with algae and acid scum, mud, and running-bond flagstones with half-step mortar. Walls get a rampart top, crenellated parapets on exposed edges, and a brick face on south-exposed edges.
  4. **Decals.** Lit clumps, relative-value tufts, rare stones and flowers, reeds, lily pads, puddles, acid bubbles.
  5. **Bridges.** Decks follow the game's own orientation rule. Rails appear only on outer edges, spans merge, and each deck casts a shadow onto the water.
  6. **Shadows.** A low sun from the upper-left. Every tall sprite projects its silhouette toward the bottom-right, and walls cast a band below the face plus a slanted shadow to the east. Each shadow darkens by one ramp step, which gives the soft contact shadows on neighbouring cells.
  7. **Objects** (`lib/objects.mjs`), painted back to front:
     - **Forest.** Trees sit on jittered points, and each crown is a clump-shaded blob, so crowns overlap into one canopy across forest cells.
     - **Mountains.** A real heightfield (lobed cones and ridged crests) rendered front to back per column like voxel terrain. The result is slope-lit facets, dark occlusion lines where a near peak overlaps a far one, and ranges that merge across cells with tapered feet.
     - **Structures.** Fort, village, ballista and throne are hand-authored pixel masks, shaded and varied per cell: roof material, whether the window is lit at dusk, and which side the clutter sits on. The pillar uses a cylinder shading ramp and is sometimes broken.
- **Locality.** Every pass reads only the cell, its 8 neighbours, and world-space hash noise. Any cell or region can be repainted alone and still match its neighbours, with no seams.
- **Weathered comparison** (`lib/weathered.mjs`). A small Canvas2D shim (drawImage, fillRect, rect clip, translate/rotate) runs the game's actual `drawWeatheredTile()` from `src/ui/WeatheredTerrain.js`. `softenGrassTexture` is re-stated because its module reads `import.meta.env`. Sampling is nearest-neighbour, as in the game, which sets `imageSmoothingEnabled = false`.
- **Phone previews** (`lib/phone.mjs`). **Resampling is an exact area-average from the 48 px render to 34 px.** A 3× DPR phone shows about 4 device px per art pixel, so the image is effectively filtered, not dropped. Nearest-neighbour (`--phone-mode nearest`) looks a touch crisper but makes plank and merlon widths uneven, because it drops every third row. The staging mirrors `BattleScene.addUnitGraphic` with the BattlefieldLab sizing:
  - rings are 24×12 world px, 6 px below the tile centre, with a 2 px stroke at 0.7 alpha, in `#3366cc` or `#cc3333`
  - sprites are scaled to 1.15 tiles tall
  - HP bars are 26×3
  - units stand on the generator's real player and enemy spawns

## Iteration log (condensed)

1. **First pass.** Grass tufts read as wallpaper stamps. Grass was too saturated. The forest-floor tone gave the cells away as squares. Crowns were separate balls. Water was navy with "starry" dot ripples.
2. **Tufts, grass and canopy.** Tufts changed to relative values, grass muted, forest floor set equal to grass, crowns enlarged into a canopy. Critique: the grass patches looked like camouflage, water reflections looked like puddles, banks looked like torn paper.
3. **Water, pines, stones, all biomes.** Longer-period noise on liquids, horizontal sheen, no stray pines, quieter stones. The first look at every biome showed four problems:
   - mountains were **pyramids**
   - swamp was a checkerboard with neon-lime acid
   - lava was a glowing honeycomb
   - wall tops had the same value as their faces
4. **Heightfield mountains.** These first read as shark fins. Swamp got wider wobble. Lava became crust with *some* live seams. Ice was calmed and the meadow ramp added.
5. **Mountain shape and rock colour.** Broader, lower massifs with spur ridges and a continuous violet-to-tan rock ramp. Mountains finally read as ranges.
6. **Swamp, floor, walls, snow, ice, mountain feet.**
   - Class-based edges: no banks inside swamp water, and no lime rim on acid cells.
   - Half-step floor mortar; wall joints separated from wall tones.
   - Snow drifts stretched by wind; paler ice.
   - Tapered mountain feet.
7. **Castle floor and mountain outline.** Warm taupe flagstones against cool slate walls, so hue *and* value separate open floor from blocking wall. Removed the dashed outline around mountain feet.
8. **Structures.** Hand-authored masks for village, throne and ballista. Before, they read as a barrel, a tombstone and a blob. The throne was placed onto its dais.
9. **Water and grass value.** Water sheen became row ripples instead of checker dither, and the deep channel now appears only mid-river. Grass went up one value step, the castle floor got quieter, lava vents got rarer, and willow highlights became less yellow.

## Honest assessment at phone scale (vs the weathered atlases)

**Better:**
- **No checkerboard.** Shorelines, canopies, mountain ranges, marsh edges and lava fields cross cell lines. The atlas version is visibly a grid of stamps: every weathered water, swamp or lava cell is a square, and plain tiles show seams.
- **One light, one palette.** Every bottom-right shadow agrees, and every colour comes from one hue-shifted palette. The AI atlases mix lighting directions and pixel densities.
- **Terrain categories separate more clearly.** Walls read as three planes (paving, rampart, face) and pillars read as columns. The atlas castle's rubble icons and its pale walls blend into its floor.
- **Hazards get their own materials.** Lava is crust with seams, acid is glowing scum on murky water, and ice is pale and cracked. They are distinct without being grimdark.
- **Biomes differ by material and shape, not tint:** pines on snow, basalt crags, willows, warm stone halls.
- **Cheap to generate.** About 0.1–0.3 s per 18×13 map in single-threaded Node, with zero image downloads.

**Worse or unresolved:**
- **Ground value is darker and busier than the weathered path.** The weathered mobile path's softened, pale, flat ground makes dark unit sprites pop more. In `mire` and `caldera` especially, units sit on busier ground. Faction rings are weak on *both* renderers; that is a ring-design problem, not a terrain one.
- **Mire is still the weakest map.** It reads organic but busy. Swamp, bog and acid types adjacent cell-by-cell produce a patchwork that no amount of edge blending fully hides.
- **Landmark icons are functional but plain.** Village, fort, throne and ballista read clearly but are smaller and less charming than the AI-painted fort and house. Hand-pixelled masks this small need a real pixel artist's pass.
- **Rendering artefacts:**
  - Front slopes of mountains show vertical column streaks from the voxel fill.
  - Wide water is a fairly dark navy.
  - Each biome has one tree species.
  - There is no animation yet.
  - The `void` biome (final boss) is only a basic stone palette.
- **Gameplay honesty is traded for organics.** Organic borders wobble ±3–5 art px (about 12–20% of a cell) off the true cell line. That is fine with the grid, movement and danger overlays on, but it should be play-tested.

## What productionizing would take

1. **Runtime renderer.**
   - Move `lib/{palette,noise,biomes,render,objects}.mjs` into `src/` as pure ES modules; they already have no Node dependencies except `image.mjs`.
   - Bake the map once at battle start into one indexed buffer, then one `CanvasTexture`. Slice it into the existing per-cell tile textures so `BattlefieldLab.paintTerrain` keeps its shape, or draw it as one image under the units. Crowns and peaks may overhang the cell above, and units still draw on top.
   - Budget: under 300 ms for the largest map. Use a Web Worker if needed.
   - Layouts that change mid-battle (captured ballista, visited village, toxic spread) repaint only the affected 3×3 region, which works because every pass is local.
2. **Tests.** Determinism snapshots (a hash of the index buffer per template and seed), a performance budget, and a check that every terrain in `data/terrain.json` has a painter.
3. **Biome variants.**
   - Tundra, volcano, castle and swamp exist.
   - Void needs its own material language: unlight-lit floor seams and dissolving walls, without skulls or runes.
   - Next: more tree species per biome, and act-based "later acts darker" grading done as a palette swap, which the indexed buffer makes a one-line change.
4. **Animation.** Palette cycling SNES-style: water sheen rows cycle `steel` 2↔3, lava vents and seams pulse through `ember` 3→5, acid bubbles blink, and swamp reeds get a 2-frame sway. Because output is indexed, this can be a per-frame palette LUT in a Phaser pipeline or shader, with no re-rendering.
5. **Readability work (independent of terrain).**
   - Keep the ground one value step lighter than the canopy (done for grassland).
   - Consider a per-biome "actor lift", since swamp and volcano grounds are the dark ones.
   - Thicker or darker-backed faction rings.
   - Validate acted-tint, danger and fog overlays over the new ground.
6. **Art pass.** Have a pixel artist refine the ~6 landmark masks (fort, village, throne, ballista, pillar, bridge ends) and the tree and crown shading. The procedural ground, shores, canopy, mountains and hazards are where the approach clearly wins. The icons are where hand work still pays.
