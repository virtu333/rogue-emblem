# Battlefield presentation — build notes (2026-09-24)

Implements the battlefield workstream of the approved art direction
(`docs/art-direction/ART_BIBLE.md`): act moods, desktop battlefield parity, the desktop
battle HUD restyle and new faction rings. Presentation only — no game rules, RNG,
save formats, combat timing or checkpoint semantics changed.

## What changed

### Act moods (`src/art/atmosphereConfig.js`, `src/art/AtmosphereFX.js`, `src/art/BattleLightLayer.js`, `src/ui/AtmosphereController.js`)

| Battle | Grade | Night layer |
|---|---|---|
| Act I | Ember Dusk | – |
| Act II | Iron Rain | – |
| Act III | Bleached Rite | – |
| Act IV (grass, castle, swamp, volcano) | Ashfall | yes |
| Act IV on snow/tundra | **Rime Night** (new, cold) | yes, blue-ink |
| Final boss (the Lieutenant) | **The Throne** (new: iron-violet shadows, ember torchlight; pillars carry torches) | yes |
| Entity / secret act / `void` maps | The Deep | yes, unlight glow on the Entity |
| Tutorial | plain Ember Dusk | – |

Biome tunes are small and relative: castle (+contrast, +frame, less key light),
swamp (−saturation, verdigris shadows), snow outside Act IV (no warm key, cool
highlights).

- `resolveAtmosphere()` / `resolveAtmosphereMode()` are pure and unit-tested.
- Post-FX runs on the **main battle camera only**. Phones already route screen UI
  through BattleScene's pinned UI camera (and the DOM HUD). Desktop gets an ungraded
  UI camera that mirrors the main view; everything at or above `UI_DEPTHS.SCREEN_UI`
  (100: HUD, menus, banners, overlays) renders there. Nothing UI is graded.
- The vignette and key light frame the **visible battlefield** (map ∩ view), so a
  small map centred on the desktop canvas gets its own edges. Inside the map the
  vignette is capped so units in corners stay readable; chromatic split only lives
  in the darkened rim.
- Night layer: world-space, depth 3.5 — above terrain (0) and fog (3), below the
  danger zone (4), pinned threats (4.5), ranges (5), path (6), rings (8), units (10+),
  HP bars and cursor. Fogged tiles never glow. Redraws only on change (terrain
  revision, fog visibility, lit-unit positions); flicker (Full only) animates an
  alpha. Half-resolution textures with linear filtering.
  Measured in headless Chromium/SwiftShader on magma_flow (54 lava emitters):
  static rebuild 1.8 ms (only on terrain/fog change), unit redraw 0.07 ms (on
  movement), idle per-frame check 0.003 ms.
- Setting **Atmosphere: Full / Reduced / Off** (Settings on phone and desktop).
  Stored as `auto` until chosen: Reduced on phones, Full on desktop. Reduced = no
  grain, no chromatic split, weaker vignette, lighter nights, no flicker. Low effects
  quality caps at Reduced; reduced motion stills grain and flicker. Changes apply live.
- Canvas renderer / no WebGL / headless mocks: silently Off. All Phaser object
  construction runs with an isolated `Math.random` so the battle RNG never advances
  (verified by e2e: identical RNG state with atmosphere Off vs Full).

### Desktop battlefield parity (`src/ui/BattlefieldArt.js`, `src/ui/battlefieldArtFlags.js`)

Desktop now presents the phone's battlefield art — weathered terrain, rebuilt
sprites, the contrast pass, ink background — without the phone side pane.

- Single entry point `paintBattlefieldTerrain(scene, grid)` → painting with
  `.ready`, `.destroy()` (restores classic tiles). BattleScene calls it for every
  device; BattlefieldLab now only owns the phone layout.
- **Seam for the procedural renderer**: a renderer renders the whole map to one
  canvas; frames are cut per cell. Register an `(input) => canvas` renderer with
  `registerBattlefieldTerrainRenderer(terrainRendererFromCanvasFunction('procedural',
  fn))` and make it default with `setDefaultBattlefieldTerrainRenderer('procedural')`
  (dev: `?terrainArt=procedural`). Input is `{ mapLayout, terrainData, biome, seed,
  cols, rows }`; seed is a deterministic hash of the layout.
- Temporary terrain, villages, Vision rewinds and checkpoint restores go through a
  new presentation-only Grid terrain listener; changed cells and their neighbours
  are repainted once per burst.
- Desktop (fixed 1:1 camera) uses terrain pre-filtered to 32 texels per cell;
  phones keep 48.
- Dev escape hatches: `?terrainArt=classic`, `?spriteArt=classic`,
  `?battleContrast=original`, `?battlefieldArt=classic`.
- Weathered 4×4 atlas cells are sampled with a small inset: the generated sheets'
  borders drift a few pixels, which used to bleed a thin seam into tile edges.

### Desktop battle HUD (`src/ui/DesktopBattleHud.js`)

Chamfered ink plates with gilt hairlines: turn/par (Press Start 2P, rating colour) over
Eye charges; objective plate top-right; hover terrain/unit plate under the status
plate; par tooltip to its right; fog chip under the objective; one faint bottom line
with the `[D] Danger / [O] Roster / [E] End Turn` buttons, the hint and `[X] Cancel`.
BattleScene still owns and writes every text object (phone DOM HUD reads them); the
controller only restyles and lays them out.

### Faction rings (`src/art/factionRingStyles.js`, `src/ui/FactionRings.js`)

