# Procedural map-sprite study

> Captures in this folder are a curated subset; see [CAPTURES.md](../CAPTURES.md) for the full sets.

**Question:** can this game's unit sprites be generated, with identity for recruits, factions,
corruption, states and motion in code, at the same quality as the approved rebuilt Edric and
Sera? If so, how?

**What this is:** a working prototype (`tools/art/sprite-lab/`) that draws map sprites at the
game's real size. Each is a 64×64 texture at one texel per world pixel, feet on y=44, inside the
per-kind size limits. The folder also holds review captures that stage those sprites on the
approved procedural terrain and the weathered atlases at phone scale, beside the current game art.

It is a static art study. It changes no game code, data, shipped art or other docs. The
recommendation and system design are in **[VISION.md](VISION.md)**.

## Run it

```bash
node tools/art/sprite-lab/generate.mjs                 # everything -> this folder (~2 min, deterministic)
node tools/art/sprite-lab/generate.mjs --only lineup,sword,recruits
#   sections: sprites lineup compare phone checks sword recruits anim derived states
#   --out DIR  writes elsewhere
ZOOM=8 CROP=12,4,40,42 node tools/art/sprite-lab/dev/lineup.mjs /tmp/x.png lord_edric myrmidon:enemy knight:corrupted:strike
```

It needs only `sharp`, which is already in `node_modules`. It reads the game's
`src/engine/MapGenerator.js` and the terrain generator (read-only) to build the boards.

## Start here

| File | What it shows |
|---|---|
| `phone_river_procedural.png` | **Start here.** One 16×10-cell crop at 34 CSS px per cell, in three panels: **A** the sprites the game draws today, **B** all procedural, **C** the recommended hybrid (indexed rebuilt lords + procedural generics). Same positions, rings, HP bars, game contrast halo; one unit is acted. |
| `phone_<map>_{procedural,weathered}.png` | The same comparison on all six terrain-study maps (river, chokepoint, castle, mire, caldera, frozen), on the procedural terrain and on the weathered atlases |
| `device3x_{river,mire}_{current,procedural,hybrid}.png` | 8×5-cell crops at 3× DPR device pixels (102 px per cell), which is what a Retina phone actually lights up |
| `compare_current_3x.png` | Every class, current game art (rebuilt or legacy, placed as the phone renderer places it) over procedural, player and enemy, at 3× |
| `lineup_1x.png`, `lineup_3x.png` | Edric, Sera and 10 generic classes: player / enemy / corrupted |
| `sword_test.png` | Six unlabeled sword units at phone scale and as silhouettes. **Name them before opening** `sword_test_key.txt`. |
| `recruits_3x.png`, `recruits_phone.png` | Six seeded Myrmidon recruits and the same six promoted to Swordmaster; six Fighter recruits; six enemy Myrmidons in issue kit |
| `checks_player.png`, `checks_enemy.png` | Each sprite on plain, forest, swamp, castle floor, snow and ash; grayscale on plain and swamp; silhouette; the game's acted tint; deuteranopia |
| `states_2x.png` | Ready, acted today (multiply `0xb8b8b8`), acted as the proposed palette operation, hit flash, strike |
| `anim_3x.png`, `anim/*.gif` | 4-frame idle, windup, strike and hit flash for seven classes; animated GIFs at 3× |
| `derived_3x.png` | Option (b): the rebuilt Edric, Sera and enemy Myrmidon indexed into the lab ramps, then calmed, recoloured, corrupted and given a breath frame |
| `sprites/` | Every 64×64 sprite: `<class>_<faction>.png` plus `manifest.json` (seed, rolled identity, alpha bounds, kind) |
| `anim/<class>_<faction>_{idle,attack}.png` | Frame strips: idle 4×64, attack = windup, strike, recovered, flash |

## Coverage

| Requirement | Where |
|---|---|
| Edric (teal, lightly equipped), Sera | `lord_edric`, `lord_sera`: procedural versions, plus the indexed rebuilt versions in `derived_3x.png` |
| Infantry sword ×3, axe, lance, bow, tome, staff; armoured; mounted; flyer | Myrmidon, Mercenary, Thief; Fighter; Knight (armoured lance + shield); Archer; Mage; Cleric; Cavalier (horse); Pegasus Knight |
| Player (steel-blue area + gold thread cord), enemy (crimson lacquer + iron), corrupted | Every generic × three treatments, in `lineup_*` and `sprites/` |
| Six seeded recruits of one class | `recruits_3x.png` row 1 (seeds are `hash("20260924:recruit:i")`, as a run would draw them) |
| Promotion pair | `recruits_3x.png` row 2: the same six people as Swordmasters |
| 2–4 frame idle and an attack pose | Four-frame idle, windup and strike, hit flash for every sprite (`anim/`) |

