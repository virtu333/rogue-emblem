# Map sprites — vision for procedural generation

Study, 2026-09-24. The working prototype is `tools/art/sprite-lab/`, and the evidence is in this
folder (see `README.md`). The study changes no game code, data or shipped art. This document is
for the owner to steer before anything is ported to production, the same way the terrain study
came before the terrain port.

## Recommendation in one paragraph

Use a **hybrid (option c)**. Build a small hand-authored part library in *indexed material slots*.
Assemble it procedurally per unit from a stored **appearance seed**. Apply every faction, identity,
corruption and state treatment as a **ramp swap**, not new art. Drive idle and attack motion from
**part tags and parametric limbs and weapons**. Lords and bosses keep their authored art (today's
rebuilt Edric and Sera). They pass through the same indexer (option b), so they share the palette,
the treatments and the motion. Do not try to generate faces, cloth masses or mounts from
primitives (option a): the kit's own first pass and this lab's parametric parts both show that
primitives only work for lines (limbs, blades, shafts, cords).

## What the game asks of a map sprite

The requirements, in the order a player needs them (legibility-v2 `PRINCIPLES.md`):

1. **Locate** the unit on busy terrain (swamp, forest, snow, castle floor) at 34 CSS px per cell.
2. **Faction**, read as a colour *area* (not piping), backed by the ring and the silhouette. The
   player is steel blue plus the gold thread; the empire is crimson lacquer and iron; corrupted
   enemies are drained to unlight violet.
3. **Class**, from silhouette and weapon. The dominant cue alone must be enough, because enemies
   of one class must read as that class at a glance.
4. **Identity**, for the player's own units only. Random recruits must look unique but coherent
   within a run, stay the same person through promotion, and never read as Edric recolours.
5. **State**: ready or acted, selected, danger, hit, affixed or corrupted. A sprite that starts
   dark leaves no room for these.
6. **Motion**: slow map tempo (idle breath, cloth), sharp punctuation (lunge, hit flash). Reduced
   motion shows end states.

Hard contract (`docs/specs/map-sprite-sizing-2026-09-21.md`, `RebuiltSprites.spritePlacement`):

- 64×64 texture centred on the 32 px tile, feet on y=44, nearest-neighbour sampling.
- Size limits per kind: infantry 34 px, mage 30, heavy 36, mounted 46×40, flyer 40×34.

The lab authors directly at that size, one texel per world pixel, so nothing is resampled.

## The three options, compared on evidence

| | (a) Fully procedural paper-doll | (b) Procedural treatment of finished art | (c) Hybrid (recommended) |
|---|---|---|---|
| What it is | Body rig and gear built from primitives (ellipses, polygons, lines) with auto-shading | Hand or AI art indexed into the ramps, then re-coloured, outlined, graded and animated by code | Small hand-authored part library in material slots; procedural assembly, identity, recolour, grades and motion; parametric limbs and weapons |
| Quality ceiling | Low for faces, hair, cloth and mounts. `tools/sprite-kit` pass 1 (primitives) was judged "blocky and whimsical" in its own README. | As high as the source. `derived_3x.png`: the indexed rebuilt Edric is visually identical to the shipped one. | Set by the part artist. The lab's parts are an engineer's pixel art (see the honest assessment in the README). |
| Consistency (one light, one palette, one pixel grid) | Perfect | Only as consistent as the sources. AI sources mix pixel density; indexing fixes the palette but not the pixel grid. | Perfect: every pixel is (slot, shade) from the bible ramps, lit from the upper left |
| Per-run identity | Free | None beyond ramp swaps: every recruit of a class shares one drawing | Free: face × hair × hair ramp × skin × headgear × beard × scarf × cloth. See `recruits_3x.png`. |
| Promotion continuity | Free | Needs a matching drawing per identity | Free: same seed, new body parts (Myrmidon → Swordmaster in `recruits_3x.png`) |
| Faction, corruption, acted | Free | **Free.** This is where (b) shines (`derived_3x.png`). | Free |
| Animation | Free but stiff | A generic "breath" row-shift only; poses need new art | Free idle, lunge and hit flash from part tags and parametric weapons (`anim_3x.png`, `anim/*.gif`) |
| Cost to cover 52 classes | Low art cost, high tuning cost, low ceiling | One finished drawing per class × tier (≈52 to 132), each needing cleanup | A part library (≈20 bodies plus deltas) and a rig, then roughly linear |
| Main risk | Looks like programmer art | Inconsistent grids and no identity; the AI sources must be curated one by one | Parts must be good. The library is the bottleneck and the place to spend artist time. |

