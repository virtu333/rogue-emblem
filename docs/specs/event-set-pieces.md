# Event set pieces

Owner request (2026-10-10): event fights should look like the story that started them. The
Toll Bridge's Dark Omen promises "It stands up from the dark behind the door", and the player
got an ordinary swamp rout with the act's ordinary foes. This spec covers:

- the engine piece: an authored, scaled, seeded **set piece** that an event battle names;
- the first set pieces;
- the phases that follow: new mechanics, new enemy types and the Echoes.

## 1. Today

Every event battle goes through `NodeMapGenerator.convertNodeToRoutBattle`. That function picks
a random rout template and biome for the act and takes foes from the act's pool. The effect
has three knobs: `enemyLevelBonus`, `elite` and `recruit`. Below is what each fight's text
promises and what the fight actually is.

| Event (choice) | The text | The fight today |
|---|---|---|
| Toll Bridge, Dark Omen (Search the hut) | "It stands up from the dark behind the door." | Any rout |
| Toll Bridge (Bluff, failed) | "He whistles. The hut was bigger than it looked." | Any rout |
| Abandoned Armory (Force the barred door) | "Someone was still home." | Any rout |
| Deserters' Fire (Take their gear) | Six deserters around a fire | Any rout, any number of foes |
| Moneylender (Rob the cart) | Four guards and a gilded cart | Any rout |
| Sunken Mine (three choices) | A flooded shaft; a guardian that "comes apart in plates" | Any rout |
| Herald of the Hollow Sun (Break the rite) | Hooded followers step out of ruins | Any rout |
| Old Faces (Ride to his side) | A deserter on a ridge with imperial riders fanning out | Any rout with a green recruit |
| Deserters' Revenge (Stand and fight) | An ambush at a narrow place in the road | Any rout |
| The Collectors (Fight) | A clerk with an abacus at a ford | Any elite rout |

## 2. Rules every set piece keeps

1. **The fight is the text.** If the text says six deserters, there are six. If it is a ford,
   there is a ford. A set piece's `lore` is the place line on the battle card.
2. **Small and authored.** Maps are 8×8 to 14×10. The deploy cap is the set piece's own, and
   usually lower than the act's. Event fights should be quicker than route fights.
3. **Scaled, not fixed.** A set piece names roles and classes, never levels. Levels come from
   the battle's own range, which already includes the act, row, rung, blessings and the
   event's `enemyLevelBonus`. One set piece serves Act I through Act III.
4. **Seeded and locked like any battle.** Every choice comes from the battle's seed inside
   `generateSeededBattle`, so it never touches `Math.random`'s run stream. The map is locked on
   first entry (`lockBattleConfig`). A resume, a Vision rewind and Continue from Map all read
   the locked map.
5. **Every downstream system still applies.** Caster gear, carried items, affixes, elite area
   arts, the Hunted wave, par and its offsets, fog, Revival Stones (only where a set piece
   asks for them) and every battle reader keep working, because the set piece produces the
   config shape that `generateBattle` returns.
6. **Variety within a set piece.** Each set piece has up to three map variants. A variant may
   allow a horizontal mirror. A slot names one class or a list of classes, and a list can
   vary by act.
7. **A rung only adds.** A slot gated by rung or act still takes its draws, so a Black Sun map
   is the First Light map plus its extra slots. Nothing that both rungs share moves.

## 3. Phase A (this PR): the foundation and the Toll-House

### 3.1 Data: `data/setPieces.json`

