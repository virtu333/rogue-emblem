# Encounters and pacing

Status: proposal, revision 4 (2026-10-09). Takes in the cross-review of the spec set and
`05`'s notes (the boss trigger kinds, the signature slot, court re-orders).
Specs only: no game code or data changes.
Branch `claude/large-maps-specs`. Part of the large-maps set ([README](README.md)); this
spec owns roadmap **Phase 0** (fixes worth doing anyway) and **Phase 2** (encounter groups
on today's templates). Spec `03` owns objective semantics and the non-walk par terms
(`parAdjust`); this spec owns the trigger engine, the clocks, the pacing model they plug
into and **the par formula** (§5.2), and the one terrain module, `engine/TerrainPhases.js`
(§2.2), that `03` and `04` call.

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

**Fix (one PR, 0b):**
1. **Engine.** `engine/TerrainPhases.js` (pure), created in this PR and owned by this
   spec, with one signature:
   `applyTerrainSetTiles(grid, setTiles, anchors, { occupants })`. `BattleScene` and the
   harness call it for hybrid overrides; `03`'s phases (`onEnter.setTiles`, its PR 4) and
   `04`'s hybrid v2 (its PR E) **call** it and extract nothing. The harness copy
   (`HeadlessBattle.js:1039-1088`) is deleted here. It never writes terrain an occupant
   could not stand on (its move type) and returns those entries. For v1 hybrid overrides
   the caller **defers** them: they join
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

**On the critical path for the first set piece.** Phase 0 is otherwise optional and
parallel, but this PR (0d) is not: a set piece fields 15–25 enemies, most of them holding
for most of the battle, so without it every enemy phase of The Mill Ford spends 4.5–7.5 s
in fixed pauses alone (300 ms each, at every speed). It lands before `04`'s first map
(§8, "Vertical slice").

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
4. **Two small ones `01` hands over.** A desktop hold key: **Shift held alone, and only
   while `battleState === 'ENEMY_PHASE'`**, sets `_holdBattleFast`, as the phone's
   `HoldBattleSpeed.js` control does (the phone's `canHoldBattleSpeed` also admits a
   player-phase combat; the desktop key is narrower). In the player phase Shift is the
   modifier of `01`'s Shift+N (previous unit, `01` §2.8) and never touches the speed, so
   the two never collide; releasing Shift, or the phase ending, clears the flag. Not Space,
   which dismisses hints and dialogue (`HintDisplay.js:148`, `DialogueOverlay.js:246`).
   And the enemy heal banner names its target only if the player can see it (`canInspectUnit`;
   today it does not check, `BattleScene.js:10447-10456`).

Effect: today an 11-enemy phase spends 3.3 s in these delays at every speed. After the
fix an idle or hidden enemy costs 0 and a seen one 300 / 150 / 1 ms (Normal / Fast /
Instant): with five holders and two fogged movers Normal saves 2.1 s, Instant 3.3 s, and
pods (§3) add no dead air. An e2e spec (`enemy-phase-pacing.spec.js`, lane `presentation`,
beside `battle-speed.spec.js`; `tests/e2e/lanes.json` has no `battle` lane) times a seeded
phase with N holders at Instant: each holder adds < 50 ms.

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
    "state": "dormant",                   // picket | dormant | patrol | awake (initial)
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
| `dormant` | `aiMode: 'hold'` on members whose role is empty or `guard`; members with their own role (heal, Necromancer guard, artillery) keep it | any wake trigger, or boss enrage |
| `patrol` | `aiMode: 'patrol'`: seek the current `route` anchor (`aiTargetTile`), advance `unit.patrolIndex` on arrival (within 1), loop (or, a column, hold at the end); attacks only a blocker (the seek_tile pipeline, `AIController.js:792`) | any wake trigger, or boss enrage |
| `awake` | `onWake` applied once | final |

**An initially awake group** (`state: 'awake'` in the config) applies its `onWake` at
battle start: the generator writes it onto the members' spawns as `aiMode` /
`aiTargetTile`, exactly as the village's bandits are written today
(`VillageSystem.buildBanditScriptedWave` puts `aiMode: 'seek_tile'` and the village tile on
each spawn; `BattleScene.addEnemyFromSpawn`, `BattleScene.js:2639-2647`, and the harness's
`_addEnemyFromSpawn`, `HeadlessBattle.js:958-966`, copy both onto the unit). Nothing runs
at the first check, and the group never "wakes" (`groupWoken` cannot name it; validated).
Before PR 2.4 this covers `hunt` (no `aiMode`) and `seek` onto a `visit` anchor, where
`VillageSystem` resolves the arrival: once the village is visited or razed, every
`seek_tile` unit on the map turns to chase (`clearSeekTileBandits`, `VillageSystem.js:358`,
called at `VillageController.js:157` and `:180`), so a 2.4-less `seek` to any other anchor
would also be released by the village. `then`, `guard`'s anti-turtle exemption and
`retake` need 2.4 (which scopes that release to the village's own seekers). So The Mill
Ford's raiders (`awake`, `seek` the village) ship without 2.4.

The member's `aiMode` is the effect; the group's state in `encounterState` is the record.
The validator checks they agree (a dormant group has no living ordinary member without
`aiMode: 'hold'`).

### 3.4 Wake triggers, precisely

All triggers are evaluated at **one point**: the encounter check at the top of each enemy
phase, once per turn (`encounterState.checkedTurn`, the group-level `holdCheckedTurn`: a
phase resumed from a mid-phase checkpoint never checks again). Events that happen mid-phase
(`hurt`, `objective`, a hostile exchange) are noted when they happen and read at the next
check. A trigger with `delay: d` found true at the check of turn T takes effect at the
check of turn T + d (fired ledger, §6); conditions are `≥`, never `===`, so a resume or a
rewind skips nothing, and each trigger fires once.

**Order within a check** (each slot takes the triggers newly true at T with delay 0 and the
ledger entries due at T):
1. boss enrage;
2. `hurt`;
   - 2b. **`boss`** (`05` §4.3): the group wakes and triggered waves that name `bossBar` or
     `bossHp`. A phase `until` of either kind is evaluated in slot 7, like every `until`;
3. `tile`;
4. `danger`;
5. `sight`;
6. `objective`;
7. **the phase slot** (`03` §6, its `checkPhase`): the current phase's `until` is
   evaluated here, whatever its kind (one trigger, or a list of which any one fires); a
   phase with no `until` whose primaries are all done also advances here (a phase whose
   primaries every later phase shares never does: completing them was the victory, `03`
   §4). At most one advance per check (the next phase's `until` arms at the
   next check). On an advance,
   `objectiveState.phase` and `objectiveState.phaseStartedTurn` (`03` §3.4) are set to the
   new index and T, and **every `onEnter` effect applies here**: terrain through
   `TerrainPhases.applyTerrainSetTiles` (§2.2), the wakes `onEnter.wake` names (reason
   `phase`, delay 0) and the band's record in the ledger;
   - 7b. **the boss signature** (`05` §5.1, `engine/BossSignature.js`): for the living boss
     that carries `battleConfig.bossSignature`, first resolve what was told at the last
     check (`bossState.signature.pending`), then plan the next tell. After the phase slot,
     so a phase's `onEnter.signature` patch is read in the same check; before `turn` and the
     cascade, so a `court_order` it resolves is a wake the cascade sees;
8. `turn` (so an `afterPhase` clock reads the phase just entered);
9. `groupWoken`, cascading to a fixed point in group order (a group woken by slots 1–8,
   `onEnter.wake` included, starts the cascade);
10. contact (below).

Nothing that a phase changes happens before this check: `03` may show its NEW OBJECTIVE
band the moment the last primary resolves, but terrain, wakes and the phase index move only
when the next enemy phase starts. `BattleObjectives.evaluate` (called after every action)
reports progress and victory and, for a phase with no `until` whose primaries have just
resolved, only emits `phase_ready` (the band's cue); it never advances a phase. Only
`checkPhase`, in slot 7, does.

| kind | Fires when | Default delay | As the player sees it |
|---|---|---|---|
| `danger` | a member the player can see (`isThreatSourceVisible`) has a player unit or known NPC on its `enemyThreatTiles` (PlayerKnowledge positions). Exactly today's hold rule 1 | 0 | the dashed outline (§3.8, always drawn) and the red zone are the wake zone; a fogged member never wakes this way |
| `sight` | a player-side unit stands within the member's vision range (`VISION_RANGES[member.moveType]`, Manhattan, the rule fog uses for the player, `Grid.js:956`; `constants.js:478`: Infantry/Armored 3, Cavalry 4, Flying 5) | 0 | if no member is visible as it wakes, the band says so without placing it ("Movement in the fog") |
| `hurt` | a member was damaged, hexed or moved (`HoldDisturbance` marks, written by every damage, status and displacement path; its guard widens from `aiMode: 'hold'` to any member of a `dormant` or `patrol` group), or a member fell (living < `size`). Today's rule 2 | 0 | the player caused it |
| `groupWoken` | group `group` woke (at any check) | 1 | warn band at fire time ("The camp stirs…"); its members' zones get the waking style |
| `tile` | a player-side unit **stands** on the anchor or in the region at the check (`battleConfig.anchors`, `04`'s field). Optional `by: { group }`: a living member of that enemy group stands there instead (`04`'s Parade). A Canto step on and off does not count | 0 | the anchor is marked on the map (`01`) |
| `objective` | `03`'s objective engine emitted `{ kind: 'objective', id, outcome: 'done' \| 'failed' }` (`EncounterTriggers.noteObjectiveEvent`, stamped with the turn); `on: done \| failed \| either`, **default `done`** (so `04`'s `objective: mill` means "when the mill is done") | 1 | warn band at fire time |
| `turn` | `{ afterContact: n }`: check turn ≥ contactTurn + n; `{ parOffset: -k }`: check turn ≥ live `turnPar` − k; `{ afterPhase: n }` (`03` §5.10): check turn ≥ `objectiveState.phaseStartedTurn` + n (`03` §3.4: written at every advance, 1 for phase 0, validated ≥ 1); any may carry `latest` (a `parOffset` or, legacy, `turn`): fires at the earlier | 1 | warn band at fire time; the objective line names the turn |
| `bossBar` (`05` §4.3) | `{ broken: n }`: the kit's boss (the unit carrying `bossKit`) has broken at least `n` Revival Stones, `revivalStonesMax − revivalStones ≥ n`; `n` may be `'last'` (= `revivalStonesMax`). Required `fallback`, a `bossHp` or `turn` trigger (never `bossBar`), used instead when the boss carries fewer than `n` stones on the rung, or none for `'last'` (decided at compile from `spawn.revivalStones`, validated). True for a fallen boss. May carry `latest` (a `parOffset` or, legacy, `turn`): fires at the earlier | 0 | the stone's own beat (`RevivalStoneController`) at the blow; the band at the check |
| `bossHp` (`05` §4.3) | `{ below: share }`: the kit's boss stands at `currentHP < maxHP × share` on its current bar at the check (at 0.5 exactly `checkBossHalfHealth`'s `currentHP * 2 < maxHP`, so the line and the trigger agree); a bar broken since the last check counts as crossed, as `checkBossHalfHealth` counts it. True for a fallen boss. May carry `latest`, as `bossBar` | 0 | the boss's `halfHealth` line at the blow, as today; the board changes at the check |

**Default delays.** The column is the default for a **group wake** when the trigger names
no `delay`: 1 for `groupWoken`, `objective` and `turn` (the warn band gets one player phase
before the group moves), 0 for the rest (`bossBar` and `bossHp` included: like `hurt`, the
player's own blow caused them). A triggered wave's `delay` (§4) and a phase
`until`'s delay default to 0 for every kind: a wave already arrives at the end of the enemy
phase and acts a phase later, and a phase's `until` is the phase's own clock (`afterPhase:
3` means three turns, as `03` §5.10's par contribution of exactly n assumes).

- **Boss enrage** wakes every `dormant` and `patrol` group, as it wakes holders today
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
| seize, escape (Dusk+) | today's hold packs become `dormant` groups `hold:<pack>`, wake `[danger, hurt]`, `onWake: hunt`. Everything else stays ungrouped (awake). Behaviour identical to today (§3.6) |
| seize, escape (First Light) | none (guards as today) |
| rout (rung's `encounterPlan.rout`, owner-gated, §9 Q2) | **picket**: the `ceil(picketShare × n)` (≥ 2) non-boss spawns nearest the player-spawn centroid, awake. **Pods**: the rest, as connected components within `podRadius` (3); components smaller than `minPod` (2) join the nearest pod within 5, else the picket. Each pod `dormant`, wake `[danger, hurt]` plus `groupWoken` from every pod within `chain` (6) tiles, delay 1. Same exclusions as holders (siege carrier, hazard tile, Necromancer stays in its role). The village's bandit wave and the ladder are unchanged |
| any | a template with `"encounters": false`, a recruit node's guardian, and the prologue (authored `holdPack`, read by the adapter) get nothing new |

Patrols, columns and `guard` posts are for authored maps (`04`) and a later procedural pass: a patrol
needs named waypoints that mean something on the map, which procedural templates do not
have.

### 3.6 HoldActivation becomes a group

- **Old configs and checkpoints** (no `encounterGroups`, units with `holdPack`):
  `groupsFromHoldPacks(spawns or units)` derives groups `hold:<pack>` at battle start, and
  `encounterStateFromUnits` derives their state on restore (dormant iff a living member
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
| `seek` | `{ mode: 'seek', anchor, then }`: `seek_tile` to the anchor (a sally to a gate), then `then` on arrival: `hunt` (default) or `exit`, `03`'s fleeing assassination target (`{ mode: 'seek', anchor: <exit>, then: 'exit' }`, `03` §5.5), which `03` resolves (the target leaves the map). The validator accepts these two values only | `seek_tile` |
| `retake` | `{ mode: 'retake', point }` (`03` §5.7): `seek_tile` to the capture point's tile whenever the player holds it, else `guard` it | `seek_tile`, `guard` |

**Re-orders** (`05` §5.2 `court_order`, §4.1 `onEnter.court`). A boss kit may give an
`awake` group new orders: they rewrite its members' `aiMode`, `guardPost`, `guardRadius` and
`aiTargetTile` through the same writer as `onWake` (one writer, so a re-order and a wake
cannot disagree). Orders take this table's modes and may set `guardRadius` and
`ignoreEnrage: false` (an authored group's `ignoreEnrage` cleared, so enrage releases it as
any group). A re-order is not a wake: the state stays `awake`, no `groupWoken` fires and no
wake band plays (the phase's or the tell's band says it). It is recorded in the ledger
(`order:<group>:<source>`), so a resume never re-applies it. An order given at a phase's
`onEnter` may carry `delay: n` (whole enemy phases): it is due at the check of T + n and
gets a warn band at the check that gives it, as a delayed group wake does (§3.8). An order
on a `dormant` or `patrol` group is its wake, with that order as its `onWake`.

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
  `dormant: true`, so the overlay (`01`) can mark the source (a resting pip) without
  lightening the tile. Enemy inspect gets one line from `telegraph.inspect`
  ("Holding: wakes if you enter its reach").
- **Sleeping groups' outlines are always drawn**, Danger on or off (Danger is off by
  default, and a `danger` wake acts in the same enemy phase, so a warning shown only under
  Danger is no warning). For each `dormant` or `patrol` group with a member the player can
  see, the board draws a dashed border around the union of its seen members' reach: the
  `dormant: true` sources over PlayerKnowledge positions, the same tiles the wake reads, so
  the line is exactly where the group wakes. No fill (the fill stays Danger's). It is
  recomputed when the board changes (an action, a wake, a phase switch) and dropped when the
  group wakes. Rendering and depth are `01`'s (its Danger layer); the tile set is this
  spec's (`encounterOutlineTiles` in `EncounterGroups.js`, pure). Open question: whether
  the first `danger` wake of a battle should also get a delay-1 warn band before it moves
  (§9 Q7).
- The objective line and the phone chips get a group summary from a pure model
  (`encounterHudModel`: "2 camps unaware"), in the style of `secondaryObjectiveStatus`.
- **Guidance at the point of use: `guide_holding`.** The first time on a slot that the
  player can see a member of a `dormant` or `patrol` group (legacy hold packs included, so
  today's Dusk+ seize and escape maps teach it too), one essential note, in the Act 1
  follow-through style: `GUIDANCE_NOTES.guide_holding: { tier: 'essential' }`
  (`engine/Guidance.js`), raised by `GuidanceController` in `PLAYER_IDLE` (the branch that
  holds `guide_objective_changed`: after it and `priorityNote`, the commander and recruit
  notes, so survival is said first; before the remains note), anchored on the nearest seen
  member, once per slot (HintManager), never in the prologue or a scripted battle
  (`GuidanceController.level()` is `off` there, `GuidanceController.js:95`). Text: "These
  foes are Holding. They stay put until you step inside the dashed line, hurt one, or
  something wakes them. Holding foes still strike anyone who comes into reach." The
  prologue's P1 tip `p1_holding_enemy` teaches the
  same subject, so `NOTE_HINT_IDS` (`src/data/prologueContent.js`) maps it to
  `guide_holding`, read only once the tip is read, as the other prologue lessons are. `03`
  owns the notes for a phase switch (`guide_objective_changed`) and a bonus's cost.
- **History words** (the battle history and the rewind picker, `BattleHistoryRecorder` /
  `BattleTimelineRecorder`). The check queues plain facts on `scene._timelineFacts`, which
  the next recorded entry carries (the first acting enemy's checkpoint, or, if §2.5 leaves
  the phase with none, the next turn start), and never a position the player could not see
  (`historyUnitVisible`):

  | Event | Fact |
  |---|---|
  | a wake with a seen member | the group's wake band, as a sentence: "The garrison stirs." |
  | a wake with none seen | "Movement in the fog." |
  | a delayed wake fired (warn) | the warn band: "The camp stirs. It moves next enemy phase." |
  | a phase switch | "New objective: <the new primary's goal sentence>." (`03` §11.2's words) |
  | a phase switch that keeps the primary (`03` §6, `05` §4.5) | the phase's band (`onEnter.line`) as a sentence: "The posterns open." Never "New objective" |
  | a boss signature resolved (`05` §7.6) | its history words: "The Calculation falls on 3 tiles." (never a hidden position; a hidden tell is told in words alone) |
  | a triggered wave fired | "Reinforcements coming: <edge> edge, end of turn <n>." |
  | a triggered wave arrived | "Reinforcements arrived: <edge> edge." |

  The edge is already public (it is named in the warn band and the objective line, §4).
  None of these adds a rewind row: rewind destinations are player-phase entries only, and
  the hand-off to the enemy phase is no destination under the fixed-RNG policy (a legacy
  battle shows it as "Before the enemy phase"; `RewindDestinations.listRewindDestinations`),
  so the words land in the enemy phase's history records, which is where the player looks
  for what happened while they waited. §2.5's removal of "X waited." beats is unaffected.

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
- **Awake at start** ≤ `rollEnemyCount(...)`, by the rule below. The player fights at most
  today's ordinary force at once.
- **Total** ≤ `1.6 × rollEnemyCount(...)`, split by group weights on the set piece's keyed
  stream. Large maps add stages, not a bigger blob.
- `enemyCountBonus` goes to the set piece's `overflow` group (default: the picket).
- More kills mean more XP: §7 measures levels at each act's end before a set piece ships.

**Awake at start, the one rule** (`04` §4.3 and its validator check 7 cite this; computed
at generation from the resolved config, per rung, no draw). An enemy counts when it can act
against the army by the check of turn 2 whatever the player does:
1. every ungrouped enemy and every member of a `picket` or `awake` group;
2. every member of a `dormant` group with a wake trigger whose **earliest fire turn + its
   delay ≤ 2**, where earliest is taken optimistically:
   - `danger` / `sight`: 1 if the zone the check would read at turn 1 (members'
     `enemyThreatTiles` with only the enemies placed; vision range for `sight`) covers any
     tile of the deploy region, since the formation may put a unit anywhere in it; else
     never;
   - `turn`: `afterContact: n` → 1 + n (contact at turn 1 at the earliest);
     `parOffset: -k` → the locked par − k; `afterPhase: n` → the earliest the phase can
     start (phase 0: 1) + n; `latest` → its own value; the earliest of these;
   - `groupWoken`: the named group's earliest wake (by this rule) + delay; `onEnter.wake`:
     the earliest the phase can start;
   - `tile`: 1 if the anchor overlaps the deploy region, or, with `by: { group }`, that
     group counts by this rule and can stand on the anchor by the end of enemy phase 1;
     else never;
   - `objective`: 1 if `on` admits `failed` (a foe can cause a failure); else never;
   - `hurt`: never (the player causes it);
   - `bossBar` / `bossHp`: never (the player's blow causes them, as `hurt`), except their
     `latest`, and a `turn` fallback, which count by the `turn` rule;
3. every member of a `patrol` group, unless every route tile it can reach by the end of
   enemy phase 2 (twice its slowest member's MOV, by path cost) lies farther than its
   members' reach (MOV + longest weapon range) from every deploy tile; a patrol's own wake
   triggers then count as in 2.

Bosses and elite captains are outside the budget (extra, as today). Boss enrage never counts
(it is ≥ par + 1, §2.1).

### 5.2 Par from the walk and the stages

**This spec owns the par formula.** `03` contributes only non-walk terms, in `parAdjust`
(`03` §5.9, four and no other: survive `n`; each `destroy` structure's `parTurns`; boss
bars, one turn per Revival Stone a primary's target or a throne's guard carries on the
rung; escort pace, `max(0, T(mov) − T(4))` along the escortee's route); `04` writes the
route (`parRoute`, `04` §8.3). Every walk term in par is W; a config on `calculatePar` has
no W (its area term stands in for the walk, as today).

**Which model.** A config uses `groups-v1` when its writer locks `parModel: 'groups-v1'`
with its inputs (W, S, `parAdjust`), so a resume never recomputes it: every config with
written `objectives` (`03` §5.9, whatever its groups: a First Light `twin_thrones` map has
no `dormant` group but two thrones that `calculatePar`'s area term cannot price), which
includes every set piece (`04` §4.2 step 10), and every procedural map with rout pods
(PR 2.6). Every other config keeps `calculatePar` exactly, including today's Dusk+ seize
and escape maps whose hold packs become `hold:<pack>` groups (§3.6: their par is today's,
byte for byte).

**The route.** W is read from `battleConfig.parRoute`, a list of legs
`{ to?: anchor, group?: id, meet?: true, extra?: n }` (or `plans`, alternatives of which
the cheapest is kept), written at generation for every primary kind and locked with the
config:
- a set piece writes its authored legs (`04` §8.3);
- any other `groups-v1` config writes the derived legs (`03`'s `defaultParRoute`, its
  table for every kind; phases append theirs in phase order): seize → each throne in
  shortest order; escape → the exit nearest the deploy centroid; rout → one `{ group }`
  leg per pod in nearest-neighbour order from the deploy centroid, each to the group's post
  (the member spawn nearest the members' centroid, ties by row then column). The anchors
  it names are written into `battleConfig.anchors`;
- a legacy config's `parRoute` is derived on read by the same rules and never written
  (`03` §5.9), so W can be read on any map (agents, the estimate) while its par stays
  `calculatePar`'s. Every `groups-v1` config carries a written `parRoute` (validated).

```
walk(leg)    = turnsToReach(previous end, leg.to or the group's post, MOV 4, Infantry) − 1
               (SeizeParFloor.turnsToReach; 0 for a meet leg; the first leg starts from the
               deploy tile nearest it) — exactly 04 §8.3's walk, so par and the estimate agree
W            = Σ walk(leg) over parRoute (the plan 04 §8.3's estimate keeps)
S            = Σ over engagements √|e|: the picket and ungrouped enemies are one engagement;
               each leg's `group` is another; on a seize or escape map, also every sleeping
               group whose spawn-time Danger tiles touch the route path
base         = ceil( 0.8 × ( b_obj + α·W + β·S + terrainPenalty + objectiveAdjustment ) )
raw          = base + parAdjust                               (parAdjust: integer turns, never × 0.8)
scaled       = (diffMult ≥ 1 ? base : max(1, floor(base × diffMult))) + parAdjust
rungPar      = max(1, scaled + parInflation + parBonus + parOffset)
floor        = 1 + W + parAdjust + bossTurns + 3
firstLight   = raw + firstLightParInflation + parBonus
par          = max(rungPar, min(floor, firstLight))
```

Order of operations, in words: the beatable part (walk and fights) is scaled by the rung's
multiplier; `parAdjust` is added to raw **after** the 0.8 and the multiplier, so a survive
phase of n turns is worth exactly n on every rung (`03` §5.10), and **before** the rung's
inflation, bonus and offset, the S floor and the First Light cap; the floor (a direct push
must be able to reach an S) counts turn 1, the walk beyond it, the turns `parAdjust` says
cannot be beaten, the boss and S's 3 (on a one-leg seize it is today's `seizeParFloor`,
`turnsToReach + 4`, `SeizeParFloor.js:92-102`); the cap holds the floor at or under the
map's First Light par, as `calculatePar` caps `parFloor` today
(`TurnBonusCalculator.js:78-85`), so the rungs stay in order. `diffMult`, `parInflation`,
`firstLightParInflation`, `parBonus` and `parOffset` are today's (`turnBonus.json`
`difficultyParMultiplier`, the config's locked inflation and offset).

- The area term goes: W measures the walk directly. β·S replaces `min(0.6n, 1.3√n)`. Since
  √ is subadditive, splitting a force into stages costs more than one blob, which is what
  the player pays (approach, regroup, re-engage).
- **Starting values**: α = 1, β = 1.3 (today's coefficient), `b_obj` = today's
  `objectiveBasePar` − 1 (the walk now carries the approach the base stood for),
  `bossTurns` = 1 when the route ends on a boss (a seize throne's guard, a `defeat`
  target), else 0 (SeizeParFloor's +1).
- **Calibration** (`sim/pacing.js --out`, §7): for each objective, regress the push
  policy's turns on (W, S) over ≥ 300 generated battles per rung; set α and β so the push
  median lands at par − 3 on Dusk (dusk-pressure: Dusk push ≥ 75% S+A), and check:
  - residual within ±1 turn for 80% of maps;
  - S reachable for a straight push on ≥ 95% of maps;
  - Dusk turtle − push gap ≥ 15 shadow (§1.5's pods-at-today's-par runs measure 52.5,
    today 39.4);
  - Nightfall ≥ 10 above Dusk for each style;
  - First Light within ±1 of today's par on maps without pods.

  The corpus is generated in the sim only: procedural rout pods (`encounterPlan.rout`
  switched on for the run, shipped `null`) and Dusk+ seize/escape maps with their hold
  groups priced as `groups-v1` (a sim-only override; shipped maps keep `calculatePar`).
  Each set piece re-runs the checks on its own combinations in `04`'s content PRs.
- **Eclipse and late pressure** keep their formulas: both are par-relative, so an
  accurate par is the whole job. A par two turns tight costs every player about 2 shadow
  a battle. Enrage follows the new par through §2.1.

## 6. Determinism, persistence, harness

- **Streams.** No new draw on any existing stream. Procedural groups use distance rules
  only; set-piece composition and patrol choices use `keyedBattleRandom(battleSeed,
  'groups:<id>')` (`BattleRng.js:24`); triggered waves use their own stream (§4). A
  test generates 200 seeded maps per objective before and after each PR that writes
  encounter fields (2.1, 2.6): positions,
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
  "objectiveEvents": [{ "id": "captain_a", "outcome": "done", "turn": 4 }]
}
```

- **Boss state** is `05`'s own object (`bossState`, `05` §10.2), beside `encounterState` in
  the same capture: the boss kinds read the boss unit, not the ledger, and the ledger records
  them as fired like any trigger.
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
stalls), not the map. **Ownership:** PR 2.0 ships the seek mode. An agent read that a new
primary kind needs (Strike on a structure, escort pacing, holding a capture point) ships with that
kind's PR in `03`; `04` only runs the agents.

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
| Par counts the walk twice, or `parAdjust` is scaled | `GroupsPar.test.js`: hand-built configs: a survive phase of 3 adds exactly 3 on every rung; a config whose `parAdjust` holds a walk term fails `03`'s validator; floor and cap order (floor above First Light par is capped; floor below rung par changes nothing); a one-leg seize floor equals `seizeParFloor` |
| Hold packs change par | Dusk+ seize/escape configs with `hold:<pack>` groups: par byte-identical to `calculatePar` |
| A phase advances outside the check, or its terrain lands late | an `until` true mid-player-phase changes nothing until the next check; at the check, `onEnter.setTiles` is on the grid before a `groupWoken` cascade reads it; `afterPhase` reads `phaseStartedTurn` across a resume |
| An awake-at-start count is wrong | hand configs for each rule-2 case (deploy tile inside a holder's zone, `afterContact: 0`, `parOffset` with a short par, a cascade via `groupWoken`, a patrol in reach by turn 2) |
| An outline lies | the dashed outline's tiles equal the tiles the `danger` wake reads, in paired worlds that differ by a hidden unit |

## 8. PR breakdown

| PR | Content | Behaviour change | Effort |
|---|---|---|---|
| 0a | §2.1 enrage formula + data key + tests | First Light boss maps with par ≥ 12: enrage one turn later | 0.5 day |
| 0b | §2.2 `TerrainPhases.js`, deferral, data fix, validator, harness copy deleted | Normal/Dusk Act III–IV boss arenas get their full waves | 1.5 days + harness notes |
| 0c | §2.3 heap A* + early exit; §2.4 branch and bound + memo | none (exact) | 1 day |
| 0d | §2.5 `afterUnit` beat, hidden-move skip, no-op checkpoint skip, Shift hold key, e2e timing spec. **On the critical path for the first set piece** | presentation only; fewer timeline rows | 1.5 days |
| 0e | §2.6 prune at `advanceAct` | smaller saves | 0.25 day |
| 2.0 | metrics and the agent's seek mode in `sim/pacing.js` (§7; kind-specific agent reads ship with `03`'s kind PRs); baseline report in this spec | none | 1 day |
| 2.1 | `EncounterGroups.js` + `EncounterTriggers.js` with `danger`/`hurt`, legacy adapter, `encounterState` persistence and validator, golden parity, `wakeHolders` deleted; initially awake groups' `onWake` written onto spawns (§3.3) | none | 2.5 days |
| 2.2a | `groupWoken`, `tile` (with `by: { group }`), `turn` `parOffset` (and legacy `turn`), the check's order (§3.4) for these, warn bands, `dormant` sources in ThreatForecast and the always-on outlines (§3.8), the inspect line, `guide_holding`, history words for wakes | none until data uses it; `guide_holding` and the outlines appear on today's Dusk+ hold packs | 1.5 days |
| 2.2b | `sight`, `objective` hook, contact with `afterContact` and `latest`, `afterPhase`, the phase slot calling `03`'s `checkPhase` (a no-op until `03` PR 4), HUD model, history words for a phase switch | none until data uses it | 1.5 days |
| 2.3 | `triggeredWaves`, sides, keyed stream, ledger, contract v2 exclusion, history words for arrivals | new configs only: procedural waves avoid the player by 3 | 2 days |
| 2.4 | patrol and column, `guard`/`seek` (`then`)/`retake` onWake, `together`, group order | authored maps only | 2 days |
| 2.5 | **the par PR**: `groups-v1` (§5.2), `parRoute` derivation for procedural maps, `parModel` locking, calibration of α, β on the sim corpus, `GroupsPar.test.js` | none until a writer locks `groups-v1` | 2 days |
| 2.6 | rout picket/pods behind `encounterPlan.rout` (shipped `null`), sims at 48 seeds per rung and policy, tuning, **owner sign-off** (§9 Q2) | yes, rung by rung, after sims | 2–3 days |

**The run-format guard** (`04` PR A0, `04` §12.1) is a dependency of the PRs here that can
write a capability: 2.3 (`triggeredWaves`), 2.4 (patrols, columns, `guard` / `seek` posts), 2.6
(pods: `encounterPlan.rout`) and 2.5 once a writer locks `groups-v1` (`parModel`). The `encounters`
capability counts only what an older client would misplay: a config of `hold:<pack>` groups,
which §3.6 writes beside the unit-level hold fields, is legacy-equivalent and is not held. PRs
0a–0e, 2.0, 2.1, 2.2a and 2.2b write nothing it detects and don't wait.

`05` K1 adds `bossBar` / `bossHp` (slot 2b), the signature slot (7b) and court re-orders
(§3.7) to this check, on top of 2.1, 2.2a, 2.2b, 2.4 and 2.5; its trimmed K1-lite needs only
2.1, 2.2a, 2.4 and the two trigger kinds (`05` §12).

Phase 0 PRs are independent of each other; 0d is on the critical path for the first set
piece. 2.0 lands before 2.5's calibration and 2.6 can be judged. 2.1 is the gate for
everything else in Phase 2 and for `03`'s phases (`03` PR 4 also needs 2.2b's phase slot).
2.5 lands before `04`'s generator PR (B), which locks `groups-v1` for every set piece, and
before `03`'s first config with written `objectives` (`twin_thrones`, its PR 4). 2.6 is
owner-gated and blocks nothing in `03` or `04`.

**Vertical slice** (the shortest path to a playtestable Mill Ford, `04` §10.1). The first
set piece needs, from this spec: **0a** (enrage floor), **0d** (dead air), **2.1**, a
trimmed 2.2, i.e. **2.2a** (`groupWoken`, `tile`, `turn parOffset`, warn bands, always-on
outlines; no `sight`), and **2.5** (the par PR; to ship sooner, a stopgap that locks
`max(calculatePar(rout), estimate + 3)` from `04` §8.3, calibrated later). **2.3** and
**2.4** are not needed: the raiders are spawn-level `seek_tile` (§3.3) and the map has no
triggered wave or patrol. Nor are 0b, 0c, 0e, 2.2b or 2.6. Two triggers wait for 2.2b:
the reserve's `objective: mill` wake (it also needs `03`'s objective events) and Black
Sun's `afterContact` clock; until then the reserve wakes on its `turn parOffset` clock.

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
7. **The first `danger` wake.** The always-on dashed outline (§3.8) is the rule. Should the
   first `danger` wake of a battle also give one warn band and wait a phase (delay 1)
   before it moves, so a player who missed the line still sees it coming? It costs the
   turtle nothing and softens the push's first contact, so it is held until the slice is
   playtested.

## 10. Notes for the README

**Adopted in README revision 2** (resolved; kept here as a record): the state is `dormant`,
not `asleep` (the AI decision reason `asleep` in §2.5 is the Sleep status's and is
unchanged); `hurt` includes a status (`HoldDisturbance` `'status'`); boss enrage is not a
trigger kind; `latest` is required on `afterContact`; the enrage figures within 24x16
(§1.5); the hybrid bug is confirmed, with its two shapes (§2.2); one terrain module
(`engine/TerrainPhases.js`, `applyTerrainSetTiles`) and one anchors field
(`battleConfig.anchors`); `tile` may name an enemy group (`by: { group }`); objective events
use `03`'s words (`done` / `failed`).

**Still open:**
1. **`members`** are spawn indices at generation; spawns and units also carry
   `encounterGroupId`. Runtime membership is the units. The README's "Unit fields" could
   say that the id rides the unit (`serializeBattleUnit`) and the group's state rides the
   checkpoint (`encounterState`).
2. **Default delays and `on`.** The README's trigger table has no default-delay column:
   `groupWoken`, `objective` and `turn` default to 1 for a group wake, the rest to 0, and a
   wave's or a phase `until`'s delay defaults to 0 (§3.4); `objective`'s `on` defaults to
   `done`.
3. **Par and the TerrainPhases owner.** Pillar 6's "par from the primary objective's route"
   is §5.2's `groups-v1` with W from `battleConfig.parRoute`; the README's shared-modules
   table could name `02` alone as `TerrainPhases.js`'s owner (`03` and `04` call it).
4. **For `03`: the floor's full form.** `03` §5.9 writes the floor as
   `max(par, W + 3 + bossTurns)`; that is shorthand for §5.2's
   `max(rungPar, min(1 + W + parAdjust + bossTurns + 3, firstLight))` (turn 1 and the
   unbeatable turns counted, the First Light cap applied), the form a one-leg seize needs to
   equal today's `seizeParFloor`. `03`'s decision that every config with written
   `objectives` takes `groups-v1` is **adopted** (§5.2 "Which model").

## Revision 2 changelog (2026-10-09)

- **Par has one owner** (§5.2): W from `battleConfig.parRoute` (04's legs; procedural maps
  derive seize → throne, escape → nearest exit, rout → group posts); `03`'s `parAdjust`
  carries only non-walk terms and is added to raw after the 0.8 and the rung multiplier,
  before inflation, the S floor and the First Light cap; the order of operations is written
  out; the floor counts turn 1 so a one-leg seize matches today's `seizeParFloor`;
  `groups-v1` covers every config with written `objectives` (adopting `03`'s decision; set
  pieces included) and rout pods, so today's hold packs keep `calculatePar`; the four
  `parAdjust` terms are listed (escort pace included); written vs derived-on-read
  `parRoute` follows `03` §5.9.
- **`engine/TerrainPhases.js`** is created in PR 0b with the one signature
  `applyTerrainSetTiles(grid, setTiles, anchors, { occupants })`; `03` and `04` call it.
- **The check's order** (§3.4) gains the phase slot after `objective` and before `turn`
  (`03`'s `checkPhase`): a phase with no `until` whose primaries are done advances there,
  every `onEnter` effect applies there before the `groupWoken` cascade, at most one advance
  per check; `evaluate` only emits `phase_ready`; `{ afterPhase: n }` reads
  `objectiveState.phaseStartedTurn`.
- **Defaults**: per-kind default delays stated for group wakes, 0 for waves and phase
  `until`s; `objective`'s `on` defaults to `done`; §6's example says `done`.
- **`seek`'s `then`** takes `hunt` (default) or `exit` (`03`'s assassination target).
- **Initially awake groups** apply `onWake` at battle start, written onto spawns as the
  village's bandits are (§3.3), so The Mill Ford's raiders need no PR 2.4.
- **Awake at start** has one precise rule (§5.1) that `04` cites.
- **Sleeping groups' outlines are always drawn** (§3.8), not only under Danger; the delay-1
  first-wake warning is open question 7.
- **New**: `guide_holding` (Guidance at the point of use), history words for a wake, a phase
  switch and a triggered arrival, the Shift rule (held alone, only in `ENEMY_PHASE`), agent
  ownership (2.0 ships seek; `03`'s kind PRs ship their reads), new tests.
- **PRs**: 0d marked on the critical path; 2.2 split into 2.2a / 2.2b; par is its own PR
  (2.5) before `04`'s generator PR; rout pods are 2.6, owner-gated; a vertical-slice note.
- Notes the README adopted in its revision 2 are marked resolved.

## Revision 3 changelog (2026-10-09)

- Takes in `05`'s notes: `bossBar` / `bossHp` (table, slot 2b, delay 0, the awake-at-start
  rule), the signature slot 7b, court re-orders (§3.7), history words for a same-primary
  phase switch and a signature; `enemy-phase-pacing.spec.js` moved to the real
  `presentation` lane.

## Revision 4 changelog (2026-10-09)

- **Old clients (review finding, P1).** `encounters` and `parModel` are capabilities of the
  run-format guard (`04` §12.1); §8 names the PRs that depend on `04` PR A0, and says a config
  of legacy hold packs is not held.
