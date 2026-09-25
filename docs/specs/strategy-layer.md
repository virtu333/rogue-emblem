# Strategy layer — recruit nodes, spawn safety, blessing pacts

Status: built on `claude/strategy-layer` (2026-09-25). Proposals that were measured but
not built (guaranteed joins, new node types, an early church) are in
[`strategy-layer-proposal.md`](strategy-layer-proposal.md).

Code: `src/engine/RecruitNodeSystem.js` (new: previews, the recruit a node spawns),
`src/engine/MapGenerator.js` (`pickRecruitSpawnTile`, `orderSpawnsTowardTarget`,
`RECRUIT_REACH_BAND`), `src/engine/RunManager.js` (recruit-node API, blessing pacts,
deforge rule, new price effects), `src/engine/BlessingEngine.js` (pact validation and
cost roll), `src/ui/RecruitBeaconController.js` (new), `src/ui/loomModel.js` +
`src/ui/LoomPanels.js` + `src/ui/loom.css` (the Loom recruit card), `data/difficulty.json`,
`data/blessings.json`, `schemas/blessings.schema.json`, and the audit sim
`sim/strategy.js` with `sim/lib/TacticianAgent.js` and `sim/lib/RescueAgent.js`.

## Why

Playtest feedback (Player A):

> it feels like you should basically never take any route that doesn't optimize for #
> of recruits because getting a guy to fight is so much more valuable than anything else
> I can route for … or let you see who the guy is to exert more influence on roster
> construction

> recruit spawns on the other side of the map from me and is guaranteed dead before I
> can get to him lol

Designer: recruit nodes are meant to be harder and riskier ("more like an elite fight
and scarier"); the church is weak early; "Forbidden Tome is too strong; same with the
Scroll Archive; probably need bigger trade-offs. Does deforge even go negative?"

## How the numbers were measured

`npm run sim:strategy -- --section <name>` (new, `sim/strategy.js`). The stock harness agent charges and loses
its commander in most act-2 battles, so the audit uses a new **TacticianAgent**
(threat-map planning: it only attacks where the counter and the next enemy phase are
survivable, holds lords out of lethal reach, heals, and walks a lord to the recruit
and Talks). Runs use **casual-mode semantics** so a run can be measured to the end: a
KO'd non-commander sits out the battle and returns at 1 HP, a commander KO is counted
and the commander restored (a real run would be over). The driver heals between
battles (a player uses Vulneraries and staves), buys a Master Seal at level 15, takes
the highest-level boss recruit, hires the best affordable mercenary at a colosseum,
and stops a battle at turn 30 (counted as a stall). Seeds are fixed (Mulberry32), so
rows with the same `--seed` share maps and rolls.

| Section | Question | Method |
|---|---|---|
| `spawn` | Does the recruit live when you go for them? | 30 recruit-first invincible runs capture every recruit battle's real map, roster and params; each is replayed 4× with fresh battle seeds by a rescuer (walks a lord over and Talks) and by a player who ignores the recruit. Player units are invincible, the recruit is not. Geometry is measured on the generated map (lord path cost to the recruit's side, foes able to strike in enemy phase 1). |
| `unitvalue` | What is one more unit worth, next to other node rewards? | 150 battles per act on fixed squads (act-1 early/late, act 2, act 3) with one variable changed: +1 unit, −1 unit, +1/+2 levels, weapon tier up, arriving at 60% HP, and the recruit-node fight (+1 foe, +1 Lv, one affixed foe). Measured: battles with a commander KO. |
| `route` | Does routing for recruits dominate? | 20 full runs per policy (recruit-first, battle-first, church-first). |
| `graph` | How many recruit nodes can a route take? | 500 generated node maps per act. |
| `blessings` | How strong is each blessing and each price? | 12–24 recruit-route runs per row; Δ squad stat points at act end and commander-KO rate vs no blessing. |
| `arts` | What can Scroll Archive hand out on day one? | Every grantable scroll, its unlock act and expected damage vs sampled act-1 foes. |