```jsonc
{
  "setPieces": [
    {
      "id": "toll_house",                 // save data: never renamed
      "title": "The Toll-House",          // the battle card's place name
      "lore": "...",                      // <= 140 chars, one line, no double quotes
      "objective": "rout",                // Phase A: rout only (seize/escape in Phase C)
      "biome": null,                      // a template biome (castle, swamp, tundra, volcano) or null
      "fog": true,                        // true/false forces fog; omit to keep the event's roll
      "deploy": { "max": 5 },             // the deploy screen's cap (the deploy bonus never passes it)
      "parBonus": 0,                      // as a template's parBonus
      "variants": [
        {
          "id": "a",
          "mirror": true,                 // may be flipped left-right (one draw)
          "map": { "legend": { ".": "Plain" }, "rows": [". . ."] },  // the prologue's grammar
          "playerSpawns": [{ "col": 0, "row": 4 }],   // in order of preference; >= deploy.max
          "enemies": [
            {
              "col": 3, "row": 3,
              "classes": ["Zombie"],      // or { "act1": [...], "act3": [...] }: from its act up
              "level": 0,                 // offset on the rolled level (min 1)
              "captain": { "name": "The Toll-Keeper" },  // isBoss: name, boss stats, captain level
              "aiMode": "guard",          // optional: guard | hold (see hold) | an AI profile
              "hold": 1,                  // optional: a hold pack (HoldActivation), size counted
              "wake": 4,                  // optional, with hold: the pack wakes in the enemy phase of this turn
              "weapon": "Hand Axe",       // optional: an authored weapon (applySpawnLoadout)
              "minRung": "hard",          // optional: only from this rung up (draws taken anyway)
              "minAct": "act2"            // optional: only from this act up (draws taken anyway)
            }
          ],
          "waves": [
            { "turn": 3, "spawns": [ { "col": 0, "row": 0, "classes": ["Zombie"], "level": -1 } ] }
          ]
        }
      ]
    }
  ]
}
```

- **Classes.** A list is uniform. A table keyed by act holds from its act up: in Act II a slot
  `{ "act1": ["Zombie"], "act3": ["Revenant"] }` draws from `["Zombie"]`. A class must be a
  real class and may be enemy-only.
- **Rung gates.** A set piece honours each rung's `enemyClassEarliestAct` (Dragons,
  Necromancers): the validator refuses a slot that is in play in an act where its rung holds
  that class back. It does not honour First Light's blanket ban on `DIFFICULTY_GATED_CLASSES`,
  which is a rule for the random pools. **Owner decision (2026-10-10): First Light does meet the
  Toll-House's Zombies.** The set piece is the story, and its text names what is there, so the
  Zombies are there on every rung (only there: no random pool gains them). Do not gate them.
- **Levels.** A filler slot takes `lo + floor(r × (hi − lo + 1)) + level`, the generator's
  filler rule. `[lo, hi]` is the battle's adjusted range (`levelRange` or the pool's range,
  plus `enemyLevelBonus`). A captain takes the elite captain's rule (`captainLevelFor`: `hi` +
  the act's captain offset) + `level`. Every slot's level is a spawn level on the one scale
  every foe uses, promoted classes included (`createPromotedEnemyUnit`: the base class to 12,
  the rest past promotion), so nothing is taken off a promoted captain. The captain's rung
  bonus is the elite captain's: none beyond the range.
