# Procedural terrain — production build review

This is the productionized version of the terrain study in `../../board/terrain/`,
which the owner approved with fixes. The runtime renderer is `src/art/terrain/`.
Its integration contract is in `src/art/terrain/README.md`.

Everything here is regenerated with:

```bash
node tools/art/procedural-terrain/generate.mjs   # captures + metrics.json (~1 min)
node tools/art/procedural-terrain/bench.mjs      # CPU cost per paint
npm run dev -- --port 3204                       # then open the preview page:
#   http://127.0.0.1:3204/docs/art-direction/build/terrain/preview.html
#   (?template=mire_crossing&seed=2   ?bench=1 runs the browser benchmark)
```

## Start here

| File | What it shows |
|---|---|
| `<map>_compare_phone.png` | Three panels at **exactly 34 px per cell**: the study (before), the runtime renderer (after), and the current weathered atlases. The crop, the real unit sprites, the faction rings and the HP bars are identical in all three. |
| `fit_closeup.png` | The owner fix. Forest, columns, peaks, structures, tundra pines and a throne room, before and after, with a faint cell grid. Units stand on and next to the object cells. Shown at 3×. |
| `<map>_overlay_phone.png` | The after panel with the game's movement overlay (`#3366cc` @ 0.4) and the stacked danger overlay (`#e8a44a` @ 0.18 / 0.30 / 0.42), to check that cells still read under overlays. |
| `<map>_after.png` | The full map at 48 px per cell, which is the texture the game would upload. |
| `terrain_sheet.png` | Every terrain type × 3 in-context variants plus an isolated instance, the biome species, and seven transition studies. Shown at 2×. |
| `preview.html` / `preview.js` | The dev-only review page. It generates real battles in the browser (seeded `generateBattle`, every template) with sprites, rings, HP bars, danger and movement overlays, grid, shimmer and a phone-scale option, next to the weathered atlases. Click a cell to change its terrain, which exercises `repaintCells`. It also has the benchmark button. |
| `preview_mire.png`, `preview_sanctum.png` | Screenshots of the preview page in Chromium. The sanctum is the final boss arena, in the void biome. |
| `metrics.json` | The readability metrics below, per map and renderer. |
| `before/` | The before panels. The six study maps are copied from `../../board/terrain/*_procedural.png`. `ambush`, `ruins` and `closeup_*` were rendered once by the study renderer from before this change. |

The maps are six study layouts (river, chokepoint, castle, mire, caldera and
frozen) plus two production checks: **ambush**, which is `forest_ambush` with
dense woods, and **ruins**, which is `castle_ruins` with pillars and broken
walls.

## Owner feedback: what changed

- **Trees and columns fit their squares.**
  - Every object belongs to one cell and is built only from that cell.
  - Trees are dense 3–5 crown groves, planned to fit and shifted into the
    cell. Canopy may spill at most 2 art px on the sides and top (≈ 3 CSS px
    at phone scale), and never below the cell.
  - Columns stand on a plinth inside the cell, with at most a 1 px capital.
  - Peaks use at most 1 px on the sides and 2 px on top. Fort, village,
    throne and ballista stay fully inside the cell. The fort's banner now
    stays inside it; in the study it poked 6 px into the cell above.
  - All of this is enforced by a test (`OBJECT_LIMITS`). The safety clip
    trims under 4% of any sprite, so shapes are not chopped.
  - An object never reaches the lower half of the cell above it, where a
    unit's feet and ring are.
- **Units pop.** The ground is lighter and quieter per biome:
  - grass is one meadow step up;
  - volcanic ash is one step up;
  - castle flagstones vary lighter rather than darker, and the void floor is
    one step up;
  - decals are sparser (clumps 62% → 30%, tufts 40% → 26%).

  See the metrics below.
- **Swamp patchwork.** Swamp and bog now share one olive "marsh" family, and
  bog is brown mud without the crack network, which read as paving. Swamp
  reads as water: horizontal glints, a dark north and west bank line, and a
  mud lip on the lit side. Acid scum is sparser. Swamp and bog stay distinct
  because gameplay needs it: cavalry cannot enter swamp.
