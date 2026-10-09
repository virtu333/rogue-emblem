# 03 — Objectives v2: primary objectives, phases, bonus objectives

Status: proposal, revision 1 (2026-10-09). Spec only: no game code or data changes.
Branch `claude/large-maps-specs`. Part of the large-maps set ([README](README.md));
roadmap Phase 3. It uses the README's shared names (`battleConfig.objectives`, the trigger
vocabulary, anchors, the checkpoint rule, Pillar 6) without renaming any of them. Where it
refines one, the change is listed in "Notes for the README" at the end.

The owner asked for more kinds of maps, more than one objective on a map, and bonus
objectives. This spec covers the objective model under all three: the data, the single
engine predicate that decides a battle, the new primary kinds, phases, bonus objectives and
their rewards, the objective strip, and how today's code moves onto it without changing an
old save.

## 1. Where we are

Line numbers are as of 2026-10-09. Sections 1, 6 and 7 of the
[appendix](appendix-current-systems.md) have the longer survey; every claim below was
re-read in code.

### 1.1 One string, three hand-written end checks

- The objective is one string. `battleConfig.objective ∈ rout | seize | escape` is copied
  from `battleParams` (`MapGenerator.js:556`). BattleScene falls back to `rout`
  (`BattleScene.js:514`).
- **Defeat** is `hasBattleDefeat` (`engine/BattleDefeat.js:3`): no living commander (an
  escaped one counts as alive), or the field and the escapes are both empty. This is the
  only way a battle is lost.
- **Rout** is `isRoutComplete` (`RoutObjective.js:39`), read by `checkBattleEnd`
  (`BattleScene.js:11013`). Victory waits while `_reinforcementsPendingThisTurn` is set.
  `isRoutFieldClear` (`RoutObjective.js:55`) cancels the waves still to come.
- **Escape** is inline in `checkBattleEnd` (`BattleScene.js:11020`): the commander has
  escaped and no lord is left on the field.
- **Seize** is never decided in `checkBattleEnd`. It is the action-menu command
  (`BattleScene.js:6347-6364`): a lord on `thronePos`, no living `isBoss`, then
  `onVictory()`.
- **The harness copies all of it.** `HeadlessBattle._checkBattleEnd`
  (`tests/harness/HeadlessBattle.js:2235`) repeats defeat inline instead of calling
  `hasBattleDefeat`. Its seize command (`:550`) tests `isBoss` without `currentHP > 0`, so
  it has already drifted from the scene (`BattleScene.js:6350`).

### 1.2 The sites that hardcode the objective list

| # | Site | What it does with the string |
|---|---|---|
| 1 | `BattleScene.checkBattleEnd` `:11013`, `:11020` | rout and escape victory |
| 2 | `BattleScene` action menu `:6348`, `:6366` | Seize and Escape commands |
| 3 | `BattleScene.updateObjectiveText` `:11084-11114` | the canvas objective string |
| 4 | `BattleScene` setup `:1773`, `:1787` | SEIZE throne label, `EscapeObjectiveController` |
| 5 | `BattleScene` turn-1 hints `:9663-9690` | `battle_seize`, `battle_escape`, `battle_par` |
| 6 | `BattleScene._showBossDefeatedBanner` `:10915-10928` | the canvas fallback is seize-only |
| 7 | `BattleScene` `:1809` and `HeadlessBattle:433` | `calculatePar({ objective })` |
| 8 | `BattleScene:1866`, `AIController.js:61`, `:341` | the AI is built with `{objective, thronePos}`; the boss throne clamp |
| 9 | `TurnManager.js:114` | standalone rout fallback |
| 10 | `TurnPressure.js:18`, `:27` | progress = lord distance to the throne or an exit |
| 11 | `HoldActivation.js:76-78` | the hold anchor (throne or exit centroid) |
| 12 | `RoutObjective.isRoutFieldClear` `:57` | wave cancel, rout only |
| 13 | `MovementActionController.js:198` | Talk re-checks a rout that is waiting on a recruit |
| 14 | `GuidanceController.js:307`, `Guidance.js:169-172` | `guide_objective_changed`, seize only (the text already has a generic `context.goal` branch) |
| 15 | `ceremonyContent.js:140-192` | `OBJECTIVE_WORDS` (orphan `defend`), `felledContent`, `shouldShowFelled` |
| 16 | `helpTopics.js:202` | `OBJECTIVE_GOALS` (rout and seize only: escape has no goal line) |
| 17 | `DeployScreenOverlay.js:136` | `OBJECTIVE_BANNERS` |
| 18 | `PartyMenus.js:291` | deploy status string |
| 19 | `loomModel.js:373`, `:527`, `:552-553` | route card label and text; Village/Caravan tags |
| 20 | `NodeMapScene.js:1827-1830` | node label "Elite Battle (Seize)" / "Battle (rout)" |
| 21 | `battleMenuModel.js:24` | `OBJECTIVE_COMMAND_IDS = ['seize','escape']` |
| 22 | `battleSidebarDisplay.js:5-19` | `compactBattleObjective` **parses the canvas string with regexes** |
| 23 | `BattleMusicSelection.js:127` | escape theme |
| 24 | `CaravanSystem.js:35`, `VillageSystem.js:46` | side-objective eligibility |
| 25 | `MapGenerator.js` `:243`, `:261`, `:396`, `:509`, `:1992`, `:2309`, `:2547`, `:2560`, `:3132`, `:3664-3689` | elite captain, exits, ladder, boss, guards, cavalry reach, par offset, validator |
| 26 | `MapTemplateEngine.js:8`, `:483`, `:1124` | `TEMPLATE_OBJECTIVES`, escape zone rule, one Throne per seize template |
| 27 | `DifficultyEngine.js:263`, `:506` | `objectiveParOffset` / `holdShare` key whitelists |
| 28 | `data/turnBonus.json` `objectiveBasePar` / `objectiveAdjustments` | a kind with no entry gets no par (`calculatePar` returns `null`) |
| 29 | `NodeMapGenerator.js:518-549` | the 28% seize / 12% escape roll |
| 30 | `tests/harness/HeadlessBattle.js` `:550`, `:560`, `:2041`, `:2235-2257`; `Invariants.js:100-120`; `tests/agents/ScriptedAgent.js:93,109,184`; `sim/lib/TacticianAgent.js:72,295`; `sim/pacing.js` | harness, invariants and agents |

Rule readers (1, 2, 7–14, 30) decide outcomes. Word readers (3–6, 15–23) only say things.
Generation readers (24–29) build maps. Prologue code (`ScriptedBattle.js:60`,
`PrologueController`) reads the string too, and this spec leaves it alone (§8.4).

### 1.3 Side objectives today

Each of these has its own state, persistence and words. There is no shared container.