- **Captains.** `isBoss: true` with the name. The scene adds `BOSS_STAT_BONUS` and the captain
  never carries items, as an elite captain doesn't. A captain is not an act boss: no boss
  node, no Sworn Enemy, no boss recruit and no earned pick. A Zombie captain leaves no
  remains (`leavesRemains`: a boss doesn't).
- **Hold packs and `wake`.** A `hold` pack sleeps until a member is threatened, hurt or killed
  (HoldActivation), so an army that waits was never attacked. `wake: N` (2 to 12, only with
  `hold`, the same on every member of a pack) adds a fourth rule: the pack wakes in the enemy
  phase of turn N (`spawn.holdWakeTurn` -> `unit.holdWakeTurn`, reason `'turn'`, the same
  once-per-turn check as the others, so a resume never checks twice). The validator refuses a
  `wake` without a `hold`, a turn outside 2..12 and a pack whose members disagree.
- **Waves** become the config's `reinforcements.scriptedWaves`, with each spawn's class and
  level resolved at generation. Their turns move with the rung's
  `reinforcementTurnOffset` and Hollow Hourglass, as every scripted wave's do.
- **Spare spawns.** The player spawns past the deploy count become the config's
  `formationSpares` (P4's field), so Formation offers authored tiles and never makes a draw.

### 3.2 Draw order (the seed's stream inside `generateSeededBattle`)

1. Variant: one draw, only when there are two or more variants.
2. Mirror: one draw, only when the variant allows it (`r < 0.5` mirrors).
3. Each enemy slot in order: two draws (class, then level), taken even when the slot is gated
   out or has a single class.
4. Each wave spawn in order: the same two draws.
5. Then the shared steps, in the generator's order: caster gear, then carried items (each on
   its own stream already), then affixes, then elite area arts.

### 3.3 Engine

- **`engine/AuthoredMap.js`** holds the map parser that Prologue.js and the set pieces share
  (`parseAuthoredMap`; `parsePrologueMap` is now an alias of it).
- **`engine/SetPieces.js`** (pure):
  - `findSetPiece(data, id)` and `setPieceIdOfConfig(config)`;
  - `setPieceDeployCap(setPiece)`;
  - `buildSetPieceBattle(...)`, which returns the map, spawns, slots and waves
    (`MapGenerator.generateSetPieceLayout` calls it, then the shared steps);
  - `validateSetPiecesConfig(config, data)`, which `npm run validate:data` runs.
- **Review route.** `?devScene=battle&preset=battle_smoke&setPiece=<id>[&act=N][&difficulty=]`
  opens a set piece directly (dev server and deploy previews only).
- **`MapGenerator.generateBattleLayout`.** When `params.setPiece` names a known set piece,
  the template steps (size, template, terrain, features, toxic overlay, spawn zones, enemy
  composition, NPC, caravan, village, escape, reachability carving, bridges, cavalry
  guarantees, assigned holders and the rout ladder) are replaced by the set piece's
  authored ones. The shared steps run unchanged:
  - caster gear;
  - carry;
  - affixes;
  - area arts;
  - the Hunted wave;
  - the Black Sun `templateWavesRaisePar`;
  - par offsets.

  The exceptions are the template steps' own rolls: a set piece's foes never roll
  `sunderWeapon` or `poisonWeapon` (those are the random pools' weapon riders; a set piece's
  loadouts are authored, `weapon` per slot), and a scripted wave's spawns carry no affixes.
  An unknown `setPiece` id (a save from a newer build) logs a warning and fights an ordinary
  template map instead of failing the battle's start.

  The config carries `templateId: "setpiece:<id>"`, `setPieceId`, `setPieceVariant` and
  `mirrored`. An unknown id in data is refused by `validate:data` before it ships.
- **`EventEffects.applyBattle`.** A `battle` step with `setPiece` calls
  `NodeMapGenerator.convertNodeToSetPieceBattle`. That writes
  `battleParams.setPiece`, `objective`, `deployCap`, the battle seed and the act-1 row scaling.
  Fog is the set piece's when it forces it, otherwise rolled as before. There is no template
  or biome draw.
- **Deploy.** `deployLimitsForParams` returns the act's limits with `cap: deployCap`, and
  `resolveDeployLimits` holds the max at the cap after the deploy bonus (min ≤ max). The deploy
  screen, the scout and the recruit node's cap all read it.
- **Place.** `ui/placeDisplay.battlePlace` reads a set piece's `title` and `lore` for a
  `setpiece:` config, so the battle card and the HUD name the Toll-House.
- **Saves.** Nothing new is stored on the run. The params carry the id, and the locked config
  carries the map. An event battle chosen before this shipped keeps its `templateId` and its
  ordinary rout.

### 3.4 Validation (`validateSetPiecesConfig`, part of `npm run validate:data`)

- Unique ids, a known objective (Phase A: `rout`), `deploy.max` from 1 to 8, and a
  `title` and `lore` within their limits.
- Each variant:
  - The map parses and is rectangular, between 6×6 and 16×12.
  - Player spawns are distinct, in bounds and on tiles that are passable and standable for
    Infantry and Cavalry (fliers aside), and there are at least `deploy.max` of them.
  - Enemy and wave tiles are distinct and in bounds, are not player spawns, and are passable
    for every move type their classes can roll, in both the normal and the mirrored map.
  - Every enemy tile and every player spawn is reachable from the first player spawn for
    Infantry. The generator never carves an authored map, so the data must already be
    reachable.
  - At least one enemy slot is in play at every rung and act the set piece can be fought on.
  - At most one captain.
- Each slot: real classes, an act table whose keys are act ids, gates that are real rungs and
  acts, a hold pack that is an integer, and a weapon that exists.
- Every `setPiece` named by an `events.json` battle exists, never beside a `recruit` (no NPC tile
  yet), and at every act the event reaches and every rung, each variant fields at least one
  foe, every slot in play has classes, and no class breaks the rung's act gate.

### 3.5 The Toll-House (two set pieces)

**`toll_house`** is the Dark Omen face's Search the hut. It is Zombies in a dead man's hut by a
rope bridge, under fog.

- The toll-keeper rises as the captain:
  - Act I: a Zombie.
  - Act III on: a Revenant.
- More Zombies wait inside and on the far bank.
- On turn 1 (the first enemy phase), two rise out of the bog behind the hut (a scripted wave).
  It is turn 1 on purpose: the engine cancels the waves still to come once a Rout's field is
  clear (`isRoutFieldClear`), so a turn-2 wave was skipped whenever the army cleared the map
  first (4 of 11 First Light wins in the harness). No army can clear this map in one player
  phase, so the rising is guaranteed without a new rule in the Rout predicate that every other
  map would then carry. (The alternative, holding the Rout open while a scripted wave is still
  due, is a change to `RoutObjective` for every template and the prologue; not worth it for one
  set piece.) Hollow Hourglass can still delay it a turn, as it delays every wave.
- The bridge is the only crossing.
- Smash matters: a fallen Zombie comes back unless its bones are stamped out (the
  ZombieRemains rule, already built).
- Zombies come to Act I (and to First Light) only here. The levels follow the battle's range.

**`toll_crossing`** is the plain face's failed Bluff. It is a bandit crossing, with archers on
the far bank in forts.

- The toll-keeper is the captain, with a bow:
  - an Archer in Acts I–II;
  - a Sniper from Act III.
- Fighters hold the bridge as a hold pack that wakes on turn 4 (`wake: 4`: the army has had
  three turns to cross or bait them, and a cautious army can no longer wait them out for good;
  the other guards keep their posts by design).
- A Thief guards the hut's strongbox.
- A shallow bog downstream is the slow flank.

## 4. Phase B: the set pieces that need nothing new

| Set piece | Event | What makes it the text |
|---|---|---|
| `deserters_camp` | Deserters' Fire | Night fog and exactly six deserters around a campfire tile in a clearing, with nothing outside it. |
| `ridge_rescue` | Old Faces | The recruit starts on the ridge with riders closing from both flanks; the army starts below. Needs an authored `npc` tile (the recruit builder's unit, seated by the set piece) and Cavalier slots. |
| `narrow_pass` | Deserters' Revenge | The army starts mid-pass, with slots on both cliffs (Forest/Mountain) and some foes carrying Ensnare. |
| `collectors_ford` | The Collectors | The clerk captain and four gloved guards at a ford (Bog/Water), with the strongbox on the far bank. |
| `armory_hall` | Abandoned Armory | A small castle interior (Floor/Wall/Pillar) and a holdout garrison holding as a pack. |
| `moneylender_road` | Moneylender | A road and the cart's four guards, as the intro says. |
| `mine_gallery` | Sunken Mine (Feel your way out) | Flooded galleries (Bog/Water) with forced fog; the "something that lives down here" as Zombies, plus a Revenant from Act III. |
| `mine_guardian` | Sunken Mine (Face the guardian) | A bone-bier chamber and an armoured captain (Knight / General) with Revival Stones authored on the slot (Phase C's Warden replaces it). |
| `hollow_rite` | Herald (Break the rite) | Ruins with a hooded captain (a Monk/Bishop until Phase D's acolytes), followers stepping out of the ruins as a turn-1 wave. |

Phase B also adds `npc` (an authored recruit tile) for `ridge_rescue`, and `seize` for any
set piece with a Throne and a captain on it.

## 5. Phase C: new mechanics (smallest first)

- **Stop the runner** (Collectors). The captain carries the strongbox and makes for a marked
  edge (`aiMode: 'flee'` to an exit). If he leaves the map, the fight is won but the spoils
  are forfeit. It is the escape objective reversed, and reads the escape tile machinery.
- **Break the rite** (Herald). Three braziers are attackable objects (a 0-MOV, 0-ATK unit
  class, `isObjective`). Each enemy phase while one stands past the rite's turn adds shadow to
  the Eclipse, committed at victory like any shadow. Breaking all three wins.
- **Darkness and torches** (Sunken Mine). Forced fog with `Torch` tiles that light a radius,
  and a Light action that lights one. Shallow water is Bog with its own name. Feel your way
  out becomes an escape to the ladder.
- **A moving objective** (Moneylender). The cart moves along an authored road each enemy
  phase; seize it before it leaves.
- **Interactive tiles** (Armory). Weapon racks you Visit (one weapon from the act's pool),
  and a barred door that opens when Smashed.

## 6. Phase D: new enemy types from the lore

Each type is its own class (enemy-only, validated like the Necromancer), with sprites from
the Imagen pipeline (red palette) and lore under the style guide.

- **Hollowed.** Soldiers touched by the Eclipse. Their stats rise with the run's shadow, read
  at battle start. They are the Dark Omen faces' foes.
- **Hollow Sun acolyte.** The Herald's followers, with a dark tome. A dimming aura shrinks
  player vision by 1 within 2 tiles in fog.
- **The Warden.** The mine's construct. Each Revival Stone is a plate, and each one broken
  trades DEF for SPD.
- **The Drowned.** Undead hidden under swamp water, unseen until adjacent (the fog ambush
  rule on any map).

## 7. Phase E: Echoes

The loop is canon: Sera reweaves the thread, and bosses half-remember. An **Echo** is a unit
the save lost in an earlier run, returning hollowed. It keeps its name, class, level, stats
and weapon from the record, with red palette and enemy AI. The Echo event (`the_echo`) gains a
fight against one.

The design needs:
- a per-save record of fallen units (slot meta, bounded, synced);
- an enemy built from a unit record;
- and the owner's go-ahead on reading across runs.

## 8. Tests

- `tests/SetPieces.test.js` covers:
  - The parser, the generator and determinism: the same seed gives the same config, and
    different seeds cover every variant and the mirror.
  - Draw stability: a rung-gated slot never moves another slot's class or level.
  - Levels and captains.
  - Waves into `scriptedWaves`.
  - Formation spares.
  - Deploy caps through the real `resolveDeployLimits`.
  - The validator, which refuses each bad shape.
  - The shipped data: every variant, mirrored and not, at every act and rung its events
    reach, generates a config that `validateBattleConfig` accepts.
- `tests/EventSetPieceBattle.test.js` covers:
  - The real event commands: choosing the Toll Bridge's Dark Omen search on the fight
    outcome writes `setPiece`. That proves the param travels into the battle.
  - `getBattleParams` → `generateSeededBattle` gives the Toll-House map with its captain,
    and locking keeps it.
  - The deploy cap.
  - The place name.
- A harness run (`tests/harness/SetPieceBattles.test.js`) plays both set pieces and an ordinary
  route battle as a control, from real runs' armies, with a careful policy and a reckless one, at
  First Light and Dusk in Act I (the Act III cell was dropped: the control itself is never won there, so it says nothing about the set pieces, and it cost a third of the run time). Every battle must end with the harness
  invariants holding, the deploy cap respected, a won Rout leaving no foe or remains, the
  Toll-House's bog wave always seen on a win and the Toll Crossing never running to the turn
  cap. `tests/harness/HeadlessSetPiece.test.js` pins that `HeadlessBattle` builds a set piece
  from `gameData.setPieces` itself and that a passive army meets the awake pack on turn 4. The
  sim driver deploys through `deployLimitsForParams` / `resolveDeployLimits` (a set piece's cap
  holds in simulated Act III), and the roster header's "Deploy up to N" reads the same rule while
  a set piece fight is waiting (`rosterDeploySlots`).
- Balance as measured (First Light, Act I, careful policy, 11 seeds): ordinary route battle 82%
  at 5.2 turns; Toll-House 73% at 7.5 turns before the guaranteed rising, 64% at 7.8 after it;
  Toll Crossing 73% at 12.8 turns with one run to the 40-turn cap before `wake`, 73% at 9.6 and
  none to the cap after (same maps and seeds). The harness now generates a set piece through
  `gameData.setPieces` on the ambient seeded stream, so its maps differ from those runs;
  on them the Crossing reads 10.6 turns with no stall.
