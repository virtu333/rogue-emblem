# Map sprites v2: traced pixel sprites

Study, 2026-09-24. Owner direction: *"be ambitious with them and get closer to modern pixel
sprite art. Right now they look a little childlike/toylike."* The workflow the owner
pointed to: generative models supply the references, code "traces" them onto the pixel
grid, and code owns compositing, palette and states. Quality target: the map-scale figures
of the **A · Detailed pixel art** board
(`docs/art/sprite-exploration-2026-09-21/concepts/A-detailed-pixel-leading-reference.png`).

This folder holds the pixel-budget decision, the method, the results and an honest
assessment. The tracer is `tools/art/sprite-trace/`. The game gets a **dev-only** review
switch (`?spriteArt=traced`). Default sprites, gameplay, data and saves are unchanged.

## Start here

| File | What it shows |
|---|---|
| [`ingame/`](ingame) | **The real game**, 14 staged units on the six biome lab maps (grass, forest, stone, snow, swamp, lava), 844×390 and 667×375. DPR 3 rows: rebuilt today · traced · traced with a device-resolution canvas. DPR 1 rows: rebuilt · traced. `forest_ambush_844x390_select.webp` (DPR 3, rebuilt vs traced + device backing) puts sprites under the blue movement-range overlay. The danger-zone call drew no tiles for the staged cast, so danger-overlay contrast is not covered. |
| [`sources_3x.webp`](sources_3x.webp) | Edric, Sera, Myrmidon, Archer and the enemy Knight in four versions: today's game texture, the hand-authored sprite-kit candidate, traced from an earlier source, and traced from the chosen source |
| [`lineup_3x.webp`](lineup_3x.webp), [`lineup_1x.webp`](lineup_1x.webp) | Ten classes × player / enemy / corrupted / NPC, plus the lords, the promotion and two bosses, on the game's own grass |
| [`pipeline.webp`](pipeline.webp) | The method, step by step, for Edric, the Knight and the enemy Myrmidon |
| [`density_dpr3.webp`](density_dpr3.webp) | The same figures at D = 1, 1.5 and 2 next to today's texture, as a DPR 3 phone shows them |
| [`checks_player.webp`](checks_player.webp), [`checks_enemy.webp`](checks_enemy.webp) | Every sprite on grass, forest, stone, snow, swamp and lava; grayscale on grass and swamp; silhouette; acted (game tint and palette op); deuteranopia |
| [`sword_test.webp`](sword_test.webp) | Six unlabeled sword units at map size, 3× and as silhouettes. Name them before opening `sword_test_key.txt`. |
| [`recruits_3x.webp`](recruits_3x.webp) | Six seeded Myrmidon recruits, the same six people promoted to Swordmaster, and six enemy Myrmidons (issue kit) |
| [`states_3x.webp`](states_3x.webp), [`anim/`](anim) | Ready, acted (both kinds), hit flash, windup, strike, corrupted; idle and attack GIFs |
| [`PIXEL_BUDGET.md`](PIXEL_BUDGET.md) | The measurements and the density decision |

## Pixel budget (summary)

Details and captures are in [PIXEL_BUDGET.md](PIXEL_BUDGET.md).

- On phones the **canvas backing store is the bottleneck**. The battle canvas is always 480
  px tall, so a tile is ~44 canvas px that the browser stretches ~2.4× to ~109 device px
  (DPR 3). Every sprite pixel is resampled twice at non-integer ratios. On desktop a tile is
  32 canvas px.
- **Decision: D = 1.5.** Sprites are drawn at 1.5 art px per world px: 96 px textures shown at
  64 world px, with the foot row, tile centring and per-kind bounds all scaled by 1.5. A
  sprite pixel is exactly one texel of the painted terrain (48 per cell), so the grids share
  a lattice and there are no fractional mixels. It maps 1:1 on a 720p desktop and is ~2.3
  device px on a Retina phone.
