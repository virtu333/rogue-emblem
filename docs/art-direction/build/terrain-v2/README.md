# Procedural terrain v2: natural variation, "mostly fit"

> Captures in this folder are a curated subset; see [CAPTURES.md](../../CAPTURES.md) for the full sets.

Owner feedback on the first runtime (`../terrain/`): push for more variation and a
more natural feel. The study's mountains (varied, mostly in their squares) were
close to the target; the runtime trees had become uniform 2-4 tree stamps aligned
to every cell. This pass finds the in-between: forests and ranges that follow the
shape of the region the map generator produced, while each object still mostly
reads as belonging to its cell.

Runtime: `src/art/terrain/` (see its README). Everything here is regenerated with

```bash
node tools/art/procedural-terrain/generate.mjs   # -> this folder, lossless WebP (~1 min)
node tools/art/procedural-terrain/bench.mjs      # CPU cost per paint
```

## Files

| File | What it shows |
|---|---|
| `<map>_compare_phone.webp` | Eight maps at exactly 34 px per cell with real units, rings and HP bars: **study** / **previous runtime** / **now** / weathered atlases. Same crop and units in every panel. |
| `fit_closeup.webp` | Objects vs their cells at phone scale, 3x, faint cell grid, units on and next to object cells: study / previous runtime / now. New cases: a scattered wood (edge, strip, lone cells), a range with lone peaks, a swamp wood, a volcanic dead wood with a crater butte. |
| `game/<labMap>_game.webp` | The real game (`?devScene=battle&preset=battle_smoke&seed=42&battleLab=1&labMap=<id>&mobilePreview=1`, 844x390): previous runtime / now, all ten lab maps. |
| `<map>_overlay_phone.webp` | Now, under the movement and stacked danger overlays. |
| `<map>_after.webp` | The 48 px per cell texture the game uploads. |
| `terrain_sheet.webp` | Every terrain type x biome, species and transitions, 2x. |
| `metrics.json` | Readability metrics per map and renderer (study, prev, after, weathered). |
| `prev/` | Previous-runtime renders (commit d9b78f3) used as the "previous runtime" panels. |

## What changed

**Forests** (`trees.js`)
- A context-free *core* per cell: one large tree, a pair or a trio (slim species
  always get company). It alone reads as a stand, so a lone forest cell is a tree
  or a small copse.
- Up to six more well-spaced foot positions per cell (best-of-darts, context-free).
  Whether each grows, how big, and as what, is decided from the 2x2 block of cells
  at its quadrant's corner: interiors grow dense and tall (trunks hidden, 95% of
  positions), edges sparse and lower, open sides lowest. Trees straddle cell
  borders and canopies meet across a shared forest edge, so rows do not line up
  with the grid.
- Species per biome (3+ where sensible): grassland broadleaf (two leaf tones),
  pine, poplar, birch, saplings, shrubs, logs, stumps; tundra pine and fir (varied
  build and tier count, snow on the lit bough edges instead of caps), bare frosted
  birch, sprucelings; volcano dead trees, charred snags, scorched pines, thorn
  scrub; swamp willow, cypress, grey snags; castle gardens broadleaf, poplar,
  birch; void dead trees and snags.
- Leafy crowns: lobes lit from the upper left with a rim light and a world-space
  leaf-clump texture.
- Forest floor: the heart of a wood is in canopy shade (a region field), so gaps
  between crowns read as depth rather than lawn.

