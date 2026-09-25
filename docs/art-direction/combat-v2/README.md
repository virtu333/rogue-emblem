# Combat v2 — choreography and effects built in code

Combat effects were the weakest art left: 22 generated strips (48 px, 4 frames, 8–12 for
signatures) in saturated generic colours — a clip-art axe inside the chop, a cartoon
bubble for the shield, green dots on drain — played on top of the target while static
sprites nudged back and forth. Arrows and spells never travelled.

Combat v2 replaces both halves:

1. **A procedural FX generator** (`tools/art/combat-fx/`, Node + sharp, deterministic, no
   network) that draws every effect as pixel art in the Ink & Ember ramps and bakes them
   into **one small atlas**.
2. **Choreography** (`src/ui/CombatChoreography.js`, primitives in
   `src/ui/CombatFxController.js`, the plan in `src/art/combatFx/strikePlan.js`):
   traced windup/strike frames, projectiles that fly, hit-stop on a held impact frame,
   knockback with terrain dust, a darker crit beat, real dodges, and deaths that fade to
   embers.

## Look first

| | |
|---|---|
| In-game at 844×390 DPR 3: the key frame of every scenario (action area, device pixels) | `ingame/<scenario>.webp` |
| In-game strips, every other frame (33 ms): sword, crit, bow, fire at night, a death at night, a magic signature at night | `ingame/<scenario>_strip.webp` |
| Before / after at 3× over real ground (Ember Dusk, Iron Rain castle, Ashfall night, Rime night) | `sheets/<family>_3x.webp` |
| One animated loop per family at 3×, before \| after, real frame timing | `anim/<family>.webp` |
| Every effect, every frame, at 1× on dusk ground and at night | `overview_1x.webp`, `overview_1x_night.webp` |

Start with `ingame/fire_night.webp`, `ingame/crit_castle_strip.webp`,
`ingame/death_night_strip.webp`, `ingame/breath_ancient_night.webp`, then
`sheets/fire_3x.webp` and `sheets/breath_3x.webp`. All captures are lossless WebP.

In-game scenarios (`tools/art/combat-fx/capture.mjs`, frame-exact on a virtual clock):