- **Also raise the phone canvas to device resolution** (`?renderScale=device`, dev-only
  today): the backing becomes CSS × DPR, the browser stops stretching the canvas, and each
  sprite pixel is sampled once. Desktop needs the same change in its own path (not done
  here; see PIXEL_BUDGET).

## Method (`tools/art/sprite-trace/`)

Each step is a pure module with a unit-tested core. The CLI is `cli.mjs`; the review
generators are `review.mjs` and `dev/capture-game.mjs`.

1. **Figure split** (`lib/figures.mjs`). Review sheets hold 2–3 figures. Transparent column
   gutters separate them, and a sword tip poking into a gutter stays with its owner.
2. **Grid recovery** (`lib/grid.mjs`). Generated "pixel art" draws each art pixel as a
   blurred block of ~3–15 screen px. The pitch drifts, and some sheets were resized
   anisotropically (the original myrmidon sheet is 6.8 × 5.4). Recovery works per axis:
   - edge-energy profile;
   - autocorrelation;
   - pitch candidates scored with harmonic support (2p, 3p), preferring the fundamental and
     rejecting the blur-pair peak;
   - **dynamic programming** to place the actual cut lines within ±30 % of the rhythm;
   - each cell sampled as the **medoid of its interior**, which ignores blended edges.

   Confidence comes from the autocorrelation's peak-minus-dip. Continuous-tone sources fall
   back to an area downscale (only the rebuilt promoted Edric does). Every other reference
   recovered as a clean grid; natives are 43–256 px tall.
3. **Material segmentation** (`lib/segment.mjs`), into the sprite-lab slot model: skin, hair,
   faction cloth (`main`), secondary cloth, leather, blade metal, armour, gold thread, linen,
   wood, mount, glow, eyes, line work.
   - Colour rules seed each material. Which hue is the faction cloth and which family the
     hair is come from a per-figure recipe. The face is found as the skin patch with hair
     above it.
   - A seeded geodesic flood (multi-source Dijkstra with a shading-tolerant colour step)
     fills the rest and stops at line work.
   - Blades are told from armour by elongation.
   - Eyes are dark or iris-coloured clusters that sit on the cheek.
   - Recipe rectangles fix what the rules miss (silver hair that reads as steel, mount
     bodies).
4. **Reduction to D = 1.5** (`lib/reduce.mjs`). The scale fits the body (not the weapon) to the
   kind's height, and it is anisotropic when a sheet's pixels were not square, so the result
   keeps the proportions the owner reviewed. This is not an image resize:
   - The exterior outline is peeled (it is regenerated). Thick near-black areas become the
     darkest step of their material. Thin ink between two parts of one material becomes a
     fold, not a black line.
   - **Near 1:1 (scale ≥ 0.55): priority-merge decimation.** Each target row/column is one to
     four source rows merged pixel by pixel. The most important pixel survives (eyes > weapon
     lines > gold thread > faces > line work > cloth). Dynamic programming picks the merges
     where neighbouring rows are most alike, with a pull toward even spacing. The artist's
     exact pixels and clusters survive.
   - **Strong reduction (< 0.55): area vote.** First a slot mode filter and a same-material
     Gaussian remove detail thinner than a target pixel. Then each target pixel takes the
     material with the highest coverage × priority in its exact footprint; skin in the face
     box is boosted, and the phase with the crispest silhouette is chosen. Thin trims, hems
     and blades are traced as continuous one-pixel lines.
5. **Cleanup** (`lib/cleanup.mjs`): pinholes, spurs, orphan and speck removal, shade calming,
   pixel-perfect line work (no L-corner doubles), and a face pass (lash and bang-shadow lines
   become skin or hair shadow; eyes are kept as a 1×2 stroke, or stamped by the map-sprite
   convention when the reduction lost them). The upper-left key light (lit rim and core
   shadow) is applied under strong reduction. Cleanup strength follows the scale: near 1:1
   the source's own clusters are kept.