**Mountains** (`mountains.js`)
- Context-free massif archetypes: spire, monolith dome (the study's look), leaning
  crag with a ledge, twin summit, flat-topped butte (a glowing crater in the
  volcano); jittered position, height, width, facets, creases and strata.
- Shoulders toward east / west mountain neighbours meet at a saddle keyed by the
  shared border, so a range reads as one ridge line with distinct summits.
- A ridge spine joins a peak to the peak north of it; valleys fill only inside
  2x2 blocks, so a block is one massif and an L-shape keeps ground in its corner.
- Boulders and scree face open ground (below and to the sides).
- Volcano peaks keep their lit faces a step darker than the pale ash ground.

**Columns and structures** (`structures.js`) still fit exactly (capital 1 px up):
intact, cracked (hairline, a chipped capital), broken with a slanted ragged
fracture, or a stump with its fallen drum; fluted or plain; square or stepped
plinth; rubble; ivy and moss in green biomes, snow in the tundra, soot and ember
cracks in the volcano.

**Ground** (`ground.js`, `fields.js`)
- Region fields: the share of forest / water / wall cells around each cell
  corner, interpolated per pixel, continuous across borders and 3x3-local.
- Tufts, stones and flowers are clustered by low-frequency fields (lush and bare
  patches, stony stretches, one-colour flower drifts) at about the old density.
- Footpaths wander from fort and village doors into the cell below.
- Wide water darkens toward the middle; castle floors get sparse hairline-cracked
  stretches and patches of moss / grime / drifted snow at the foot of walls;
  tundra snow and volcanic ash get dashed, wind-shaped drift crests.

## The new fit rule: "mostly fit"

| Object | left / right / top / bottom (art px) | Notes |
|---|---|---|
| trees | 4 / 4 / 4 / 2 | 4 px only toward more forest; **2 px into open ground** (tested), also over a corner into a non-forest diagonal; a trunk foot 1-2 px down |
| peaks | 3 / 3 / 4 / 1 | summits may rise 4 px; scree 1 px down |
| columns | 0 / 0 / 1 / 0 | unchanged |
| structures | 0 / 0 / 0 / 0 | unchanged |

Why these numbers, at phone scale (34 CSS px per cell, 1 art px = 1.42 CSS px):
- 4 art px is 5.7 CSS px, a sixth of a cell. It is enough for canopies to touch
  across a shared forest edge and for summits to break the cell's top line (the
  study's peaks overhung 6-10 px, which the owner flagged), and it never reaches
  the lower half of the cell above, where a unit's feet and ring sit (tested
  for every biome: object pixels reach at most 4 px into the cell above).
- Toward open ground a canopy spills 2 px (2.8 CSS px, the old limit), so a plain
  cell next to a wood still reads as open: objects cover under 10% of any open
  neighbour (tested; p95 in random clustered layouts is about 1%).