| Scenario | Map / grade | What it shows |
|---|---|---|
| `sword_grass`, `sword_traced` | River crossing · Ember Dusk (default / traced sprites) | lunge on the traced windup/strike frames, comet crescent, hit-stop, dust |
| `axe_castle` | Castle ruins · Iron Rain | heavy cleave, debris chips, stone dust |
| `lance_mire` | Mire crossing (swamp) | thrust streak + shock ring, mire splash |
| `crit_castle` | Castle ruins | the crit beat: afterimages, 110 ms freeze, ink vignette, starburst, shock ring |
| `bow_range2` | River crossing | an arrow arcing over range 2; the shaft stands in the target |
| `ballista_castle` | Castle ruins | a ballista bolt at range 3: flight, held impact, flash, heavy knockback |
| `fire_night` | Caldera · Ashfall (night) | fireball with a cinder trail; pixel fire engulfs the target; impact light |
| `thunder_night` | Frozen pass · Rime (night) | chained bolt at range 3, strike from above |
| `wind_grass` | Forest ambush | the cyclone: three spiral blades with ink cut lines |
| `light_castle` | Corridor siege | a shaft of holy light falls, cross-flare, gilt motes |
| `unlight_night` | Magma flow · Ashfall (night) | ink orb, unlight burst that eats light (violet rim, never a black box) |
| `breath_night`, `breath_toxic`, `breath_ancient_night` | Glacier run, mire, frozen pass | the three breaths rolling through the target as lit billows |
| `miss_grass` | River crossing | side-step with an afterimage |
| `heal` | River crossing | verdigris rune ring, shimmer column, sparkles; motes from the healer |
| `death`, `death_night`, `death_traced` | River, Caldera, Chokepoint | fading to embers (the unit's own pixels) |
| `death_boss_night`, `death_entity_night` | Magma flow, Caldera | boss (bigger, shock + rune ring + ink beat), Entity (collapses into unlight) |
| `signature`, `signature_magic_night` | Castle ruins, Caldera | Legendary-art climaxes (sword X-cut; rune circle + pillar) |
| `enrage_night` | Magma flow | boss enrage: crown of crimson flame, ink beat, embers |

## Effect families

One table, `src/art/combatFx/fxFamilies.js`, maps a weapon to a family: exact names first
(legendaries and oddities), then the element read from the weapon's **name, then lore**
for Tomes/Breath/Scrolls, then the type (melee and ranged forms). Every combat weapon in
`data/weapons.json` is covered by a test (`tests/CombatFxFamilies.test.js`).

| Family | Impact | Travel | Weapons (examples) |
|---|---|---|---|
| sword | `fx_slash` comet crescent, afterimage, ink cut line, steel sparks | — (range 2: `bladeWave` crescent) | swords; Ragnarok at 2 |
| axe | `fx_chop` heavy blood→ember cleave, ink gash, stone/earth chips | — (range 2: spinning `fx_proj_axe`) | axes; Hand Axe / Tomahawk / Short Axe at 2 |
| lance | `fx_thrust` streak + `fx_shock_small` | — (range 2: `fx_proj_javelin` arc) | lances; Javelin / Spear at 2 |
| bow | `fx_arrow` flare along the flight, shock ring, the shaft left standing, splinters | `fx_proj_arrow` ballistic arc (height reads distance) | all bows |
| fire | `fx_magic` pixel fire: burst, tongues licking up over the target, flicks, cooling smoke | `fx_proj_fire` solid fireball + cinder trail | Fire, Elfire, Bolganone, Witchfire |
| thunder | `fx_thunder` white-gold bolt from above, crackle | `fx_bolt_seg` chained jagged segments | Bolting; Levin Sword at range |
| wind | `fx_wind` cyclone of spiral blades with ink cut lines, flecks thrown out | `fx_proj_wind` | Excalibur ("a seer's wind"); Wind Sword / Tempest Blade at range |
| light | `fx_light` a shaft from above, cross-flare, gilt motes and sparkles | `fx_proj_light` + gilt motes | Lightning, Shine, Aura, Sunflare, Luce |
| dark (unlight) | `fx_dark` violet-black ink that eats light, violet rim | `fx_proj_dark` ink orb | Twisting Vortex, Eldritch Grasp, anything the Entity wields |
| breath ×3 | `fx_breath` (ember), `fx_breath_toxic` (verdigris + acid bubbles and drips), `fx_breath_ancient` (pale steel + unlight flecks): a lit billow rolling through the target, cooling to smoke | tumbling solid puffs | Fire / Toxic / Ancient Breath |
| staff | `fx_heal` rune ring at the feet, shimmer column, rising sparkles | mote stream healer → target | heals, cures, Healing Circle |
| ballista | `fx_arrow` + held impact, flash, heavy knockback | `fx_proj_bolt` | emplacements (`processBallistaFire`) |

Overlays and beats: `fx_crit` (ink-lined starburst), `fx_shock` (crit/signature shock
ring), `fx_pierce`, `fx_flurry`, `fx_drain` (+ crimson motes pulled from target to
striker), `fx_shield` (gilt hex ward with rune ticks), `fx_buff` (rising ember sparks),
`fx_status` by type (`_sleep`, `_silence`, `_acid` for acid and poison, `_root`, generic),
`fx_ring` (gilt rune ring for weapon arts), 7 signatures (`fx_sig_sword|lance|axe|bow|magic`,
`fx_sig_entity`, `fx_sig_enrage`), and 9 ground reactions chosen by terrain then biome
(`fx_dust`, `_sand`, `_snow`, `_ash`, `_stone`, `_leaves`, `_splash`, `_mire`, `_sparks`).
All 22 old keys still exist, so every existing call site plays the new art.

### How the art is made

Each effect is drawn from analytic shapes (arcs, tapered strokes, rings, stars, jagged
polylines, flame tongues, lit puffs, seeded motes) sampled at pixel centres, in two
layers per frame:

- **Glow** (additive): an intensity field quantized onto the family's short ramp
  (`GLOW_RAMPS` in `src/art/combatFx/fxPalette.js`). The dimmest band is ordered-dithered,
  so a hard-edged effect gets a soft outer glow on the dusk and night grades.
- **Matter** (normal blend): ink line work, debris, unlight bodies — and, new in this pass,
  **bodies** (`tools/art/combat-fx/lib/body.mjs`). An additive glow washes out to a pale disc
  on a lit meadow, so fire, the breaths, smoke and the fireball draw their body as solid
  colour: flame tongues (a silhouette with the same thin rim whatever their width, coloured
  by a heat map so several tongues read as one fire with a cream core low in the middle)
  and lit billow puffs (key light upper-left), quantized once onto hand-picked bands —
  dark crimson rim → orange → gold → cream, like hand-drawn pixel fire. The glow layer keeps
  only their light (the burst bloom, cinders).

Easing is hand-tuned per frame: each frame has its own duration (`fxAnims.json`), and
frame 0 of every impact is the readable impact frame the runtime holds through hit-stop.

Generated references (Gemini `MODELS.pro`, via `tools/art/gen`) guided the fire, breath and
heal rebuilds — silhouettes, band order and timing only; nothing generated ships. They live
in `docs/art/combat-v2-refs/` with their provenance.

```
node tools/art/combat-fx/generate.mjs           # bake atlas + tables (also the public/ copy)
node tools/art/combat-fx/generate.mjs --check   # fail if committed files are stale
node tools/art/combat-fx/preview.mjs --only fx_magic --out /tmp/p.png
node tools/art/combat-fx/review.mjs [--gif]     # sheets, overview, loops (this folder)
node tools/art/combat-fx/capture.mjs --base http://127.0.0.1:3519 [--screens]   # in-game
node tools/art/combat-fx/timing.mjs  --base http://127.0.0.1:3519   # frame-exact timings
```

Rebuilds are byte-identical (seeded per effect key, no `Math.random`, own indexed PNG
encoder); `tests/CombatFxGenerator.test.js` checks it and that the committed atlas matches.

## Choreography

`planStrike(strike, settings)` (pure) returns the ordered steps and their waits; the
choreography executes them and the tests read them directly.

```
windup? → lunge (traced `windup` → `strike` frame, afterimages on crits/arts/flurries)
        → travel (ranged)  → contact: impact frame held, two-frame hot flash, damage number,
          procs, art ring, crit: ink vignette + shock ring + starburst (+ the existing cut-in)
        → hit-stop → react: knockback 4–7 px + terrain dust, struck crimson tint
        → hold → recover (a ranged striker settles during the hold)
```

The crit beat complements, and never duplicates, the existing portrait cut-in (which
plays first, throttled) and the lord quips; the growth ceremonies are untouched.
Miss: the target side-steps and leaves an afterimage; arrows sail a tile past.
Deaths: `deathFade` copies the unit's current frame into a canvas texture and dissolves it
in 2-world-px blocks (seeded noise + top-first bias; the Entity collapses inward), the
front burning in the style's edge colour while up to 60 blocks leave as pooled motes that
keep the pixel's colour, heat, and drift up (players: gilt embers — their light going out;
enemies: crimson cinders to ash; allies: verdigris; bosses: bigger, slower, shock + rune
ring + ink beat; the Entity: violet-black motes pulled inward under `fx_sig_entity`).