- **Vertical streaks on mountains are gone.** Peaks are now faceted:
  Voronoi rock plates with their own tilt, lit on the west face and shaded
  on the east, with creases, spurs, strata ticks and jagged crag
  silhouettes. The voxel columns have been replaced. Mountain cells stand on
  open ground, so no scree squares show through.
- **Wide water is no longer navy.** A new teal-slate `tide` ramp replaces
  steel for open water, and ice is paler.
- **Second tree species per biome:**
  - grassland: broadleaf + poplar;
  - tundra: pine + snow-laden fir;
  - volcano: dead tree + charred snag with ember cracks;
  - swamp: willow + bald cypress;
  - castle: broadleaf + poplar;
  - void: dead tree + snag.
- **Landmarks:**
  - The throne is redrawn as a gilt high back with the Hollow Sun, a low
    two-step dais and a carpet.
  - The fort is compact and its banner stays inside the cell.
  - The village is a 3/4-view cottage with a chimney, a warm window and a
    flower box.
  - The ballista has a heavier stock and bow arms on a wheeled carriage.
  - Bridges have rails with posts, and end beams where they land on a bank.
- **Borders stay on the grid.** Organic borders drift at most 3 art px off
  the true cell line, which is ≤ 3 CSS px at 34 px per cell. The study
  allowed ±3–5 px. This is enforced by a test, and the overlay captures show
  that movement and danger squares still map cleanly onto cells.

## Readability metrics (phone scale, same crop and units for every renderer)

All values are CIE L*.

