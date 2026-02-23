# C1 Spec: All-Sleep Auto-Advance Crash Fix

## Context

- Source finding: `docs/code-review-2026-02-23.md` (Critical C1).
- Current crash site: `src/scenes/BattleScene.js:9854`.
- When all living player units are still asleep after early condition recovery, `onPhaseChange('player')` schedules a delayed auto-skip and calls `this.endPlayerPhase()`.
- `BattleScene` has no `endPlayerPhase()` method, so this path throws a runtime `TypeError` and can hard-stop the battle.

## Goal

1. Eliminate the crash in the all-sleep auto-advance path.
2. Preserve intended behavior: skip player phase and hand off to enemy phase through `TurnManager`.
3. Add regression coverage so a wrong receiver (`this` vs `this.turnManager`) is caught by tests.

## Non-Goals

- No changes to sleep recovery probabilities or status durations.
- No changes to phase timing (`300ms` delay remains unchanged).
- No refactor of general phase orchestration outside this specific crash path.

## Proposed Changes

### 1) Runtime fix (BattleScene)

- File: `src/scenes/BattleScene.js`
- In the all-sleep auto-advance delayed callback, replace:
  - `this.endPlayerPhase()`
- With:
  - `this.turnManager.endPlayerPhase()`

Rationale: phase transitions are owned by `TurnManager`; this matches existing usage in `forceEndTurn()` (`src/scenes/BattleScene.js:4156`).

### 2) Regression test hardening

- File: `tests/BattleSceneFogSnapshot.test.js`
- Update all-sleep tests so they assert against `scene.turnManager.endPlayerPhase` (not `scene.endPlayerPhase`).
- Ensure the scheduled callback is executed in-test and verified:
  - callback does not throw.
  - `scene.turnManager.endPlayerPhase` is called exactly once when all units remain asleep.
  - `scene.turnManager.endPlayerPhase` is not called when at least one unit wakes during early recovery.

Rationale: current tests stub `scene.endPlayerPhase`, which masks the production bug and would let it regress.

## Acceptance Criteria

1. Repro scenario (all living player units asleep at player-phase start) no longer crashes.
2. Auto-advance correctly transitions to enemy phase through `TurnManager`.
3. Updated tests fail on pre-fix code and pass post-fix.
4. Targeted test command passes:
   - `npm test -- tests/BattleSceneFogSnapshot.test.js tests/StatusConditionSystem.test.js`

## Risk Assessment

- Risk level: low.
- Blast radius is limited to one method call receiver and related unit tests.
- Behavioral risk is minimal because `TurnManager` is already the canonical phase-transition owner.

## Rollout

1. Land code + tests together.
2. Run targeted tests, then full suite as part of normal CI gate.
3. Mark Critical C1 as resolved in `docs/code-review-2026-02-23.md` status tracking.
