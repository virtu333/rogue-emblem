# Phase 4 Hybrid Boss Arena Implementation Plan

Date: 2026-02-14
Owner: gameplay roadmap stream
Status: Planned

## 1. Implementation Strategy

Deliver in four narrow slices, each mergeable and test-gated:

1. Contract and validation
- Add `hybridArena` and `phaseTerrainOverrides` validation in `MapTemplateEngine`.
- Keep strict failures explicit and backward-compatible for legacy templates.

2. Generation and placement
- Extend `MapGenerator` to apply hybrid arena overlay after procedural generation.
- Resolve and expose anchors in generated battle config.
- Validate in-generator bounds and deterministic application order.

3. Runtime override application
- Apply deterministic turn-triggered terrain overrides in `BattleScene`.
- Keep state/pathing/visual updates in one atomic step.
- On turns where both are due, apply overrides before reinforcement scheduling/spawns.
- Mirror identical behavior in `HeadlessBattle` for parity.

4. Data activation and coverage
- Mark one Act 4 boss and one Act 3 dark champion template as hybrid.
- Add unit/harness/determinism tests for concrete templates and failure cases.

## 2. Exact Files To Modify (No Extras)

- `docs/act4-hardmode-rollout-plan.md`
- `docs/specs/difficulty_spec.md`
- `docs/specs/act4_hybrid_boss_arena_spec.md`
- `docs/reports/phase4_hybrid_boss_arena_implementation_plan.md`
- `data/mapTemplates.json`
- `public/data/mapTemplates.json`
- `src/engine/MapTemplateEngine.js`
- `src/engine/MapGenerator.js`
- `src/scenes/BattleScene.js`
- `tests/MapTemplateEngine.test.js`
- `tests/MapGenerator.test.js`
- `tests/harness/HeadlessBattle.js`
- `tests/harness/HeadlessBattle.test.js`
- `tests/harness/Determinism.test.js`
- `tests/Act4ProgressionGuards.test.js`

## 3. Proposed New Functions and Types

`src/engine/MapTemplateEngine.js`
- `validateHybridArena(path, hybridArena, errors)`
- `validatePhaseTerrainOverrides(path, overrides, anchors, errors)`

`src/engine/MapGenerator.js`
- `applyHybridArenaOverlay(mapLayout, hybridArena, cols, rows)`
- `resolveHybridAnchors(hybridArena, cols, rows)`
- `applyPhaseOverrideToLayout(mapLayout, override, resolvedAnchors)`

`src/scenes/BattleScene.js`
- `applyDueHybridOverridesForTurn(currentTurn)` (turn-trigger entrypoint)
- `applyHybridTerrainChanges(changes)` (single atomic mutation path)

`tests/harness/HeadlessBattle.js`
- `applyDueHybridOverridesForTurn(currentTurn)` parity mirror of scene logic

Data shape additions (template-level):
- `hybridArena`
- `phaseTerrainOverrides`

## 4. Test Plan

Unit:
- `tests/MapTemplateEngine.test.js`
  - accepts valid hybrid template shape.
  - rejects malformed overlay matrix, anchor refs, duplicate override targets.
  - rejects hybrid template missing `bossOnly: true`.
- `tests/MapGenerator.test.js`
  - same seed gives identical overlay and anchors.
  - different seeds vary only approach region, not arena overlay.
  - explicit templateId for Act 4 boss and Act 3 dark champion emits expected hybrid fields.
  - non-hybrid template generation unchanged.

Integration and harness:
- `tests/harness/HeadlessBattle.test.js`
  - turn-triggered overrides apply exactly once on due turn.
  - same-turn collision applies override-before-reinforcement ordering.
  - override does not desync movement/pathing vs scene expectations.
- `tests/harness/Determinism.test.js`
  - same seed + params reproduces identical override timing/results.
  - concrete Act 4 boss and Act 3 dark champion scenarios remain deterministic.
- `tests/Act4ProgressionGuards.test.js`
  - guards presence of the two hybrid boss templates and required hybrid keys.
  - guards boss-only gating.

Manual smoke:
- Boss battle with hybrid template: verify approach variability across seeds while arena remains fixed.
- Verify no soft-lock after each override turn.

## 5. Rollback Strategy

- Keep hybrid logic behind presence of `hybridArena`; no legacy template path changes.
- If regressions occur, remove `hybridArena` from concrete templates first to disable feature data-side.
- If needed, revert `MapGenerator` overlay application while preserving existing reinforcement scheduler behavior.
- Roll back full slice if any of these occur:
  - replay divergence (scene vs harness),
  - unwinnable no-path map state,
  - save/load corruption or terrain state desync.

## 6. Why This Is The Smallest Viable Change

- Reuses existing template, generator, scheduler, and battle runtime flows.
- Adds one narrow template contract extension instead of a separate map pipeline.
- Constrains scope to two boss templates only, avoiding non-boss behavior churn.
- Limits dynamic behavior to deterministic turn-trigger overrides; no new objective or combat systems.
- Uses existing test surfaces (unit + harness + determinism) without adding a new harness framework.