## What is derived and what is drawn in code

| Element | Source |
|---|---|
| Faces (3), hair styles (9), beards (2), headgear (9), scarf | **Drawn in code**: ASCII grids in `lib/heads.mjs`, fill only |
| Torsos, leg stances, Edric's cloak, Sera's robe and hair, knight's shield, quiver, satchel, swordmaster coat tails | **Drawn in code**: `lib/classes.mjs`, `lib/infantry.mjs` |
| Horse, pegasus body, wing, tails, saddle cloths, pennant | **Drawn in code**: `lib/mounted.mjs`. The legacy `characters/cavalier.png` and `pegasus_knight.png` were consulted as a luminance dump for proportions only; no pixels were copied. |
| Arms, all weapons (sword, longsword, broadsword, dagger, lance, axe, bow, staff, tome + light), gold cord | **Procedural and parametric**: `lib/gear.mjs`, `lib/build-helpers.mjs`, from sockets and angles per pose |
| Outline (selout), lit-edge rim, contact shadows | **Procedural**: `lib/figure.mjs`, `lib/resolve.mjs` |
| Palette | Art Bible ramps verbatim (five-step picks). Edric's teal and Sera's plum ramps were **sampled from the rebuilt sprites**. Skin and hair ramps are new but follow the bible's hue-shift rule. |
| Faction, corruption (drain + split), acted, hit flash | **Procedural** ramp swaps and grades: `lib/palette.mjs` `TREATMENTS`, `lib/resolve.mjs`, `lib/treat.mjs` |
| Recruit identity, enemy issue kit | **Procedural**, seeded: `lib/identity.mjs` |
| Idle, windup and strike motion; wing beat | **Procedural** tag offsets and socket tables: `lib/build.mjs` and the recipes |
| `derived_3x.png`, panel C of the phone captures | **Derived** from `assets/sprites/rebuilt/lord_edric.png`, `lord_sera.png`, `enemy_myrmidon.png` by nearest-ramp indexing (`lib/derive.mjs`) |
| Class design cues | From `docs/asset-art-direction.md` and the legibility-v2 sword contract. The ASCII legend convention follows `tools/sprite-kit/grid.mjs`. |
| Staging (rings, HP bars, 64 px texture on a 32 px tile, contrast halo, acted tint) | Mirrors `BattleScene.addUnitGraphic`, `BattleContrast` and `RebuiltSprites.spritePlacement` (`lib/stage.mjs`, `lib/rebuilt.mjs`). Terrain comes from `tools/art/procedural-terrain`. |

## How it works

1. **Figure** (`lib/figure.mjs`). A 64×64 canvas of `(slot, shade 0..4, part id)`. Parts are
   stamped from ASCII: one character = one slot at one shade. Lines are drawn with lighting
   across their width. Nothing is RGB yet.
2. **Recipe** (`lib/classes.mjs`, `infantry.mjs`, `mounted.mjs`). The class draws back to front:
   - back items;
   - back arm (parametric), legs, torso (stamped);
   - cord (procedural);
   - identity head at the head socket;
   - front arm and weapon (parametric; sockets and angles depend on pose);
   - shield.
3. **Build** (`lib/build.mjs`):
   - Idle frames shift the upper-body tags down one pixel and sway `sway`-tagged cloth.
   - Windup and strike shift the upper body.
   - Then contact shadows are computed from part draw order.
4. **Resolve** (`lib/resolve.mjs`). Slot → ramp through identity and then faction aliases. An
   optional grade runs (unlight or acted). Then the lit-edge rim and the tinted exterior outline.
5. **Treat** (`lib/treat.mjs`). The corruption split and after-image, hit flash, and the game
   diagnostics (halo, acted multiply, grayscale, silhouette, deuteranopia).

Numbers:

- About 2.5 ms per sprite frame in Node.
- 30 to 60 colours per sprite, against 280 to 350 in the rebuilt art.
- Feet on row 43 for every class.
- Heights: infantry 32–34 px, robed 30–31, thief 27 (the 80% crouch rule).
- Knight and cavalier lances reach the top of the texture.

## Honest assessment

### Where procedural wins