- Downward overhang is limited to a trunk foot or a scree stone (1-2 px): terrain
  draws under units, so this never hides one, but it keeps the cell's bottom line
  (where the next row's units stand) clean.
- Shapes are planned to fit, so the safety clip trims nothing for trees and under
  0.2% for peaks (tests allow 4%).

## Locality: how context-aware objects stay 3x3-local

A repaint still recomputes only the 3x3 neighbourhood of a changed cell and is
bit-identical to a full paint. Every object part records which owner-relative
cells its look depends on (`Sprite.setDeps`) and paints, sprite and shadow, only
into cells whose own 3x3 neighbourhood contains all of them. A tree decided from
its cell's north-west 2x2 block may spill north and west only; a shoulder that
depends on the east neighbour may reach into it; the context-free core and massif
may spill anywhere. The object cache now drops the 3x3 neighbourhood of a changed
cell. The existing locality and repaint-equality tests pass unchanged.

## Readability (average of 8 maps, phone scale, CIE L*)

| Renderer | ground L* | micro | edge | edges >= 15 | pop | local |
|---|---|---|---|---|---|---|
| study | 44.0 | 4.53 | 19.1 | 61.8% | 4.24 | 18.0 |
| previous runtime | 51.3 | 5.11 | 23.6 | 73.5% | 4.62 | 24.9 |
| **now** | **51.5** | **5.06** | **23.7** | **73.8%** | **4.68** | **25.2** |
| weathered atlases | 51.6 | 5.86 | 22.3 | 69.9% | 3.93 | 24.2 |

No regression: ground micro-contrast is slightly lower and every separation
measure slightly higher than the previous runtime, despite the richer forests
and ground. Per map (prev -> now): pop river 4.80 -> 4.86, chokepoint 4.98 ->
5.14, castle 4.52 -> 4.47, mire 4.77 -> 5.04, caldera 3.39 -> 3.43, frozen 5.28
-> 5.53, ambush 3.66 -> 3.64, ruins 5.53 -> 5.36. The two small dips (castle,
ruins: cracked paving and wall moss; ambush: denser canopy) are within 0.2 and
still far above the atlases (2.85 / 3.19).

## Performance (Node, process CPU, interleaved A/B, min of 15 runs)

The review container ran at a load average of 7-13 from other sessions; the
interleaved minimums are the robust comparison.

| Map | Full paint prev -> now | Longest work unit (1 row, 1 pass) | Repaint 1 cell (median) |
|---|---|---|---|
| synthetic 20x13, every terrain mixed | 76 -> 93 ms | 3.6 -> 4.6 ms | 3.1 -> 3.6 ms |
| eldritch_sanctum (void) | 27 -> 35 ms | 2.0 -> 2.5 ms | 1.4 -> 2.1 ms |
| act4_boss_intent_bastion (tundra) | 45 -> 61 ms | 2.3 -> 3.7 ms | 1.6 -> 2.1 ms |
| eruption_point (volcano) | 63 -> 76 ms | 3.8 -> 4.6 ms | 2.6 -> 3.6 ms |
| glacier_fortress (tundra) | 52 -> 67 ms | 3.2 -> 4.9 ms | 2.1 -> 4.2 ms |
| river_crossing | 47 -> 52 ms | 2.1 -> 2.6 ms | 2.2 -> 2.5 ms |
| mire_crossing (swamp) | 48 -> 52 ms | 2.0 -> 2.4 ms | 2.1 -> 2.8 ms |
| great_hall (castle) | 23 -> 29 ms | 1.6 -> 2.2 ms | 1.4 -> 2.0 ms |
| forest_ambush (dense woods) | 43 -> 52 ms | 3.0 -> 4.0 ms | 2.2 -> 3.2 ms |

- Full paints cost 10-35% more CPU. They run in the Worker at battle start
  (main thread untouched) or time-sliced; the longest work unit stays under 5 ms
  CPU (about 20 ms on a 4x slower phone), inside the 8 ms slice budget's
  worst-case band measured before (< 30 ms at 4x throttle).
- A mid-battle repaint is 2-4 ms CPU: a change now rebuilds the objects of the
  whole 3x3 neighbourhood, since they depend on each other.
- Kept in check by memoising the rock facets and leaf-clump texture per map (pure
  functions of the pixel, like the noise lattices), a cheaper worley that returns
  the nearest point's offset, squared-distance lobe rejection in crowns, and
  building the per-cell composite sprite only on demand.
- Memory: two extra per-map caches (2 bytes + 1 byte per art pixel, ~0.4 MB for
  20x13), dropped by `disposeTerrain`.

## Iteration log

1. **Dependency-aware parts.** Quadrant-decided trees plus a context-free hero;
   first look: organic but a sparse orchard of small trees.
2. **Density.** Bigger crowns, more positions, hidden trunks in dense interiors,
   feet up to v=19 decided from the north block so crowns can cover the cell's top
   band; tundra snow moved from caps to bough edges. Rows of gaps at cell tops
   shrank.
3. **Mountains.** Archetypes and border-keyed saddles; the first version read as
   low walls; taller, bulkier massifs, then a back fill and valleys (a lattice of
   grass holes, then solid massifs).
4. **Zero clipping, coverage.** Plans shrink until nothing is trimmed; a
   context-free core (single / pair / trio) guarantees cover for lone cells;
   corner spill into non-forest diagonals capped at 2 px. Tests added for fit,
   open ground, cover, variation and ranges.
5. **Phone-scale review vs study and previous runtime.** Canopy pushed toward the
   study's mass (bigger, fewer broad crowns); footpaths recoloured (the first
   ones read as a blood trail); ash dunes and snow drifts broken into faint dashes
   (the first read as contour lines); flower drifts thinned.
6. **Real-game review (10 lab maps).** Vertical ridges read as stacked "pine
   trees" of cones: skirts removed, a ridge spine instead, bulkier profiles;
   valleys only inside 2x2 blocks; wall moss made patchy (it outlined every
   wall); deep water toned down (the 7-wide river went navy); volcano lit rock one
   step darker (peaks vanished into pale ash); cracked paving sparser.
7. **Performance.** Memoised facets and leaf clumps, cheaper crowns: the dense
   forest map went from +65% to +20% CPU over the previous runtime.

## Open questions for the owner

- The overhang numbers (4 px toward more of the same, 2 px into open ground) are
  a proposal; both are single constants (`TREE_OVERHANG`, `MOUNTAIN_OVERHANG`).
- Vertical one-cell mountain columns still read as stacked peaks joined by a
  ridge; the study looked similar. A dedicated "long ridge" archetype for
  north-south chains would be the next step if that bothers you.
- Castle forests remain square garden beds (hard floor edges); a planter kerb or
  softer beds is possible.
- Browser timings were not re-measured on this overloaded container; the Node
  CPU numbers above and the unchanged worker / time-slice paths should carry
  over, but a check on a real phone (`preview.html?bench=1`) is worth doing.
