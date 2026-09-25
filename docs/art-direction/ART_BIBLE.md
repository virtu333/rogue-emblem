# Rogue Emblem — Art Bible: "The Last Light Is a Thread"

Approved direction (2026-09-24). The direction board lives in `docs/art-direction/board/`
(studies + captures) and was reviewed by the owner. This file is the source of truth for
how the game looks and moves. Existing rules in `docs/asset-art-direction.md` and
`docs/art/class-sprite-review-2026-09-22/legibility-v2/PRINCIPLES.md` still hold
(identity before polish, Edric stays teal, no skulls/spikes/glowing runes/grimdark
decoration, lit actors over a restrained world, faction color as an area).

> The world is going dark. The goddess's name was spent; an empire feeds the thing
> asleep under the sacred ground. The only warm light left is Sera's sight — a gold
> thread through it. Everything the player controls is drawn in that light.

## Decisions (owner-approved)

| Topic | Decision |
|---|---|
| Tone | Dusk-lit maps; darkness lives at the edges (vignette, fog, night acts) and in ceremonies. True night only in Act IV and the Deep. |
| UI palette | **Ink & Ember** (`src/ui/uiPalette.json`): ink surfaces, ember gold reserved for the player's agency, blood crimson for the empire, verdigris for allies, unlight violet for corruption. |
| Type | Press Start 2P for short labels/headings; readable body face for anything read; **Cinzel** (`--re-display`) for ceremony only (boss names, act titles, fate cards, logo), ≥14px, capitals. |
| Desktop | Adopts the phone's battlefield presentation (procedural terrain, traced map sprites). One game, not two. |
| Map sprites | **Traced** (2026-09-24, owner: "they look great, make them the default"): every unit on the battlefield is a traced map sprite (`tools/art/sprite-trace`, see Map sprites). The rebuilt 64 px set is the dev comparison (`?spriteArt=rebuilt`). |
| Art production | Procedural in code first (UI plates, light, particles, terrain, key art). Existing assets may be used and hand-edited. |
| Region names | Act I region is **Border Marches** (`regions.json`), not "Border Quarries". |
| Title | **The Hollow Sun** key art and subtitle. |
| Terrain objects | Trees and peaks mostly fit their cell (≤ 4 art px over the top and sides, 1–2 px down; canopies only 2 px into open ground); columns and structures fit exactly. Varied, not stamped: forests and ranges follow the shape of the region (owner feedback on the terrain study and the first runtime). |

## World → image

| Canon | On screen |
|---|---|
| The goddess's name was spent | **The Hollow Sun**: black eclipse, thin gold corona. Title, shrines, blessings, the act-end/boss route node. |
| Sera sees futures as threads | **Gold means you**: cursor, paths, route choices, Vision, Rewind, primary actions. Never decoration. |
| The Lieutenant fractures time | Cracked/doubled threads in crimson and violet; affixes read as threads snapping. |
| The Empire kept the drills | Iron and crimson lacquer. Enemies carry no light of their own. |
| The land warps toward the rite | Per-act grade: Ember Dusk → Iron Rain → Bleached Rite → Ashfall (night) → the Deep. |
| The Entity has no words | Unlight: violet-black, color drains, the image splits. No name card, only "· · ·". |

## Palette

UI tokens: `src/ui/uiPalette.json` → `uiTokens.css` (`--re-*`) and `UI_PALETTE`/`UI_HEX`
(`src/utils/uiStyles.js`). Never add raw hex to UI code; add a token.

Art ramps (terrain, key art, FX) — hue-shifted, shadows lean violet/blue, highlights warm:

```
ink       #07060b #0e0c14 #16131e #211d2b #2e293a #403949 #58505e #766b77 #978b94 #bdb0aa #ddd0bd #f4ecdb
ember     #2a170e #4f2c16 #80461f #b3702c #dca044 #f3cb6c #fff0bd
blood     #22090f #44111c #6e1a28 #9e2632 #cc4038 #ec7a5c
steel     #101a2e #1c2f4f #2c4c77 #4574a0 #77a5c6 #b8d8e6
verdigris #0f2622 #1b4239 #2d6450 #4d8b66 #86b27b #c3d69a
unlight   #170c24 #2c1645 #4a2270 #763aa0 #a863cc #dcaaf0
earth     #1d1a12 #34301d #4f4a2a #6e6a3b #938c55 #b8ae78
stone     #1a1a20 #2b2c33 #40414a #5a5b63 #7a7a80 #a09e9f
```

## Light & atmosphere

