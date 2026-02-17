# Repo Hardening Next Steps Plan

Date: 2026-02-17
Owner: core gameplay/runtime stream
Status: Proposed

## Validation Snapshot (2026-02-17)

- Mobile camera/runtime verification (targeted) is green:
  - `tests/BattleCameraController.test.js`
  - `tests/BattleSceneMobileCameraUi.test.js`
  - `tests/BattleSceneMobileCameraGestures.test.js`
  - `tests/MobileControls.test.js`
  - `tests/runtimeFlags.test.js`
  - Result: 5 files / 47 tests passed.
- Recent overlay stability pass found no new blocking desktop UX/performance regressions from mobile camera or sub-overlay precedence changes.
- Follow-up tracking remains focused on repo hardening items below (lint/schema/CI artifacts/decomposition), not emergency runtime fixes.

## Goals

1. Reduce regression risk in core gameplay and content loading.
2. Improve developer velocity with consistent repo hygiene gates.
3. De-risk future feature work by reducing `BattleScene` coupling over time.

## Scope

This plan focuses on engineering guardrails and architecture health. It does not include new gameplay features.

## Priority Plan

## P0: High leverage, low disruption

### 1) Add Prettier + ESLint policy with CI and pre-commit

Target outcome:
- Formatting and basic lint checks are automated and consistent across contributors.

Implementation slices:
1. Add configs:
   - `.prettierrc`
   - `.prettierignore`
   - `eslint.config.js` (or `.eslintrc.*`)
2. Add npm scripts:
   - `format`
   - `format:check`
   - `lint`
   - `lint:fix`
3. Add pre-commit hook with staged-file enforcement.
4. Add CI steps in `.github/workflows/ci.yml` before build/tests.

Acceptance criteria:
- `npm run format:check` and `npm run lint` run in CI.
- Pre-commit blocks style/lint regressions on staged files.
- No gameplay/runtime behavior changes in this slice.

Rollback:
- Remove new CI checks and hooks; keep code changes intact.

### 2) Add data schema validation for `data/*.json`

Target outcome:
- Invalid content fails fast with actionable file/path errors before runtime.

Implementation slices:
1. Add schema validation entrypoint (recommended: AJV + JSON Schema).
2. Add initial schema set for highest-risk files:
   - `data/classes.json`
   - `data/weapons.json`
   - `data/skills.json`
   - `data/enemies.json`
   - `data/mapTemplates.json`
3. Add `npm run validate:data`.
4. Add CI gate for `validate:data`.
5. Optional dev-only runtime assertion path in `src/engine/DataLoader.js`.

Acceptance criteria:
- CI fails on schema violations with file + JSON path output.
- A known-bad fixture test proves failure behavior and message quality.
- Existing data passes without behavior regressions.

Rollback:
- Remove CI gate and validator script; retain schema files for later use.

### 3) Upload failing harness/sim artifacts in CI

Target outcome:
- Failing seeds/scenarios are immediately reproducible from CI output.

Implementation slices:
1. Update runners to emit structured failure artifacts (seed, scenario, error, repro command).
2. Save artifacts to a stable directory (example: `.tmp/ci-artifacts/`).
3. In `.github/workflows/ci.yml`, add `actions/upload-artifact` with `if: failure()` for harness/sim jobs.

Acceptance criteria:
- Forced harness/sim failure produces downloadable artifacts.
- Artifact includes exact repro command using existing npm scripts.

Rollback:
- Disable upload step while retaining local artifact generation.

## P1: Entropy control and contributor guidance

### 4) Start gradual `BattleScene` decomposition (coordinator pattern)

Target outcome:
- `BattleScene` remains composition root while logic moves into testable modules.

Recommended extraction order (small PRs, behavior-preserving):
1. `BattleInputController`
   - Pointer/touch/keyboard mapping to semantic battle actions.
2. `BattleUIController`
   - Menus, overlays, tooltip placement/pinning, HUD refresh triggers.
3. `BattleStateMachine`
   - Battle states/transitions and allowed action gating.
4. `BattleSystemsFacade`
   - Narrow interface over engine operations used by scene/controllers.

Guardrails:
- Each extraction PR must include focused regression tests.
- No PR should change more than one responsibility domain.
- Preserve current feature flags and mobile/desktop input behavior.

Acceptance criteria:
- `BattleScene` line count/import count trend downward over slices.
- Test coverage shifts from scene-integrated to controller-focused where possible.

### 5) Add contributor-facing scene architecture conventions

Target outcome:
- New contributors can place code correctly without reading all of `CLAUDE.md`.

Implementation slices:
1. Add `CONTRIBUTING.md` with a short "Scene Architecture" section:
   - where gameplay rules go
   - where scene orchestration goes
   - where UI overlay logic goes
   - where input mapping goes
2. Include required validation lanes by change type (unit/harness/sim/e2e smoke).
3. Link `CONTRIBUTING.md` from `README.md`.

Acceptance criteria:
- Clear path for adding systems without defaulting to `BattleScene` edits.
- Contributor guide references existing script names exactly.

## P2: Reliability and compliance follow-through

### 6) Add scheduled nightly wide-seed workflow

Target outcome:
- Wider deterministic coverage catches regressions before PR lane failures.

Implementation:
- Add `.github/workflows/nightly.yml` with schedule trigger.
- Run existing commands:
  - `npm run fuzz:nightly`
  - optionally `npm run sim:fullrun:harness` on slower cadence.
- Upload summary artifact.

Acceptance criteria:
- Nightly workflow is green or emits actionable failure artifacts.
- Runtime budget and timeout thresholds are documented.

### 7) Add explicit code and asset licensing statements

Target outcome:
- Repo distribution rights are unambiguous.

Implementation:
1. Add root `LICENSE` for source code.
2. Add `ASSET_LICENSE.md` documenting ownership and usage constraints for media.
3. Link both in `README.md`.

Acceptance criteria:
- License posture is explicit for both code and bundled assets.

## Execution Order

1. P0.1 Formatting/lint policy
2. P0.2 Data schema validation
3. P0.3 CI failure artifacts
4. P1.5 `CONTRIBUTING.md` architecture conventions
5. P1.4 BattleScene decomposition kickoff
6. P2.6 Nightly workflow
7. P2.7 Licensing docs

## Validation Matrix Per Slice

Minimum commands for each slice:

```bash
npm run test:unit
npm run test:harness:pr
npm run sim:fullrun:pr
npm run test:e2e:smoke
```

For BattleScene decomposition slices, add focused battle regressions:

```bash
npm run -s test -- tests/BattleScene*.test.js tests/BattleCameraController.test.js tests/MobileControls.test.js
```

## Risks and Mitigations

1. Tooling churn from lint/format rollout.
- Mitigation: one-time baseline formatting PR, then enforce.

2. Overly strict schemas blocking content iteration.
- Mitigation: phase schema strictness and start with high-confidence constraints.

3. Architecture refactor causing hidden behavior drift.
- Mitigation: behavior-preserving extractions only, small PRs, targeted regression suites per slice.
