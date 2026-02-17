# Mobile Pinch-to-Zoom Remainder Spec

## Goal
Close the remaining gaps between the original mobile pinch-to-zoom plan and the current implementation, then finish with merge-ready validation.

## Current Status (synced 2026-02-17)
- Core pinch/zoom/pan controller is implemented and wired in `BattleScene`.
- Screen/world coordinate conversion is in place for click + inspect paths while zoomed.
- UI pinning uses split cameras with explicit pinning (`_pinToScreen`) plus auto-pin for high-depth UI candidates.
- Auto-pin threshold is currently `depth >= 500` with explicit low-depth HUD exceptions.
- Gesture allow-list is already expanded in `isCameraGestureAllowed()`:
  - `PLAYER_IDLE`
  - `UNIT_SELECTED`
  - `SELECTING_TARGET`
  - `SHOWING_FORECAST`
  - `ENEMY_PHASE`
  - `COMBAT_RESOLVING`
  - `HEAL_RESOLVING`
  - `CANTO_MOVING`
- Pointer provisioning is intentionally battle-scoped (`this.input.addPointer(1)` in `_setupBattleCameraSystem()`), with an inline comment documenting intent.
- Reset View button + one-time mobile hint are implemented.
- Feature flag exists (`MOBILE_CAMERA_ENABLED` / `mobileCameraEnabled`).
- Targeted suite passes:
  - `tests/BattleCameraController.test.js`
  - `tests/BattleSceneMobileCameraUi.test.js`
  - `tests/BattleSceneMobileCameraGestures.test.js`
  - `tests/MobileControls.test.js`
  - `tests/runtimeFlags.test.js`
  - Snapshot: 5 files / 47 tests passed.

## Remaining Gaps

### 1) Manual device closure (still pending)
Automated coverage is in place, but we still need recorded on-device smoke verification on at least one iOS and one Android device.

### 2) Spec alignment cleanup
This doc previously described an older 3-state gesture allow-list. It is now corrected. Any related docs referencing that old list should be updated to match runtime.

### 3) Optional UX follow-up (not a blocker)
Mobile overlays that rely on keyboard-first search (`/`-driven flows) remain a known UX limitation and are out of scope for this camera remainder slice.

## Scope of Final Remainder Slice

### A. Finalize gesture policy
File:
- `src/scenes/BattleScene.js`

Changes:
- Expand `isCameraGestureAllowed()` to allow gestures in non-modal gameplay states:
  - `PLAYER_IDLE`
  - `UNIT_SELECTED`
  - `SELECTING_TARGET`
  - `SHOWING_FORECAST`
  - `ENEMY_PHASE`
  - `COMBAT_RESOLVING`
  - `HEAL_RESOLVING`
  - `CANTO_MOVING`
- Keep hard blocks for:
  - story/dialogue lock,
  - tutorial strict gate,
  - pause/roster/unit detail/vision dialogs,
  - loot settings/loot roster/deploy selection,
  - any other true modal overlays.

Notes:
- Tap suppression with second touch remains unchanged.
- Gesture handling remains touch-only.

### B. Standardize pointer provisioning
Files:
- `src/main.js` (if choosing config-level approach)
- `src/scenes/BattleScene.js`

Decision:
- Preferred: keep scene-level provisioning (`addPointer(1)`) as canonical behavior (least global side effects).

Required follow-through:
- Add a short code comment in `_setupBattleCameraSystem()` clarifying why scene-level allocation is intentional.
- Add test coverage proving battle setup requests a second pointer when mobile camera is enabled.

Alternative (if team preference is plan parity):
- Add `input: { activePointers: 2 }` in Phaser config and remove scene-level addPointer logic.
- Add one integration test ensuring touch pointer2 exists in battle runtime.

### C. Harden low-depth overlay pinning
Files:
- `src/scenes/BattleScene.js`
- Optional targeted overlay files under `src/ui/` (if explicit pin hooks are cleaner)

Changes:
- Add explicit pinning for battle-reachable low-depth overlays that are not auto-pin candidates.
- At minimum, ensure overlays that can appear during or adjacent to zoomed gameplay are pinned via `_pinToScreen(...)` or explicitly marked world-camera only (`_forceWorldCamera = true`) when intended.

Guardrail:
- Do not change world-space effects that should track map tiles.

### D. Complete validation
Files:
- `tests/BattleSceneMobileCameraGestures.test.js`
- `tests/BattleSceneMobileCameraUi.test.js`
- `tests/BattleCameraController.test.js`
- optional: new focused test file if matrix becomes large

Add tests for:
- `isCameraGestureAllowed()` allow-list and block-list matrix.
- Pointer provisioning behavior under selected strategy.
- Low-depth overlay pin behavior under zoomed camera context.
- Existing tap/long-press suppression invariants remain intact.

Run:
- Targeted suite (mobile camera + controls + runtime flags)
- Full `npm test`

## Acceptance Criteria
- Gestures are allowed in intended gameplay states and blocked in true modal states.
- Pointer strategy is explicit, consistent, and tested.
- No known low-depth overlay drift in battle while zoom is active.
- Targeted mobile suite passes.
- Full suite passes.
- Manual smoke pass completed on at least one iOS and one Android device:
  - pinch in/out,
  - two-finger pan,
  - tap select accuracy while zoomed,
  - long-press inspect behavior,
  - forecast + combat readability while zoomed,
  - Reset View visibility/behavior.

## Out of Scope
- New gesture types (double-tap zoom, inertia, kinetic pan).
- Non-battle scene camera gestures.
- Visual redesign of mobile controls.

## Deliverable
One final "pinch-to-zoom remainder closure" PR/commit stack containing:
- gesture policy finalization,
- pointer provisioning standardization,
- low-depth pinning hardening,
- tests + validation evidence.
