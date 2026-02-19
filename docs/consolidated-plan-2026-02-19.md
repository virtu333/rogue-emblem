# Consolidated Execution Plan - Feb 19, 2026 (Track A/B Closeout)

## Snapshot

| Metric | Value |
| --- | --- |
| Baseline commit | `a30ebde` |
| Branch | `main` |
| Track A status | Closed (Path A approved: overlay architecture retained, A2/A3 deferred) |
| Track B status | Closed by local closeout patch (pending merge) |
| Unit test gate | `npm test` -> `2415/2415` passing across `143` files |
| Journey E2E gate | `tests/e2e/journey-run-loop.spec.js` passes 3 consecutive runs with `--retries=0` |

## Delivered In `a30ebde`

- Colosseum data contract and runtime copy:
  - `data/colosseum.json`
  - `public/data/colosseum.json`
- Pure Colosseum engine module:
  - `src/engine/ColosseumEngine.js`
- Node type and run-generation wiring:
  - `src/utils/constants.js`
  - `src/engine/DataLoader.js`
  - `src/engine/NodeMapGenerator.js`
  - `src/engine/RunManager.js`
- Overlay-based Colosseum UX from NodeMap:
  - `src/ui/ColosseumOverlay.js`
  - `src/scenes/NodeMapScene.js`
- Colosseum sim harness:
  - `sim/colosseum.js`
- Regression coverage:
  - `tests/ColosseumEngine.test.js`
  - `tests/ColosseumOverlay.test.js`
  - `tests/RunManager.test.js`
  - `tests/NodeMapSceneSlice4.test.js`
  - `tests/BattleSceneEquipMenuText.test.js`

## Local Closeout Patch Scope (Pending Merge)

- AI terrain lookup hardening in `src/engine/AIController.js`:
  - terrain indices now resolve by terrain name with safe fallback values.
- Shared audio unlock utility usage in:
  - `src/scenes/TitleScene.js`
  - `src/scenes/SlotPickerScene.js`
  - `src/scenes/HomeBaseScene.js`
  - utility source: `src/utils/audioUnlock.js`
- RunComplete transition guard in `src/scenes/RunCompleteScene.js`:
  - prevents double-fire transitions on repeated clicks.
- Coverage floor in `vite.config.js`:
  - `coverage.thresholds.lines = 70`.
- Journey E2E conversion in `tests/e2e/journey-run-loop.spec.js`:
  - starts from `/` (no `devScene`),
  - drives `Title -> HomeBase -> DifficultySelect -> BlessingSelect -> NodeMap -> Battle -> Title`,
  - uses pause `Save & Return to Title`,
  - asserts ordered scene history and no unignored page/console errors.
- Roster-cap runtime source-of-truth consistency:
  - Battle recruit/talk gating consumes `runManager.getRosterCap()` with fallback only when `runManager` is absent in scaffolding.

## Path A Reconciliation (Approved)

- Chosen path: **Path A** (defer A2/A3).
- Overlay architecture (`ColosseumOverlay` from `NodeMapScene`) is the accepted endpoint for this phase.
- Deferred items moved to explicit backlog:
  - `docs/issues/track-a2-a3-deferred-backlog-2026-02-19.md`

## Deferred Backlog (A2/A3)

- Combat forecast extraction to `src/ui/CombatForecastDisplay.js`.
- Combat resolution extraction to `src/engine/CombatResolutionFlow.js`.
- XP/Gold award extraction to `src/ui/XPGoldAwardFlow.js`.
- Optional future migration from overlay to `src/scenes/ColosseumScene.js`.

## Acceptance Summary

- Workstream 1: complete.
- Workstream 2: complete.
- Workstream 3: complete.
- Track B closeout gate (`npm test`): complete.
- Track A closeout reconciliation gate (Path A documented + deferred backlog captured): complete.
