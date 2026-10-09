# Encounters and pacing

Status: proposal, revision 1 (2026-10-09). Specs only: no game code or data changes.
Branch `claude/large-maps-specs`. Part of the large-maps set ([README](README.md)); this
spec owns roadmap **Phase 0** (fixes worth doing anyway) and **Phase 2** (encounter groups
on today's templates). Spec `03` owns objective semantics and objective par; this spec
owns the trigger engine, the clocks and the pacing model they plug into.

Evidence: scratch scripts run on the real `HeadlessBattle`, `AIController`,
`MapGenerator` and `sim/pacing.js` (after `npm ci`; nothing tracked was changed). Line
numbers are as of `45cf27e` and drift.

## 1. Where we are

### 1.1 The clocks

| Clock | Rule | Where |
|---|---|---|
| Boss enrage | from turn `min(bossEnrageTurn 12, par + bossEnrageOverPar 2)`, live par (waves raise it) | `TurnBonusCalculator.js:180-198`, `turnBonus.json` `latePressure`, read by `TurnPressure.js:101-103`, `BattleScene.js:2964`, `BossPresenceController.js:126` |
| Anti-turtle | 3 enemy phases with no kill / lord step to throne or exit / escape → `aggressiveMode` (guards leave posts, throne clamp off); never wakes holders | `TurnPressure.js:78-110`, `constants.js:111` |
| Template waves | absolute `turn` + rung offset + seeded jitter; procedural edge tiles have **no** player-distance exclusion | `ReinforcementScheduler.js:238-249`, `:393-425` |
| Rout ladder (Dusk, Nightfall) | absolute turns T3/T4 … T10, one edge per wave, 3-tile exclusion | `RoutLadder.js:80-130`, `ReinforcementScheduler.js:431-455` |
| Late pressure, Eclipse | par-relative (decay past par + 2; shadow past par − 3, cap 6) | `TurnBonusCalculator.js:138-171`, `EclipseSystem.js` |

The scheduler is stateless: a turn's arrivals are a pure function of turn, seed, config
and occupancy, drawn on a stream keyed by turn (`mixSeed(seed, turn)`,
`ReinforcementScheduler.js:548`). Nothing records that a wave fired.

### 1.2 Holds: the one encounter mechanism

`engine/HoldActivation.js` (dusk-pressure §2b, PR 3) is the template for everything below:
- **Generation** (`assignHolders`, `:106-176`, called at `MapGenerator.js:495`): Dusk+
  seize/escape only (`difficulty.json` `holdShare` 0.35–0.55), non-boss spawns nearest the
  throne or exits, in packs linked within `HOLD_PACK_RADIUS` 3. No RNG. Excludes siege
  carriers, hazard tiles, Necromancers, heal-role units.
- **State on units**: `aiMode: 'hold'`, `holdPack`, `holdPackSize`, `holdPost`,
  `holdDisturbed`, `holdCheckedTurn`, `holdWoke`. They ride `serializeBattleUnit`
  (`BattleUnitState.js:12`, a shallow clone) into checkpoints and rewinds.
- **Wake** (`wakeHolders`, `:225-274`, called first in `AIController.processEnemyPhase`,
  `AIController.js:97`): enrage; disturbed (hurt, hexed, moved: `HoldDisturbance.js`,
  marked when it happens); a packmate gone; a visible member with a player or known NPC on
  its Danger tiles (`ThreatForecast.enemyThreatTiles` over PlayerKnowledge). Once per turn.
- **Telegraph**: "The garrison stirs!" if a woken holder is visible (`BattleScene.js:10433`).
  Nothing marks a holder before it wakes (only the prologue coach reads `isHolding`,
  `PrologueCoach.js:261`).
- Rout has no passive enemies by design (`MapGenerator.js:2308`: "to avoid passive enemies
  on rout maps"); the owner kept rout hold share at 0% (dusk-pressure §4).

### 1.3 Enemy-phase dead air

- `AIController.processEnemyPhase` waits a fixed `_delay(300)` after **every** enemy,
  holders and sleepers included (`AIController.js:129`); the speed setting never sees it
  (it is a `setTimeout`, `:1364`). The harness stubs it (`HeadlessBattle.js:471`).
- `animateEnemyMove` tweens every step (80 ms, 60 on ice; `BattleScene.js:10535-10580`)
  with no visibility check.
- Every `onUnitDone` writes a suspend checkpoint and a timeline row (`BattleScene.js:10470-10490`),
  each a full `rm.toJSON()` persist that, under the default rewind policy, also reseeds
  the battle RNG (`BattleSuspendController.js:94-110`). End Turn already writes the checkpoint the
  enemy phase replays from ("a refresh during the enemy turn resumes here and replays it on
  the same RNG stream", `BattleScene.js:4415-4428`).

### 1.4 Pathfinding

`computePath` (`Grid.js:415-497`) re-sorts its open array on every pop, keeps stale
duplicates, and floods the whole map when the goal is impassable or blocked.
`_findRecoveryFallbackTile` (`AIController.js:980-1008`) runs one A* per tile of a radius-2
diamond (13 tiles) per target, for every player and NPC, after two stuck phases (`:738`).

### 1.5 Measured (this spec's scratch runs)

**Contact at today's and set-piece sizes** (passive, unarmed, unkillable army; Act III; 8
seeds; "engaged" = the enemy made an attack decision by T16):

| Map | Engaged by T6 | by T16 | First attack per enemy p25 / median / p75 | First contact per battle |
|---|---|---|---|---|
| 16x12 rout, First Light | 79% | 94% | T3 / T4 / T5 | T2–T4 |
| 18x13 rout, First Light | 73% | 86% | T3 / T4 / T6 | T2–T3 |
| 22x14 rout, First Light | 77% | 94% | T4 / T4 / T6 | T1–T4 |
| 18x13 seize, Dusk | 34% | 76% | T3 / T7 / T13 | T1–T3 |
| 22x14 seize, Dusk | 41% | 87% | T4 / T7 / T11 | T2–T3 |
| 22x14 escape, Dusk | 58% | 74% | T4 / T4 / T6 | T2–T4 |

Within the README's size ceiling (24x16) the walk is not what breaks: contact is T2–T4
everywhere. What breaks is that on rout every enemy charges from T1 and arrives as one
conga line; the seize column shows the alternative (holds) and its cost (a cluster at
T10–11: that is enrage waking every pack).

**Boss enrage vs par** on boss seize maps (40 seeds each, deploy 7):

| Size | Rung | Walk (MOV 4) | Par | Enrage | Maps where the 12 cap binds | Enrage ≤ par |
|---|---|---|---|---|---|---|
| native (18x12/18x13) | First Light | 4 | 11 | 12 | 40/40 | 11/40 (Act III), 3/40 (Act IV) |
| native | Dusk / Nightfall / Black Sun | 4 | 8 | 10 | 0 | 0 |
| 22x14 | First Light | 5 | 12 | 12 | 40/40 | **40/40** |
| 22x14 | Dusk+ | 5 | 9 | 11 | 0 | 0 |
| 24x16 | Dusk+ | 5 | 9–10 | 11–12 | 1–2/40 | 0 |

The absolute cap is a First Light problem: there every boss map is capped, and from 22x14
up every one enrages at or before par, so an A-pace player meets an enraged boss.

**Rout pods, today's par** (`sim/pacing.js --holdRout 0.5`, the sim-only prototype that
holds the half of each rout garrison farthest from the player; calibrated edge
`act1:2,act2:6,act3:10,act4:12`; 48 paired seeds):

| Rung | Policy | Rout turns (mean) | Rout S% | Run shadow | Force-won stalls |
|---|---|---|---|---|---|
| Dusk | push, today / pods | 5.4 / 7.0 | 65 / 36 | 15.9 / 39.3 | 5 / 15 |
| Dusk | turtle, today / pods | 7.2 / 10.5 | 38 / 10 | 55.3 / 91.8 | 5 / 53 |
| Nightfall | push, today / pods | 7.2 / 8.8 | 41 / 21 | 41.0 / 67.9 | 11 / 25 |
| Nightfall | turtle, today / pods | 9.0 / 12.0 | 22 / 6 | 80.4 / 95.8 | 10 / 82 |

Pods do what they should (the turtle pays most: +36 shadow on Dusk against the push's
+23), but at today's par they cost the push two rating bands, and the stall count shows
the harness agents do not go looking for enemies that do not come. Hence §5 (par from the
walk) and §7 (an agent that seeks pods) come before any rout pod ships. (Today's baseline
has drifted up from dusk-pressure's shipped 35 / 10.3 for Dusk; re-baseline before
tuning.)

## 2. Phase 0: fixes worth doing anyway

Each is its own PR, ships with no encounter groups, and leaves old saves and locked maps
untouched unless stated.

### 2.1 Boss enrage never before par + 1

```
enrageTurn(par) = max(par + bossEnrageMinOverPar, min(bossEnrageTurn, par + bossEnrageOverPar))
                 (no par: bossEnrageTurn, as today)
```
New `turnBonus.json` key `latePressure.bossEnrageMinOverPar: 1`; `bossEnrageTurn` 12 and
`bossEnrageOverPar` 2 stay. `getBossEnrageTurn` is the only formula; TurnPressure,
BossPresenceController and the scene's warning already call it.

- **Changes only maps with par ≥ 12**, i.e. today: First Light boss maps with par 12
  (11/40 Act III, 3/40 Act IV), which enrage at par + 1 instead of at par. No Dusk+ map at
  today's sizes changes (par + 2 ≤ 12). On large maps any par ≥ 12 gets par + 1.
- **Rung order holds:** f(par) is non-decreasing, and par is First Light ≥ Dusk ≥ Nightfall
  ≥ Black Sun on every map (dusk-pressure §2b), so a harder rung never enrages later.
- The prologue's P4 (par 10, enrage 12) and the pinned cases in `TurnBonusCalculator.test.js:377-387`
  are unchanged.
- **Why not contact-based** (`max(par + 2, contact + k)`): enrage is the clock that
  punishes waiting. A clock that starts at contact is one the turtle controls: it delays
  contact and delays enrage. This spec keeps two kinds of clock apart: **par clocks**
  punish waiting (enrage, sallies, a `latest` bound on every wave); **contact clocks**
  answer an assault (relief columns, flank waves). Nothing that taxes the turtle may be
  contact-relative without a par-relative `latest`.
- Dropping the 12 cap entirely would move every First Light boss map one turn later
  (§9 Q1).

### 2.2 Hybrid arenas: walls and waves (confirmed bug)

**Confirmed** by `scratchpad/hybridbug.mjs` (real `HeadlessBattle`, both templates, every
rung, 4 seeds; traced per turn by `hybridtrace.mjs`):

| Template | First Light / Dusk | Nightfall / Black Sun (wave offset −1) |
|---|---|---|
| `act4_boss_intent_bastion` | 8 of 16 scripted spawns blocked: the T2 Fighter on `wave1_a` [8,1] and the T5 Knight on `wave2_a` [10,1] | all arrive; the T1 Fighter (a `guard`) is walled in where it stands at T2 |
| `act3_dark_champion_keep` | 8 of 16 blocked: the T3 Fighter on `wave1_a` [7,1], the T6 Knight on `wave2_a` [8,1] | 14–15 of 16 arrive (the misses: a tile already occupied); nobody walled in |

Why: the override runs at the **start** of enemy phase T (`BattleScene.js:9755`,
`HeadlessBattle.js:2280`) and writes Wall into `grid.mapLayout`, which is
`battleConfig.mapLayout` by reference (`Grid.js:509`, `BattleScene.js:1550`); the wave
for T resolves at the **end** of the same phase against that layout
(`ReinforcementSpawns.js:260`) and a scripted spawn has no fallback tile
(`ReinforcementScheduler.js:571-578`). On the −1 rungs the wave lands at the end of T−1
and the wall goes up under it, because `setTerrainAt` (`Grid.js:571-587`) is a raw setter.
Each wave therefore arrives at half strength on First Light and Dusk; par still rises by
1 (one unit arrived).

**Fix (one PR):**
1. **Engine.** `engine/TerrainPhases.js` (pure; the module `04` §7 names, exporting the
   `applyTerrainSetTiles(grid, setTiles, anchors, { occupants })` that `03` §6 names),
   used by `BattleScene` and the harness; the harness copy (`HeadlessBattle.js:1039-1088`)
   is deleted. It never writes terrain an occupant could not stand on (its move type) and
   returns those entries. For v1 hybrid overrides the caller **defers** them: they join
   `pendingHybridOverrideTiles` and are retried at each later enemy-phase start until the
   tile is free (`03`'s phases and `04` record and skip instead). The list rides `captureBattleWorldState`
   beside `appliedHybridOverrideTurns` (`BattleSnapshotState.js:20`) and the validator
   (`BattleStateSnapshot.js:175`).
2. **Not in `setTerrainAt`.** Restore writes terrain through it
   (`BattleSnapshotState.js:42-48`) and must reproduce a saved board exactly, including a
   unit an old save left on a wall. The check belongs to the override applier.
3. **Data.** Move the conflicting spawns to arena tiles no override touches: bastion
   Fighter [8,1] → [9,1] (`wave1_b`, defined and unused), Knight [10,1] → [10,2]; keep
   Fighter [7,1] → [6,1], Knight [8,1] → [9,1]. Every wave then arrives whole on every
   rung, and the walls go up as authored. Locked configs keep their copy and get only the
   deferral.
4. **Validator** (`MapTemplateEngine.validateMapTemplatesConfig`): refuse an override
   target equal to a scripted spawn tile whose wave resolves on or after the override's
   turn on any rung (`turnOffsetByDifficulty` applied).
5. **Measure.** Normal and Dusk Act III/IV boss battles get +2 enemies; run
   `test:harness:pr` and `sim:fullrun:pr` with threshold notes if a slice moves.

The arenas' absolute coordinates on wider maps (README §1 item 6) belong to hybrid v2
(`04`); this PR does not change their placement.

### 2.3 Binary-heap A*

Replace the sorted array in `computePath` with a binary heap ordered by **(f, insertion
sequence)**, skip stale entries (`g > best g`), and return null at once when the goal is
impassable for the move type or held by a blocking occupant (start = goal still returns
`[start]`).

- **Exact.** Stable sort + `shift` pops the lowest f, earliest inserted; so does the
  (f, seq) heap. Step costs are ≥ 1 (`getMoveCost` clamps at 1, `Grid.js:703-710`), so
  Manhattan is consistent and skipping stale entries changes nothing.
  `scratchpad/astar_heap.mjs`: 48,000 queries (generated maps at 18x13 and 24x16, real
  occupancy, 4 move types): **0 mismatches**.
- **Speed** (desktop node, per call): reachable goal 0.053 → 0.026 ms at 18x13, 0.089 →
  0.037 ms at 24x16; unreachable 0.20 → 0.010 ms and 0.39 → 0.005 ms.
- Optional: component labels per (move type, `terrainRevision`), so a goal on a terrain
  island returns null without a flood. `computeMovementRange` (`Grid.js:223-266`) has the
  same re-sort but MOV-bounded floods (~0.07 ms); it gets the heap only if a profile asks.

### 2.4 Recovery fallback: branch and bound

In `_findRecoveryFallbackTile` and `_findPathAwareChaseTile`, which both keep the
shortest path by node count with strict `<`:
- memoise paths per tile within one decision (adjacent targets share diamond tiles);
- skip a tile whose lower bound `manhattan(enemy, tile) + 1` is ≥ the target's best path
  so far or ≥ the best over all targets (it can never win a strict `<`).

Exact by construction; `scratchpad/recovery.mjs` checks each live call against the
shipped function: **0 mismatches** over 137 calls; A* calls 8,387 → 4,204 (18x13) and
2,702 → 1,067 (24x16), time 911 → 431 ms and 176 → 23 ms (before the heap). With §2.3's
early exit, diamond tiles held by players cost nothing. A hard cap (say 64 A* per
decision) is a fallback only if a profile still shows spikes: unlike the above it changes
decisions.

### 2.5 Enemy-phase dead air

Scene-side rules; the engine gains one callback.

1. **Beat only after something the player saw.** `processEnemyPhase` calls
   `await callbacks.afterUnit?.(enemy, decision)` instead of the fixed `_delay(300)`
   (kept as the default when no callback is given). The scene waits
   `combatDuration(scene, 300)` under a new `COMBAT_WAITS` label `enemy_between_units`
   (`combatTiming.js`: Fast halves it, Instant is 1 ms, hold-to-fast applies) **only** if
   the enemy moved through a visible tile, struck, healed, used a staff or broke a wall
   where the player sees either end (`historyUnitVisible`); otherwise 0.
2. **No tween in the dark.** `animateEnemyMove` skips the hidden prefix and suffix of the
   path (fog on, tiles not `grid.isVisible`) and sets the unit on its last tile; a fully
   hidden move is one position update. The final state is identical; only presentation
   changes.
3. **No checkpoint for a turn that resolved nothing.** An enemy whose decision has no
   path, target, heal, staff or break (`hold`, `asleep`, `guard_hold`, `healer_hold`,
   `no_reachable_move` without a break) is marked acted and dimmed but writes no
   checkpoint and no timeline row. Why the anti-refresh guarantee survives:
   - A no-op draws no RNG (AIController has no `Math.random`; the enemy art roll,
     `EnemyArtScoring.js:120`, happens only in combat) and depends only on state the last
     checkpoint holds, so a resume replays the skipped turns identically, bookkeeping
     included (`_aiNoMoveStreak`, `holdCheckedTurn`).
   - The next acting enemy's checkpoint, or the turn-start checkpoint, carries them.
   - With every enemy idle, the phase replays from End Turn's checkpoint on the same RNG
     stream, which is already the designed recovery.
   - It removes "X waited" rows from the rewind timeline. Nobody rewinds to before a wait.
4. **Two small ones `01` hands over.** A desktop hold key (holding Shift in the enemy phase
   sets `_holdBattleFast`, as the phone's `HoldBattleSpeed.js` control does; not Space,
   which dismisses hints and dialogue, `HintDisplay.js:148`, `DialogueOverlay.js:246`), and the
   enemy heal banner names its target only if the player can see it (`canInspectUnit`;
   today it does not check, `BattleScene.js:10447-10456`).

Effect: today an 11-enemy phase spends 3.3 s in these delays at every speed. After the
fix an idle or hidden enemy costs 0 and a seen one 300 / 150 / 1 ms (Normal / Fast /
Instant): with five holders and two fogged movers Normal saves 2.1 s, Instant 3.3 s, and
pods (§3) add no dead air. An e2e spec (`enemy-phase-pacing.spec.js`, battle lane) times
a seeded phase with N holders at Instant: each holder adds < 50 ms.

### 2.6 Prune locked configs at `advanceAct`

`battleConfigsByNodeId` is reset only at run start (`RunManager.js:538`, `:741`, `:817`)
and grows about 2.4 KB per battle all run. Node ids carry the act (`NodeMapGenerator.js:86`),
and every reader asks for a node of the current map or the battle in progress
(`RunManager.js:2886-2898`, `:3315`, `:3591`, `:4067`; `RouteEdit.js:264`;
`SlotManager.js:328`); the pending reward keeps its own `draw` and the checkpoint its own
`battleConfig`. So `advanceAct` (`RunManager.js:4458`) resets it beside
`shopStateByNodeId` (`:4477`). Test: reload across an act transition, resume a locked node
of the new act.

## 3. Encounter groups (Phase 2)

### 3.1 The model

An encounter group is a set of enemies that share one awareness: they sleep, patrol or
fight together. Every enemy belongs to at most one group (`unit.encounterGroupId`); an
ungrouped enemy is awake from turn 1 (today's behaviour). Group state lives in
`encounterState` (§6), never in a private flag. One pure module, `engine/EncounterGroups.js`,
with its trigger evaluator `engine/EncounterTriggers.js` (shared with waves here and
with `03`'s phases), is called by `BattleScene` and `HeadlessBattle` at the same point
`wakeHolders` is called today (top of `AIController.processEnemyPhase`).

### 3.2 Schema

**Battle config** (written at generation, locked like every field; README §3):

```jsonc
"encounterVersion": 1,
"encounterGroups": [
  {
    "id": "pod:1",                       // unique; procedural: "picket", "pod:<n>", "patrol:<n>"; legacy: "hold:<pack>"
    "members": [4, 5, 7],                // indices into enemySpawns at generation; each spawn also carries encounterGroupId
    "state": "asleep",                   // picket | asleep | patrol | awake (initial)
    "wake": [                            // any one fires; README trigger vocabulary
      { "kind": "danger" },
      { "kind": "hurt" },
      { "kind": "groupWoken", "group": "pod:0", "delay": 1 }
    ],
    "onWake": { "mode": "hunt", "together": true },
    "route": null,                       // patrol or column: anchor names, e.g. ["ford", "mill"] (04's `route`)
    "loop": true,                        // patrol loops; a column (false) stops at its last anchor and holds
    "telegraph": { "wake": "encounter.garrison_stirs", "warn": "encounter.camp_rousing", "inspect": "encounter.holding" }
  }
]
```

- `members` is the generation record; runtime membership is the living units carrying
  the id (reinforcements may join, §4). `telegraph` values are content keys
  (`src/data/encounterContent.js`) or a set piece's own strings.
- **Template**: optional `"encounters"` overrides the rung's plan (`false` opts out, as
  `"ladder": false` does); an authored map's groups are `04`'s format, which must produce
  this schema.
- **Rung plan** (`difficulty.json` `encounterPlan`, every rung incl. `dusk`, validated in
  `DifficultyEngine`): `{ rout: { picketShare, podRadius, minPod, chain } | null }`.
  Seize and escape keep `holdShare` (§3.6).

### 3.3 States and transitions

| State | AI | Leaves when |
|---|---|---|
| `picket` | awake from turn 1, today's chase | never (it is awake) |
| `asleep` | `aiMode: 'hold'` on members whose role is empty or `guard`; members with their own role (heal, Necromancer guard, artillery) keep it | any wake trigger, or boss enrage |
| `patrol` | `aiMode: 'patrol'`: seek the current `route` anchor (`aiTargetTile`), advance `unit.patrolIndex` on arrival (within 1), loop (or, a column, hold at the end); attacks only a blocker (the seek_tile pipeline, `AIController.js:792`) | any wake trigger, or boss enrage |
| `awake` | `onWake` applied once | final |

The member's `aiMode` is the effect; the group's state in `encounterState` is the record.
The validator checks they agree (an asleep group has no living ordinary member without
`aiMode: 'hold'`).

### 3.4 Wake triggers, precisely

All triggers are evaluated at **one point**: the encounter check at the top of each enemy
phase, once per turn (`encounterState.checkedTurn`, the group-level `holdCheckedTurn`: a
phase resumed from a mid-phase checkpoint never checks again). Events that happen mid-phase
(`hurt`, `objective`, a hostile exchange) are noted when they happen and read at the next
check. A trigger with `delay: d` found true at the check of turn T takes effect at the
check of turn T + d (fired ledger, §6); conditions are `≥`, never `===`, so a resume or a
rewind skips nothing, and each trigger fires once. Order within a check: enrage, `hurt`,
`tile`, `danger`, `sight`, `objective`, `turn`, then `groupWoken` cascades to a fixed point
in group order; then contact (below).

| kind | Fires when | Default delay | As the player sees it |
|---|---|---|---|
| `danger` | a member the player can see (`isThreatSourceVisible`) has a player unit or known NPC on its `enemyThreatTiles` (PlayerKnowledge positions). Exactly today's hold rule 1 | 0 | red zone = wake zone; a fogged member never wakes this way |
| `sight` | a player-side unit stands within the member's vision range (`VISION_RANGES[member.moveType]`, Manhattan, the rule fog uses for the player, `Grid.js:956`; `constants.js:478`: Infantry/Armored 3, Cavalry 4, Flying 5) | 0 | if no member is visible as it wakes, the band says so without placing it ("Movement in the fog") |
| `hurt` | a member was damaged, hexed or moved (`HoldDisturbance` marks, written by every damage, status and displacement path; its guard widens from `aiMode: 'hold'` to any member of an `asleep` or `patrol` group), or a member fell (living < `size`). Today's rule 2 | 0 | the player caused it |
| `groupWoken` | group `group` woke (at any check) | 1 | warn band at fire time ("The camp stirs…"); its members' zones get the waking style |
| `tile` | a player-side unit **stands** on the anchor or in the region at the check (`battleConfig.anchors`, `04`'s field). Optional `by: { group }`: a living member of that enemy group stands there instead (`04`'s Parade). A Canto step on and off does not count | 0 | the anchor is marked on the map (`01`) |
| `objective` | `03`'s objective engine emitted `{ kind: 'objective', id, outcome: 'done' \| 'failed' }` (`EncounterTriggers.noteObjectiveEvent`, stamped with the turn); `on: done \| failed \| either` | 1 | warn band at fire time |
| `turn` | `{ afterContact: n }`: check turn ≥ contactTurn + n; `{ parOffset: -k }`: check turn ≥ live `turnPar` − k; `{ afterPhase: n }` (`03` §5.10): n turns into the current phase; any may carry `latest` (a `parOffset` or, legacy, `turn`): fires at the earlier | 1 | warn band at fire time; the objective line names the turn |

- **Boss enrage** wakes every `asleep` and `patrol` group, as it wakes holders today
  (unless an authored group sets `ignoreEnrage`). It is a battle-wide rule, not a trigger.
- **Anti-turtle never wakes a group** and never releases a `guard` posted by `onWake`
  (dusk-pressure: "otherwise a turtle would only have to wait 3 phases"). Rolled
  First Light guards keep today's release.
- **Cost:** a `danger` check is one movement flood per sleeping member until its group
  wakes (dusk-pressure measured "about 8 at most", the cost of one Danger zone); stop at
  the first member that fires.

**Contact** (`encounterState.contactTurn`, null until set; never unset except by a rewind
past it). Set at the first check (turn T) at which any of these holds:
1. a group has woken by `danger`, `sight`, `hurt` or `tile`;
2. a hostile exchange has been noted: any combat or area strike between a player-side
   unit and an enemy, noted by `PostCombatEffects` (`world.noteHostileExchange`, one site
   that the scene and the harness both drive, `PostCombatEffects.js`, `AreaStrike.js:81`);
3. a player-side unit stands on the Danger tiles of an awake, player-visible enemy
   (today's rule 1 applied to awake units).

contactTurn is the check's turn, not the exchange's. It is deterministic (a phase
boundary, the board as checkpointed), it is something the player saw, and the awake
picket guarantees it on any map with one (§3.5): the turtle cannot postpone it by
standing still.

### 3.5 Generation on today's templates

No new draws on any stream: groups partition the spawns `generateEnemies` already placed,
by distance rules alone, after `assignHolders` and the guard roll (`MapGenerator.js:2308-2322`,
`:495`).

| Objective | Rule |
|---|---|
| seize, escape (Dusk+) | today's hold packs become `asleep` groups `hold:<pack>`, wake `[danger, hurt]`, `onWake: hunt`. Everything else stays ungrouped (awake). Behaviour identical to today (§3.6) |
| seize, escape (First Light) | none (guards as today) |
| rout (rung's `encounterPlan.rout`, owner-gated, §9 Q2) | **picket**: the `ceil(picketShare × n)` (≥ 2) non-boss spawns nearest the player-spawn centroid, awake. **Pods**: the rest, as connected components within `podRadius` (3); components smaller than `minPod` (2) join the nearest pod within 5, else the picket. Each pod `asleep`, wake `[danger, hurt]` plus `groupWoken` from every pod within `chain` (6) tiles, delay 1. Same exclusions as holders (siege carrier, hazard tile, Necromancer stays in its role). The village's bandit wave and the ladder are unchanged |
| any | a template with `"encounters": false`, a recruit node's guardian, and the prologue (authored `holdPack`, read by the adapter) get nothing new |

Patrols, columns and `guard` posts are for authored maps (`04`) and a later procedural pass: a patrol
needs named waypoints that mean something on the map, which procedural templates do not
have.

### 3.6 HoldActivation becomes a group

- **Old configs and checkpoints** (no `encounterGroups`, units with `holdPack`):
  `groupsFromHoldPacks(spawns or units)` derives groups `hold:<pack>` at battle start, and
  `encounterStateFromUnits` derives their state on restore (asleep iff a living member
  has `aiMode: 'hold'`; `checkedTurn` = the members' `holdCheckedTurn`). Unit fields stay
  as they are: they are save data.
- **New configs** write both `encounterGroups` and the unit-level hold fields (`aiMode`,
  `holdPack`, `holdPackSize`), so a build without the module (rollback) still plays them.
- **Parity, then deletion.** PR 2.1 runs the new engine and `wakeHolders` side by side in
  tests over a golden record (every wake reason, turn and pack, across the
  `Determinism.test.js` scenarios plus 40 seeded Dusk+ seize/escape battles), must match
  exactly, then deletes `wakeHolders` and the harness's private copies. `onHoldersWoke`
  keeps its shape for the prologue (`PrologueController.onHoldersWoke`).

### 3.7 onWake

| mode | Behaviour | Built on |
|---|---|---|
| `hunt` (default) | clear `aiMode`: today's chase and attack | a woken holder |
| `guard` (protect an anchor) | `aiMode: 'guard'`, `guardPost` = the anchor tile, `guardRadius` (default 3) replaces the literal 3 at `AIController.js:303`. Exempt from anti-turtle release (above); released by enrage | `guard` |
| `seek` | `{ mode: 'seek', anchor, then }`: `seek_tile` to the anchor (a sally to a gate; `03`'s fleeing assassination target with `then: 'exit'`, which `03` resolves), then `then` (default `hunt`) on arrival | `seek_tile` |
| `retake` | `{ mode: 'retake', point }` (`03` §5.7): `seek_tile` to the capture point's tile whenever the player holds it, else `guard` it | `seek_tile`, `guard` |

`together: true` gives the woken members one shared priority target, chosen at the wake
check: the player-side unit nearest the group's centroid (by the AI's full knowledge, as
targeting is today). Members still move by the ordinary chase. Staying close as a pack
belongs to `enemy-ai-profiles.md`'s `friendZone` term, and the scored chase it would need
is held by owner decision (its §6.3), so this spec adds no movement cap.

### 3.8 Telegraphs and Danger

- Every wake is shown or told (README pillar 7; design log: no untelegraphed ambushes,
  `docs/design-log.md:703`):
  - a visible wake gets the group's band (default "The garrison stirs!");
  - a delayed wake (`groupWoken`, `objective`, `turn`) gets a warn band when it fires,
    one player phase before the group moves;
  - a hidden `sight` wake is told without a position.
- **Danger stays truthful and undimmed.** A sleeping member's zone is its full reach:
  entering it wakes the group at the next check, and the group acts in that same phase.
  A dim zone would read as "safe-ish", and it is not. `ThreatForecast` sources gain
  `asleep: true`, so the overlay (`01`) can mark the source (a resting pip, a dashed edge)
  without lightening the tile. Enemy inspect gets one line from `telegraph.inspect`
  ("Holding: wakes if you enter its reach").
- The objective line and the phone chips get a group summary from a pure model
  (`encounterHudModel`: "2 camps unaware"), in the style of `secondaryObjectiveStatus`.

### 3.9 Enemy-phase order

For configs with `encounterGroups`, the enemy loop runs in a stable order: ungrouped
enemies and the picket in array order, then each awake group in group order, members in
array order. Sleeping members are processed as no-ops, with no beat and no checkpoint
(§2.5). Grouping keeps a pod's moves together for the enemy-phase camera (`01`). Legacy
configs keep array order, so their decisions match the golden record.

## 4. Waves timed by triggers

`battleConfig.reinforcements` gains `triggeredWaves` (written at generation; old configs
have none):

```jsonc
"triggeredWaves": [
  { "id": "relief", "when": { "kind": "turn", "afterContact": 2, "latest": { "parOffset": -2 } },
    "delay": 0, "count": [2, 3], "side": "behind", "minPlayerDistance": 4,
    "xpMultiplier": 0.5, "levelBonus": 1, "joinGroup": null, "telegraph": "encounter.relief" }
]
```

- **When.** Any trigger from §3.4. Fired at the encounter check of turn T; the wave
  arrives at the end of enemy phase T + `delay`, as every wave does today (it acts from the
  next enemy phase). `latest` is required on `afterContact` waves (the par-clock rule,
  §2.1).
- **Side**, resolved **at fire time** from the live positions of the player's own units
  (never hidden information): `front` (the edge beyond the nearest awake enemies on the
  player-to-enemy centroid axis, `RoutLadder.routLadderEdges`'s rule applied to live
  centroids), `behind` (the opposite edge), `flank` (the side edge nearer the player
  centroid; ties hashed as the ladder hashes flank order), `edge:<name>`,
  `anchor:<name>` (tiles within 2 of an anchor). The resolved edge is written to the
  ledger and named in the warn band and the objective line ("Riders: east edge, end of
  turn 6"), so unlike the ladder's telegraph it need not hedge.
- **Tiles**: `collectEdgeSpawnCandidates` plus `minPlayerDistance` (default 3) and the
  ladder's NPC exclusion; no legal tile on the side sends the whole wave to `front`.
- **Stream**: count and tiles come from the wave's own stream, `mixSeed(seed,
  hash('wave:' + id))`, never the turn stream (`ReinforcementScheduler.js:548`): it never
  shifts another arrival, whatever turn it fires on.
- **Par-neutral** by default, like the ladder (`raisesPar: true` opts in). A rout field
  clear cancels pending triggered waves (`isRoutFieldClear`).
- **The ladder and template waves stay absolute** in Phase 2. The ladder is the
  anti-turtle clock. Moving template waves to `{ afterContact: turn − 2, latest: { turn:
  turn + 1 } }` is a tuning item, measured before it ships.
- **Procedural waves get the 3-tile exclusion** on configs generated after the PR
  (`reinforcementContractVersion: 2`). Old locked maps keep v1, whose seeded draws the
  exclusion would shift.
- **Recorded**: `encounterState.fired['wave:<id>'] = { firedTurn, dueTurn, edge, arrived }`.
  The scheduler takes the due entries as input and stays pure. `arrived` and the existing
  `_enemyPhaseReinforcedTurn` guard keep a resume from spawning a wave twice.

## 5. Enemy count, density and par

### 5.1 Count by groups, not by area

`rollEnemyCount` (`MapGenerator.js:2328-2369`: deploy count + act/row offset, capped by
`enemies.json` `enemyCountByTiles`) stays the one draw on the battle stream. On today's
templates groups partition its result, so the count does not change.

A set piece (`04`) spends a budget in groups:
- **Awake at once** ≤ `rollEnemyCount(...)`: the picket plus every group that can wake
  by turn 2 without a player choice. The player fights today's ordinary force at once.
- **Total** ≤ `1.6 × rollEnemyCount(...)`, split by group weights on the set piece's keyed
  stream. Large maps add stages, not a bigger blob.
- `enemyCountBonus` goes to the set piece's `overflow` group (default: the picket).
- More kills mean more XP: §7 measures levels at each act's end before a set piece ships.

### 5.2 Par from the walk and the stages

A config whose groups include an `asleep` or `patrol` group uses par model
`groups-v1` (locked as `parModel` with its inputs, so a resume never recomputes it); every
other config keeps `calculatePar` exactly.

```
W     = turns for the slowest lord (MOV 4 Infantry, SeizeParFloor.turnsToReach) from the
        nearest deploy tile along the primary route: seize → throne; escape → nearest exit;
        rout → each pod's post in nearest-neighbour order from the deploy centroid;
        other primaries → the route spec 03 names
S     = Σ over engagements √|e|: the picket and ungrouped enemies are one engagement; each
        sleeping group the route must defeat is another (rout: all; seize/escape: groups
        whose spawn-time Danger tiles touch the route path, or that 03 marks required)
raw   = ceil( 0.8 × ( b_obj + α·W + β·S + terrainPenalty + objectiveAdjustment ) )
par   = today's rung pipeline on raw (difficulty multiplier, parInflation, parBonus,
        parOffset), then max(par, W + 3 + bossTurns), capped at the map's First Light par
        as calculatePar caps parFloor today
```

- The area term goes: W measures the walk directly. β·S replaces `min(0.6n, 1.3√n)`. Since
  √ is subadditive, splitting a force into stages costs more than one blob, which is what
  the player pays (approach, regroup, re-engage).
- **Starting values**: α = 1, β = 1.3 (today's coefficient), `b_obj` = today's
  `objectiveBasePar` − 1 (the walk now carries the approach the base stood for),
  `bossTurns` = 1 (SeizeParFloor's margin).
- **Calibration** (`sim/pacing.js --out`, §7): for each objective, regress the push
  policy's turns on (W, S) over ≥ 300 generated battles per rung; set α and β so the push
  median lands at par − 3 on Dusk (dusk-pressure: Dusk push ≥ 75% S+A), and check:
  - residual within ±1 turn for 80% of maps;
  - S reachable for a straight push on ≥ 95% of maps;
  - Dusk turtle − push gap ≥ 15 shadow (§1.5's pods-at-today's-par runs measure 52.5,
    today 39.4);
  - Nightfall ≥ 10 above Dusk for each style;
  - First Light within ±1 of today's par on maps without pods.
- **Eclipse and late pressure** keep their formulas: both are par-relative, so an
  accurate par is the whole job. A par two turns tight costs every player about 2 shadow
  a battle. Enrage follows the new par through §2.1.

## 6. Determinism, persistence, harness

- **Streams.** No new draw on any existing stream. Procedural groups use distance rules
  only; set-piece composition and patrol choices use `keyedBattleRandom(battleSeed,
  'groups:<id>')` (`BattleRng.js:24`); triggered waves use their own stream (§4). A
  test generates 200 seeded maps per objective before and after PR 2.5: positions,
  classes, levels and every other field are identical apart from the encounter fields.
- **Battle state** (one object, `encounterState`, in `captureBattleWorldState` /
  `restoreBattleWorldState`, so the suspend checkpoint and the Vision snapshot carry it
  together, `BattleSnapshotState.js:9-29`, `VisionRewindController.js:138`):

```jsonc
"encounterState": {
  "version": 1,
  "checkedTurn": 4,
  "contactTurn": 2,
  "hostileExchangeTurn": 2,
  "groups": { "pod:1": { "state": "awake", "wokeTurn": 3, "reason": "danger", "size": 3 } },
  "fired": {
    "pod:2/groupWoken": { "firedTurn": 3, "dueTurn": 4 },
    "wave:relief": { "firedTurn": 4, "dueTurn": 4, "edge": "left", "arrived": true }
  },
  "objectiveEvents": [{ "id": "captain_a", "outcome": "complete", "turn": 4 }]
}
```

- **Validator** (`BattleStateSnapshot.validateBattleState`): known group ids and states,
  integer turns ≥ 1, `dueTurn ≥ firedTurn`, members' `aiMode` agreeing with the group's
  state, at most 64 fired entries. A snapshot without `encounterState` derives it (§3.6).
- **Units**: `encounterGroupId`, `patrolIndex`, `guardPost`/`guardRadius` are plain
  fields that `serializeBattleUnit` carries.
- **Harness parity.** `HeadlessBattle` calls the same `EncounterGroups.check(...)` with
  `_playerThreatContext()`, and notes exchanges through its post-combat world. Deleted
  copies: `_applyDueHybridOverridesForTurn` (§2.2) and its `wakeHolders` path.
- **Prologue**: unchanged (`isScriptedBattle` gates generation; P4's authored holds run
  through the adapter).

## 7. Measurement and tests

**Metrics** (added to `sim/pacing.js` records and `--out`, reported per rung × objective ×
policy, 48 paired seeds, calibrated edge):
- `contactTurn` and the first-attack turn per enemy (distribution, as §1.5);
- share of enemies that engage by battle end, and groups woken per battle with the reason
  mix;
- turns per battle, turns − par, S/A/B/C, run shadow, and the paired turtle − push gap;
- force-won stalls (must stay ≤ 2× baseline, dusk-pressure §3), `no_reachable_move` and
  recovery-fallback counts;
- AI time per enemy phase, p95 (budget 50 ms on a mid-range phone, enemy-ai-profiles §2.2).

**Agent first.** `TacticianAgent` gains a seek mode: with no foe in reach and sleeping
groups left, advance on the nearest group's post (push) or the nearest pod's Danger
edge, then bait (turtle). Without it pods measure the agent (§1.5's 53 Dusk turtle
stalls), not the map.

**Tests** (each catches one failure; expected values derived by hand):

| Failure | Test |
|---|---|
| Enrage formula wrong or rungs invert | `TurnBonusCalculator.test.js`: hand cases (par 10 → 12, 11 → 12, 12 → 13, 14 → 15, null → 12); property: non-decreasing in par |
| Hybrid waves still blocked or walled in | `HybridArenaWaves.test.js`: both templates × 4 rungs × 6 seeds, every scripted spawn arrives, no unit on Wall at any check; deferral round-trips a checkpoint; validator refuses the old data |
| Heap A* changes a path | property test against a frozen copy of today's `computePath` (the 48,000-query harness above, seeded) |
| Recovery prune changes a decision | frozen copy vs new over the passive-battle calls (`recovery.mjs` as a test) |
| A skipped checkpoint breaks resume | scene test: an enemy phase with three holders, resume from the last checkpoint, identical end state and RNG cursor |
| Pruning loses a needed config | reload across `advanceAct`; resume a locked node of the new act; promised-recruit names unchanged |
| Legacy holds change | golden wake record (§3.6) matches exactly; `Determinism.test.js` hashes unchanged |
| A trigger fires twice or never | per kind: fires once; `≥` across a resume that skipped the exact turn; delay lands on T + d; cascade order fixed |
| Danger wake reads hidden units | paired worlds differing only by a hidden unit (`PlayerKnowledgePreviews.test.js` style) wake identically |
| Contact can be postponed by waiting | a passive army on a picket map gets `contactTurn` ≤ the picket's arrival; an `afterContact` wave with `latest` fires by `latest` with no contact |
| Encounter state lost on rewind or resume | round trip through `captureBattleWorldState` and the validator, mid-phase and at turn start |
| Generation draws RNG | seeded map identity before/after (§6) |

## 8. PR breakdown

| PR | Content | Behaviour change | Effort |
|---|---|---|---|
| 0a | §2.1 enrage formula + data key + tests | First Light boss maps with par ≥ 12: enrage one turn later | 0.5 day |
| 0b | §2.2 `TerrainPhases.js`, deferral, data fix, validator, harness copy deleted | Normal/Dusk Act III–IV boss arenas get their full waves | 1.5 days + harness notes |
| 0c | §2.3 heap A* + early exit; §2.4 branch and bound + memo | none (exact) | 1 day |
| 0d | §2.5 `afterUnit` beat, hidden-move skip, no-op checkpoint skip, e2e timing spec | presentation only; fewer timeline rows | 1.5 days |
| 0e | §2.6 prune at `advanceAct` | smaller saves | 0.25 day |
| 2.0 | metrics and the agent's seek mode in `sim/pacing.js`; baseline report in this spec | none | 1 day |
| 2.1 | `EncounterGroups.js` + `EncounterTriggers.js` with `danger`/`hurt`, legacy adapter, `encounterState` persistence and validator, golden parity, `wakeHolders` deleted | none | 2.5 days |
| 2.2 | `sight`, `tile`, `groupWoken`, `objective` hook, `turn`, contact, warn bands, `asleep` sources in ThreatForecast, inspect line, HUD model | none until data uses it | 2.5 days |
| 2.3 | `triggeredWaves`, sides, keyed stream, ledger, contract v2 exclusion | new configs only: procedural waves avoid the player by 3 | 2 days |
| 2.4 | patrol and column, `guard`/`seek`/`retake` onWake, `together`, group order | authored maps only | 2 days |
| 2.5 | rout picket/pods behind `encounterPlan.rout` (shipped `null`), par `groups-v1`, sims at 48 seeds per rung and policy, tuning, owner sign-off | yes, rung by rung, after sims | 3–4 days |

Phase 0 PRs are independent. 2.0 lands before 2.5 can be judged. 2.1 is the gate for
everything else in Phase 2 and for `03`'s phases.

## 9. Open questions for the owner

1. **Enrage cap.** Keep 12 as a cap that may pull enrage to par + 1 (this spec: changes
   only par ≥ 12), or drop it (every First Light boss map enrages one turn later)?
2. **Rout pods.** dusk-pressure kept rout hold share at 0%. With par `groups-v1`, do rout
   pods ship on Dusk+ (and on First Light only in set pieces), or stay set-piece-only?
3. **First Light set pieces**: do sleeping pods and patrols appear there at all (README Q2)?
4. **Hybrid arena intent**: should the walls seal the wave's entry after it arrives (then
   the override turn becomes the wave turn + 1 on every rung) rather than the spawn
   moving (this spec's data fix)?
5. **`together`**: is a shared target enough, or should the profile spec's held scored
   chase be reopened for woken pods only?
6. **Template waves**: convert Dusk+ seize/escape template waves to contact-relative with
   a `latest` bound, if the sims show it narrows the push/turtle gap the right way?

## 10. Notes for the README

1. **`asleep` collides with the Sleep status.** Code already has `isSleeping` (the Sleep
   staff, `AIController.js:134`) and the player reads "Asleep!". This spec keeps the
   contract's id but never shows the word: the player sees "Holding" / "Unaware". Consider
   renaming the state to `dormant` before code lands.
2. **`hurt` includes hexed.** Today's rule wakes on a status as well (`HoldDisturbance`
   `'status'`); the vocabulary table says "damaged, moved or killed".
3. **Boss enrage is not a trigger kind.** It is the battle-wide wake that holds use today;
   §3.4 keeps it outside the table.
4. **`turn` needs `latest`.** `{ afterContact: n }` alone lets a turtle postpone it; this
   spec makes `latest` (par-relative) required on contact clocks, and defines contact
   (§3.4).
5. **Enrage evaluation.** The README's "6–8 turns before par" is at 40x24, beyond its own
   ceiling. Within 24x16 (§1.5) the cap binds only on First Light: every boss map there,
   and from 22x14 up every one enrages at or before par; Dusk+ is unaffected.
6. **Hybrid bug: confirmed**, and its shape is two-fold: on First Light/Dusk the wave is
   blocked (half of each wave lost), on Nightfall/Black Sun the wall is set under an
   arrived guard. The fix is not an occupancy check in `Grid.setTerrainAt` (restore
   depends on it being raw) but in the override applier.
7. **`members`** are spawn indices at generation; spawns and units also carry
   `encounterGroupId`. Runtime membership is the units.
8. **One terrain module, one anchors field.** `03` names the function
   `applyTerrainSetTiles`, `04` the module `engine/TerrainPhases.js`, and this spec uses
   both. Anchors resolve into `battleConfig.anchors` (`04`'s proposal), which the `tile`
   trigger reads. The README should list both. The README's pointer to the hybrid bug
   (`02` §8) is §2.2 here.
9. **`tile` may name an enemy group** (`by: { group }`), as `04`'s Emperor's Parade needs;
   the vocabulary table says player units only. Objective events use `03`'s words
   (`done` / `failed`).
