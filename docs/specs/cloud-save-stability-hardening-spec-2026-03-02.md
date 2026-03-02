# Cloud Save Stability Hardening Spec

Status: Proposed
Date: 2026-03-02
Owner: Runtime / Save Systems

## Problem Statement

Recent review findings identified three stability risks in save flow:

1. Remote-newer conflicts in cloud writes can repeatedly reject updates, leaving cloud progress stale for the current device session.
2. Run merge preference currently keeps local data when either `savedAt` is missing/invalid, which can block recovery from newer cloud state.
3. Run clear paths depend on `registry.activeSlot`; if missing, clear becomes a silent no-op and stale run data can remain.

Code reference points:
- `src/cloud/CloudSync.js` (`updateSlotInTable`, `writeSlotWithRetry`, `shouldPreferLocalRun`)
- `src/engine/RunManager.js` (`resolveRunKey`, `clearSavedRun`)
- `src/scenes/RunCompleteScene.js` (run-clear call site), with similar call sites in `BattleScene`, `NodeMapScene`, `BlessingSelectScene`

## Goals

- Prevent cloud sync from entering a repeated conflict state for active runs.
- Make run merge rules deterministic and recovery-friendly when timestamps are missing.
- Guarantee end-of-run clear behavior still executes in slot-edge cases.
- Preserve "local play continues" behavior under transient cloud failures.

## Non-Goals

- Full multi-device conflict UI/UX.
- Changes to slot count or storage schema outside save metadata fields.
- Reworking auth/session cloud gate behavior.

## Scope

In scope:
- `CloudSync` conflict handling for run/meta slot upserts and merge helpers.
- `RunManager` slot resolution and save timestamp generation.
- Scene call sites that clear run saves.
- Unit/integration tests and telemetry for the new behavior.

Out of scope:
- Backend schema migrations.
- New player-facing menus for cloud conflict resolution.

## Design

### A) Clock-safe local save timestamps

#### Requirement A1: Monotonic `savedAt` per slot
- `saveRun()` must stamp `savedAt` with a monotonic value, not raw `Date.now()` alone.
- Algorithm:
  - `now = Date.now()`
  - `previousLocalSavedAt = savedAt from existing local run key for this slot (if valid)`
  - `remoteFloorSavedAt = optional conflict floor for this slot (see A2)`
  - `nextSavedAt = max(now, previousLocalSavedAt + 1, remoteFloorSavedAt + 1)`
- Result: clock rollback and skew cannot produce non-increasing local run timestamps.

#### Requirement A2: Remote conflict floor
- On `CLOUD_CONFLICT_REMOTE_NEWER`, store `remoteSavedAt` as a per-slot "clock floor" in local storage.
- New key format: `emblem_rogue_slot_{slot}_run_clock_floor`.
- Successful cloud write for that slot clears this floor.

#### Requirement A3: Conflict behavior must not appear as fatal queue failure
- `updateSlotInTable()` should classify `CLOUD_CONFLICT_REMOTE_NEWER` as a conflict state, not generic write failure.
- Keep reporting (for observability), but use a dedicated context:
  - `cloud_update_slot_conflict_remote_newer`
- Avoid noisy repeated `console.warn` on identical conflict for the same slot in the same session (dedupe/throttle).

### B) Deterministic run merge policy

#### Requirement B1: Replace boolean helper with explicit winner selection
- Replace `shouldPreferLocalRun(localSlot, cloudSlot)` with comparator semantics:
  - If both `savedAt` are valid: newer timestamp wins (`local >= cloud` keeps local).
  - If only one side has valid `savedAt`: valid side wins.
  - If neither side has valid `savedAt`: cloud wins (deterministic recovery baseline).

#### Requirement B2: Backward compatibility for legacy saves
- Legacy run payloads without `savedAt` remain loadable.
- After first save in current build, run gains monotonic `savedAt` and exits ambiguous merge state.

#### Requirement B3: Explicit telemetry on ambiguous merge
- When neither side has valid `savedAt`, emit `markStartup('cloud_run_merge_no_savedAt', { slot })`.