### Timing

Plan values (ms, Normal unless noted; legacy = the presentation this replaced):

| Strike | Legacy | Normal | Fast | Instant | Reduced | Normal steps |
|---|---|---|---|---|---|---|
| melee hit | 330 | 340 (+3%) | 170 | 3 | 150 | lunge 90, hit-stop 60, hold 100, recover 90 |
| melee crit | 420 | 460 (+10%) | 230 | 3 | 240 | lunge 90, hit-stop 110, hold 170, recover 90 |
| melee miss | 480 | 430 (−10%) | 215 | 3 | 300 | lunge 90, miss hold 250, recover 90 |
| follow-up hit | 295 | 290 (−2%) | 145 | 3 | 150 | lunge 55, hit-stop 45, hold 100, recover 90 |
| offense proc (wind-up) hit | 400 | 410 (+2%) | 205 | 4 | 150 | windup 70, lunge 90, hit-stop 60, hold 100, recover 90 |
| bow @2 hit | 330 | 322 (−2%) | 161 | 3 | 150 | draw 70, travel 92, hit-stop 60, hold 100 |
| bow @3 hit | 330 | 348 (+5%) | 174 | 3 | 150 | draw 70, travel 118, hit-stop 60, hold 100 |
| bow @2 crit | 420 | 442 (+5%) | 221 | 3 | 240 | draw 70, travel 92, hit-stop 110, hold 170 |
| bow @2 miss | 480 | 382 (−20%) | 191 | 3 | 300 | draw 70, travel 92, miss hold 220 |
| thunder @5 hit | 330 | 307 (−7%) | 154 | 3 | 150 | cast 70, bolt 77, hit-stop 60, hold 100 |
| unlight @2 hit | 330 | 350 (+6%) | 175 | 3 | 150 | cast 70, travel 120, hit-stop 60, hold 100 |
| breath @1 hit | 330 | 289 (−12%) | 145 | 3 | 150 | draw 70, roll 59, hit-stop 60, hold 100 |
| signature (Legendary art) | 400 | 445 (+11%) | 223 | 4 | 150 | windup 70, lunge 90, hit-stop 115, hold 80, recover 90 |
| signature crit | 490 | 535 (+9%) | 268 | 4 | 240 | windup 70, lunge 90, hit-stop 115, hold 170, recover 90 |