6. **Ramps and render** (`lib/ramps.mjs`, `lib/render.mjs`):
   - Each material gets a five-step ramp built from the figure's own pixels. This is how
     Edric's teal, Sera's red hair and the pegasus white survive.
   - Faction cloth, metals and thread swap to the Art Bible ramps.
   - The exterior outline is a generated **selout**: the darkest step of the material it
     borders, pushed toward ink, softer on the lit top and left edges.
   - Interior line work takes the darker neighbouring material's shadow instead of black.
7. **Treatments** (`lib/treat.mjs`, `lib/identity.mjs`). Every state is a ramp swap of the
   same drawing:
   - player: steel-blue area, gold thread, bright plate;
   - enemy: crimson lacquer, iron, no bright step;
   - NPC: verdigris;
   - corrupted: unlight drain plus the "image splits" tear;
   - acted: palette drain, as a proposal;
   - hit flash;
   - seeded recruit identity: design A/B, hair and skin ramps, an optional headband with
     knot tails.

   Lords and bosses keep their own cloth.
8. **Motion** (`lib/motion.mjs`). All frames are made in index space, so light and outline
   are regenerated per frame.
   - **Idle**: four frames. The upper body settles 1 px above an estimated waist; hair trails.
     The feet never move.
   - **Attack**: windup (lean back, weapon up) and strike (the upper body lunges with a shear,
     the weapon leads).
9. **Bake** (`cli.mjs bake`, `lib/atlas.mjs`). Sixty sprites × six frames go into a
   1728×1920 atlas (`assets/sprites/traced/traced-atlas.png`, 0.2 MB) plus
   `src/ui/TracedSpriteManifest.json`. The bake is deterministic: the same references give
   the same bytes.

## Which source each unit is traced from, and why

The lead's source priority: the newest map-scale candidates, then the latest revision of each
class sheet, then the original class sheets, then rebuilt art. Values are measured by the tracer:

- **Native** is the recovered pixel-art size.
- **Pitch** is the screen pixels per art pixel in the reference, x/y. Anisotropic pitches come
  from sheets resized after generation. The tracer keeps the proportions the owner reviewed
  either way.
- **Scale** is the horizontal reduction at D = 1.5. Near 1 keeps the most of the reference;
  below ~0.55 the heavy-reduction path is used.