| | State | Persisted in | Reward |
|---|---|---|---|
| **Village** (`VillageSystem.js`, `VillageController.js`) | `_villageState {col,row,status: intact\|visited\|razed, rewardItemUid?}` | checkpoint `villageState` (`BattleCheckpointAdapter.js:45`), Vision snapshot (`VisionRewindController.js:158`, restore `:311-314`), validator (`BattleStateSnapshot.js:131-134`) | **Paid during the battle**: `VILLAGE_GOLD_BY_ACT` 150/300/500/700 into `scene.goldEarned` (multiplied at commit), plus a consumable into the convoy (`VillageController.js:121-160`). A rewind removes the item by uid (`VisionRewindController.js:1104`) |
| **Bandit raid** (the village race) | seek_tile bandits from a turn-1 scripted wave; raze in `handleEnemyUnitDone` (`BattleScene.js:10476`) | the units and `villageState` | none (it is the village's failure) |
| **Caravan** (`CaravanSystem.js`, `CaravanController.js`) | an NPC with `isCaravan`; `_caravanExited` | checkpoint `caravanExited`, Vision `:159`, validator `:179` | `completeBattle({ caravanSurvived })` (`RunManager.js:4193`) gives `pendingCaravanShop`. "Survived" means alive on the field **or** exited (`CaravanController.js:120`) |
| **Recruit NPC** | `npcUnits`, Talk | units | the unit |
| **Rout ladder** | config `reinforcements.ladder` | config + turn | none (pressure only) |

Phone chips come from `secondaryObjectiveStatus(sideObjectiveInputs(scene))`
(`battleSidebarDisplay.js:40`, `:85`). That is the one structured status model today, and
it already does fog correctly: a caravan out of sight reads "in fog".

### 1.4 Constraints from history

- **Survive-N as a primary is rejected.** `dusk-pressure.md` §1 shows that a timer the
  player waits out is the turtle: waiting costs nothing when the enemy comes to you.
- **Settle once, at the victory commit.** Contracts are judged once in
  `RunManager.completeBattle` (`:4166`), never mid-battle, "so a revert or a resume never
  touches it". The bugs fixed in `event-nodes-phase2.md` ("Contract settlement recovery")
  were rewards lost silently. A reward is never lost without the player seeing why.
- **Gold loot cards carry team XP.** `PendingRewardController.activateReward` calls
  `awardTeamXp` (`:93-97`), so a bonus paid as a gold loot card would break Pillar 6.
- **NPCs have no AI phase.** The caravan's only movement is `advanceCaravan`
  (`CaravanSystem.js:384`), called at enemy-phase start (`BattleScene.js:10400`, skipped on
  resume).
- **Breakable terrain is temporary only.** `Grid.setTemporaryTerrain` (`Grid.js:597`), the
  player's Break (`BattleScene.js:5315`, one action, no HP) and the AI's `break_wall`
  (`AIController.js:1368`). No permanent structure has HP.

## 2. Goals and non-goals

**Goals.**
- One pure predicate decides victory, objective progress and failure for the scene, the
  harness, TurnPressure, ceremonies and the HUD.
- A config without `objectives` behaves exactly as today, byte for byte.
- New primary kinds: multi-seize, defeat, assassinate, escort with a protect clause,
  capture, destroy.
- Phases.
- Up to two bonus objectives per map, settled once at the commit and paid in a different
  currency from the clock.
- One structured strip model replaces the regex parsing.

**Non-goals.**
- No new run-ending defeat (§8).
- No survive-N primary.
- No enemy AI that targets structures or points on its own. That is spec 02 (groups) and
  `enemy-ai-profiles.md`.
- The prologue does not change.
- Camera, markers and pointers are spec 01. Where set pieces appear is spec 04.

## 3. Data model

### 3.1 `battleConfig.objectives`

It is written at generation, locked with the config, and never re-rolled.

```js
objectives: {
  version: 1,
  primary: [Objective],   // all must resolve to win (AND); display order
  bonus:   [Bonus],       // 0..2 (MAX_BONUS_OBJECTIVES)
  phases:  [Phase],       // optional; when present, phases[0].primary === primary
  parAdjust: 0,           // integer turns, summed contributions (§5.9), locked
}
```

Fields every objective shares:

| field | type | meaning |
|---|---|---|
| `id` | `[a-z0-9_]{1,24}`, unique in the config | names it for triggers, state and words |
| `kind` | see §5 | |
| `anchors` | `[{col,row}]`, resolved at generation | what markers point at (01) and agents walk to |
| `text` | optional content key | overrides the kind's default words |
| `reward` | Reward (§7.4) | a bonus's payout, or a failable primary's **stake** |
| `onFail` | `{ primary: [Objective], line }` or `'stake'` | failable kinds only (§8.2) |

**Unit references.** An objective names a unit by `ref` (a string). The generator writes
`spawn.objectiveRef`, and the unit carries `unit.objectiveRef`. It rides
`serializeBattleUnit` (a shallow clone) the way `holdPack` does. Refs replace index lookups,
which break once units die and arrays shift.

**NPC allies.** An escort or protect target that is neither the caravan nor a recruit comes
from `battleConfig.npcAllies: [{ ref, className, level, name, col, row }]`. It is built by
`engine/ObjectiveNpc.js` `buildObjectiveNpc(spec, act, gameData)`: faction `npc`, no Talk,
never joins. It is the first generic NPC-ally builder (the appendix §6 lists the gap).

**Structures.** `battleConfig.structures: [{ id, col, row, kind: 'gate', hp, def, res,
brokenTerrain }]`. The tile holds the new `Gate` terrain (§5.7).

### 3.2 No `objectives`: today, exactly

`normalizeObjectives(battleConfig, ctx)` derives the model when it reads a config. It never
writes into the locked config, so old saves, old locked maps and the generation
fingerprints keep their bytes.

| legacy config | derived `primary` | derived `bonus` |
|---|---|---|
| `objective: 'rout'` | `[{ id:'rout', kind:'rout', requiredRecruits: battleRequiredRecruits(ctx) }]` | |
| `objective: 'seize'` | `[{ id:'seize', kind:'seize', thrones:[{ id:'throne', col, row, guard:'@boss' }] }]` from `thronePos` | |
| `objective: 'escape'` | `[{ id:'escape', kind:'escape', tiles: escapeTiles, who:'lords' }]` | |
| `villageTile` present | | `{ id:'village', kind:'visit', legacy:'village', anchors:[villageTile] }` |
| `caravanSpawn` present | | `{ id:'caravan', kind:'caravan', legacy:'caravan' }` |

`'@boss'` means "every living `isBoss` enemy", today's test (`BattleScene.js:6350`). The
recruit beacon and the ladder line are **notes** in the strip, not objectives (§10). A
derived model has `parAdjust: 0` and no phases. Legacy bonuses have `costTurns: null`
because today's maps never computed a detour. The strip computes one on read with the same
pure helper (§7.5); it is cheap at today's sizes and deterministic.

### 3.3 The legacy `objective` string

`objective` stays `rout | seize | escape` (README §3). New maps write it as
`legacyObjectiveKind(objectives)`, the family of `primary[0].kind`:

| kind | legacy | why |
|---|---|---|
| rout, defeat, assassinate | `rout` | kill-shaped; no throne or exit for legacy readers to misuse |
| seize, capture, destroy | `seize` | tile-shaped; `thronePos` is the first throne (seize only; capture and destroy write no `thronePos`) |
| escape, escort | `escape` | exit-shaped; `escapeTiles` is the exit set |

After PR 1, this string is read only by word fallbacks and by generation code that the new
kinds bypass (`TEMPLATE_OBJECTIVES`, the node roll). A boundary test (§12) keeps every rule
reader on the model. The validator requires `objective === legacyObjectiveKind(objectives)`
and, on seize, `thronePos` equal to the first throne.

### 3.4 Battle state: `objectiveState`

```js
objectiveState: {
  version: 1,
  phase: 0,
  status: { [objectiveId]: { s: 'open'|'done'|'failed', turn?, by?, reason? } },
  thrones: { [throneId]: 'open'|'taken' },
  points:  { [pointId]: 'neutral'|'player'|'enemy' },
  structures: { [structureId]: { hp, state: 'intact'|'broken'|'opened' } },
  escorted: [ref],         // NPCs that reached their exit (like caravanExited)
  fled: [ref],             // assassinate targets that left
  floors: { [objectiveId]: true },   // unbloodied: whether it has broken
}
```

- `by` is the `unitUid` of the unit that completed an objective, so a forge reward has a
  hand to go to (§7.4).
- Legacy bonuses keep their own state as the single source of truth: `_villageState` and
  `_caravanExited` are read, never copied.
- Fired triggers live in spec 02's trigger ledger. This module **emits** `objective`
  events into it (`{ kind:'objective', id, outcome: 'done'|'failed' }`) and reads
  `phase` advances from it.
- A missing `objectiveState` (every checkpoint written before PR 3) is created from the
  config plus the legacy fields on resume. It equals what a fresh battle at that moment
  would hold, because every legacy rule is derivable from the field.

## 4. The engine module: `engine/BattleObjectives.js`

The module is pure: no Phaser and no RNG. It is the one predicate, and it follows the
`RoutObjective` / `HoldActivation` pattern. BattleScene, `HeadlessBattle`, `TurnPressure`,
`GuidanceController`, the ceremonies and the strip model all call it.

```js
normalizeObjectives(battleConfig, ctx)            // §3.2; memoised per config object
createObjectiveState(objectives, field)
evaluate(objectives, state, field)                // → { outcome, state, events }
commandsFor(unit, objectives, state, field)       // → [{ id:'seize'|'escape'|'strike', target }]
onPlayerActionEnd(unit, …) / onEnemyActionEnd(unit, …)  // take/retake points, reach, flee
onEnemyPhaseStart(…)                              // escort steps, slay deadlines, phase turns
progressMeasure(objectives, state, field)         // → TurnPressure
parContribution(objective, map)                   // generation only (§5.9)
bonusVerdicts(objectives, state, field)           // → commit input (§7.3)
statusView(objectives, state, field, knowledge)   // → strip model input (§10)
goalTiles(objectives, state, field)               // → agents and markers
```

`field` is `{ playerUnits, enemyUnits, npcUnits, escapedUnits, zombieTombstones,
villageState, caravanExited, ballistas, turn, phase, reinforcementsPending }`. It is plain
data that both worlds already hold.

**`evaluate`, in order:**
1. **Defeat**: `hasBattleDefeat` unchanged, which returns `{ outcome: 'defeat' }`. The
   scene's guards, the prologue intercept and the Vision prompt stay in `checkBattleEnd`.
2. **Statuses**: each open primary and bonus in the current phase is re-read from the
   field. Transitions are one-way within a timeline; only a restore puts one back.
3. **Failures**: a primary that failed applies its `onFail`: a fallback replaces it in the
   current phase, or `'stake'` resolves it as failed (§8.2). This emits events.
4. **Phase advance** (§6) on a fired `until`, or on completion of a phase that has no
   `until`.
5. **Victory**: the last phase's primaries are all resolved (done, or failed with
   `'stake'`) and none is waiting on a fallback. Then the deferral: a victory reached
   inside the enemy phase waits for the phase's end (today's
   `_reinforcementsPendingThisTurn` rule, now for every kind, since no victory has ever
   been taken mid-AI-loop). The rout field-clear wave cancel stays rout-only.