- Key light: low, warm, **upper-left**; cast shadows fall bottom-right. Every tile, sprite and icon agrees.
- Per-act grade: `src/art/AtmosphereFX.js` (WebGL camera post-process). Night layer: `src/art/BattleLightLayer.js` (your units carry warm light; lava/forts/villages glow; enemies carry none). Units and range highlights always draw above the darkness.
- Snow/tundra uses a cool variant (warm grades read pink on snow).
- Setting **Atmosphere: Full / Reduced / Off**; default Reduced on phones (battery, heat), Full on desktop. Canvas renderer = Off.

## UI — the Reliquary

`src/ui/reliquary.css` over the kit (`reKit.css`): chamfered plates and buttons (cut corners, not radius), gilt header hairlines, ember-fill primary actions (ink text), gold-thread left inset for selection. Visual-only: never change metrics, 44px targets or safe areas. Focus rings stay inset.

## Ceremonies (Souls staging, anime cut-ins)

DOM components (crisp on retina), cover the map area only (the command rail stays live), tap to skip, honor reduced motion and Instant speed (show end state), never mutate game state, never replay on resume.

| Moment | Treatment |
|---|---|
| Boss encounter | Dark band, boss bust breaking the frame, **NAME** in Cinzel + epithet from lore, crimson hairline. |
| Boss bar | Thin crimson bar docked at the bottom of the map area; gold chunk shows damage just dealt; enrage turns it ember with a status line. |
| Critical / weapon art | Diagonal cut-in: attacker's eyes strip, speed lines, **CRITICAL** in Cinzel. |
| Lord falls | Crimson **FALLEN** band + name/class; Rewind offered by Sera beneath. |
| Victory | Gold band with the objective's word: **ROUTED / SEIZED / ESCAPED / DEFENDED**, turn/par/rank. |
| Boss felled | **FOE VANQUISHED**. |
| Act transition | ACT n · region name (Cinzel) · grade name · hairline · the story line. |
| Run ends | **THE THREAD IS CUT**, where and when. |

## Route map — the Loom

Lanes are warp threads; walked route is a plied gold rope with knots; reachable choices glow; futures fade into dither but stay tappable; abandoned roads fray; elites carry a crimson crack; the boss is the Hollow Sun. Select-then-Travel flow and 44px targets unchanged.

## Map sprites

Traced from the reviewed references by `tools/art/sprite-trace` (grid recovery, material
slots, pixel-art-aware reduction, cleanup) at D = 1.5: a 96 px texture shown at 64 world
px, one sprite pixel per terrain texel, feet on the rebuilt baseline (row 66). Records:
`docs/art-direction/sprites-v2/` (pipeline, pixel budget) and `sprites-v3/` (full roster,
motion, memory).

- **Coverage**: every class a unit can hold, as six seeded people (player), enemy,
  corrupted enemy and NPC; the seven lords base and promoted; every named boss; the
  Entity. `tests/TracedSprites.test.js` fails if the data can spawn something without one.
- **Faction is an area**: the same drawing in steel blue (you), crimson lacquer (the
  empire), verdigris (allies), unlight (corrupted). Rings, HP bars and the acted tint are
  unchanged.
- **People, not palettes**: six designed recruits (design A/B, hair, skin, band) shared
  by every class, picked by name — a unit keeps its face through either promotion and a
  reclass. Promotion adds one signature accent: a gold circlet.
- **Faces**: where a reduction collapses a face, it is redrawn deliberately (lit plane,
  brow shadow under the hair, near eye one pixel in from the front edge, far eye behind).
- **Motion** (six frames, names fixed for the combat choreography): `idle0..3` — torso
  settles before the head, hair and hems trail, wings beat, feet never move; `windup` —
  the drawn weapon swung about the hand into its anticipation (blade cocked behind the
  shoulder, lance drawn back level, axe overhead, bowstring drawn, tome/staff raised);
  `strike` — the follow-through (sweep, thrust, chop, loose, thrust with a flare).
- **Budget**: one or two 2048 px atlas pages (~25 MB decoded for the whole roster); each
  sprite is a texture whose frames borrow the page — no per-sprite canvases.

## Terrain

Procedural (`tools/art/procedural-terrain` → runtime). No cell grid: shores, canopies, ridges, lava flow across cells; one light direction; biomes change material, not tint. Units must pop: quiet, lighter ground; objects mostly fit their cell (trees and peaks may spill a few pixels, columns and structures never) and vary naturally: dense wood interiors, sparse edges, lone copses, ranges joined by ridges.

## Motion

Map tempo is slow (idle breathing, drifting ash). Punctuation is sharp: hit-stop, cut-ins, bands. Reduced motion shows end states (map sprites hold `idle0`). Nothing animates while hidden.