- **Faction at a glance.** Steel-blue and crimson areas read on every biome. The game's legacy
  player sprites (Myrmidon, Knight, Archer, Mercenary, Thief, Cleric, Cavalier) are dark and
  low-saturation and sink into mire, forest and castle floor. Compare panels A and B in
  `phone_mire_*` and `phone_castle_*`. On pale snow both read; procedural reads more cleanly.
- **Class silhouettes.** The silhouette columns in `checks_*.png` are distinct for all ten
  classes:
  - thief crouch;
  - knight slab and shield;
  - archer bow arc;
  - cleric staff head;
  - mage A-line and light;
  - horse and pegasus with wings.

  The sword test separates on shape alone: Thief is low and hooded, the Myrmidon is narrow with a
  ponytail and a raised slender blade, and the Mercenary is broad with a horizontal blade across
  the shoulders. That is my reading; the owner's blind naming is still the real test.
- **Consistency.** One light direction, one palette, one pixel grid, one scale, one baseline.
  Enemy and player versions of a class are the *same drawing*, so a class cannot drift between
  factions.
- **Things that are hard to do with art**, and here are free:
  - seeded recruit identity that survives promotion;
  - corruption on any class;
  - an acted state that stays readable;
  - idle, lunge and hit flash for every class and faction;
  - the gold thread motif applied consistently.

### Where procedural loses (plainly)

- **It does not reach the rebuilt Edric and Sera in richness.** The rebuilt lords are painterly,
  with dense interior line work, dynamic lunge poses and mature proportions. The procedural sprites
  are cleaner and flatter, closer to classic FE/GBA map sprites. At 34 CSS px the gap is modest
  (`phone_*`, panel B). At 3× device pixels it is visible (`device3x_river_*`). **The procedural
  Edric and Sera are not a replacement for the rebuilt ones.** Keep the authored lords and put them
  through the indexer (panel C).
- **Heads are still slightly large and faces are generic.** Three faces at 8×9 px cannot carry
  identity. Hair colour and silhouette, skin, headgear and the scarf do. Six Myrmidon recruits look
  like six people in `recruits_3x.png`, but only just at map scale.
- **The limbs are an engineer's.** Parametric 2 px arms look stiff, and hands are 2×2 blobs.
  Stances are less dynamic than the rebuilt art. The horse's barrel and the pegasus wing
  (a single fan) are serviceable, not beautiful, and the cavalier's rider legs barely read.
- **Weak pairings.** A white-robed cleric on snow; dark iron enemy knights and cavalry on swamp
  in grayscale (still separated by the outline, but with the least margin).
- **Palette economy.** The `(slot × 5 shades)` model gives 30–60 colours per sprite, not the 10–14
  that legibility-v2 suggests as a simplification aid. It reads fine, but a tighter per-class ramp
  budget would help.

**Bottom line.** For the generic roster, procedural sprites already beat the shipped legacy sprites
on the axes that matter for play: locating a unit, reading its faction and class, and seeing its
state. At phone scale they sit plausibly next to the rebuilt lords. For the lords themselves, and
for richness, hand-authored art still wins. So the recommendation is the hybrid in
[VISION.md](VISION.md): an artist-made part library, procedural assembly and treatment, and
authored lords and bosses indexed into the same system.

## Recommended next steps

1. **Owner review** of `phone_river_procedural.png` (A/B/C), `sword_test.png` (blind),
   `recruits_3x.png` and `states_2x.png`. Decide the five questions at the end of VISION.md.
2. **Artist pass on the library, not the roster.** Hand the ASCII parts to a pixel artist in
   Aseprite (slot palette plus pivots). Priority order:
   1. faces and hands;
   2. horse and pegasus;
   3. arm stamps for the three most common poses;
   4. richer interior line work on torsos.

   Re-run the lab after each change; every class and seed updates at once.
3. **Prototype the runtime** behind a flag: a `ProceduralSprites.js` beside `RebuiltSprites.js`,
   with the appearance seed on units and determinism, bounds, baseline and palette tests. Swap
   the generic classes in the actual battle, keeping lords and bosses rebuilt (indexed).
4. **Portraits from the same seed**, so each recruit's portrait matches their map sprite.
5. **Try the acted palette operation in game** in place of the `0xb8b8b8` multiply, and turn off the
   `BattleContrast` halo for sprites that carry their own contour.
6. **Extend coverage** to wyvern, the armoured horse and the 30 promotion deltas only after step 2
   sets the quality bar.