`outcome` is `'defeat' | 'victory' | 'deferred' | null`. `events` are presentation
records (`objective_done`, `objective_failed`, `phase_changed`, `throne_taken`,
`structure_broken`, `guard_fell`). The scene presents them through
`safeBattlePresentation`, and the harness ignores them.

**Who calls it.** `checkBattleEnd` becomes the guards, then `evaluate`, then the outcome.
The Seize command becomes `commandsFor` and then a `takeThrone` mutation followed by
`checkBattleEnd`. Seize no longer calls `onVictory()` directly, so a single-throne seize
wins through the same path as everything else (the prologue's `onSeize` beat is still
awaited first). `TurnManager.js:114` keeps its standalone fallback but asks the module.

## 5. Primary kinds

For each kind: the fields, the win and fail rules, its par, how it touches the AI (spec 02
holds the groups), and its words. All words are plain UI register: the lore style guide
keeps stat-line text plain.

### 5.1 Rout (unchanged)

- Fields: `{ requiredRecruits? }`.
- Win: `isRoutComplete`. Fail: none.
- Par: today's (`objectiveBasePar.rout` 2).
- Words: "Rout · 3 enemies remain".

### 5.2 Seize: one or more thrones

- Fields: `thrones: [{ id, col, row, guard: ref | '@boss' }]`. All thrones must be taken.
- **Take**: a lord on an open throne whose guard is dead uses Seize, and the throne
  becomes `taken`. A taken throne stays taken; enemies never retake one.