Every strike stays within +15% at Normal (a test enforces it for every case above). The
signature's climax frames keep playing after the strike ends (overlays linger and destroy
themselves), so the old cut-off is gone without a longer wait. Instant uses exactly the
legacy waits (each 1 ms) and adds none; reduced motion keeps only the legacy hold; low
quality keeps the ranged draw but drops the flight and its wait.

Measured in the real game (`timing.mjs`: stepped at 60 fps on a virtual clock, one strike
per combat, cut-ins stubbed; frame-quantized, so ±17 ms), art-branch head before Combat v2
→ now:

| Speed | sword hit | sword crit | sword miss | axe hit | bow @2 | bow @2 crit | longbow @3 | fire @2 | Bolting @5 | Excalibur | Shine | Vortex | Fire Breath |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Normal | 383 → 400 | 483 → 533 | 533 → 500 | 383 → 400 | 383 → 383 | 483 → 517 | 383 → 417 | 383 → 383 | 483 → 500 | 383 → 383 | 383 → 383 | 383 → 417 | 383 → 350 |
| Fast | 217 → 217 | 267 → 300 | 283 → 267 | 217 → 217 | 217 → 217 | 267 → 300 | 267 → 317* | 217 → 217 | 217 → 217 | 217 → 217 | 217 → 217 | 217 → 233 | 217 → 200 |
| Instant | 83 → 83 | 83 → 83 | 83 → 83 | 83 → 83 | 83 → 83 | 83 → 83 | 83 → 83 | 83 → 83 | 83 → 83 | 83 → 83 | 83 → 83 | 83 → 83 | 83 → 83 |
| Reduced | 150 → 150 | 250 → 250 | 300 → 300 | 150 → 150 | 150 → 150 | 250 → 250 | 150 → 150 | 150 → 150 | 150 → 150 | 150 → 150 | 150 → 150 | 150 → 150 | 150 → 150 |

Normal is at most +10% (sword crit). \*The longbow row at Fast runs right after a crit in
the timing script and carries ~50 ms from it on both revisions; measured alone it is 233.

Deaths: dissolve 360–380 ms (boss 560, Entity 620) against the old 300 ms fade; Fast
halves it, Instant is 1 ms, reduced motion keeps the old 140 ms fade. Embers keep drifting
0.5–1.2 s after the unit is gone without holding anything up.

## Settings

| Setting | Effect |
|---|---|
| Battle speed | every wait carries a `COMBAT_WAITS` label (`combat_fx_travel`, `combat_fx_hit_stop` added), overlays play at 2× on Fast, Instant shows one static frame and adds no waits |
| Reduce motion | no displacement (no lunge, dodge, knockback, scale pop, travel), static frames, no vignette, the legacy fade for deaths |
| Effects quality: Low | no overlays, motes, dust, ghosts, vignette or flights; motion stays |
| Atmosphere | the impact light only exists when the night light layer does |

## Mobile budget

| | Before | After |
|---|---|---|
| Textures | 22 PNG strips (22 GL textures, a batch break per effect) | **1** atlas `fx_atlas` (640×1000, both sides ≤ 1024) |
| Decoded (GPU) | 1,207,296 B (1.15 MiB) | 2,560,000 B (2.44 MiB) |
| Files | 211 KB of PNG | 60 KB palette PNG (49 colours) + 140 KB atlas JSON |