Limits: the agent does not use items, weapon arts, forging or XP-shaping, so the rows for
XP/forge/heal/art prices read as zero; it is a careful but simple player, so absolute KO
rates are pessimistic and only the deltas are meaningful. Commander-KO rates move ±3
points between seed sets of 16–24 runs.

## Findings (before the change)

### Recruits are the only route value that compounds

- `unitvalue`, act 1 early (3 of 4 slots filled): **+1 unit cuts commander-KO battles
  from 20.7% to 10%** (−11 points) — as much as +1 level on every unit (−9) or a weapon
  tier (−9). In act 2 and 3 the same +1 unit is worth ~0 to −3 points, less than +2 levels
  (−11 to −13) or a weapon tier (−3 to −9). The value of a recruit is filling empty
  deploy slots early; after that it is roster depth.
- `graph`: the average map has 2.5 recruit nodes per act, the recruit-maximising route
  reaches 1.7–1.8 of them (≥2 on 64–72% of maps), and that route passes 1.2–1.9 services
  vs 2.0–2.9 on the best service route.
- `route` (recruit-first vs battle-first, same code): roster at the end of act 2
  6.7 vs 5.0, empty deploy slots 0.5 vs 1.2, commander-KO battles in act 2 45% vs 54%.
- A colosseum mercenary costs 400–1550 G and appears on ~0.6 colosseums per act; the sim
  hires 0.1–0.3 per act. A recruit node gives the same unit for free plus 1.2× battle gold.

### The recruit spawn lottery

Before, the recruit was placed by column bias alone. `spawn` (30 runs × 4, TacticianAgent):

| Act | Rescue: recruited | Died | Lord needs ≥3 turns | Ignored: recruit dies |
|---|---|---|---|---|
| act 1 | 99.3% | 0.7% | 0% | 52% |
| act 2 | 96.5–97.2% | 2.8–3.5% | 12–13% | 66% |
| act 3 | 91–96% | 4–8% | 16–18% | 84% |

By lord turns-to-reach: turn 1 → 100% recruited; turn 2 → 97%; **turn 3 → 73–84%;
turn 4+ → 39–55%**. Player A's "guaranteed dead" is the tail: one act-2/3 recruit battle
in six spawned the recruit 3+ turns away, where a careful player loses them a third to a
half of the time, and the recruit was marked only by a green palette (and a "?" in fog).

### Blessings

`blessings` (16–24 runs per row, recruit route; commander-KO % of battles, Δ squad stat
points at the end of act 3):

| Row | cmdrKO | Δ squad A3 |
|---|---|---|
| no blessing | 36.7–42.9 | 0 |
| **Forbidden Tome** (+15 all growths) | **25.1–29.9** | **+91 to +110** |
| Scholar's Vow (tier 2, +5 all growths) | 34.2–43.7 | +4 to +48 |
| other tier-4 boons (Arsenal Pact, Blood Forge, War Tutelage, Armory Stash) | 35–44 | −11 to +16 |
| tier-4 price −30% battle gold | ±0 | 0 (−840 G by end of act 1) |
| tier-4 price −2 DEF in act 1 | +4 | −1 to +6 |
| tier-4 price "Deforge lord weapons by 1" | ±0 | 0 — **void**: starting weapons carry no forge |
| tier-4 price +35% forge costs | ±0 | 0 |

Forbidden Tome was 11–14 points of commander-KO rate better than no blessing — three to
four times any other tier-4 boon — and its price was a random tier-4 roll, two of five
of which cost nothing in practice.