- **Win**: every throne taken. With one throne this is exactly today's rule.
- Fail: none.
- **Par**: today's seize par plus, for each further throne, `ceil(walk(throne_i →
  throne_{i+1}) / 4)` along the shortest order (Infantry BFS, the `SeizeParFloor`
  method). The seize floor walks through every throne.
- **AI**: the throne clamp (`AIController.js:341`) reads `enemy.clampTile`, written on each
  guard's spawn, instead of the one `thronePos`. The unread `guardianClampPos`
  (`MapGenerator.js:360-368`) retires into it. Taking throne A emits `objective
  throne_a done`, which 02's groups can wake on ("the second garrison stirs"). That is
  Two Towers.
- **Boss nodes keep one throne in v2**: the boss card, `_bossName`, the boss recruit draft
  and the act's relief all assume a single boss. Multi-seize is for elite and set-piece
  maps.
- Words: "Seize · 1/2 thrones", "Seize · Defeat the guard", "Seize · Take the throne".

### 5.3 Escape (unchanged rule)

- Fields: `{ tiles, who: 'lords' }`.
- Win: today's (commander escaped, no lord on the field).
- Par: today's.
- Words: "Escape · Lords 1/2" (`EscapeObjectiveController.getObjectiveLabel`).
- **Combination rule**: escape ends the battle when the last lord leaves, so it may not
  share a phase with a primary that has an `onFail` fallback, only with `'stake'` ones
  (validator). An open stake-only primary resolves as failed when the lords leave.

### 5.4 Defeat: kill the target(s), the rest may stand

- Fields: `{ targets: [ref], need?: n }` (default all). The FE "defeat the boss" map.
- Win: `need` targets dead. A target's Revival Stones hold as usual: only its last bar
  counts.
- Fail: none, since the targets cannot leave.
- Par: `objectiveBasePar.defeat` (4) plus an adjustment of 1, the same as seize but without
  the throne step.
- AI: targets are ordinary guard or hold group members (02).
- Victory word: VANQUISHED. Strip: "Defeat · Varro".

### 5.5 Assassinate: kill the target before it gets away

- Fields: `{ target: ref, exit: [{col,row}], reward, onFail }`.
- The target spawns in a sleeping group (02). Its `onWake` sets `aiMode: 'seek_tile'` and
  `aiTargetTile` to the nearest exit tile. The flight trigger is the group's wake, so it
  is always visible or told (Pillar 7).
- `_decideSeekTileAction` (`AIController.js:792`) already walks to a tile and attacks only
  a blocker. The target runs; it does not fight.
- **Win**: the target dies.
- **Fail**: the target ends a move on an exit tile. `onEnemyActionEnd` removes it the way
  an escaping unit is removed (no kill, no gold, no XP, no deed, no stone spent) and
  records `fled`. The objective fails and `onFail` applies. The usual fallback is
  `{ primary: [{ kind:'rout' }], line: 'objective.fled' }`: the battle goes on as a rout,
  and the stake is lost.
- **Calibration**: `calibrateFlight` is a pure helper like `calibrateBanditSpawn`
  (`VillageSystem.js:181`). It requires the target's walk from its post to the exit,
  after its wake, to take at least the turns the army's fastest unit needs to reach the
  target from the deploy zone, plus 2. Validated.
- The target never carries Revival Stones. Stones plus flight would be unfair (validator).
- Par: defeat's. The flight clock is the pressure, so par needs nothing more.
- Words: "Assassinate · Stop Varro reaching the road". Failure: "Varro got away."

### 5.6 Escort, and the protect clause

- **Escort**: `{ unit: ref, route: [{col,row}], exit: [{col,row}], mov: 1..4, leash: 3,
  reward, onFail }`. The escortee is an `npcAllies` unit or the caravan.
- **Movement** (the minimum NPC behaviour, with no AI phase):
  `engine/EscortRoute.js` `advanceEscort` runs where the caravan steps
  (`BattleScene.js:10400`, `!resume`), before `_reinforcementsPendingThisTurn` is raised.
  - It moves up to `mov` tiles toward the next waypoint by `Grid.computePath` over
    passable, unoccupied tiles.
  - It moves **only when a living player unit is within `leash` tiles**: it waits for its
    guard, so the player paces it.
  - It stands still when blocked.
  - Ending on an exit tile, it leaves (`escorted`). The harness calls the same function.
- **Win**: the escortee leaves, or it is alive when the field is clear (no enemy standing
  or rising, no wave pending). "The road is clear" is a natural win.
- **Fail**: the escortee falls, then `onFail`.
- **AI**: the escortee takes the caravan's +40 target score (`AIController.js:1297`, keyed
  on `isEscort` too). Chasers and sallies are 02's.
- **Par**: `max(rout par, ceil(routeLength / mov) + 1)`. The difference goes into
  `parAdjust`.
- **Protect** is a clause, not a goal: `{ kind:'protect', unit: ref, onFail }`. It
  resolves `done` when every other primary in its phase is done, and `failed` when the unit
  falls. On its own it would be a survive timer, so the validator refuses a phase whose
  only primaries are `protect`.
- Words: "Escort · Brother Aldo to the east road", "Protect · Brother Aldo".

### 5.7 Capture: hold the points

- Fields: `{ points: [{ id, col, row }], need?: n }` (default all).
- **Take**: a player unit ends its action on a point. This is the village-visit hook
  (`BattleActionCompletion.js:35`), so it needs no new command, and the Wait note says
  "Takes the point".
- **Retake**: an enemy ends its move on a player-held point (the raze hook,
  `BattleScene.js:10476`). A point with a player unit on it cannot be retaken, so holding
  means standing there or keeping enemies off.
- **Win**: `need` points held at once, checked the moment a point is taken. As with seize,
  there is no timer. The puzzle is keeping earlier points while taking the last.
- Fail: none.
- AI: 02's `onWake: { retake: pointId }` gives a group `seek_tile` to a point. No other
  enemy cares about points (v2).
- Par: seize base plus the walk to the farthest point (the multi-seize rule over points).
- Victory word: HELD. Strip: "Capture · 2/3 points".

### 5.8 Destroy: break structures

- **The minimal gate.**
  - `data/terrain.json` gains `Gate` **appended at index 19** (never reorder). It is
    impassable to all four move types, like Wall.
  - `battleConfig.structures` gives each gate its HP and defences. `objectiveState`
    holds its live HP.
  - **Strike** is a command when a structure is in the equipped weapon's range
    (`ui/StructureController.js`, following the Break target flow at
    `BattleScene.js:5355`). It does `structureDamage = max(1, (STR or MAG by weapon) + Mt
    − (def or res))`. It always hits, never crits, takes no counter, gives no XP, fires no
    art, Mark or skill proc, and spends no weapon wear.
  - A captured ballista and siege tomes may Strike.
  - At 0 HP: `grid.setTerrainAt(brokenTerrain)` (Floor or Plain, or Water for a bridge
    segment), state `broken`, event `structure_broken`.
  - A phase `setTiles` on a structure's tile marks it `opened`, as when the gate captain's
    death opens it.
  - Enemies never strike or repair a structure in v2: to both sides, a gate is a wall.
- **Objective**: `{ structures: [id], need? }`. Win: `need` structures broken or opened.
  Fail: none.
- Par: `objectiveBasePar.destroy` plus an authored `parTurns` per structure, which the 04
  validator holds in a band.
- Art: one Gate tile (intact) for the terrain painter. Broken ground reuses Floor or Plain.
- Victory word: DESTROYED. Strip: "Destroy · Gate 18/30".

### 5.9 Par in one place

`parContribution(objective, map)` runs at generation and its sum is locked in `parAdjust`.
`calculatePar` gains one parameter, `parAdjust`, added before `max(1, …)`, and it is called
with `objective: parKind(objectives)`: the first primary's kind when `turnBonus.json` lists
it, else the legacy kind. `turnBonus.json` gains `defeat 4/1`, `assassinate 4/1`,
`escort 4/1`, `capture 4/1` and `destroy 4/1`. `survive` stays unlisted, so the test that
pins `survive` → `null` (`tests/TurnBonusCalculator.test.js:128`) keeps holding. **Bonus
objectives contribute nothing to par** (Pillar 6). Par is computed once at battle start,
whatever the phases, and waves raise it as today.

### 5.10 Survive (phase only)

`{ kind:'survive' }` is allowed only in a phase that is not the last, whose `until` is
`{ kind:'turn', afterPhase: n }` with `1 ≤ n ≤ SURVIVE_PHASE_MAX_TURNS` (3), and only when
the next phase has a real goal (validator). It contributes exactly `n` to par, because a
timer cannot be beaten. TurnPressure counts every enemy phase of a survive phase as
progress, so anti-turtle aggression does not stack on the phase's own pressure.
`objectiveParOffset` and `holdShare` keep their keys and are read for the legacy kind
(`DifficultyEngine.js:506` is unchanged).

## 6. Phases

```js
phases: [
  { id: 'hold', primary: [{ id:'pass', kind:'survive' }],
    until: { kind: 'turn', afterPhase: 3 } },
  { id: 'push', primary: [{ id:'camp', kind:'seize', thrones:[…] }],
    onEnter: { setTiles: [{ anchor:'east_gate', terrain:'Floor' }],
               wake: ['camp_guard'], line: 'phase.signal' } },
]
```

- **Order.** Phases run in order. `objectiveState.phase` is the current index.
- **Advance.** A phase advances when its `until` trigger fires (any README trigger; the
  `until` of phase k arms only once phase k is current), or, with no `until`, when its
  primaries are all done. The last phase has no `until`; it ends in victory.
- **`onEnter.setTiles`** reuses the `phaseTerrainOverrides` entry shape and its anchor or
  coordinate resolution (`BattleScene.js:2735-2790`). The tile logic moves into a pure
  `applyTerrainSetTiles(grid, setTiles, anchors)` that both the hybrid overrides and phases
  call. As with 02's §8 fix, a tile holding a unit is never set to impassable terrain:
  that tile's entry is skipped and recorded.
- **`onEnter.wake`** names 02 groups. The wake rides 02's ledger.
- **`onEnter.line`** is the band's text key.
- **Resume.** The phase index rides the checkpoint, and `onEnter` effects are recorded in
  the ledger as fired, so a resume or rewind never re-applies them: terrain is restored
  from `mapLayout`, groups from their state.
- **How a switch is shown.**
  1. An objective band in the ceremony style: word NEW OBJECTIVE, the sub-line the new
     primary's goal sentence.
  2. The strip pulses (`_pulseObjectiveText`).
  3. `guide_objective_changed` fires with `context.goal`. Its text already has the generic
     branch (`Guidance.js:172`); `objectiveChange()` (`GuidanceController.js:304`) reads
     `statusView` instead of the seize test, and the seize boss case becomes a
     `guard_fell` event.
  4. Spec 01 pans to the new anchor.
- **Par.** Par does not change at a switch. It was locked as the sum of every phase's
  contribution.
- **Not in v2**: branching phases and a phase that undoes an earlier one.

## 7. Bonus objectives

### 7.1 Kinds

| kind | done when | failed when | anchors | default reward |
|---|---|---|---|---|
| `visit` (legacy village) | `villageState.status === 'visited'` | `razed` | the village | **paid in battle, as today** (§9) |
| `caravan` (legacy) | at victory: the caravan alive or exited | the caravan falls | the caravan | `pendingCaravanShop`, as today |
| `rescue` | `count` of its villages visited | too few left intact | villages | gold + item |
| `slay` | `ref` dies on or before `byTurn` | the player phase of `byTurn` ends with it alive, or it flees | the target | gold + forge step |
| `protect` | at victory: the unit alive (or exited) | it falls | the unit | gold |
| `unbloodied` | at victory: never broke | any deployed unit at an action boundary below `floor(maxHP × share)` (default 0.5) | none | gold + item |
| `capture` | the ballista (`ballista.owner === 'player'`) or point is taken | (a ballista destroyed, if 04 adds that) | the ballista | item |
| `reach` | a player unit ends its action on the cache tile | a thief (04 `seek_tile`) ends on it first | the cache | item |

`byTurn` is locked at generation as `par − k` (k from data). It is a real number on the
strip ("before turn 6"), never "par minus 2". "No unit below X%" is checked at action and
enemy-unit boundaries, not on every HP write, so a heal later in the same action counts.

### 7.2 How many, and where

- At most **two** per map (validator, `MAX_BONUS_OBJECTIVES`). Today's maps carry at most
  one, since the village and the caravan exclude each other (`VillageSystem.js:46`).
- Set pieces (04) declare theirs. Ordinary procedural maps keep only the derived village
  and caravan in v2 (open question 5).
- None on a scripted battle, as villages and caravans already never appear there.

### 7.3 Judged once, at the victory commit

- **During the battle**, `objectiveState.status` tracks progress for the strip only.
  Nothing is paid, except the legacy village (§9).
- **At victory**, `PostCombatController.onVictory` passes
  `bonusVerdicts(objectives, state, field)`, a list of
  `{ id, kind, done, reason, by, reward }` plus the stakes of done primaries, into
  `completeBattle(…, { objectiveVerdicts })`. An open `slay` resolves as failed and an open
  `protect` as done if the unit lives.
- `completeBattle` calls `engine/BonusSettlement.js` `settleBattleBonuses(run, { nodeId,
  verdicts })` **after** the contract settlement (`RunManager.js:4166`). It sets
  `run.lastBonusSettlement` for presentation, like `lastContractSettlement`, and its lines
  join the victory band (`band.addParts`, `PostCombatController.js:200-206`).
- **Why this cannot pay twice or lose a reward.** `completeBattle` applies once per node
  (`openBattleNode`). A Vision rewind, a resume or Continue from Map happens before it and
  so has paid nothing. A reload after it finds the node complete.
- The `caravanSurvived` option stays for callers that pass it (the sims). When verdicts are
  present, the caravan verdict decides.

### 7.4 Rewards: never XP

Rewards are locked at generation from `data/objectives.json` `bonusRewards`, by act, so the
strip shows exactly what will be paid. The validator refuses any key outside this list.

| key | paid how | when it cannot be paid |
|---|---|---|
| `gold: n` | `run.awardGold(n)` after burdens. Not multiplied, not garnished (as a contract reward), so "+300 G" means 300 | never |
| `item: {…whole item}` | locked as a whole item object (names are identity; the `ItemNameMigration` walk must cover `battleConfigsByNodeId[*].objectives`, with a test), drawn at generation on `keyedBattleRandom(battleSeed, 'bonus:<id>')` from the act's loot pools; into the convoy | no room: paid as its sale value (`price × SHOP_SELL_RATIO`) and said so ("No room for Elixir: sold, +150 G"). No owed record and no hold on the party |
| `forge: true` | one free forge step (`applyForge`) on the equipped weapon of the unit in `by`, the stat on `keyedBattleRandom(battleSeed, 'bonus-forge:<id>')` | not forgeable, or that unit has gone: `forgeFallbackGold[act]` |
| `vision: 1` | +1 Vision charge, Act III+, at most once per act (`run.bonusVisionActs`, saved) | off by default (README Q3) |

- Bonuses never go through the loot screen, because gold cards carry team XP (§1.4).
- **Sizes, to tune with `sim/pacing.js`**: gold 150/300/500/700 by act, the village's
  amounts and the S→A rank step (`0.4 × baseBonusGold × GOLD_PAR_BONUS_MULTIPLIER`). An
  item is added when `costTurns ≥ 2`. The sim target: a push that takes the bonus ends
  with more gold-equivalent than a push that skips it, net of rank gold, at the median
  Eclipse cost.

### 7.5 Cost in turns, and the Eclipse

- `costTurns` is locked at generation by `bonusDetourTurns`: the Infantry walk from the
  deploy centroid through the anchor to the primary anchor, minus the direct walk, divided
  by 4 and rounded up (minimum 1 for a tile bonus). Bonuses with no tile (`unbloodied`,
  `protect`) show "no detour". The strip says "~2 turns".
- **The price is the clock.** Each turn costs late-pressure decay past par and shadow past
  par − 3 (`eclipse.md` §1). Bonuses never touch par and never pay shadow relief: that
  would pay in the clock's own currency. Black Sun keeps the same rewards and costs; there,
  a bonus is mostly a gold-for-shadow trade (open question 6).
- Contracts: `underPar` still reads turn and par, so a bonus that costs turns can break
  one. The strip's cost line is what tells the player.

### 7.6 Failure

A failed bonus is final. It costs nothing but the reward. It fades in the strip with a
one-line reason ("Village razed", "Varro lived past turn 6", "Mara fell below half"), and
the band lists it as missed. It never ends a battle.

## 8. Defeat and failure

### 8.1 No new run-ending defeat

`hasBattleDefeat` stays the only defeat: the commander falls, or the army is gone. A run
ends only on that (CLAUDE.md, "Roguelike tension"). An escort or an assassination going
wrong is a setback inside the battle, never a game over.

### 8.2 Failable primaries

Assassinate, escort and protect must carry `onFail` (validator):

- **A fallback** (`{ primary: [...], line }`) replaces the failed objective in its phase.
  The fallback must itself be non-failable (rout, defeat, seize, escape, capture or
  destroy), so failure never chains. The band reads, e.g., "Varro got away. Rout the
  rest."
- **`'stake'`** resolves the objective as failed, and the battle goes on with its other
  primaries.
- Either way, the objective's `reward` (its stake) is not paid.
- Elite status, loot picks and par are unchanged. The fallback usually costs turns, and
  that is the real price.

### 8.3 Vision rewind

A failure is not a defeat, so there is no modal prompt. When a Vision charge is unspent,
the failure band's sub-line adds "Rewind can undo it" and the rewind control pulses once.
The objective state rides every rewind destination (§11), so rewinding past the fall
reopens the objective.

### 8.4 The prologue

It is untouched. Prologue chapters never carry `objectives`, and their configs keep the
derived model. `requiredRecruits` keeps its path. The protected-unit intercept
(`_prologue.onDefeatIntercept`, `BattleScene.js:11003`) still runs before anything here.
The prologue harnesses (`tests/harness/PrologueP1–P4`) are the gate.

## 9. Migrating today's side objectives

1. **Village and bandit raid** become the `visit` bonus, by derivation only. Its reward
   path is **unchanged in v2**: it pays in battle into `goldEarned` and the convoy, with
   the uid rollback on rewind. The visit's float, the "Village saved!" banner and the
   multiplied gold are what players know, and the rewind path is tested. Its verdict
   carries `reward: { paidInBattle: true }`: the band lists it, and `BonusSettlement`
   pays nothing. Moving its payout to the commit is open question 4. `villageState` stays
   the saved field, with the same validator.
2. **Caravan** becomes the `caravan` bonus by derivation. Its rule ("survived") and its
   reward (`pendingCaravanShop`) are unchanged; `BonusSettlement` sets the shop from the
   verdict.
3. **Recruit NPC** and **rout ladder** become notes in the strip (§10). They are not
   bonuses: the recruit's reward is the unit, and the ladder is pressure.
4. `secondaryObjectiveStatus` stays as an adapter over the strip model, returning today's
   `{ id, text, tone }` parts, so its tests and the phone chips keep their strings.

Save compatibility: nothing new is written for these maps. Old checkpoints restore
`villageState` and `caravanExited` as today, and `objectiveState` is rebuilt from them.

## 10. Retiring the hardcoded sites

| PR | Sites (§1.2) | Becomes |
|---|---|---|
| 1 | 1, 2, 9, 12, 13, 30 (harness, invariants) | `evaluate`, `commandsFor`; `isRoutFieldClear` asks the module whether the current phase's primary is a rout |
| 1 | 7 | `calculatePar({ objective: parKind, parAdjust })` |
| 1 | 8 | `new AIController(grid, data, { objectives })`; the clamp reads `enemy.clampTile ?? thronePos` |
| 1 | 10, 11 | `progressMeasure` (old fields kept, plus `bestObjectiveScore`; the validator accepts both); hold anchors from `goalTiles` |
| 1 | 14 | `objectiveChange()` from `statusView` |
| 2 | 3, 5, 6, 15–22 | content and model by kind: `src/data/objectiveContent.js` (goal sentences, verbs, victory words, the deploy banner, hint ids), the strip model (§11); `compactBattleObjective` deleted |
| 2 | 23 | music reads `legacyObjectiveKind` (escape and escort take the escape theme) |
| — | 24–29 | stay: they generate today's procedural maps, which keep the three kinds. New kinds come from set pieces (04) and the twin-thrones template (PR 4) |

Hint ids `battle_seize` and `battle_escape` keep their names, so seen-state carries over.
New kinds get `battle_objective_<kind>`. `OBJECTIVE_WORDS.defend` is removed.

## 11. UI

### 11.1 One model

`ui/objectiveStripModel.js` builds `objectiveStrip(scene)` from
`BattleObjectives.statusView` plus `PlayerKnowledge`:

```js
{ phase: { index, total, label } | null,
  primary: [{ id, kind, verb, text, compact, progress: {done,total}|null,
              tone: 'open'|'good'|'warn'|'bad', anchors, marker, reason }],
  bonus:   [{ id, kind, text, compact, cost: '~2 turns'|'no detour'|null,
              reward: '+300 G · Elixir', status, tone, anchors, marker, reason }],
  notes:   [{ id: 'recruit'|'ladder', text }] }