Filled translucent faction ellipse + crisp 1.6px faction band (lit rim on the upper arc)
+ ink keyline, near full tile width, centred just above the feet so sides and the
front arc show past the sprite. Player steel-blue, enemy crimson, boss a heavier
double crimson ring with side clasps, NPC verdigris, caravan earth, Entity unlight.
Acted units get a multiplicative dim (matches the sprite tint).

## How to review

Dev server, then:

```
/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1&labMap=<map>[&mobilePreview=1]
  &atmosphere=act1|act2|act3|act4|rime|throne|deep   force a grade (dev only)
  &atmosphereMode=full|reduced|off                    force a mode (dev only)
```

Lab maps: river_crossing, forest_ambush, chokepoint (I); corridor_siege, castle_ruins,
mire_crossing (II); frozen_pass, glacier_run, caldera, magma_flow (IV).

## Captures

All captures are real renders of the dev battle route (headless Chromium, WebGL via
SwiftShader), seed 42. *Before* = the base branch (`c62b5ed`); *after* = this branch.
Desktop is 960×720 (640×480 canvas). Phones use the `mobilePreview` layout at 844×390
and 667×375 (DPR 3), where Atmosphere defaults to Reduced.

| File | What it shows |
|---|---|
| `act-moods-desktop.jpg`, `act-moods-phone-844.jpg` | Every grade: Ember Dusk, Iron Rain, Bleached Rite, Ashfall night, Rime Night (tundra), The Throne, The Deep with an Entity and a boss ring, Act II swamp tune. Grades other than on their natural maps are forced with `&atmosphere=`. |
| `atmosphere-modes-desktop.jpg`, `atmosphere-modes-phone-844.jpg`, `atmosphere-modes-phone-667.jpg` | Off / Reduced / Full on caldera (Act IV night). |
| `desktop-parity-<map>.jpg` (6 maps) | Desktop before/after: classic tiles → weathered terrain, rebuilt sprites, contrast pass, rings, HUD, default grade. |
| `desktop-all-lab-maps.jpg` | All eight reviewed lab maps on desktop after the change (all ten are covered by e2e). |
| `phone-844-<map>.jpg` (5), `phone-667-<map>.jpg` (3) | Phone before/after: same layout, new rings, Reduced grade/night. |
| `desktop-hud.jpg`, `desktop-hud-zoom.png` | Desktop HUD before/after with hover info, par tooltip, fog chip (simulated), unit selected; 1.5× zoom of the plates. |
| `rings-before-phone-danger.png`, `rings-after-phone-danger.png` | Unit close-ups at 844×390 over grass, stone/floor, snow/ice, lava/volcanic and swamp, with the danger overlay on and one acted player unit. |
| `settings-atmosphere.jpg` | The Atmosphere control in the settings menu on phone and desktop. |
| `canvas-renderer-fallback.jpg` | Chromium with WebGL disabled (Canvas renderer): atmosphere silently off; terrain, rings and HUD unchanged. |

## Known limits / judgement calls

- **Final boss vs. void.** The final battle's sanctum is tagged `void`, but the brief
  asks for "The Throne" there, so the final battle (the Lieutenant) gets the Throne. Only
  the Entity (Lunatic), a future `secretAct` and other `void` maps get the Deep.
- **Tutorial** uses the plain Ember Dusk grade, never night (clarity first).
- **Desktop world FX.** On desktop everything at depth ≥ 100 goes to the ungraded UI
  camera. That includes world-space punctuation (floating damage numbers at 300, proc
  chips at 301, "ESCAPED!" pop-ups at 320), which the phone camera split grades. They
  keep exact positions (the UI camera mirrors the main camera, including the crit zoom
  punch and shake).
- **Rime Night.** On bright snow the lantern pools read as near-neutral light; warmth is
  kept low on purpose so the pools don't clip to white.
- **Entity light** is an unlight pool (deeper violet-black around the Entity) instead of
  an additive glow; the pale Entity sprite reads against it and player light cuts through.
- **Caravan ring** changed from ember gold to earth; the bible reserves gold for the
  player's agency.
- **Terrain look on phones changed slightly.** The weathered 4×4 atlas cells are
  sampled with a ~1.6% inset to stop neighbouring cells bleeding a seam into every tile
  edge (most visible once desktop filters the art down to 32 texels).
- **Hint wording.** The desktop hint line was condensed to fit one line:
  `[R] Vision · [V]/right-click: details · Esc/off-map: cancel` (same information; the
  `[X] Cancel` button sits at the right end of the same line).
- **Replay viewer.** `BattleHistoryScene` still paints its own per-cell weathered tiles
  (it renders snapshots, not a live Grid); it now follows the terrain-art flag, so desktop
  replays match too, but it is not yet routed through the renderer seam.
- **Desktop camera** is unchanged: small maps still sit in the middle of the 640×480
  canvas (no desktop zoom). The grade's vignette and key light frame the map itself.
- **Performance** figures are headless SwiftShader numbers; a physical-phone check is
  still due.
- **Out of scope, found stale on the base branch** (fail identically before and after
  this change): `battlefield-lab.spec.js` 106 (40px commands), 259/277 (old terrain
  copy), 62/225; `mobile-pause.spec.js:21`; `battle-submenus-desktop.spec.js:4` (expects
  the pre-Ink `#ffdd44`); `ui-completion.spec.js:80`; `gamepad-menus.spec.js:107/197`;
  `weapon-selection.spec.js` 311/351/376/410; `gamepad-battle.spec.js` 323/378/395/426;
  `mobile-viewport.spec.js` 221/237/273; `battle-invariants.spec.js:109`.