| Unit | Source | Native | Pitch | Scale | Why |
|---|---|---|---|---|---|
| Edric | `sprite-candidates-2026-09-22/sources/edric.png` | 65×69 | 10.3 | 0.73 | Newest owner-aligned map candidate. Its README note is applied in code: gold trim muted (only the belt keeps its thread) and the sword brought in to 80 %. |
| Edric, promoted | `assets/sprites/rebuilt/lord_edric_promoted.png` | 103×128 | 8.8 (area fallback) | 0.39 | Approved identity. It is the only reference that is not a clean pixel grid, so it is the weakest trace. |
| Sera | `sprite-candidates-2026-09-22/sources/sera.png` | 43×56 | 14.6 | 0.80 | Newest candidate (staff, cream robe), nearly map size already |
| Kira | `assets/sprites/rebuilt/lord_kira.png` | 73×112 | 10.0 | 0.45 | Approved identity. No map-scale candidate exists. |
| Myrmidon (player A/B, enemy) | `class-sprite-review-2026-09-22/legibility-v2/sheets/myrmidon.png` | 125×256 | 3.2 | 0.20 | Latest sword-class revision: raised slender blade, narrow wrap (the legibility contract) |
| Mercenary (A/B, enemy) | `legibility-v2/sheets/mercenary.png` | 54×71 | 7.9 | 0.72–0.74 | Latest revision: broad blade over the shoulder |
| Thief (A/B, enemy) | `legibility-v2/sheets/thief.png` | 54×55 | 8.0 | 0.74 | Latest revision: low hooded crouch, traced at the 80 % crouch height |
| Fighter (A/B) | `player-set-2/sheets/fighter.png` | 70×68 | 8.9 | 0.74–0.77 | Latest player designs |
| Fighter (enemy) | `sheets/fighter.png`, figure 3 | 59×88 | 8.0/5.4 | 0.85 | The newer sets have no enemy designs |
| Knight (A/B) | `player-set-2/sheets/knight.png` | 104×149 | 5.3 | 0.36 | Latest player designs |
| Knight (enemy) | `sprite-candidates-2026-09-22/sources/knight.png` | 61×59 | 14.9 | 0.91 | Newest owner-aligned candidate |
| Archer (A) | `sprite-candidates-2026-09-22/sources/archer.png` | 60×73 | 11.0 | 0.70 | Newest candidate: "the biggest readability win" |
| Archer (B, enemy) | `revision/sheets/archer.png`, figures 2–3 | 72×85, 55×64 | 5.8, 7.7 | 0.60, 0.79 | Latest archer revision with an enemy design |
| Mage (A/B) | `player-set-2/sheets/mage.png` | 69×85 | 7.9 | 0.52 | Latest player designs |
| Mage (enemy) | `sheets/mage.png`, figure 3 | 51×47 | 8.4/9.2 | 0.87 | No later enemy design |
| Cleric (A/B) | `player-set-2/sheets/cleric.png` | 49×81, 45×104 | 7.9/7.0, 8.0/5.3 | 0.62 | Latest player designs |
| Cleric (enemy) | `sheets/cleric.png`, figure 3 | 45×54 | 8.3 | 0.83 | No later enemy design |
| Cavalier (A) | `player-set-3/sheets/cavalier.png` | 131×111 | 5.0/7.0 | 0.38 | Latest player design |
| Cavalier (enemy) | `sheets/cavalier.png`, figure 3 | 66×67 | 7.8 | 0.91 | No later enemy design |
| Pegasus Knight (A) | `player-set-3/sheets/pegasus-knight.png` | 162×143 | 4.9 | 0.35 | Latest player design |
| Pegasus Knight (enemy) | `sheets/pegasus-knight.png`, figure 3 | 100×84 | 5.6 | 0.60 | No later enemy design |
| Swordmaster (A/B, enemy) | `sheets/swordmaster.png` | 84–91 × 86–88 | 5.6 | 0.57–0.58 | Promotion line for the recruits. No later revision exists. |
| Blade Lord, Iron Wall | `assets/sprites/rebuilt/boss_*.png` | 95×117, 131×142 | 9.8, 9.1 | 0.45, 0.37 | Approved boss identities |

The pitch estimates on a few sheets are not exact (for example, the two player-set-2
clerics read 7.0 and 5.3 vertically). The traced proportions do not depend on them, because
each figure is rescaled by its own measured pixel aspect. An error only changes how many
source rows the reducer sees.

Also consulted:

- The **hand-authored sprite-kit** (`docs/art/sprite-candidates/`). Its rules are reused:
  - value bands (the sprite uses the extremes: dark selout and bright highlights);
  - one faction block per class;
  - silhouette first;
  - hue-shifted five-step ramps;
  - feet on the baseline row.

  At D = 1.5 its boxes scale to 57×51 (infantry) and 69×60 (mounted). It sits in
  `sources_3x.webp` as a comparison: it is the "chunky, bigger heads" look the owner called
  toylike.
- The **rebuilt portraits** (`assets/portraits/rebuilt/`). These were used only as identity
  cues while reviewing (hair and skin families). The portraits should consume the same
  identity ramps as the sprites (see Rollout).

## Results

What the traced sprites do better than today's (`sources_3x.webp`, `ingame/`):

- **Crisp, coherent pixel art at map size.** Today's runtime nearest-samples a 1024–1254 px
  source into ~34 px, which picks arbitrary pixels: broken outlines, salt-and-pepper
  interiors, no readable face. The traced sprites have continuous outlines, material
  clusters, a lit face and a weapon line.
- **The owner's candidates survive nearly intact.** Sera (0.80), the enemy Knight (0.91) and
  Edric (0.73) keep their faces, trims and weapons. At DPR 3 with the device-resolution
  canvas they look like the A board's map row: detailed small figures, not icons.
