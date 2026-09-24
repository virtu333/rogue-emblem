# Candidate unit sprites (hand-authored pixel art)

Readability study for map sprites. These are candidates only and are not wired into the game.
Regenerate with `npm run sprites:candidates` (source: `tools/sprite-kit/`).

## What's here

| Path                      | Contents                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `sprites/`                | 64x64 PNGs, `<faction>_<class>.png`, plus `_idle.png` two-frame breathing strips      |
| `sprites-grim/`           | Same sprites with the `grim` grade: everything but faction cloth muted and darkened   |
| `manifest.json`           | `RebuiltSpriteManifest.json`-style entries whose bounds place the art at scale 1      |
| `review-lineup.png`       | Player row over enemy row on meadow, 1x (true size) and 3x                            |
| `review-palettes.png`     | Standard vs grim, on meadow and on swamp (2x)                                         |
| `review-terrain.png`      | Rows = sprites; columns = Plain, Forest, Mountain, Water, Swamp, Bog, Lava, Ice       |
| `review-readability.png`  | Columns = colour, grayscale, grayscale on bog, silhouette, "moved" grey, deuteranopia |
| `review-vs-current.png`   | Current rebuilt art (top) vs these candidates (bottom), same placement, 3x            |

All review sheets reproduce the in-game treatment: the faction ring and the 1px contrast halo from
`BattleContrast.contrastSpriteKey`.

Classes: Edric (lord, teal), Myrmidon, Knight, Fighter, Archer, Mage, Cleric, Thief, Cavalier.
Each non-lord class has a player (azure) and enemy (crimson) version.

## Format

- Native pixel art. Nothing is resampled, so every pixel is intentional at 1x.
- Infantry art stays inside the 38x34 box at x 13..50, y 10..43. Mounted art stays inside 46x40 at
  x 9..54, y 4..43. These are the boxes `RebuiltSprites.spritePlacement` scales to. The
  manifest bounds match them exactly, so the art renders at scale 1 with feet on row 43. The
  generator fails if any pixel leaves its box.
- Figures are about 2.7 heads tall: bigger heads and weapons than the rebuilt art, but not GBA-chibi.

## Design rules applied

- **Value bands.** Terrain sits in a narrow mid-dark range. Sprites use the extremes: a coloured dark
  outline (selout, lighter on the lit top-left side) and bright face, metal and cloth highlights.
- **One faction block per class.** Every sprite routes one large cloth area through the `faction`
  material, so a side is a palette swap:
  - Knight and Mage: tabard or coat
  - Archer: hood and cloak
  - Fighter: vest
  - Myrmidon: scarf and tie
  - Cleric: stole
  - Cavalier: saddle cloth and pennant

  Other materials are shared across sides. Per `docs/asset-art-direction.md`, faction is not the
  whole costume.
- **Silhouette first.** Each class has one dominant shape:
  - Knight: slab shield and box helm
  - Fighter: axe head above the shoulder
  - Archer: bow taller than the body
  - Mage: A-line coat and open tome
  - Cleric: staff and robe
  - Thief: crouched with a reversed dagger
  - Myrmidon: scarf and ponytail streaming out
  - Cavalier: upright lance with pennant

  The silhouette column in `review-readability.png` is the check.
- **Hue-shifted ramps.** Five steps per material, with shadows toward violet and highlights toward
  warm yellow (`tools/sprite-kit/pixel.mjs`).
- **Darker tone without losing clarity.** The `grim` grade mutes skin, metal, leather and cloth
  (saturation x0.6, value x0.84) but leaves faction cloth at full strength. The world gets darker
  while the side marker gets relatively louder.

## Findings from the review sheets

- Every sprite stays readable on all eight terrain types, including bog, lava and ice.
- Red vs blue survives deuteranopia as olive vs blue. The faction ring and pennant give a second
  channel.
- The "moved" grey state stays distinct from grass because sprite values sit outside the terrain
  band.
- Mage and Thief are the closest pair in silhouette. The mage coat was widened to an A-line for this.
  If more classes get added, give the thief a hood point or a coat tail.
- Compared with the current rebuilt art, these read much more clearly at 1x. They also look younger
  and brighter. Choose between the standard and grim grades, or tune `PALETTES.grim` in
  `generate.mjs`.

## Trying them in game

1. Copy the PNGs into `assets/sprites/rebuilt/` (and `public/`).
2. Add the `manifest.json` entries to `src/ui/RebuiltSpriteManifest.json`, keyed the way
   `rebuiltSpriteKey` looks them up:
   - `enemy_<class>` for enemies
   - `lord_edric` for Edric

Non-lord player units don't have a rebuilt lookup yet.
