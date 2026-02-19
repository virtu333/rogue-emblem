# Track A/B Remaining Work Spec - Feb 19, 2026

## Status Update (Closeout)

- Workstream 1: complete in local closeout patch.
- Workstream 2: complete (`tests/e2e/journey-run-loop.spec.js` now runs from `/` with required ordered scene assertions).
- Workstream 2 stability gate: passed 3 consecutive local runs with `--retries=0`.
- Workstream 3: complete (`BattleScene` recruit/talk gating uses `runManager.getRosterCap()` with fallback only for missing test scaffolding).
- Workstream 4 decision: **Path A selected** (A2/A3 deferred and captured in backlog).
- Reconciliation docs:
  - `docs/consolidated-plan-2026-02-19.md`
  - `docs/issues/track-a2-a3-deferred-backlog-2026-02-19.md`

## Context

- Baseline in `main`: `a30ebde` (`feat(colosseum): add arena/mercenary node flow and follow-up fixes`)
- Delivered scope is closed for overlay-based Colosseum.
- This spec covers remaining work to close unresolved items from the original consolidated plan.

## Goals

1. Land outstanding quality fixes that are currently local-only.
2. Complete the full journey E2E coverage originally scoped for Track B2.
3. Resolve one remaining consistency cleanup (roster-cap source of truth).
4. Reconcile original Track A2/A3 expectations with the overlay architecture now in production.

## Non-goals

- No net-new Colosseum features (champion fights, betting, special rewards).
- No large RunManager decomposition.
- No broad UI test-infra expansion beyond what is required for the journey test.

## Workstream 1: Promote local-only quality patch to `main`

### Scope

- `src/engine/AIController.js` (terrain name lookup)
- `src/scenes/RunCompleteScene.js` (double-click/lifecycle hardening)
- `src/scenes/TitleScene.js`, `src/scenes/SlotPickerScene.js`, `src/scenes/HomeBaseScene.js` (shared audio unlock usage)
- `vite.config.js` (coverage threshold)
- `tests/e2e/journey-run-loop.spec.js` (tracked in repo)

### Requirements

1. Keep changes surgical; no behavior changes beyond the intended fixes.
2. Ensure all touched scenes still boot and transition correctly in smoke tests.
3. Keep `coverage.thresholds.lines = 70` as the initial floor.

### Acceptance criteria

- `npm test` passes.
- No new console errors in scene transitions covered by existing tests.
- No duplicate inline audio-unlock implementations remain in touched scenes.

## Workstream 2: Complete full journey E2E (Track B2)

### Target file

- `tests/e2e/journey-run-loop.spec.js`

### Required flow

1. Clear save-slot localStorage keys.
2. Open `/`.
3. Title -> New Game -> HomeBase.
4. HomeBase -> Begin Run -> DifficultySelect.
5. Select Normal -> BlessingSelect.
6. Skip blessing -> NodeMap.
7. Enter first available battle node -> Battle.
8. Open pause -> Save and Return to Title -> confirm.
9. Assert return to Title.

### Required assertions

- Ordered scene history includes: `HomeBase -> DifficultySelect -> BlessingSelect -> NodeMap -> Battle -> Title`.
- No console errors/invariant violations.
- Runtime target <= 30s on CI baseline.

### Stability requirements

- Avoid brittle text selectors where stable hooks exist.
- Use existing helper utilities in `tests/e2e/helpers.js`.
- Add explicit waits only where deterministic scene readiness is unavailable.

### Acceptance criteria

- E2E spec passes locally and in CI at least 3 consecutive runs.
- No flaky retries needed in steady state.

## Workstream 3: Roster-cap consistency cleanup

### Scope

- `src/scenes/BattleScene.js`

### Change

- Replace inline roster-cap math (`ROSTER_CAP + rosterCapBonus`) with `runManager.getRosterCap()` when available.
- Keep fallback only if `runManager` is missing during test scaffolding.

### Acceptance criteria

- Existing battle tests pass unchanged.
- Recruit/talk gating behavior remains identical at default cap and with meta cap bonus.

## Workstream 4: Track A2/A3 reconciliation decision

The original plan expected BattleScene extractions plus a dedicated `ColosseumScene`. Shipping architecture is overlay-based.
This closeout resolves Workstream 4 with Path A.

### Path A (recommended): Officially defer A2/A3

1. Record ADR/update docs that overlay architecture is the accepted Sprint 3 endpoint.
2. Move A2 extraction work into a later technical-debt/refactor milestone.
3. Keep current gameplay behavior unchanged.

Acceptance:
- Updated planning docs no longer imply `ColosseumScene` is pending for Track A closure.
- Backlog issue(s) created for extraction debt with clear priorities.

### Path B: Execute original A2/A3

1. Extract:
   - `src/ui/CombatForecastDisplay.js`
   - `src/engine/CombatResolutionFlow.js`
   - `src/ui/XPGoldAwardFlow.js`
2. Add `src/scenes/ColosseumScene.js` and route NodeMap node transitions through SceneRouter.
3. Keep Colosseum behavior parity with current overlay flows.

Acceptance:
- Full regression suite green.
- No user-visible behavior regression in arena/mercenary flow.
- BattleScene line count and direct Colosseum coupling reduced as planned.

## Recommended execution order

1. Workstream 1 (small patch, low risk).
2. Workstream 2 (E2E parity with original plan).
3. Workstream 3 (consistency cleanup).
4. Workstream 4 decision, then either Path A doc finalization or Path B implementation.

## Exit criteria for Track A/B closeout

- Track A closeout:
  - Path A or Path B above is completed and documented.
- Track B closeout:
  - Workstreams 1-3 completed.
  - `npm test` green and journey E2E flow passing.