| Metric | Meaning |
|---|---|
| **ground L\*** | Mean terrain lightness. |
| **micro** | Ground micro-contrast: the RMS of L* minus its 5×5 box mean. Lower means quieter. |
| **edge** | Mean \|ΔL*\| across unit silhouettes, comparing a sprite pixel with the terrain pixel just outside it. |
| **edges ≥ 15** | The share of silhouette pairs that are clearly visible. |
| **pop** | edge / micro. |
| **local** | \|L*(sprite) − L*(ground in the unit's 3×3 cells)\|. |

| Renderer (average of 8 maps) | ground L* | micro | edge | edges ≥ 15 | pop | local |
|---|---|---|---|---|---|---|
| before (study) | 44.0 | 4.53 | 19.1 | 61.8% | 4.24 | 18.0 |
| **after (runtime)** | **51.3** | 5.11 | **23.6** | **73.5%** | **4.62** | **24.9** |
| weathered atlases | 51.6 | 5.94 | 22.2 | 70.5% | 3.89 | 24.3 |

On average the runtime **beats the weathered atlases on every unit-separation
measure** (edge, visible edges, pop, local) with **less ground micro-contrast**,
and it closes the study's lightness gap (+7.3 L*).

Per map, after vs weathered:

- **Better:** river, chokepoint, mire, caldera (edge and local), frozen and
  ruins (pop).
- **Roughly equal:** ambush. Its forest canopy raises micro-contrast, and pop
  is 3.66 vs 3.69.
- **Behind on local contrast:** castle and ruins. The atlas floor is
  brighter, L* 59 vs 53–56, but it is also much busier: micro 8.8 vs 5.5,
  and pop 2.8 vs 4.5.

| Map | Renderer | ground L* | micro | edge | edges ≥ 15 | pop | local |
|---|---|---|---|---|---|---|---|
| river | before / after / weathered | 43.7 / 49.7 / 48.2 | 4.1 / 4.8 / 4.6 | 20.2 / 22.9 / 21.2 | 72 / 79 / 77% | 4.88 / 4.80 / 4.58 | 18.7 / 22.6 / 21.6 |
| chokepoint | | 45.9 / 48.8 / 53.1 | 4.3 / 5.0 / 5.1 | 21.6 / 24.8 / 22.2 | 77 / 80 / 78% | 4.98 / 4.98 / 4.32 | 21.1 / 24.4 / 23.4 |
| castle | | 44.9 / 53.2 / 59.5 | 4.7 / 5.5 / 8.8 | 20.1 / 24.8 / 24.4 | 69 / 78 / 73% | 4.31 / 4.52 / 2.78 | 17.3 / 26.5 / 29.7 |
| mire | | 36.7 / 45.9 / 43.9 | 3.6 / 4.1 / 4.5 | 14.9 / 19.6 / 20.0 | 43 / 67 / 66% | 4.11 / 4.77 / 4.49 | 11.0 / 18.9 / 18.9 |
| caldera | | 28.6 / 37.6 / 36.8 | 5.0 / 4.8 / 4.0 | 11.6 / 16.2 / 14.4 | 25 / 52 / 47% | 2.32 / 3.39 / 3.55 | 5.6 / 13.8 / 11.7 |
| frozen | | 60.3 / 69.8 / 64.4 | 5.9 / 6.3 / 6.2 | 26.8 / 33.1 / 28.9 | 81 / 86 / 77% | 4.53 / 5.28 / 4.66 | 32.0 / 40.3 / 36.6 |
| ambush | | 46.5 / 49.0 / 48.0 | 4.3 / 5.6 / 5.4 | 18.8 / 20.5 / 19.8 | 64 / 66 / 64% | 4.38 / 3.66 / 3.69 | 20.8 / 24.1 / 22.8 |
| ruins | | 45.4 / 56.3 / 59.2 | 4.3 / 4.8 / 8.9 | 18.9 / 26.8 / 26.8 | 64 / 82 / 82% | 4.43 / 5.53 / 3.03 | 17.7 / 28.4 / 29.8 |

## Performance

### Node, process CPU time

This measurement is robust on the shared review machine. Run it with
`bench.mjs`; each value is the median of 7 runs. A work unit is one pass
over one row of cells, which is the granularity of the time-sliced painter.

| Map | Size | Full paint | Longest work unit | Repaint, 1 cell |
|---|---|---|---|---|
| Synthetic worst case: every terrain type mixed | 20×13 | 105 ms | 8.7 ms | 3.2 ms |
| `act4_boss_intent_bastion` (tundra) | 18×13 | 95 ms | 8.6 ms | 2.3 ms |
| `eruption_point` (volcano) | 18×13 | 81 ms | 6.1 ms | 2.8 ms |
| `glacier_fortress` (tundra) | 18×13 | 67 ms | 4.2 ms | 2.6 ms |
| `mire_crossing` (swamp) | 18×12 | 75 ms | 4.3 ms | 2.8 ms |
| `river_crossing` | 18×12 | 62 ms | 3.7 ms | 2.5 ms |
| `eldritch_sanctum` (void, final boss) | 16×14 | 37 ms | 3.0 ms | 1.6 ms |
| `great_hall` (castle) | 18×12 | 35 ms | 3.2 ms | 1.7 ms |

### Chromium, headless

These come from `preview.html?bench=1`. The review container has 4 cores
running at a load average of **30–46** from other sessions, so wall-clock
samples include time given to other processes. Treat them as **upper
bounds**: the minimums are the better estimate, and the medians show the
noise.

| Case | Sync full paint (min / median) | Sliced paint (8 ms budget): longest slice | Sliced wall | Warm worker wall (main thread free) | Upload | Repaint 1 cell (median) | Shimmer frame |
|---|---|---|---|---|---|---|---|
| 1×, synthetic 20×13 | 319 / 886 ms | 19.6 ms | 225 ms | 358 ms | 1.3 ms | 5.1 ms | 0.1 ms (1,215 px) |
| 1×, act 4 boss 18×13 | 109 / 234 ms | 11.7 ms | 103 ms | 297 ms | 0.2 ms | 13.8 ms | < 0.1 ms |
| 1×, volcano 18×13 | 188 / 275 ms | 14.5 ms | 159 ms | 131 ms | 1.2 ms | 3.3 ms | 0.1 ms (1,468 px) |
| 1×, river 18×12 | 114 / 186 ms | 12.2 ms | 88 ms | 186 ms | 0.3 ms | 3.9 ms | < 0.1 ms (931 px) |
| **4× CPU throttle** (phone proxy), synthetic 20×13 | 259 / 1006 ms | **26.6 ms** | 190 ms | 408 ms¹ | 3.8 ms | 11.2 ms | 0.1 ms |
| 4×, act 4 boss 18×13 | 247 / 840 ms | **26.7 ms** | 204 ms | 1143 ms¹ | 0.3 ms | 41.5 ms | < 0.1 ms |
| 4×, volcano 18×13 | 428 / 768 ms | **64.2 ms** (p95 27.9 ms) | 716 ms | 642 ms¹ | 0.3 ms | 3.4 ms | 0.1 ms |
| 4×, river 18×12 | 88 / 133 ms | **13.3 ms** | 102 ms | 556 ms¹ | 0.3 ms | 13.6 ms | < 0.1 ms |

¹ CDP CPU throttling applies to the page thread only, not to workers.

**Conclusions for phones:**

- **Never paint synchronously at battle start.** A full paint costs about
  35–105 ms of CPU on desktop, so 150–450 ms on a phone.
- **The time-sliced path meets the target.** Its longest slice stays under
  about 30 ms at 4× throttling, apart from one scheduler outlier under this
  load, against a target of < 50 ms per chunk. Any single work unit is
  ≤ 9 ms of CPU (≈ 35 ms on a 4× slower device). The whole map is ready in
  about 0.2–0.7 s of wall time while input stays live.
- **The worker path takes the work off the main thread entirely.** What is
  left there is the `putImageData` upload, ≤ 4 ms. It is the default
  (`mode: 'auto'`). The first paint in a session runs cold code; the worker
  is kept alive, so later battles are warm. After a worker paint, the
  main-thread renderer is warmed in idle time, so the first mid-battle
  repaint does not hitch.
- **Repaints are cheap.** A mid-battle terrain change repaints a 3×3
  neighbourhood in about 2–3 ms of CPU, bit-identical to a full paint.
- **Shimmer costs less than 0.1 ms per frame** for up to about 1,500
  animated pixels at 8 fps, plus a small texture upload. It is off under
  reduced motion.
- **Memory is about 7.4 MB of JS for a 20×13 battle:**
  - 2.4 MB of RGBA output;
  - 1.8 MB of repaint buffers;
  - about 3 MB of memoised noise lattices, whose rows are filled lazily;
  - 0.15 MB of cell objects.

  `disposeTerrain()` frees everything except the pixels.

## Iteration log (this pass)

1. **Port to `src/art/terrain` as region passes.**
   - There is a strict 3×3 locality budget. Objects are per cell,
     shadows fall only on the E, S and SE neighbours, and bridge decks are
     derived from the cell's own 3×3 neighbourhood.
   - A first look showed that the trees now fit but read as sparse
     orchards. Peaks were small tents, and mountain cells showed tan scree
     squares.
2. **Denser groves, bulkier peaks, open ground under mountains.**
   - Trees got 5-crown groves with shift-to-fit.
   - Peaks got Voronoi facets and crag silhouettes. They now read as rock
     and fit their cells.
3. **Speed.** Memoised noise lattices, a cached flagstone layout and an
   allocation-free worley roughly halved the ground pass and cut garbage
   collection. The profiled total went from about 175 ms (wall clock) to
   about 56 ms of CPU per map.
   Tests went green: locality over every buffer, repaint equality,
   containment and border drift.
4. **Wetland, throne, ballista.**
   - Swamp became readable water pools and bog brown mud, the throne was
     redesigned and the ballista given mass.
   - The metrics then showed caldera and castle behind the atlases on
     separation, so ash and flagstones went up a step and the void floor
     up a step. After that, every average separation metric beats the
     atlases.

## Open issues

- The castle and ruins floors are still darker than the weathered atlas
  floor (L* 53–56 vs 59), so unit-vs-local contrast is a little lower
  there, although pop is much higher. Another floor step would trade away
  some of the dusk mood; that is the owner's call.
- The `void` biome only has a palette so far (ink flagstones and unlight
  merlons). It needs its own material language.
- The landmark masks and tree shading are code-pixelled. A pixel artist's
  pass would still add charm, especially to the fort and the ballista.
- The browser numbers were measured on an overloaded shared container.
  Re-run `preview.html?bench=1` on a real phone, and check comfort in the
  native simulator, once wired.
- Wiring into the game (`BattlefieldArt`) is intentionally not done here.
  `src/art/terrain/README.md` describes the seam. The study's per-act
  palette-swap grading has not been started.