Scroll Archive (`arts`): 12 scrolls are grantable to the starting lords; **6 of them are
act-3/act-4 arts** (Dragonhaze, Nosferatu, Silence Strike, Courtbreaker, Sanctuary,
Dawn's Judgment — 2500–3000 G each in a shop, where they unlock only in act 3+). Dawn's
Judgment lifts Sera's expected damage vs act-1 foes from 53% to 84% of their HP per
exchange. Two of those on day one, for a random price.

**Deforge** (`ForgeSystem.deforgeWeapon`): never negative. It pops the last forge step
and returns `{ success: false }` on an unforged weapon, so the price did nothing unless a
lord weapon was already forged — which at run start never happens (Honed Blades /
Blood Forge forge *after* offers are rolled).

## What changed

### 1. Recruit nodes show who waits there

Every recruit node gets a fixed preview (`node.recruitPreview = { v, className, name }`)
when its act map exists, drawn from the act's recruit pool on its own seeded stream
(`recruit-preview:${runSeed}:${nodeId}`). Node-map generation's `Math.random` is not
touched, so maps are unchanged. Legacy saves are filled in on load; a node whose battle
is already locked shows the recruit that battle spawns.

The unit itself comes from `buildRecruitNodeUnit` on a second stream
(`recruit-unit:${runSeed}:${nodeId}`) plus the run's current state (roster, fallen,
meta, blessings). The Loom calls it to draw the card, the battle calls it to spawn the
NPC and the harness calls it to replay; with the same run state all three get the same
unit. It runs under a temporarily installed seeded `Math.random` and restores the
caller's generator, so the battle RNG is never consumed.

The Loom card (tap/hover a recruit knot, `.re-loom-recruit`) shows the crest, name,
`CLASS · LV n · SEASONED`, six key stats (STR or MAG, whichever is the attack stat),
the two best growths, and every trait with its per-unit text. The place line reads
"Garrick, a potential ally"; the body reads "Hunters are closing on Garrick. Reach them
with a lord and Talk." Eclipsed and walked recruit knots show no preview.

### 2. Recruit nodes are elite fights for better recruits