## The recommended system

### 1. Data: the appearance seed

- At recruitment, give each unit `appearance: { seed }`, drawn from the run RNG. Save it with the
  unit, so it survives the Supabase sync and the battle-suspend checkpoint. Promotion, reclass
  seals and reloads keep the seed, so the person stays the same.
- `rollIdentity(seed, classFamily)` (`lib/identity.mjs`) is a pure function. Each class family
  constrains what it may roll: an Archer may lower its hood but never wear a helm; a Knight always
  wears an open helm. Identity cloth never uses teal (Edric's signature), steel blue or crimson
  (the factions).
- Migration for existing saves: seed = hash(run id, unit name, class). This is deterministic and
  needs no stored state.
- **Generic enemies do not roll identity.** They wear their class's issue kit: fixed headgear and
  dark cloth, with only skin and mostly hidden hair varying. Every enemy Myrmidon therefore reads
  as the same class, and allies read as people (`recruits_3x.png`, bottom row). Bosses and lords
  are authored.
- **Portraits should consume the same seed.** Hair ramp, skin ramp and headgear are the only
  identity channels that survive at 32 px, so the 128 px portrait must agree with them. That makes
  the portrait the recruit's full identity and the map sprite its summary.

### 2. Palette and slots

Every pixel is `(slot, shade 0..4)` and never RGB until the last step (`lib/figure.mjs`). The
ramps are five-step picks from the Art Bible ramps (`lib/palette.mjs`); new skin and hair ramps
follow the same hue shift.

| Slot | Player | Enemy | Corrupted |
|---|---|---|---|
| `main` (faction area) | steel cloth (bible steel 1–5) | crimson lacquer (bible blood 1–5) | lacquer drained toward unlight; keeps a wine undertone so it still reads as the empire |
| `trim` (thread) | gold (bible ember): cords, knots, hems, shield bands | iron | iron, drained |
| `armor` (plate) | warm silver | dull iron, no bright step ("enemies carry no light") | drained |
| `metal` (blades) | white highlight bounded by grey | same, one step dimmer (the weapon cue must survive) | drained |
| `glow` | gold (tome, staff) | gold | unlight violet |
| identity slots (`skin`, `hair`, `sub`, `leather`, `linen`, `mount`, `mane`) | from the seed | issue kit | issue kit, drained |

Lords override `main`: Edric keeps **teal**, and Sera keeps plum with her tome's light as the gold
thread. The 1 px gold cord (a baldric, sash knot or hem) on every player unit is the "gold means
you" motif at map scale.

### 3. The part library (hand-authored)

The lab's parts are ASCII grids that are fill-only; outlines are generated. They are in
`lib/heads.mjs`, `lib/classes.mjs`, `lib/infantry.mjs` and `lib/mounted.mjs`. Production should
move authoring to **Aseprite**: one layer per part, the slot palette as an indexed palette, and
sockets as slice pivots. A small exporter turns the layers into the same part records. ASCII is
fine for a study but is not an artist's tool.

The library needed to cover the game:

| Part family | Lab has | Production needs |
|---|---|---|
| Faces (3/4 right, 8×9) | 3: youth, mature, soft | 4–5 (add aged and scarred) |
| Hair styles (front + back) | 9 | ~12 |
| Headgear | 9: headband ×2, circlet, hood ×2, veil, open helm, great helm, kettle | ~14 (add wizard cap, war hat, horned helm for Berserker, circlet variants) |
| Beards / accessories | stubble, full, scarf | +2 |
| Leg stances | 5: stride, planted, hakama, crouch, greaves (+ robe hems in the torsos) | ~7 |
| Torsos (one per class family, promoted as deltas) | 11 | ~21 base + 30 promotion deltas (most deltas are a coat, mantle or plate layer) |
| Mounts | horse, pegasus (+ wings) | + wyvern, + armoured horse; polish all three |
| Shields, quivers, satchels, cloaks | 1 / 1 / 1 / 1 | ~8 total |
| Weapons | parametric: sword, longsword, broadsword, dagger, lance, axe, bow, staff, tome | + breath, + light tome; rank as ramp (iron / steel / silver); legendaries as unique stamps |

### 4. Assembly, lighting, outline

`lib/build.mjs` and `lib/resolve.mjs` draw back to front in this order:

1. Back hair, cloak and quiver.
2. Back arm, then legs, then torso.
3. Cord.
4. Head, then headgear.
5. Front arm, then weapon, then shield.

Then the post passes run:

- **Contact shadow.** A nearer part drops a one- to two-shade line on what is behind it, on the
  lower-right only, because the key light is upper left.
- **Lit-edge rim.** Top and left silhouette pixels step up one shade.
- **Selective outline.** The outline is tinted by the material it borders: darker on the shadow
  side, lighter on the lit side.

The game's runtime 1 px contrast halo (`BattleContrast`) then doubles the outline. For lab sprites
it should be switched off, because they carry their own contour; the captures keep it on so the
comparison stays fair.

### 5. Motion

- **Idle** has four frames: the upper body drops one pixel (the breath), loose cloth sways, and
  wings beat against the breath. Legs never move, so the feet stay on the baseline.
- **Attack** has two poses, windup and strike. The recipes move their arm sockets and weapon
  angle, and the upper body lunges +2/+1.
- **Hit flash** turns every opaque pixel to paper white and the dark contour to crimson, so the
  silhouette survives.

Everything is data (tag offsets and socket tables) and costs about 2.5 ms per frame in Node. For
signature moments (weapon arts, crits) the ceremony cut-ins do the heavy lifting, as the Art
Bible already says.

### 6. States as palette operations

Indexed sprites make states cheap and legible:

- **Acted.** Today the game multiplies by `0xb8b8b8`. The proposed palette operation drains colour
  and drops value about 14% per material *before* outlining. The result reads as spent without
  sinking into the ground (`states_2x.png`, "acted: palette op").
- **Corrupted / unlight.** A value-preserving drain toward the bible unlight ramp, then the "image
  splits": two slices shift sideways with a violet tear edge, plus a faint violet after-image.
- **Affixes** can use the same mechanism, for example a crimson crack line through the split
  instead of the violet tear ("affixes read as threads snapping").
- **NPC green** is one more treatment row (`main` → verdigris).
- **Fog and silhouette previews** follow the same pattern.

### 7. Lords and bosses: authored, then indexed (option b as a service)

The approved rebuilt Edric and Sera stay as they are. `lib/derive.mjs` classifies each pixel to
the nearest ramp step among that character's candidate ramps. The result is the same kind of
indexed figure, so it gets:

- the player, enemy and corrupted treatments;
- the acted operation;
- a generic breath frame;
- a palette that matches every procedural unit beside it.

`phone_*.png` panel C and `device3x_river_hybrid.png` show that mix. A "calm" pass that removes
single-pixel sparkle exists but changes little, because the rebuilt art's busyness is in its line
work, not its shading.

## Tie-in to gameplay

| Gameplay fact | Sprite rule |
|---|---|
| Random recruits every run | Identity from the stored seed; class family constrains the rolls; no faction colours in identity cloth |
| Promotions | Same seed; the promoted body adds a layer (coat, mantle, plate, longer weapon) and more gold thread. Authority, not bulk. |
| Faction reads as an area | `main` is always a large block (tabard, coat, hood and mantle, saddle cloth, vest, shield field) |
| Same-class enemies read as one class | Issue kit per class, no identity rolls, silhouette-first recipes |
| Affixed and corrupted enemies | Unlight grade plus split, applied on top of the class sprite, so the class still reads |
| Acted state | Mid-value sprites plus the drain operation; never ship a dark base sprite |
| Colour-blind safety | Blue versus olive survives deuteranopia (`checks_*.png`). Ring and silhouette are second cues; faces-for-allies versus helms-for-enemies is a third for armoured classes. |
| Night acts (BattleLightLayer) | The player's gold thread is the one warm light on the sprite; enemy iron has no bright step |

## Pipeline

1. **Author** parts in Aseprite with the indexed slot palette → `export-parts` script → part JSON
   (rows, slots, sockets).
2. **Recipes** are data per class. The lab keeps them as functions for speed of iteration;
   production should move to JSON beside `classes.json`, keyed by class name.
3. **Bake.** Two options:
   - Runtime, at battle start: ~2.5 ms per frame, 7 frames per unit, ~20 units ≈ 0.35 s. Run it in
     a worker, cache per `seed:class:faction:state`, and add the textures through Phaser
     `textures.addCanvas`, exactly like `prepareRebuiltSprites`.
   - Build time, for enemies (their kits are finite).

   Recruits must bake at runtime because their seeds are unknown until the run.
4. **Integration** point: a `ProceduralSprites.js` beside `RebuiltSprites.js` that returns the
   same `rebuilt-*`-style texture keys. `BattleScene.addUnitGraphic` already sizes 64 px textures
   correctly. Keep `?spriteArt=classic` as the comparison switch.
5. **Gates** (CI):
   - determinism snapshot hash per class × faction × seed;
   - bounds check against the per-kind limits;
   - baseline check (lowest opaque row = 43);
   - palette check (every pixel is a ramp colour or outline mix).
6. **Review.** Re-run `generate.mjs` for the lineup, phone captures, checks and the sword test
   before every part-library change.

## What must be hand-authored

- Heads: faces, hair, headgear.
- Torsos and promotion deltas.
- Leg stances.
- Mounts and wings.
- Shields and back items.
- Unique legendary weapons.
- Lord and boss sprites (as today).
- Portraits.

Everything else is code: arms, weapons, cords, outlines, lighting, recolours, identity, grades,
motion and states.

## Effort estimate (for a first production pass)

| Work | Who | Days |
|---|---|---|
| Aseprite export and part JSON; recipe data format | engineer | 2–3 |
| `ProceduralSprites.js` runtime baker, cache and worker; integration behind a flag | engineer | 3–4 |
| Appearance seed in unit data, save migration, portrait hook | engineer | 1–2 |
| CI gates (determinism, bounds, baseline, palette) | engineer | 1 |
| Part library for the 21 base classes (bodies, stances, mounts incl. wyvern) | pixel artist | 12–18 |
| 30 promotion deltas | pixel artist | 8–12 |
| Heads: faces, hair and headgear polish, +6 new | pixel artist | 3–4 |
| Attack key poses per family (~8 families) | pixel artist | 3–4 |
| Review loops on phone and captures | both | ongoing, ~20% |

In total: roughly 7–10 engineer-days plus 26–38 artist-days to replace every generic class. The
lab alone, without an artist, reached the quality in this folder in about one focused session.
Expanding it to all 52 classes at that same quality would take an engineer roughly 8–12 more days.

## Risks

- **Style register.** Procedural sprites are clean and cel-like, closer to classic FE and GBA
  than the painterly, noisier rebuilt art. The two sit together at 34 px, and at 3× device pixels
  the difference is visible (`device3x_river_hybrid.png`). The owner must choose one of:
  - accept the mix (lords stay rich);
  - move the lords toward clean (re-author, or calm them further);
  - push the part library toward richer interior line work.
- **Faces carry little identity at 32 px.** Hair colour and silhouette, headgear and skin carry
  it. That is why portraits must share the seed.
- **ASCII authoring does not scale.** It needs the Aseprite exporter before the library grows.
- **Parametric limbs look stiff in extreme poses**, and weapons at arbitrary angles alias.
  Quantise angles to clean pixel slopes, and use authored arm stamps for signature poses.
- **Combinatorial clipping** (hair × headgear × torso) needs the lineup and recruit sheets as a
  regression gate over many seeds, not one.
- **White on snow.** Clerics' linen on tundra is the weakest pairing (`phone_frozen_*`). Give
  robed classes a darker hem band or a tundra-specific `linen` step.

## Decisions the owner should make

1. **Hybrid or not.** Is the recommended split right (procedural generics, authored and indexed
   lords and bosses)?
2. **Register.** Clean procedural versus painterly rebuilt: which way should the other side move?
3. **Enemy identity.** Should generic enemies wear issue kit (no per-unit identity), as proposed?
4. **Acted state.** Replace the multiply tint with the palette operation?
5. **Portraits.** Should they use the appearance seed, as proposed?