- **Class reads by silhouette** (`checks_*`, silhouette column; `sword_test.webp`). The sword
  trio separates as black shapes: crouch and hood, blade over the shoulder, raised slender
  blade.
- **Faction is an area in every state.** The same drawing is steel blue, crimson lacquer,
  verdigris or unlight, so a class cannot drift between factions. Rings, HP bars, acted tint
  and selection are unchanged in game.
- **Grayscale and deuteranopia**: players and enemies stay separable by value and by the
  blue-versus-olive split. Every biome swatch is legible, including snow and lava.
- **Seeded recruits** (`recruits_3x.webp`): six people from two designs, with hair, skin and
  headband swaps. Each keeps hair, skin and band through promotion.
- **Motion**: slow idle breathing, hair trail, lunge and hit flash on every sprite, from one
  drawing.

## Honest assessment vs the A board

**Where it reaches the bar.** Units traced from references whose native pixel art is already
close to map size look like the A board's map figures at phone scale. These are the
2026-09-22 candidates, the legibility-v2 mercenary and thief, and the player-set fighter and
archer (scale ≥ ~0.65). They show the same discipline: detailed but readable, lit faces,
strong silhouettes.

**Where it falls short, and why.**

1. **Strong reductions lose the face.** The legibility-v2 Myrmidon (0.20), the
   player-set-2 Knight (0.36), the player-set-3 Pegasus (0.35) and Cavalier (0.38), rebuilt Kira (0.45) and the
   bosses (~0.4) keep silhouette, colour areas and class cue, but faces become a hair
   mass with at best a stamped eye. Their small interiors (straps, trims) turn into soft
   mottling instead of designed clusters. No amount of cleanup restores detail the target
   grid cannot hold, and an artist would *redraw* those areas.
2. **Promoted Edric** comes from the only non-grid reference (the rebuilt art is resampled,
   not pixel art). It traces noticeably worse than base Edric.
3. **Identity variety is limited by the references.** Each class has two player designs, so
   recruits vary in hair and skin colour, skin tone, and a headband. Hair *shapes* and
   headgear come only from the two designs. Real variety needs more designs per class.
4. **Hair shape across promotion.** Swordmaster A/B are different drawings from Myrmidon
   A/B. Colour identity carries over, but hair style does not.
5. **Motion is code-driven warps.** They read well at map tempo, but there are no authored
   key poses (a real sword swing, a bow draw).
6. **Palette economy.** Sprites carry 40–70 colours (five-step ramps per material, plus
   selout). That reads fine, but it is not the tight 16–24 colour discipline of hand-made
   sprites.

**What would close the gap.** New references generated **at the map size**. Give the image
model the owner's preferred on-map reference (as the 09-22 candidates did) and ask for
~48–64 px natives on a clean pixel grid, one figure per image, for every class, the enemy
designs, the promotions and the lords. The tracer then only recovers the grid and cleans up
(scale ≈ 0.7–1), which is where it already matches the bar. The repo has
`tools/imagen-pipeline/`; the owner can add a `GOOGLE_API_KEY` in `.env`. Priority: Myrmidon,
Knight, Pegasus (player), promoted Edric, Kira, the bosses, and a third and fourth design per
common class for recruit variety. Idle and attack key frames are the next reference type
(the same figure in 2–3 poses): the tracer's grid recovery and segmentation are already
pose-agnostic.

## Try it in the game

```bash
npx vite --port 3302 --strictPort --host 127.0.0.1
# phone layout, traced sprites, canvas backing at device resolution:
open "http://127.0.0.1:3302/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1&labMap=forest_ambush&spriteArt=traced&renderScale=device"
```

- `?spriteArt=traced` (dev builds only) switches to the baked traced sprites where one exists
  for the unit, and to the rebuilt art otherwise.
  - Enemies with affixes use the corrupted treatment, NPCs the verdigris one.
  - Generic player units get one of the seeded identities by a hash of their name. The name
    persists through promotion, so the person stays the same.
  - Units idle at map tempo (held on the rest frame under reduced motion).