| Rule | Normal | Hard | Lunatic | Where |
|---|---|---|---|---|
| Extra hunters | +1 | +2 | +2 | `difficulty.json` `recruitEnemyCountBonus` (was 0 / 1 / 1) |
| Guaranteed affixed captain | 1 | 1 | 1 | `recruitAffixCount` (new; uses the Eclipse's guaranteed-affix channel) |

The Loom card shows both as red tags: `Hunters +1`, `Captain`. In exchange the recruit is
**seasoned**: joins at the average effective level of your strongest deploy-cap units
(not Edric-anchored), growth ranges roll in the upper half of each class range, and
they always carry at least one trait. Lord recruits and promotions follow the existing
rules. `unitvalue` puts the elite fight at +12 to +17 points of commander-KO rate in
acts 1–2 (+1 foe, one affixed): the price of a known, better unit.

### 3. The recruit spawns within reach, out of first-strike range, and is marked

`pickRecruitSpawnTile` scores every free, passable tile (never lava, acid, ice, throne or
ballista):

- **Reach**: the Infantry path cost for a lord on the nearest player spawn to stand beside
  the recruit must be within `RECRUIT_REACH_BAND` (2–8: by the second player phase);
  4–7 is preferred (straddles one infantry move, so a rescue usually means stepping
  toward the hunters).
- **Safety**: no enemy can strike the tile in the first enemy phase (real move costs per
  class, estimated weapon reach); tiles the enemy cannot reach by the second enemy phase
  score higher; forest/fort/cover scores higher.
- Fallbacks relax to one first-phase threat, then to a wider band; only a map with no
  reachable tile at all falls back to the old column-biased placement.

Player spawns are then ordered nearest-first to the recruit
(`orderSpawnsTowardTarget`) and lords take the first tiles
(`spawnTilesForDeployment(..., { lordsFirst: true })`), so a lord always starts closest.

`RecruitBeaconController` (BattleScene owns create / sync / destroy) draws a gilt banner
with a pixel `RECRUIT` label above the recruit and a slow verdigris halo on their tile,
above the fog layer, from turn 1. It re-derives everything from `scene.npcUnits`, so
Talk, a death, a rewind or a resume need no special cases. The objective panel names the
recruit ("Recruit: reach Garrick with a lord · Talk") and a one-time field note says
"Garrick (Cavalier) holds out under the gold banner. Reach them with a lord and choose
Talk before the hunters do." It replaces the fog-only "?" marker.

### 4. Blessing pacts

A blessing may carry a `pact`: a fixed price, shown on every offer (the card says
**Pact:** instead of **Cost:**) and replacing the rolled cost. `rollCostForBlessing`
still spends one draw for it, so every other offer's price is unchanged.

| Blessing | Before | After |
|---|---|---|
| **Forbidden Tome** (T4) | All growths +15; random tier-4 price | **Lords' growths +12.** Pact: **recruits' growths −10, all run.** Lore: "Chained on the crypt's top shelf. It teaches the blood of lords and bleeds the rest." |
| **Scroll Archive** (T4) | 2 random art scrolls (any act); random tier-4 price | **2 scrolls drawn from arts that open by Act II** (Grounder, Windsweep, Lunge, Hexblade, Healing Light, Seraphim for the default lords). Pact: **every weapon art costs +2 HP, all run.** Lore: "The seers inked every art in the reader's blood. Open one and the ink wants more." |
| Deforge price (T4 pool) | "Deforge lord weapons by 1" | "Lords' forged weapons lose one forge (never below +0)". Never offered while no lord weapon carries a forge (`isBlessingCostApplicable`); applied, it pops forge steps down to +0 and records `void` when there was nothing to take. Might never drops below the catalog value. |

Forbidden Tome candidates (commander-KO %, Δ squad A3, Δ lords A3; two seed sets):

| Candidate | cmdrKO | Δ squad A3 | Δ lords A3 |
|---|---|---|---|
| no blessing | 40.6 / 36.7 | 0 | 0 |
| old: all +15 | 26.6 / 25.1 | +102 / +97 | +23 / +78 |
| all +10 | 28.8 | +55 | +31 |
| all +15, run shadow +25 or +40 (Eclipse) | 26.3–27.2 | +101–110 | +4–12 |
| all +15, −2 DEF in act 1 | 30.8 | +105 | +65 |
| all +10, −2 DEF in act 1 | 35.9 | +66 | +25 |
| all +15, foes +1 level all run | 21.7 | +126 | +90 |
| lords +15 only | 28.6 | +48 | +72 |
| lords +15, recruits −10 | 28.2 / 25.6 | +24 / −1 | +78 / +66 |
| **lords +12, recruits −10 (shipped)** | **31.1** | **+17** | **+77** |
| scholar_vow (T2 reference) | 36.3 / 34.2 | +48 / +40 | +24 / +58 |

What the table rules out: a darker Eclipse start does nothing to the Tome (the act clock
drives node falls, and a stronger army clears faster); **"foes +1 level" is a boon, not a
price** (more XP per fight; −3 points of KO on its own) — the `enemy_level_delta` effect
was built for this test and stays available but unused; a flat act-1 DEF price only
shaves the early game. The lord-only Tome with a recruit price is the one that changes
what you do: it keeps most of the commander's safety (the thing the Tome is for) and
takes away the army-wide snowball, and it argues with the recruit route instead of
feeding it. +12 rather than +15 puts it between the old Tome and Scholar's Vow.

Scroll Archive's pact taxes exactly what it grants (arts cost 3–8 HP; +2 is 25–65% more)
and the act-II cap removes the late-act nukes; the agent does not use arts, so this is
priced from the `arts` table and shop prices (the grant was worth ~5000 G at shop prices,
~4000 G now).

**Save safety.** A running save stores its blessing and the price it paid
(`activeBlessings[i].rolledCost`), and run-start effects are applied once
(`_runStartBlessingsApplied`). Active runs therefore keep their old boon and old price:
growth deltas were baked into units and runtime modifiers when the run began. A legacy
save with no stored price migrates to a tier-pool price (`ignorePact`), never to a
pact. New fields: `blessingRuntimeModifiers.enemyLevelDeltas` (guarded default `[]`,
normalized on load). The elite recruit rules are difficulty modifiers, which a save
stores (`difficultyModifiers`), so a run begun before this change keeps its old recruit
fights until it ends.

New blessing effect types (engine only; data uses the first two through the pool/pacts):
`weapon_art_hp_cost_delta` (existing), `targeted_growths_delta` with `scope: "recruits"`
(existing), `starting_scroll.maxUnlockAct` (new param), `enemy_level_delta` (new, per act
or all run), `eclipse_shadow_delta` (new; darkens the run's sun without moving the act
clock).

## After the change

`spawn` (30 runs × 4, TacticianAgent, current code):

| Act | Rescue: recruited | Died | Lord reaches on turn 1 | Lord needs ≥3 turns | Foes able to strike in phase 1 | Ignored: recruit dies |
|---|---|---|---|---|---|---|
| act 1 | **100%** | 0% | 71% | 0% | 0.1 | 20% |
| act 2 | **100%** | 0% | 55% | 0% | 0 | 30% |
| act 3 | **100%** | 0% | 50% | 0% | 0 | 62% |

Before: 91–99% recruited, 12–18% of act-2/3 recruits 3+ turns away. The mean lord path
cost to the recruit's side is 3.9 / 4.6 / 4.8 (acts 1–3), the recruit sits at 10–20% of
the map width from the player edge, and half of act-2/3 rescues now take a second turn.
A first tuning that preferred reach 3–6 gave the same 100% with 75–82% turn-1 reaches.

`route` (20 runs per policy, current code, elite recruit fights):

| Policy | Act-1 cmdrKO | Act-2 cmdrKO | Act-3 cmdrKO | Roster end A2 | Empty slots A2 |
|---|---|---|---|---|---|
| recruit-first | 18.3% | 45.0% | 55.6% | 6.7 | 0.5 |
| battle-first | 17.5% | 53.5% | 58.3% | 5.0 | 1.2 |
| church-first | 17.8% | 49.6% | 70.6% | 5.2 | 1.2 |

The recruit route is no longer safer in act 1 (the elite fight costs what the extra body
saves there) and still ahead in act 2, where its extra units fill the fifth slot. That is
the intended shape: recruiting is a real investment with a visible payoff, not a free
dominant line. The proposal document covers what would close the act-2 gap.

## Tests

- `tests/RecruitNodeSystem.test.js` — previews (seeded, idempotent, unique names, legacy
  fill-in), the unit build (deterministic, seasoned growths, guaranteed trait, level
  rule, restores `Math.random`), spawn-tile order for deployment.
- `tests/RecruitSpawnSafety.test.js` — over generated maps for every act: reach band,
  nearest-first spawns, no first-phase strike (≥95%), no hazard/throne/ballista seat,
  cover preference, the picker's preference window and null fallback.
- `tests/RunManagerRecruitNodes.test.js` — battle mods from difficulty, preview ↔ battle
  params, locked encounters, save round trip.
- `tests/BattleSceneRecruitNode.test.js` — BattleScene spawns exactly the previewed unit
  on the NPC tile without consuming battle RNG and seats a lord nearest.
- `tests/RecruitBeaconController.test.js` — banner lifecycle, objective, one-time hint,
  reduced motion.
- `tests/BlessingPacts.test.js` — pact data and validation, fixed offers, draw parity,
  Scroll Archive act cap and blood price, deforge floor/void/applicability, new effect
  types, active and legacy saves (idempotent reload).
- `tests/e2e/strategy-layer.spec.js` — the Loom recruit card and the battle beacon at
  1280×800 and 844×390 (`?devScene=battle&devNode=recruit` is a new dev route).

## Deviations from the brief

- **Survival is not tuned below 100% for a player who goes for the recruit.** With the
  first-phase-strike rule and a lord seated nearest, a careful rescuer loses no recruits
  in the sim. The risk moved from the spawn lottery to the fight itself (an elite fight
  with a captain, the lord walking toward the hunters). A player who ignores the
  recruit still loses them 20–62% of the time. The preferred reach window (4–7) was
  measured against a farther one (6–9, a guaranteed second-turn rescue): on generated
  maps it dropped the first-phase-safe share to 92.5% (test floor 95%) and seated act-1
  recruits past 60% of the map width — Player A's complaint again.
- **Forbidden Tome's price is a pact on recruits, not an Eclipse price.** Shadow prices
  were measured and do nothing to it (table above).
- The `enemy_level_delta` and `eclipse_shadow_delta` effects are engine-only for now;
  no shipped blessing uses them.
- The mobile battle sidebar shows only the first objective line; the recruit line is on
  the map banner and in the field note, not in the sidebar.