### C) Slot-safe clear behavior

#### Requirement C1: Slot resolution fallback
- `clearSavedRun(onClear, slotNumber)` must resolve slot via:
  1. Explicit `slotNumber` argument when valid.
  2. Persisted active slot (`getActiveSlot()` from `SlotManager`) when argument missing.
  3. If still unresolved, no delete and emit structured warning/error telemetry.

#### Requirement C2: Scene call sites use resolved slot helper
- All run-clear call sites (`RunCompleteScene`, `BattleScene`, `NodeMapScene`, `BlessingSelectScene`) should pass through one helper path to avoid drift.
- No direct localStorage key construction in scenes.

#### Requirement C3: Cloud delete callback alignment
- When fallback slot resolution is used, cloud delete callback must receive the same resolved slot.
- Prevent local clear/cloud delete slot mismatch.

## Behavioral Acceptance Criteria

1. After a remote-newer conflict, subsequent saves from the same device can sync to cloud without requiring manual clock changes.
2. A local run with missing `savedAt` does not always override newer cloud data at boot.
3. End-of-run clear in `RunCompleteScene` removes run data even when `registry.activeSlot` is unset but persisted active slot exists.
4. If no slot can be resolved, system logs telemetry and avoids destructive deletes.
5. Existing offline/local-only save flow still works.

## Test Plan

### Unit

- `tests/RunManager.test.js`
  - `saveRun` monotonic timestamp when system clock goes backward.
  - `clearSavedRun` resolves via persisted active slot when argument missing.
  - `clearSavedRun` unresolved slot path does not call callback and emits telemetry.

- `tests/CloudSync.test.js`
  - run merge comparator matrix:
    - both valid (`local > cloud`, `local < cloud`, equal)
    - local valid/cloud invalid
    - local invalid/cloud valid
    - both invalid -> cloud wins

- `tests/CloudSync.writeQueue.test.js`
  - remote-newer conflict stores floor and emits conflict context.
  - successful later write clears floor.
  - repeated identical conflicts are deduped/throttled.

### Scene/Integration

- `tests/RunCompleteSceneTransitionRecovery.test.js` (or equivalent scene tests)
  - `registry.activeSlot` missing + persisted active slot set: run is cleared locally and cloud delete receives correct slot.

- `tests/BlessingSelectScene.test.js`, `tests/PauseTransitionRecovery.test.js` (or equivalent)
  - shared clear helper path remains correct at all existing call sites.

### Regression

- Full unit suite and harness subset touching save/load/scene transitions.
- Targeted smoke:
  - boot with cloud session
  - continue run
  - save
  - complete/abandon run
  - return to title
  - verify slot summary reflects cleared run.

## Telemetry and Observability

New contexts/events:
- `cloud_update_slot_conflict_remote_newer`
- `cloud_run_merge_no_savedAt`
- `run_clear_missing_slot_resolution_failed`
- `run_clear_slot_fallback_used`

Telemetry payloads should include:
- `slot`
- `table` (for cloud events)
- `localSavedAt`
- `remoteSavedAt`
- `usedFallback` (for clear path)

## Rollout Plan

1. Land comparator + monotonic timestamp + clear fallback in one guarded PR.
2. Land tests in same PR (required for merge).
3. Observe telemetry for conflict/fallback rates for 1-2 days.
4. If conflict rates remain high, follow-up with player-visible cloud conflict notice on title screen.

## Risks and Mitigations

1. Risk: false-positive fallback slot resolution could clear wrong slot.
   - Mitigation: only trust explicit slot or persisted active slot; otherwise no-op with telemetry.

2. Risk: cloud conflict handling hides real data divergence.
   - Mitigation: keep dedicated conflict telemetry and include `localSavedAt`/`remoteSavedAt`.

3. Risk: merge rule change could surprise legacy users on first boot.
   - Mitigation: keep legacy payload support; first post-pull save stamps `savedAt` and normalizes behavior.