57 effects, 598 layer frames trimmed and deduplicated to 527 rects, shelf-packed at the
smallest area. Frames are drawn at 1 art px per world px and shown at scale 1 (never
larger than display size), so nothing ships above display size ×3. Runtime textures: one
128×128 vignette canvas (64 KiB, created on the first crit, kept) and one transient canvas
per dying unit (≤ 96×96, removed with the unit's graphic).

Particles: one pool of at most 120 Image motes (`FxMotePool`), created lazily and reused;
a death spends ≤ 60 (40 enemies, 44 players, 60 bosses; the Entity's inward sparks share
its 60), a crit burst 10, a signature 22, drain 9, heal/status streams 7, a projectile
trail ≤ 7. Mote motion is a function of normalized life (no per-frame allocation); the
per-frame loops (motes, projectile paths, the pose guard) use plain indexed loops. The
update listener exists only while motes are alive.

## Rules the runtime keeps

- **Determinism.** Presentation never calls `Math.random`, Phaser random helpers or camera
  shake. Choices come from `fxSeed` (unit ids, turn, strike index) and a private
  `fxRandom`. The e2e spec runs every family on the real battle RNG and checks identical
  outcomes **and the battle-RNG state** with effects on, off, reduced and at every speed.
- **Lifecycle.** `CombatFxController` owns every sprite, tween, timer, pose and tint.
  `finishStrike` settles units home at scale 1, untinted, on an idle frame, and lets an
  overlay that is still animating finish its last frames (it destroys itself); `reset()`
  (vision rewind, checkpoint restore) and `destroy()` (scene shutdown) drop everything,
  including lingering overlays, motes and dissolves. Both bump the controller's `epoch`:
  a strike, flight, dissolve or ballista shot that started before sees it after its next
  await and stops there, so a rewind or shutdown mid-strike never draws or moves anything
  more; and nothing is created on a scene that is not running (`_live()`).
- **Layering.** Every effect lives in the world, below `UI_DEPTHS.SCREEN_UI`, so the act
  grade and fog apply to it exactly as to the units it lands on:

  | Depth | Layer |
  |---|---|
  | 3.5 / 3.6 | night darkness (`BattleLightLayer`) / the impact light just above it |
  | 8 | faction rings |
  | 10–10.9 | unit sprites (by row); ghosts just under their unit, dust just over it |
  | 11.8 / 11.85 | crit ink vignette / projectiles in flight |
  | 11.9 (±0.01 ink) / 11.95 | effect overlays / pooled motes |
  | 12–14 | HP bars and affix pips, readable over every effect |
  | 90 | fog (an effect in fog stays hidden) |
  | 300 | damage numbers (with an ink stroke) |

  Fire and light glow additively; unlight is drawn as ink with a violet rim, so it reads
  as darkness, not a black rectangle. Ghosts are tinted by faction.

## Verification

- Unit: `CombatFxFamilies`, `CombatFxPlan` (every strike within +15% at Normal, Fast is
  half, Instant adds no wait, reduced and low quality), `CombatFxGenerator` (byte-identical
  rebuild, committed atlas matches, palette-pure, hard alpha, ≤ 1024 a side),
  `CombatFxDissolve`, `CombatChoreography` (step order, waits per speed, reduced motion, low
  quality, a rewind mid-freeze, a shutdown mid-lunge and a rewind mid-flight stop the
  strike with nothing more drawn, ballista bolts at every speed, poses, lingering
  overlays, the mote pool; no `Math.random`).
- E2E: `tests/e2e/combat-fx.spec.js` — 17 weapon forms (all families incl. the three
  breaths, Levin Sword at range and the Entity) × {Normal, Fast, Instant, reduced motion,
  effects off} with default and traced sprites on the real battle RNG: identical results
  and RNG state, units home/untinted/scale 1/idle frame, no live FX objects; Legendary
  signatures for every weapon type, ballista bolts and staff heals draw nothing from the
  RNG and settle; a rewind or a shutdown mid-strike stops cleanly; deaths (enemy, boss,
  Entity, player) at every speed leave no motes, dissolves or textures behind and stay
  within 60 motes.

## Hooks requested from the traced-sprite work

- `startTracedIdle` (src/ui/TracedSprites.js) repaints idle frames on a 260 ms tick and
  would overwrite a held `windup`/`strike` frame mid-lunge. Combat v2 guards this with a
  `postupdate` listener that exists only while a pose is held. A one-line skip in the idle
  tick — `if (g._fxPose) continue;` — would make the guard unnecessary.
- The pose frame names (`windup`, `strike`, idle `idle0`) are read from the texture
  (`texture.has(...)`), so any unit baked with those frames gets poses automatically.