```

- **Fog rule** (from `sideObjectiveInputs`): a target, escortee or thief out of sight
  reads "in fog" and gives no anchor. Its last seen tile is kept by the caller, never read
  from hidden units. `marker ∈ throne | exit | target | escort | point | structure |
  bonus` goes to spec 01, which draws at most three kinds at once.
- **The canvas objective text** is `objectiveLines(model)`, the same strings. Desktop keeps
  its plate (`DesktopBattleHud.js:230`); a hover tooltip adds rewards and costs.
- **Phone, landscape and portrait.** The rail button shows `primary[0].compact` (a "+1"
  when there are more). The strip has at most **two rows**: the primary, then the first
  open bonus ("Village · ~2 turns · +300 G"). A tap opens the details sheet,
  `objectiveHelp(model)`, which lists every primary, bonus and note with its reward and its
  failure reason. A row's tap pans to its anchor (01). Done rows collapse to a check;
  failed rows fade with their reason.
- **Portrait** follows the contract slot precedent: a fixed rail row, so the map never
  resizes when a status flips. Its rules sit inside `@media (orientation: portrait)`
  (`PortraitCssGating.test.js`).

### 11.2 Words (`objectiveContent.js`, plain register)

| kind | goal sentence (deploy, help, turn-1 hint) | victory |
|---|---|---|
| rout | Defeat every enemy on the map. | ROUTED |
| seize | Defeat each throne's guard, then move a Lord onto it and choose Seize. | SEIZED |
| escape | Bring your Lords to the green exits. The army retreats when the last Lord leaves. | ESCAPED |
| defeat | Defeat {name}. The rest need not fall. | VANQUISHED |
| assassinate | Defeat {name} before they reach the road. | VANQUISHED |
| escort | Keep {name} alive to the {edge} road. They walk only with a guard near. | ESCORTED |
| capture | End a unit's action on each point, and hold them all at once. | HELD |
| destroy | Strike the {structure} until it breaks. | DESTROYED |
| survive (phase) | Hold until turn {n}. | (never the last phase) |

- **Other places that read the model:**
  - the deploy banner and the `PartyMenus` status;
  - the victory band: the last phase's last kind, plus "Bonus: Village saved +300 G" /
    "Bonus missed: Varro lived past turn 6";
  - the felled band (`guard_fell`: "Take the throne", "1 throne left");
  - the pause list (each objective and its status, beside the burden and contract
    entries);
  - the Help tab (a Battle › Objectives page: kinds, bonuses, "bonuses never give EXP").
- **The route map.** `node.battleParams.objectivePreview = { primary: [kind], bonus:
  [kind] }` is written when 04 picks a set piece at node generation (the config does not
  exist yet then). The loom card and the node label read it, falling back to today's
  `OBJECTIVE[objective]` and its Village/Caravan tags (`loomModel.js:552`).

## 12. Persistence, determinism, harness parity

**Config.** `objectives`, `structures` and `npcAllies` are written at generation and
locked (`RunManager.js:3626`). `getLockedBattleConfig` (`:3591`) gains a sanitizer for
structure tiles, beside `sanitizeEscapeTilePassability` (`:3600`): a `Gate` at every
intact structure. The legacy derivation is never written.

**Battle state.** `objectiveState` joins, in the same PR (README §3):
- `captureBattleState` (`BattleCheckpointAdapter.js:5`), and with it the rewind timeline,
  which is built from it;
- the suspend restore (`BattleSuspendController.js:339-362`);
- the Vision snapshot and restore (`VisionRewindController.js:140-160`, `:284-317`);
- `BattleStateSnapshot` validation (optional key, a `validateObjectiveState` shape check).

Structure HP and terrain go together: the terrain rides `mapLayout`, the HP rides
`objectiveState`, and both restore from one snapshot. Unit fields (`objectiveRef`,
`clampTile`, `isEscort`) ride `serializeBattleUnit`. Escort and flight removals are
recorded in `objectiveState` (`escorted`, `fled`), as `caravanExited` is.

**Commit.** `completeBattle` gains `objectiveVerdicts`. `lastBonusSettlement` is
presentation only. `bonusVisionActs` is saved only if Vision rewards are enabled.

**Determinism.**
- The module draws nothing.
- Reward items and forge stats use `keyedBattleRandom(battleSeed, 'bonus…')` and never
  touch the battle stream or `Math.random`.
- Escort steps are deterministic paths.
- Calibrators and detour estimates are pure BFS.
- The legacy village keeps its draw exactly where it is.

**Harness.** `HeadlessBattle` calls the same module in four places:
1. `_checkBattleEnd` becomes the guard plus `evaluate`;
2. the action list comes from `commandsFor`;
3. the escort step goes in `_processEnemyPhase` beside the caravan (`:2331`);
4. take, retake and reach go in its action-end paths.

`ScriptedAgent` and `TacticianAgent` read `goalTiles` instead of testing
`objective === 'seize'`. `Invariants.js` checks against the model. Per CLAUDE.md, no
harness copy of any rule survives the PR that moves it.

**Boundary test** (`tests/ObjectiveReaders.test.js`, in the style of `HpWriteBoundary`):
outside an allowlist (generation, words fallbacks, prologue), no `src/` file may compare
`.objective` with a literal.

## 13. Tests

**Realistic failures first:**
1. An old config or checkpoint behaves differently after PR 1, through derivation drift.
2. The scene and the harness disagree about a new kind.
3. A bonus is paid twice, or lost, across rewind, resume, Continue from Map or a reload
   after the commit.
4. Evaluation or settlement moves the battle RNG cursor.
5. The strip leaks a hidden target's or escortee's tile under fog.
6. A resume or rewind replays a phase: the band again, terrain re-set, groups re-woken.
7. Escape plus a fallback primary deadlocks. An escort waits forever on a clear field. A
   target is killed on the move it reaches the exit.
8. A rewind restores gate HP without the terrain, or the terrain without the HP.
9. Removing the regex changes a legacy compact label.
10. A rule reader is left on the string.
11. A new kind gets `null` par.
12. A bonus leaks XP.
13. Multi-seize lets the second throne be taken before its guard falls, or the clamp
    binds the wrong guard.
14. Anti-turtle fires during a survive phase.
15. The prologue changes.

**Suites:**
- `tests/BattleObjectives.test.js` (pure): legacy derivation per objective, exact
  equivalence with the old `checkBattleEnd` branches on a table of hand-built fields
  (expected values derived by hand, not by running the old code), every kind's win, fail,
  fallback and stake, AND resolution, deferral inside the enemy phase, the escape
  combination rule, escort on a clear field, flight versus kill on the same move.
- `tests/ObjectiveLegacyGolden.test.js`: about 200 harness battles over today's templates
  and seeds, run before and after PR 1. Outcome, turn and RNG cursor are identical. The
  checkpoint fixtures from today restore and finish identically.
- `tests/ObjectiveReaders.test.js`: the boundary grep (failure 10).
- `tests/ObjectiveStripModel.test.js`: every legacy compact string pinned (failure 9),
  fog pairs that differ only by a hidden unit (the `PlayerKnowledgePreviews` pattern),
  the maximum-length names at 9 px.
- `tests/BonusSettlement.test.js`: each reward key; no room becomes the sale value; forge
  falls back to gold; one payment through `completeBattle` called twice; a revert before
  the commit pays nothing; `awardTeamXp` is never reached; the RNG cursor.
- `tests/ObjectivePersistence.test.js`: `objectiveState` through checkpoint, Vision,
  validator and suspend, with phase index, structures, points and the `escorted`/`fled`
  lists; an old checkpoint without it; gate HP and terrain together.
- `tests/EscortRoute.test.js`, `tests/AssassinateCalibration.test.js`,
  `tests/Structures.test.js` (damage, Strike availability, `brokenTerrain`, a phase
  opening it, terrain index 19 appended).
- `tests/TurnBonusCalculator.test.js`: every primary kind has par, and `parAdjust` is
  applied.
- Harness: `tests/harness/Objectives*.test.js` fixtures per kind, played by the agents.
  The prologue harnesses stay green.
- e2e: `objective-strip.spec.js` (lane `mobile-ui`): desktop 640x480, 844x390, 667x375,
  390x844; a bonus done, failed, and rewound; no overflow.
- Prove each new test can fail by planting its bug once (CLAUDE.md).

## 14. PR breakdown

| PR | What | Behaviour change | Effort |
|---|---|---|---|
| 1 | `BattleObjectives.js` with the legacy derivation only; every rule reader and the harness moved; `parAdjust` plumbing (always 0); boundary and golden tests | none (pinned) | 3–4 days |
| 2 | `objectiveContent.js`, `objectiveStripModel.js`; regex parsing removed; every word site by kind | none in words for today's kinds (escape gains its help goal line) | 2 days |
| 3 | `objectiveState` and its four persistence sites; derived village and caravan bonuses; `BonusSettlement` at the commit; bonus rows on the strip and band | the strip and the band show the bonus | 2–3 days |
| 4 | Phases (index, `until`, `onEnter`, shared `applyTerrainSetTiles`), `objective` events into 02's ledger, multi-seize with per-guard clamp, `twin_thrones` elite seize template (Act III+, two Throne features; `MapTemplateEngine:1124` allows two when `thrones: 'all'`) | new elite maps | 3 days, after 02's ledger |
| 5 | `data/objectives.json`, new bonus kinds (rescue, slay, protect, unbloodied, capture, reach), validator, the pacing-sim reward check | set pieces may declare bonuses | 3 days |
| 6 | Defeat, assassinate (+ `calibrateFlight`), escort (`ObjectiveNpc`, `EscortRoute`), protect clause, `onFail` | set pieces only | 4–5 days |
| 7 | Capture points; structures: `Gate` terrain and art, Strike, `StructureController`, destroy | set pieces only | 4 days + art |

PRs 1–3 are worth shipping alone: one predicate, no regex, and bonuses that say what they
pay. PR 4 is the README's "multi-seize on today's maps". PRs 6–7 feed spec 04's
catalogue (Hunting Party, Caravan Under Siege, Break the Gate, The Bridge Must Fall).

## 15. Open questions for the owner

1. **Vision as a bonus reward** (README Q3): off by default here. If allowed: Act III+,
   once per act?
2. **Should a failed escort or assassination ever end the run?** Recommendation: never;
   fallback or stake only.
3. **An item reward with no room**: is the sale value acceptable, or should it use the
   contract's owed lifecycle (which holds the party at the node)?
4. **The village's payout**: keep it paid in battle (today), or move it to the commit like
   every other bonus? Moving it unifies the code, but changes the multiplied gold and
   takes the convoy item away during the battle.
5. **Bonuses on ordinary maps** beyond the village and caravan, for example "Capture the
   ballista" on Nightfall+ maps that already roll one?
6. **Black Sun**: may a bonus ever relieve shadow? Recommendation: no (Pillar 6: the clock
   is not a bonus currency).
7. **Multi-seize on act boss nodes** (v2 says no): wanted later?
8. **The `unbloodied` threshold**: 50% of max HP, or a per-map number?

## Notes for the README

1. **`turn` trigger refinement.** Phases need a turn relative to the phase's start, so the
   `turn` trigger gains `{ afterPhase: n }` beside `afterContact` and `parOffset`. It is
   used for survive phases (n ≤ 3).
2. **The legacy string for new kinds.** README §3 keeps `objective ∈ rout | seize |
   escape` for legacy readers. This spec maps each new kind to a family (§3.3) and makes
   every *rule* reader read the model (PR 1), so the string is only a fallback for words
   and generation.
3. **The trigger ledger.** This spec assumes 02 owns the fired-trigger ledger in battle
   state. Objectives emit `objective` events into it and read phase `until`s from it.
4. **The village exception.** Roadmap Phase 3 says bonus rewards are paid at the victory
   commit. The legacy village keeps its in-battle payout in v2 for compatibility (§9,
   open question 4). Every new bonus pays at the commit.
5. **The 02 `onWake` contract.** Assassinate and capture need a group's `onWake` to be
   able to set `aiMode: 'seek_tile'` with an anchor target (`{ seek: anchor }`), and
   `{ retake: pointId }` for capture.
