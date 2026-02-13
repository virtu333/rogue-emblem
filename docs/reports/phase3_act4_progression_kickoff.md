# Phase 3 Kickoff: Act 4 Progression

Date: 2026-02-13
Owner: gameplay roadmap stream
Status: In progress (audit complete)

## Roadmap Position
- Next item after Phase 2 hazards: **Act 4 Hard-Mode Acceleration - Phase 3 (Act 4 progression)**.
- Goal: hard runs flow `act1 -> act2 -> act3 -> act4 -> finalBoss` with stable save/load and generation.

## Audit Findings (Current Gaps)
1. Difficulty act sequencing still skips `act4`.
2. Runtime act constants/config omit `act4`.
3. Map size selection has no `Act 4` phase mapping.
4. Enemy pools/boss roster have no `act4` entries.
5. Economy/content hooks are partial for `act4` (turn bonus, forge limits, fog chance, music aliases).
6. Test coverage does not yet assert hard-mode includes `act4` or that Act 4 generation is valid.

## Implementation Plan
1. **Sequence + runtime config**
- `data/difficulty.json`: add `act4` to `hard.actsIncluded` (between `act3` and `finalBoss`).
- `src/utils/constants.js`: add `act4` entries for deploy/enemy offsets/fog/shop/loot as needed; add `ACT_CONFIG.act4`.
- `src/engine/MapGenerator.js`: add `act4` map-size prefix mapping.

2. **Act 4 content data wiring**
- `data/mapSizes.json`: add two `Act 4` map-size entries.
- `data/enemies.json`: add `act4` pool + `act4` boss entry (`The Emperor`, `General`, level 20).
- `data/turnBonus.json`: add `act4` base bonus gold.
- `src/utils/musicConfig.js`: add `act4` node/battle/boss track mappings (reuse Act 3 tracks initially).

3. **Save/load + progression compatibility checks**
- Confirm `RunManager` and `NodeMapGenerator` work with inserted act id via `actsIncluded`.
- Add guard tests for resumed runs with old saves (missing `act4` in saved arrays).

4. **Tests**
- Add/extend tests to assert:
  - hard difficulty sequence includes `act4`
  - generated hard run can create Act 4 node map + battle config
  - enemies/map sizes resolve for Act 4
  - no regressions to normal/finalBoss flow

5. **Verification**
- Focused order for failure isolation:
  1. `npm run -s test -- tests/MapGenerator.test.js`
  2. `npm run -s test -- tests/NodeMapGenerator.test.js`
  3. `npm run -s test -- tests/RunManager.test.js`
- Include parity/data-sync in focused pass:
  - `npm run -s test -- tests/DataPublicParity.test.js tests/DifficultyDataSync.test.js tests/EnemiesDataSync.test.js tests/MapSizesDataSync.test.js tests/TurnBonusDataSync.test.js`
- Additional touched suites:
  - `npm run -s test -- tests/TerrainHazards.test.js tests/Act4ProgressionGuards.test.js tests/BossRecruitSystem.test.js tests/TurnBonusCalculator.test.js tests/FogOfWar.test.js tests/UnitManager.test.js`
- `npm run -s test:all`
- `npm run -s test:e2e` (smoke)

## Feedback Integrated
1. Added legacy save-compat safeguards in `RunManager.fromJSON` for saves missing `act4` metadata.
2. Added guard tests asserting required act-indexed tables explicitly contain `act4` and `finalBoss`.
3. Added Act 4 pool/map-size sufficiency checks tied to density caps on both Act 4 map sizes.
4. Added explicit act-level music fallback behavior so missing Act 4 keys do not crash lookup.
5. Added focused parity/data-sync coverage for all touched data files.
6. Added explicit `pickTemplate(..., act4)` + fallback assertions.
7. Locked focused test execution order to `MapGenerator -> NodeMapGenerator -> RunManager`.

## Out of Scope (Phase 3)
- Reinforcement scheduler (Phase 4)
- Defend/Survive/Escape objectives
- Secret Act wiring
- Full biome art expansion (Phase 2B)
