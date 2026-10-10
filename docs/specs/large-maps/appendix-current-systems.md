# Current-systems reference: objectives, battle config, AI hooks, reinforcements, node map, NPCs, rewards

Read-only survey of `/home/user/rogue-emblem` (2026-10-09), written so specs for bigger maps, new objectives, bonus objectives, staged encounters and authored set pieces extend the existing code. Citations are `file:line` (line numbers as of this survey). "BS" = `src/scenes/BattleScene.js`, "MG" = `src/engine/MapGenerator.js`, "RM" = `src/engine/RunManager.js`.

---

## 1. Objectives

### 1.1 How an objective is represented
- There is one string field, `objective ∈ {'rout','seize','escape'}`. It sits on `node.battleParams.objective` and is copied to `battleConfig.objective` (MG:556). BS falls back to `{ act:'act1', objective:'rout' }` (BS:514).
- Data needed for each objective, all on the battle config:
  - **seize**: `thronePos {col,row}` (set from the template's `Throne` feature, MG:136-150) and one enemy spawn with `isBoss: true`.
  - **escape**: `escapeTiles [{col,row}]` (`placeEscapeTiles`, MG:1484; 1-6 tiles from the template's `escapeZone`). They must be standable by Infantry, Armored, Cavalry and Flying (`ESCAPE_TILE_MOVE_TYPES`, MG:1451), and `sanitizeEscapeTilePassability` re-heals them on load (RM:3602).
  - **rout**: nothing extra. Optional `requiredRecruits: string[]` (prologue only).
- The objective enum is hardcoded in several places. Every one needs a branch for a new objective:
  - `TEMPLATE_OBJECTIVES` (MapTemplateEngine.js:8): mapTemplates.json must have a non-empty array per objective (MapTemplateEngine.js:948-955).
  - DifficultyEngine `holdShare` / `objectiveParOffset` keys (DifficultyEngine.js:506).
  - `turnBonus.json objectiveBasePar` / `objectiveAdjustments`. `calculatePar` returns **null** (no par) for an objective missing there; tests already pin `'defend'`/`'survive'` → null (tests/TurnBonusCalculator.test.js:128-129).
  - `OBJECTIVE_WORDS` (ceremonyContent.js:140). It already contains an orphan `defend: 'DEFENDED'`, not used anywhere else.
  - `felledContent` / `shouldShowFelled` (ceremonyContent.js:178-192).
  - `OBJECTIVE_GOALS` (helpTopics.js:202, rout/seize only).
  - `OBJECTIVE_BANNERS` (DeployScreenOverlay.js:136).
  - The deploy status string (PartyMenus.js:291).
  - Loom `OBJECTIVE` labels (loomModel.js:373).
  - `OBJECTIVE_COMMAND_IDS = ['seize','escape']` (battleMenuModel.js:24).
  - Turn-1 contextual hints (BS:9651-9690).
  - `compactBattleObjective` regexes (battleSidebarDisplay.js:5).
  - `BattleMusicSelection` (escape theme, BattleMusicSelection.js:127).
  - Caravan/village eligibility (CaravanSystem.js:35, VillageSystem.js:46).
  - `HoldActivation.holdCandidates` (anchor per objective, HoldActivation.js:54-96).
  - `TurnPressure.measureTurnPressure` (progress metrics, TurnPressure.js:16-56).
  - AI throne clamp (AIController.js:341).
  - The harness mirror `tests/harness/HeadlessBattle.js` (`_checkBattleEnd` :2235, seize/escape commands :550-560).

### 1.2 Win/lose check: `BattleScene.checkBattleEnd()` (BS:10983)
The checks run in this order:
1. **Idempotence guard.** It returns true while `BATTLE_END`, `_fatalDecision`, `_fatalCapturePending`, `_defeatDecision` or `visionDialog` is set. It returns false while `_deathAffixChainDepth > 0`.
2. **Defeat.** `hasBattleDefeat(playerUnits, escapedUnits)` (engine/BattleDefeat.js:3): no living `isCommander` (an escaped commander counts as alive), or the field and the escapes are both empty. That leads to `_prologue.onDefeatIntercept()` (prologue chapters restart), then `showLordDeathVisionPrompt()` (spend a Vision to rewind), then `onDefeat()`. These are the only loss conditions. There is no turn limit, and losing the caravan, a razed village or a dead recruit never fails a battle.
3. **Rout.** `isRoutComplete(routObjectiveState())` (engine/RoutObjective.js:39). It needs no enemies, no `_zombieTombstones`, and every `requiredRecruits` name in `playerUnits` or `escapedUnits`. Victory is deferred while `_reinforcementsPendingThisTurn` is set (that flag is on through the enemy phase, BS:10396). `isRoutFieldClear` cancels all remaining waves once the field is clear (BS:2681).
4. **Escape.** The commander has escaped and no lord remains on the field (BS:11020).
5. **Seize** is never decided here. It is the `Seize` action-menu command (BS:6347-6364): a lord on `thronePos`, no living `isBoss` enemy. It awaits the prologue's `onSeize`, then calls `onVictory()` directly.

`checkBattleEnd` is called from many sites (after combat, after removal, after Talk, at the end of the enemy phase, and in error recovery). `TurnManager` gets it as a callback (BS:1851-1862).

### 1.3 The other objectives' flows
- **Escape** (`ui/EscapeObjectiveController.js`).
  - `executeEscape` (:84) moves the unit into `scene.escapedUnits` and marks it acted.
  - A non-lord earns `ESCAPE_EVAC_GOLD_BY_ACT[act]` (constants.js:236; 20/30/40…) into `scene.goldEarned`.
  - It then calls `checkBattleEnd`, records history, and captures the suspend checkpoint.
  - Escaped units are survivors at victory (PostCombatController.js:130).
- **Seize-boss death.** `_showBossDefeatedBanner` (BS:10915) shows the FOE VANQUISHED band (CeremonyController.js:229) and pulses the objective. GuidanceController raises `guide_objective_changed` (GuidanceController.js:279-311). That is the existing hook for an objective changing mid-battle.
- **Prologue `requiredRecruits`.**
  - `battleRequiredRecruits` (engine/Prologue.js:574) reads `battleConfig.requiredRecruits`, or else the chapter's data.
  - Talk sets `routWaited` and re-checks the end (MovementActionController.js:197).
  - In a standard run the list is always `[]`.

### 1.4 How objective text reaches the player
- **Canvas objective line**: `updateObjectiveText()` (BS:11084), built from `objectiveText` at BS:1890.
  - The first line is per objective: seize → red/green text by boss status; escape → `EscapeObjectiveController.getObjectiveLabel()` (:70); rout → `routObjectiveLabel` (RoutObjective.js:73) plus the ladder line (`routLadderObjectiveLine`).
  - Suffix lines are appended for the recruit beacon (`RecruitBeaconController.getObjectiveSuffix`) and the village (`VillageController.getObjectiveSuffix`, `villageObjectiveLine` VillageSystem.js:417).
  - It is called after deaths (BS:9334), arrivals, terrain overrides and Talk.
- **Desktop HUD**: `DesktopBattleHud.js:230` lays `objectiveText` out top-right. Boss presence sits under it.
- **Mobile HUD**: `MobileBattleHUD.js:981-1014`. The rail button shows `compactBattleObjective(objectiveText.text)`. Its details sheet is `objectiveHelp(text, bossLine, objective)` (helpTopics.js:211), which lists the lines after the first as points.
  - Side chips come from `secondaryObjectiveStatus(sideObjectiveInputs(scene))` (battleSidebarDisplay.js:40/76), with village, caravan and ladder parts of `{id,text,tone}`. This is the existing **secondary-objective status model**.
  - Fog-aware: the caravan shows "in fog" when it is out of sight.
  - Note: the compact label is derived by **regex-parsing the canvas string**. A new objective needs either its own pattern or (better) a structured model.
- **Banners**:
  - Deploy screen `OBJECTIVE_BANNERS` (DeployScreenOverlay.js:136).
  - Victory band `showVictory({objective, turn, par, rating, shadowGain…})` (CeremonyController.js:247), worded through `objectiveWord`.
  - Arrival band `showArrival` (via ReinforcementPresenter).
  - Turn-1 hints `battle_seize` / `battle_escape` / `battle_par` (BS:9651).
- **Route map**: the Loom card (`loomModel.js:527` → `OBJECTIVE[id]`, e.g. "ESCAPE · Get every lord…").

### 1.5 Existing "bonus"/secondary concepts
| Concept | Where | Shape |
|---|---|---|
| **Turn par rating** S/A/B/C | `TurnBonusCalculator.calculatePar` (:22), `getRating` (:95); brackets in `turnBonus.json` (S ≤ par−3, A ≤ par, B ≤ par+3, C) | Bonus gold `baseBonusGold[act] × bracket.bonusMultiplier × GOLD_PAR_BONUS_MULTIPLIER` (`calculateBonusGold` :218), paid once in `prepareBattleRewards`. Live XP × `parXpMultipliers` (S 1.25 / A 1.10 / B 1 / C 0.9) via `getParXpMultiplier` (:256, BS:9009) |
| **Late pressure** | `getLatePressureState` (:138); `getTurnPressureState` BS:2951 | XP and gold decay once more than `startOverPar` turns over par. Boss enrage from turn min(12, par+2) (`getBossEnrageTurn` :180) |
| **Village** (secondary) | `engine/VillageSystem.js`, `ui/VillageController.js` | `battleConfig.villageTile {col,row,uncontested?,reward?}`; state `_villageState {col,row,status:intact|visited|razed,rewardItemUid?}`. A visit pays `VILLAGE_GOLD_BY_ACT` into `goldEarned` plus a convoy item (never XP). Bandits arrive as a turn-1 scripted wave with `aiMode:'seek_tile'`, `aiTargetTile`. They raze in `handleEnemyUnitDone`, then revert to `'chase'` |
| **Merchant Caravan** (escort) | `engine/CaravanSystem.js`, `ui/CaravanController.js` | `battleConfig.caravanSpawn {col,row,exit}`. An NPC with `isCaravan`, HP 18+4·act, moving 1 tile per enemy phase toward its exit (`stepTurn`, BS:10401). AI target score +40 (AIController.js:1297). Survival leads to `completeBattle({caravanSurvived})` and then `run.pendingCaravanShop` |
| **Recruit NPC** | `RecruitNpc.js`, `RecruitNodeSystem.js` | `battleConfig.npcSpawn`; a lord Talks to recruit. Recruit node gold ×1.2 (`NODE_GOLD_MULTIPLIER.recruit`) |
| **Contracts** `underPar` / `noLosses` | `engine/Contracts.js:65`, `ContractSettlement.js` | Judged **once** in `RM.completeBattle` from `{turnCount, turnPar, losses}`. Reward and penalty are event effect lists run through the `EventEffects` planner. The verdict is a durable `run.contractOwed` and is retried until delivered. The chip comes from `contractHudModel.js` / `ContractHudController.js` |
| **Deeds** | `engine/DeedSystem.js`, `data/deeds.json` (19 ids: held_the_line, untouched, bossbane, lordshield, last_of_them…) | Per-unit feats (epithets/Oaths), not battle objectives. Battle scratch is `unit._battleDeeds`, committed at victory (`deedsFor(scene).commitVictory`) |
| **Elite flag** | `battleParams.isElite` (seize/escape mid-act nodes, eclipsed nodes, event `battle.elite`) | 4 loot choices / 2 picks (constants.js:230-231), gold ×1.25 (`ELITE_GOLD_MULTIPLIER`), `enemy.isElite`, area arts at Nightfall+ Act III+, the seize elite captain, the elite-victory line |
| Hidden extras | Escape non-lord evac gold; boss kill +300 kill gold (`GOLD_BOSS_BONUS`); ballista capture | |

### 1.6 Extension points
- **A new primary objective** has to touch:
  - `checkBattleEnd` (a branch, or a pure predicate module in the style of `RoutObjective.js`, shared with the harness `_checkBattleEnd`);
  - `updateObjectiveText`, plus the compact/regex label, `OBJECTIVE_*` tables and turn-1 hints;
  - `TEMPLATE_OBJECTIVES` with a template pool;
  - `validateBattleConfig` objective requirements (MG:3663-3689);
  - `ensureReachability` targets (MG:413);
  - `turnBonus.json` par;
  - `TurnPressure` progress metrics;
  - `HoldActivation` anchor;
  - the DifficultyEngine key whitelists;
  - the music and ceremony words;
  - the harness.
  - A command-driven objective (like Seize/Escape) adds an action-menu command at BS:6347-6372 and to `OBJECTIVE_COMMAND_IDS`.
- **Secondary or bonus objectives** have no generic container today. Each micro-objective (village, caravan) has bespoke state fields:
  - in the checkpoint (`villageState`, `caravanExited`: ui/BattleCheckpointAdapter.js:45-46);
  - in the Vision snapshot (VisionRewindController.js:155-159, restore :303-317);
  - in the validator (BattleStateSnapshot.js:131-134, 179);
  - in a `completeBattle` option (`caravanSurvived`).
  - A generic "side objectives" record would need all four of those plus `sideObjectiveInputs`.
  - Pay-in options:
    - `scene.goldEarned`: it is multiplied by node, elite, run and difficulty gold multipliers in `completeBattle`;
    - `run.addToConvoy` (village, with uid rollback on rewind);
    - an extra `completeBattle` option, settled at commit like contracts (the safest, since revert and suspend never touch it);
    - or the `pendingBattleReward` record (`summary`, `choices`, `picksRemaining`).

---

## 2. Battle config

### 2.1 Generation: `generateBattle(params, deps)` (MG:61)
- `generateBattle` retries the layout up to `CARAVAN_PLACEMENT_ATTEMPTS` (8) if a promised caravan found no tile.
- `generateBattleLayout` (MG:72) runs these steps:
  1. Map size: `pickMapSize` (mapSizes.json by act phase), overridden by `fixedSize`.
  2. Template: the pre-assigned `templateId` if allowed for the act and objective, else `pickTemplate` (weighted by optional `weight`, one draw).
  3. Terrain: zones, then `applyStructures`, then `applyHybridArenaOverlay`.
  4. Features: Throne sets `thronePos`; Ballista only at Nightfall+ outside Act I.
  5. Toxic overlay.
  6. Player spawns (`placeSpawns` 'playerSpawn', count = `deployCount`).
  7. Enemies (`generateEnemies` MG:1972): the boss first on seize (random from `enemies.bosses[act]`, or `eliteCaptains` for elite seize), anchors, fill.
  8. Caster gear, carry, affixes, Sworn affix and elite area arts.
  9. The NPC recruit (`generateNPCSpawn`) and recruit guardian (MG:334).
  10. The caravan tile, the village tile (written as Village terrain) and escape tiles (MG:394).
  11. `ensureReachability` to all targets plus bridges and cavalry guarantees.
  12. Reinforcement clone (`cloneReinforcementConfig` MG:748: difficulty gating `minActByDifficulty`, `actTurnOffset`, `extraWavesByDifficulty` merged then stripped).
  13. Hybrid clone, the village bandit scripted wave, `assignHolders` (MG:495), the rout ladder (MG:508), the Hunted wave (MG:537) and `wavesRaisePar:false`.
- **Returned fields** (MG:552-584):
  - `mapLayout` (number[][] of terrain indices), `cols`, `rows`, `objective`, `biome`.
  - `playerSpawns` (ordered toward `npcSpawn` on recruit maps), `enemySpawns`, `npcSpawn`, `caravanSpawn?`, `villageTile?`, `thronePos`, `escapeTiles?`, `ballistas?`, `templateId`.
  - `parBonus`, `parInflation?`, plus `parOffset`/`parFloor` (`parOffsetConfig`, MG:3129; seize floor `SeizeParFloor.js`).
  - `toxicTiles`, `reinforcementContractVersion`, `reinforcements` (see §4).
  - `hybridArena`, `hybridAnchors {name:{col,row}}`, `phaseTerrainOverrides`.
  - Prologue-only: `prologueChapter`, `requiredRecruits`, `hidePar`, `loot`, `formationSpares`.

### 2.2 Locking and validation
- In BS:1503-1520, a battle uses `runManager.getLockedBattleConfig(nodeId)` if present (RM:3591, a structuredClone with legacy repairs). Otherwise a prologue chapter uses `buildPrologueBattleConfig`. Otherwise `withBattleSeed(battleParams.battleSeed, () => generateBattle(...))` runs and then `lockBattleConfig(nodeId, cfg)` (RM:3626).
- The lock is write-once into `run.battleConfigsByNodeId` (serialized RM:4876) and sets `node.encounterLocked`.
- Consequence: anything a spec wants to stay stable across refresh/revert must be **written into the config at generation** (holders, ladder, Hunted wave and revival stones all follow this rule).
- `battleParams` come from `RM.getBattleParams(node)` (RM:3431). It is a clone of `node.battleParams` plus difficulty modifiers: `fogEnabled`, `enemyLevelBonus`, `holdShare`, `routLadder`, `parInflation`, `revivalStones`, `objectiveParOffset`, `reinforcementTurnOffset`, `huntedWave`, `swornEnemy`, `battleDebuffs`, `eclipse*`, `recruitPreview`, …
- `validateBattleConfig(config, deps, {expectedPlayerSpawns})` (MG:3576) checks:
  - that the map is rectangular;
  - spawn bounds, overlap and per-move-type passability (player, enemy, npc, caravan);
  - that the village tile is Village terrain;
  - seize: `thronePos` and an `isBoss` spawn;
  - escape: tiles passable for all 4 move types;
  - Infantry BFS reachability from `playerSpawns[0]` to every enemy, npc, caravan, village, throne and exit.
- It runs only under `DEBUG_MAP_GEN`, in fuzz tests, and for prologue chapters in `npm run validate:data` (Prologue.js:1945). It never throws.

### 2.3 Authored configs
- **Prologue** `buildPrologueBattleConfig(chapter, terrain)` (Prologue.js:472):
  - The map is an ASCII grid (`map.legend` char → terrain name, `map.rows` space-separated, `parsePrologueMap` :411).
  - It takes explicit `playerSpawns` and `enemies[]` with `{id,className,level,col,row,weapon?,skills?,aiMode?,holdPack?,holdPackSize?,isBoss?,name?,stats?}`, which become spawn `authoredId`, `weapon`, `skills`, `stats` (applied by `EnemySpawnGear.applySpawnLoadout` :129).
  - It also takes `npc`, `villageTile{reward}`, `thronePos`, `escapeTiles`, `requiredRecruits`, `showPar → hidePar`, `loot`, `formation.tiles → formationSpares`.
  - Prologue runs pre-lock all chapters at `startPrologue` (RM:817-821).
  - **Caveat:** authored configs are tied to `isScriptedBattle(battleParams)` (`battleParams.prologueChapter`, ScriptedBattle.js:31). That predicate suppresses the Eclipse, Guidance, hints, deeds, formation, villages/caravans, beats, etc. A standard-run authored set piece needs a new non-scripted path, e.g. a "pre-built config" source in the BS:1503 branch or an authored-map template type.
- **Hybrid boss arenas** (spec `docs/specs/act4_hybrid_boss_arena_spec.md`, shipped):
  - Template `hybridArena {approachRect, arenaOrigin:[c,r], arenaTiles: terrainName[][], anchors:{name:[c,r]}}`. It requires `bossOnly: true`.
  - The authored tile block is stamped over procedural terrain (MG:851).
  - `phaseTerrainOverrides [{turn, setTiles:[{anchor|coord, terrain}]}]` apply at the **start of the enemy phase** of `turn` (BS:9755 → `applyDueHybridOverridesForTurn` BS:2735). Applied turns live in `appliedHybridOverrideTurns` (checkpointed).
  - Templates: `act3_dark_champion_keep` (castle, 4×3 arena at [6,0]) and `act4_boss_intent_bastion` (tundra, at [7,0]), each with 2 scripted waves (guards/sunder).
  - **Likely latent bug (code reading, not run):** on First Light/Dusk the scripted waves land on the same turn as the override that walls the anchor tile they spawn on (bastion: turn 2, `wave1_a` [8,1] → Wall, then a Fighter at [8,1]). Overrides run before reinforcements, and the scheduler reads `battleConfig.mapLayout`, which the Grid mutates by reference (Grid.js:509). So that arrival is blocked. On Nightfall/Black Sun the wave's −1 offset moves it a turn earlier, and the wall can then be set under a standing guard (`setTerrainAt` does not check occupancy).
- **`eldritch_sanctum`** (finalBoss, `fixedSize [16,14]`, `entitySpawn [11,5]`, Throne at `entityAnchor`) is the only finalBoss template, so the final battle always uses it (Lieutenant on the throne, or the Entity with its 3×3 footprint).

### 2.4 mapTemplates.json schema (validator: `MapTemplateEngine.validateMapTemplatesConfig`, known keys :962-988)
- **Top level**: `{ rout:[...], seize:[...], escape:[...] }`. Counts: rout 11, seize 8, escape 4.
- **Template keys**:
  - `id`, `name`, `lore` (≤ 140 chars, one line), `fogChance` [0,1], `parBonus` (int ≥ 0), `weight` (> 0).
  - `caravan` (false = no caravan), `ladder` (false only = opt out of the rout ladder).
  - `acts` (act-id list; absent = every act), `biome` (absent = grassland; must match a rolled biome for the template to be preferred), `bossOnly`.
  - `zones`, `structures`, `features`, `anchors`, `enemyWeights`, `escapeZone`, `minBridges`, `minBridgesByAct` (int or [min,max] per act).
  - `fixedSize [cols,rows]`, `entitySpawn [c,r]` (needs `fixedSize`).
  - `hybridArena`, `phaseTerrainOverrides` (needs `hybridArena`), `reinforcementContractVersion` (1), `reinforcements`.
- **zones**: `{rect:[x1,y1,x2,y2] normalized 0..1, terrain:{Name: weight}, priority, role?}`. Shipped roles: `playerSpawn`, `enemySpawn`. A missing playerSpawn zone falls back to columns 0-3 or the right 3.
- **structures**: `{type: fill|room|wall_line|pillar_grid|pillar_line, rect, terrain?, spacing?}`, applied in order (MG:930).
- **features**: `{type: Throne|Ballista, position: center|right|topRight|bottomRight|centerLeft|entityAnchor}` (MapTemplateEngine.js:725-734, resolved MG:1427). There are no free coordinates. Every seize template needs exactly one Throne.
- **anchors**: `{position: throne|center_gap|bridge_ends|gate_adjacent, unit: highest_level|boss_or_strongest|lance_user|knight}` (:748-749). Unknown values silently do nothing at generation.
- **enemyWeights**: `infantry|cavalry|archer|mage|knight|armored|lance|flying` → multipliers.
- **escapeZone**: `{rect, tileCount 1-6}`. Required for escape templates.

---

## 3. Enemy behaviour hooks

### 3.1 `AIController._decideAction` (AIController.js:284), first match wins
1. `aiMode === 'hold'` stays put (`reason:'hold'`).
2. Planted siege artillery (`isArtilleryPlanted`, SiegeArtillery.js) fires from its post.
3. `aiMode === 'guard'`: it remembers `enemy.guardPost` (set on first decision). If the nearest player or NPC is more than 3 tiles from the post and not `aggressiveMode`, it returns to the post or holds (`guard_hold`/`guard_return`). Otherwise it acts normally.
4. Seize throne clamp (:341): `isBoss && objective==='seize' && thronePos && !aggressiveMode` limits candidate tiles to Manhattan ≤ 1 of the throne.
5. `aiMode === 'seek_tile' && aiTargetTile` takes its own pipeline (`_decideSeekTileAction` :792): it advances on the tile and attacks only a blocker.
6. `aiMode === 'heal'` (Clerics, MG:2303) heals allies under 75% HP and otherwise trails combat allies.
7. Default chase/attack. Targets are scored by `_scoreAttackTarget`; caravan +40; `aggressiveMode` adds +35 to targets on Fort/Throne and +25 to staff users. Affix `aiOverride:'target_lowest_hp'` (`_hasAiOverride` :1424).

- The Entity takes its own branch (`_decideEntityAction` :209; stationary, range 2).
- Asleep units skip their turn.
- NPCs have **no phase or AI**. Recruit NPCs stand still; the caravan steps in `CaravanController.stepTurn` at enemy-phase start.
- The constructor takes only `{objective, thronePos}` (BS:1866). The AI knows nothing about exits, villages (except seek_tile) or other objective tiles.
- `docs/specs/enemy-ai-profiles.md` is an **unbuilt proposal** (data-driven scoring profiles).

### 3.2 Who gets which mode at generation
- Clerics get `heal`. Necromancers get `guard`.
- Seize maps only: 15-25% of non-boss enemies in the boss half get `guard` (MG:2308-2322).
- Village bandits get `seek_tile`.
- Holders get `hold` (below).
- Prologue spawns take any `aiMode`.
- `'chase'` is an explicit no-op mode set when bandits revert (VillageSystem.js:362).
- **Dead field**: the recruit guardian spawn carries `guardianClampPos` and `isRecruitGuardian` (MG:360-368), but no code reads `guardianClampPos`.

### 3.3 HoldActivation (engine/HoldActivation.js), garrison packs
- `assignHolders({spawns, objective, share, thronePos, escapeTiles, playerSpawns, mapLayout})` (:106) runs only on seize/escape, with share = `difficulty.json holdShare[objective]` (Dusk 0.35/0.30, Nightfall 0.45/0.40, Black Sun 0.55/0.50).
  - Candidates: non-boss and non-Entity, no siege weapon, not a Necromancer, not on a hazard, `aiMode` empty or `guard`. Escape candidates must also be in the exit half.
  - They are sorted by distance to the anchor (throne or exit centroid).
  - The count is `round(share × pool)` holders (≥ 2), taken in packs where each holder is within `HOLD_PACK_RADIUS` 3 of another. Lone candidates are skipped.
  - Packs are found by connected components and get `aiMode:'hold'`, `holdPack:int`, `holdPackSize:int`. A map with holders strips the rolled guards.
  - No RNG is used.
- `applyHoldSpawn(enemy, spawn)` (:180) copies the pack data and sets `holdPost`.
- `wakeHolders(...)` (:225) runs at the top of each enemy phase (AIController.js:99), once per turn (`holdCheckedTurn`). Wake reasons, per pack:
  - `enrage` (boss turn-pressure enrage);
  - disturbed (`holdDisturbed`, set by HoldDisturbance.js hooks when the unit is hit, given a status or moved, or it is off its post);
  - `fallen` (fewer living members than `holdPackSize`);
  - `threat` (the holder is visible and a player or NPC stands in its Danger tiles over PlayerKnowledge).
- On waking, `aiMode` is deleted and `holdWoke` set. The scene shows "The garrison stirs!" if a woken holder is visible (BS:10427).
- Anti-turtle aggression never wakes holders.
- All of this state is plain unit fields, so it rides `serializeBattleUnit` (BattleUnitState.js:12, a shallow `{...unit}` clone) into checkpoints and rewinds.
- **This is the closest thing to "pods/triggers" today.** It is per-pack and data-on-spawn, but the wake rules are fixed. There are no authored trigger regions, no cross-pack links, and it is only assigned by generator share (prologue spawns can author `holdPack` directly).

### 3.4 TurnPressure (engine/TurnPressure.js)
- The state is `{noProgressTurns, aggressiveMode, turnEnrageActive, bestEnemyCount, bestLordThroneDistance, bestLordEscapeDistance, bestEscapedCount}`.
- It advances at enemy-phase start (BS:3005 `updateAntiTurtlePressure`, called at BS:9718).
- Progress means: fewer enemies, a lord closer to the throne or an exit, or more escaped.
- After `ANTI_TURTLE_NO_PROGRESS_TURNS` (3) phases without progress, or during boss enrage, `aiMode` goes aggressive: guards leave their posts and the throne clamp is released. It feeds `aiController.setAggressiveMode` / `setBossEnraged`.
- It is checkpointed as `antiTurtleState` and validated (BattleStateSnapshot.js:113-124).
- A new objective needs a progress metric here, or every defend/survive map turns aggressive by turn 4.

### 3.5 Per-spawn data a spawn can carry today
- **Generated/authored `enemySpawns[]`**:
  - `className`, `level`, `col`, `row`, `isBoss`, `isEntity`, `name`, `isElite`.
  - `sunderWeapon`, `poisonWeapon`, `statusStaff`, `siegeWeapon`, `affixes[]`, `areaArt`, `carries`, `carryValue`, `revivalStones`.
  - `aiMode`, `aiTargetTile{col,row}`, `holdPack`, `holdPackSize`, `isRecruitGuardian`, `guardianClampPos`.
  - Authored only: `authoredId`, `weapon`, `skills[]`, `stats{}`.
  - Consumed by `BS.addEnemyFromSpawn` (BS:2565-2649); the harness has an equivalent.
- **Template `scriptedWaves[].spawns[]`** are narrower. The validator allows only `col,row,className,level,sunderWeapon,poisonWeapon,aiMode,affixes` (MapTemplateEngine.js:128-136). The scheduler additionally passes `aiTargetTile` (ReinforcementScheduler.js:596), but **not** hold packs, names, bosses, weapons or skills.

---

## 4. Reinforcements

### 4.1 Schema (`battleConfig.reinforcements`, cloned from the template)
- Required keys: `spawnEdges` (left|right|top|bottom), `waves`, `difficultyScaling`, `turnOffsetByDifficulty{normal,dusk,hard,lunatic}`, `xpDecay[]` (non-increasing, 0..1).
- Optional: `turnJitter [min,max]`, `scriptedWaves`, `repeatingWaves`, `minActByDifficulty`, `actTurnOffset`, `extraWavesByDifficulty`. The last three are merge-only and stripped at generation.
- **Procedural `waves`**: `{turn, count:[min,max], edges?⊆spawnEdges}`.
  - The turn is `turn + battleParams.reinforcementTurnOffset + (difficultyScaling ? turnOffsetByDifficulty[rung] : 0) + seeded jitter` (`resolveScheduledTurn` :234).
  - Arrivals pick a random edge and then a random edge tile (free, not excluded terrain such as lava, acid, throne, ballista or village, standable by every reinforcement move type, with a free inward neighbour).
  - Each arrival copies a class from the map's non-boss spawns (`buildReinforcementTemplatePool`, ReinforcementSpawns.js:61) via a hash.
- **`repeatingWaves`**: `{startTurn, every, count, edges, xpMultiplier, maxActiveEnemies (default 20)}`. No jitter. Used for escape pursuit.
- **`scriptedWaves`**: `{turn, xpMultiplier?, spawns:[{col,row,className?,level?,...}]}`. The turn is offset like the others but has no jitter. They resolve **first** on a shared turn. An illegal tile (occupied or impassable for its class) is simply blocked; there is no fallback tile.
- **`ladder`** (written by `RoutLadder.buildRoutLadder`, Dusk/Nightfall rout only, replaces `waves`): `{front, minPlayerDistance, (npcDistance), waves:[{turn, count, edge, xpMultiplier, levelBonus?, promoted?}]}`. Absolute turns. A flank with no legal tiles sends its wave to the front.
- **`hunted`** (`HuntedWave.withHuntedWave` :70): `{turn, count, xpMultiplier, edges}`. Never on boss maps.
- `wavesRaisePar:false` (Black Sun).
- **Par**: each distinct procedural or scripted wave that actually spawns raises `turnPar` by 1 (`parRaiseForArrivals`). Repeating, ladder and hunted waves are par-neutral (`PAR_NEUTRAL_WAVE_TYPES` :24).

### 4.2 Triggering
- Waves are **turn-only.** `scheduleReinforcementsForTurn({turn, …})` (:465) is a pure function of turn, seed, config and occupancy. There is no condition, region, kill-count or objective trigger anywhere.
- The only non-turn gates are:
  - a clear rout field, which cancels all remaining waves;
  - `maxActiveEnemies` for repeating waves;
  - tile legality.
- **Timing**: `applyReinforcementsForTurn(turn)` (BS:2678) runs at the **end of the enemy phase**, after AI and enemy terrain damage (BS:10520-10523), guarded by `_enemyPhaseReinforcedTurn`. New units therefore first act in the next enemy phase.
- Phase terrain overrides run at the start of the enemy phase (BS:9755).
- Mid-phase victory is deferred by `_reinforcementsPendingThisTurn`.
- Arrivals are stamped by `stampReinforcementMeta` (ReinforcementSpawns.js:322): `_isReinforcement`, `_reinforcementWaveIndex`, `_reinforcementSpawnTurn`, and `_reinforcementRewardMultiplier` (scales XP and gold).

### 4.3 Announcement
- `ReinforcementPresenter.present(units, {bandits})` (ui/ReinforcementPresenter.js:28): a DOM crimson band (`CeremonyController.showArrival({count, bandits})`), or the canvas fallback `showReinforcementBanner`.
- Each visible arrival gets a thread-and-ring mark. Fogged arrivals are counted but never marked.
- There is no advance warning except the ladder's objective line or chip ("Waves 1/3 · next T6", `routLadderStatus`).

### 4.4 Serialization
- Nothing scheduler-side is stored. Determinism comes from turn plus `getReinforcementSeed()`.
- The checkpoint (ui/BattleCheckpointAdapter.js:5-54) holds the spawned units (with their meta fields), `turnNumber`, `phase`, `turnPar` (already raised), `appliedHybridOverrideTurns`, `mapLayout` and `antiTurtleState`.
- A resumed enemy phase (`startEnemyPhase({resume:true})`) re-runs the tail. A condition-triggered wave would need its own fired-trigger ledger in the checkpoint, the Vision snapshot and the validator; per-unit flags can ride the units for free.

---

## 5. Node map: where battles come from

- **Generation**: `generateNodeMap(actId, actConfig, mapTemplates, options)` (NodeMapGenerator.js:47).
  - `ACT_CONFIG` rows: act1 9, acts 2-4 10, finalBoss 2 (constants.js:159).
  - Row 0 and row 1 are battles; row `rows-2` is RUINS; `rows-1` is BOSS. Mixed rows take one draw against `NODE_TYPE_WEIGHTS` (`pickNodeType` :476).
  - After generation:
    - 2-3 RECRUIT conversions from battle or shop nodes (rows > 1);
    - one optional COLOSSEUM from a battle node in rows 2-4;
    - the service-streak repair;
    - village ambush conversion of shops (`isAmbush`, `convertNodeToRoutBattle` :308).
  - The Eclipse converts fallen nodes to eclipsed elite rout battles (EclipseSystem.js:360-366).
- **`buildBattleParams`** (:533):
  - BOSS gives `{act, objective:'seize', row, battleSeed, levelRange}`.
  - RECRUIT gives rout with `isRecruitBattle`.
  - BATTLE: if `canSeizeAtRow` (act1: second half; act2 row ≥ 3; act3 row ≥ 2), one roll gives 28% seize / 12% escape (these set `isElite`) and the rest rout. Then the caravan roll (act2+, not escape) and the village roll (rout/seize, exclusive with caravan, always drawn).
  - `ACT_LEVEL_SCALING` (:18).
  - All draws are on the seeded node-map stream. Adding a draw shifts everything after it; existing code works around this by drawing and then discarding.
- **Template choice**: `pickTemplateForNode(objective, mapTemplates, actId, isBossNode, biome, {caravan})` (:612).
  - It filters by act, then caravan, then the biome from `rollBiome` (`ACT_BIOME_WEIGHTS` constants.js:453), then `bossOnly` (allowed only on boss nodes). It falls back to the act pool and makes one draw (unweighted at node gen; `MapGenerator.pickTemplate` honours `weight`).
  - The result is written to `node.templateId` and `battleParams.templateId`.
  - Fog roll: battle nodes only. Boss nodes never get fog.
- **Boss selection**:
  - `enemies.json bosses[act]`: act1 Iron Captain/Warchief, act2 Knight Commander/Archmage/Dark Rider, act3 Blade Lord/Iron Wall/Berserker King, act4 The Emperor, finalBoss The Lieutenant / The Entity (`difficultyFilter`).
  - The boss is picked at random in `generateEnemies` and placed on the throne.
  - Boss maps are **not dedicated**. A boss node draws from the whole seize pool for its act and biome, and `bossOnly` only *permits* the hybrid arenas. By code reading the keep lands on about 27% of Act III boss maps (castle roll 44% → 1 of 2; swamp → fallback 1 of 4) and the bastion on about 17% of Act IV's. The final boss always uses `eldritch_sanctum`.
  - Elite seize nodes field `enemies.elites[act]` captains (MG:685), which are `isBoss` on the map but `scene.isBoss` false (no boss card or recruit).
- **Event battles**: `EventEffects.applyBattle` (EventEffects.js:1073) calls `convertNodeToRoutBattle` with `{isEventBattle, eventEnemyLevelBonus, isElite?, isRecruitBattle?}`. Event battles are **always rout**. The node keeps `type:'event'` plus `eventBattle:true`.
- **Launch**: `NodeMapScene.handleBattle` (NodeMapScene.js:2100) passes `{battleParams: rm.getBattleParams(node), roster, nodeId, isBoss: node.type==='boss', isElite}` to the Battle scene.
- **Adding a node type** touches:
  - `NODE_TYPES` (constants.js:167), `pickNodeType` weights (and the path-walk baseline test `tests/EventNodeGeneration.test.js`);
  - `buildBattleParams`, `NODE_GOLD_MULTIPLIER` (constants.js:191);
  - the service-streak set and `NON_COMBAT_ALTERNATIVES`;
  - NodeMapScene icons and colours (:154/165), the click routing and the `handleBattle` flags;
  - the Loom model (`BATTLE_TYPES` loomModel.js:378);
  - EclipseSystem falls;
  - RouteEdit (`rebuildNodeAs`).
  - A cheaper route is a new objective or flag on BATTLE params (as `isElite`/`hasVillage` do).

---

## 6. NPC allies and escort-like systems

- **`scene.npcUnits`** (faction `'npc'`) holds recruit NPCs and the caravan.
  - Enemies attack every NPC.
  - The army's staves heal them (`isNpcAlly`, RecruitNpc.js:36).
  - They share the army's turn-start and hazard effects (`armyAndNpcAllies`).
  - They have no AI phase: recruits never move. The caravan moves 1 tile per turn by `computeCaravanStep` toward `caravanExit` and leaves at the edge (`_caravanExited`).
- **Recruit battles**:
  - `npcSpawn {col,row,className,name,(prologueUnit)}`, seated by `pickRecruitSpawnTile` within `RECRUIT_REACH_BAND` (2-8 steps, MG:3108). Built via `RM.getRecruitNodeUnit` (deterministic, own stream).
  - Talk (lord adjacent) moves the unit into `playerUnits` and `_battleRecruits`.
  - Nightfall+ may add a guardian adjacent to the recruit (`recruitGuardianChance`).
  - A recruit's death has no failure consequence.
- **Prologue P3 Sera**: an authored green unit (`buildPrologueNpcUnit`) and a `requiredRecruits` rout gate. Protected-unit falls restart the chapter (`prologueProtectedNames`, PrologueController).
- **Caravan**: the escort precedent. It has HP, a destination edge, an enemy target priority, an outcome flag carried into `completeBattle`, a fog-aware HUD chip, and Vision and checkpoint handling of `caravanExited`.
- **Village**: the "defend a tile against a race" precedent. It has a tile on the config, a seek_tile squad delivered as a turn-1 scripted wave, an intact/visited/razed state machine, a reward with rewind rollback (`rewardItemUid`), and an objective suffix line.
- **What exists for escort/defend objectives**: unit-level escort (caravan), tile-level contest (village), tile-seeking AI (`seek_tile` + `aiTargetTile`) and the throne clamp (stay near a tile).
- **What does not exist yet**:
  - a defeat condition tied to an NPC or tile;
  - an NPC that fights or moves under AI;
  - a "survive N turns" victory;
  - per-objective par;
  - enemy targeting of a defend tile, other than via `seek_tile`, which only moves (it attacks only blockers);
  - a generic NPC-ally builder for non-recruit allies (caravan and recruit are special-cased).

---

## 7. Victory rewards

Flow: `PostCombatController.onVictory` (PostCombatController.js:69).

1. Deeds commit. Class-mastery participation is recorded.
2. `completionGoldAward = floor(GOLD_BATTLE_BONUS(80) × lateGoldMult)`.
3. `RM.completeBattle(allUnits, nodeId, scene.goldEarned, {turnCount, turnPar, completionGoldOverride, caravanSurvived, fallenRecruits, fallenBattleRecords})` (RM:4043):
   - gold = `calculateBattleGold(goldEarned, nodeType, completion)` (LootSystem.js:112: `(floor(killGold × NODE_GOLD_MULTIPLIER[type]) + completion) × GOLD_BATTLE_REWARD_MULTIPLIER`) × `ELITE_GOLD_MULTIPLIER` 1.25 if elite × run gold mult × difficulty gold mult;
   - burdens settle (`burdenEffectsOnVictory`);
   - Eclipse shadow is committed;
   - casualties, roster and staff refill;
   - the contract is settled (`settleContract` with turnCount, turnPar, losses);
   - boss node: +1 Vision; ambush, event and caravan pending flags.
4. `prepareBattleRewards(run, data, rewardContext())` (PendingBattleRewards.js:73). It runs once and is saved:
   - turn-par gold (`getRating` → `calculateBonusGold` × pressure) is paid;
   - loot `choices` (`rollBattleRewardChoices`: `LOOT_CHOICES` 3 or elite 4; authored `battleConfig.loot` replaces the draw);
   - `picksRemaining` (elite 2), `skipGold`, `summary` text ("Battle and completion: N gold · Turn S: +M gold"), and `draw` (for Branching Threads rerolls).
5. Boss leads to the boss recruit draft; the third lord follows; then the loot screen (`PendingRewardController`). The final boss pays turn gold silently.

- **Kill gold** accrues in battle into `scene.goldEarned`: `calculateKillGold` (LootSystem.js:59) = 28 + 8·level (soft cap 110), plus a promoted bonus, plus 300 for an `isBoss`, × the arrival's reward multiplier × late pressure. Village gold and escape evac gold also go into `goldEarned`, so they are multiplied at commit.
- **XP** comes per combat from `BattleXp` × live par multiplier × difficulty × reinforcement `xpMultiplier`.
- **Plug points for bonus objectives**:
  - (a) Add to `goldEarned` mid-battle. It is simple and rewind-safe through the Vision gold snapshot, but it is multiplied.
  - (b) A new `completeBattle` option settled at the commit (contract pattern; revert-proof).
  - (c) Extend the `pendingBattleReward` record: extra `choices`/`picksRemaining`, a `summary` line, or elite-style 4/2 picks.
  - (d) Reuse the `EventEffects` planner and `describeResult` for item, gold or stat rewards with guaranteed delivery (ContractSettlement).
  - Victory band lines can be appended (`band.addParts`, PostCombatController.js:200-206).