- Unchanged: 64×64 world display size, tile-centred placement, faction rings, HP bars, the
  acted tint, selection and danger overlays, rewind, and battle history. Traced sprites skip
  the `BattleContrast` halo because they carry their own outline.
- `?renderScale=device` raises the phone canvas backing (see PIXEL_BUDGET).
- Code: `src/ui/TracedSprites.js`, plus a few lines in `BattleUnitVisuals.js`,
  `BattleContrast.js`, `BattleScene.js`, `BootScene.js` and `battlefieldArtFlags.js`, and
  `BattlefieldLab.battleRenderScale`.
- Tests: `tests/SpriteTrace.test.js`, `tests/TracedSprites.test.js` and
  `tests/BattlefieldArtFlags.test.js`.

## Recommended rollout

1. **Owner review** of `ingame/` (third row of each DPR 3 sheet), `sources_3x.webp` and the
   blind sword test.
2. **Commission map-size references** for the units listed under "What would close the gap",
   and re-run `cli.mjs bake`. The recipes live in `tools/art/sprite-trace/roster.mjs`.
3. **Ship the phone backing change**: audit pinned Phaser UI under a scaled UI camera, cap
   at DPR 3, and profile the atmosphere pass. Then do the desktop equivalent.
4. **Runtime identity**: store an appearance seed on units (VISION.md §1). Bake recruits at
   runtime from the indexed sprite, or bake N identities per class at build time as this
   study does. Have portraits consume the same hair and skin ramps.
5. **Replace the acted multiply with the palette op** (`states_3x.webp` compares them), and
   cut frames straight from the atlas instead of per-sprite canvases.
6. **CI gates**, once adopted: a determinism hash per baked sprite, the foot row and bounds
   (already unit-tested), atlas ≤ 2048 px, and a palette check.

## Reproduce

```bash
node tools/art/sprite-trace/cli.mjs bake                 # atlas + manifest (deterministic)
cp assets/sprites/traced/traced-atlas.png public/assets/sprites/traced/   # or npm run sync-assets
node tools/art/sprite-trace/review.mjs                   # every offline sheet in this folder
node tools/art/sprite-trace/dev/capture-game.mjs /tmp/cap          # in-game captures (dev server on 3302)
node tools/art/sprite-trace/dev/compose-ingame.mjs /tmp/cap docs/art-direction/sprites-v2/ingame
node tools/art/sprite-trace/cli.mjs recover <sheet.png> --figure 0 --out native.png --zoom 4
node tools/art/sprite-trace/cli.mjs trace <sheet.png> --figure 0 --recipe '{"main":"blue","hair":"brown"}' --out s.png --zoom 4
node tools/art/sprite-trace/dev/measure-budget.mjs       # PIXEL_BUDGET table
```

## Verification (2026-09-24)

- `npx vitest run --exclude 'tests/e2e/**'`: 380 files, 6172 tests pass, including
  `tests/SpriteTrace.test.js` (grid recovery on synthetic sheets, determinism, palette and slot
  mapping, foot anchor and bounds, pixel aspect) and `tests/TracedSprites.test.js`.
- `npx eslint . --ignore-pattern '.claude/**'`: 0 errors. `npm run format:check` and
  `npm run build` pass.
- `cli.mjs bake` re-run gives a byte-identical atlas and manifest.
- Playwright on the dev server (port 3302): `traced-sprites`, `character-art`,
  `scene-transitions`, `rebuilt-sprites` and 11 of 12 `mobile-battle-hud` tests pass.
- Two known failures come from specs that are behind upstream changes. Neither spec, nor any
  CSS, nor `BattlefieldArt.js` is touched by this branch.
  - `mobile-battle-hud` "commands have readable targets": the 38 px sidebar-button
    minimum fails on the CSS inherited from upstream.
  - All 17 `battlefield-lab` tests fail in `boot()`: they expect
    `data-terrain-art="weathered"`, but b1f59c1 made `procedural` the default renderer.
