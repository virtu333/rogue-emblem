# Harness Threshold Calibration

This document defines how to calibrate and maintain strict full-run harness thresholds without introducing flaky CI failures.

## Scope

Applies to deterministic full-run slices in `tests/sim/fullrun-slices.js`, especially economy/progression and ambush coverage windows:

- `avg_gold`
- `avg_shop_spent`
- `promotion_by_act2_rate_pct`
- `avg_invalid_shop_entries`
- `avg_ambush_battles`

## Current PR Gate Metrics

Current strict PR suite (`npm run sim:fullrun:harness:pr`) enforces:

- `act1_pressure_normal`
  - `min_avg_gold=300`, `max_avg_gold=700`
  - `max_avg_shop_spent=200`
  - `min_avg_nodes=1.50`
  - `max_avg_turns=15.00`
  - `max_avg_units_lost=1.25`
  - `max_avg_invalid_shop_entries=0.00`
- `act1_pressure_hard`
  - `min_avg_gold=200`, `max_avg_gold=650`
  - `max_avg_shop_spent=200`
  - `min_avg_nodes=1.00`
  - `max_avg_turns=10.00`
  - `max_avg_units_lost=1.50`
  - `max_avg_invalid_shop_entries=0.00`
- `progression_invincible`
  - `max_timeout_rate=0.00`
  - `min_win_rate=95.00`
  - `min_avg_nodes=10.00`
  - `min_avg_gold=4000`, `max_avg_gold=11000`
  - `min_avg_shop_spent=1000`, `max_avg_shop_spent=11600`
  - `min_avg_recruits=0.50`
  - `min_promotion_by_act2_rate=0.00`, `max_promotion_by_act2_rate=50.00`
  - `max_avg_units_lost=0.00`
  - `max_avg_invalid_shop_entries=0.00`
- `ambush_hard_invincible`
  - `max_timeout_rate=0.00`
  - `min_win_rate=95.00`
  - `min_avg_nodes=25.00`
  - `min_avg_gold=9000`, `max_avg_gold=33000`
  - `min_avg_shop_spent=8000`, `max_avg_shop_spent=26000`
  - `max_avg_units_lost=0.00`
  - `max_avg_invalid_shop_entries=0.00`
  - `min_avg_ambush_battles=0.20`

## Anchor Commit Provenance

The current strict-slice windows are anchored to intentional gameplay shifts:

- `progression_invincible`: first-bad anchor `7be192d`
  - observed shift: `avg_shop_spent` moved to ~`10533` after recruit behavior change
- `ambush_hard_invincible`: first-bad anchor `3c372c0`
  - observed shift: `avg_gold` moved to ~`31285` and `avg_ambush_battles` to ~`0.25` after hard-map/ballista tuning

Do not attribute these shifts to later UI/refactor commits without first-bad verification.

## Recalibration Procedure

1. Confirm intentional change scope.
   - Recalibrate only after intentional gameplay/economy/policy changes.
2. Run deterministic first-bad attribution.
   - `npm run sim:fullrun:harness:triage -- --slice <slice_id> --range <good_sha>..<bad_sha>`
   - Record: `first_bad_sha`, `parent_sha`, failing metric lines, and touched files.
3. Capture baseline from deterministic slices.
   - Run `npm run sim:fullrun:harness:pr`.
   - Record summary metrics per slice from stdout.
4. Update threshold windows.
   - Keep integrity checks strict:
     - `max_avg_invalid_shop_entries` should stay `0.00`.
     - `max_timeout_rate` should stay `0.00` for invincible slices.
     - `min_avg_ambush_battles` should stay enabled for ambush slices.
   - For value windows (`avg_gold`, `avg_shop_spent`, promotion rate, ambush frequency), use bounded windows around observed baseline, not single-point targets.
   - Recommended default windowing:
     - Lower bound: `floor(observed * 0.85)`
     - Upper bound: `ceil(observed * 1.25)`
   - Use tighter bounds only after repeated stable runs.
5. Apply changes in `tests/sim/fullrun-slices.js`.
6. Re-run verification.
   - `npm run test:sim`
   - `npm run sim:fullrun:harness:pr`

## Threshold-Change PR Requirement

Any PR that changes strict slice thresholds must include triage output in PR notes:

- attribution command(s) with exact slice + commit range
- `first_bad_sha` and `parent_sha`
- failing metric lines that motivated the change
- touched files between `parent_sha..first_bad_sha`

CI enforces this on pull requests via `npm run check:threshold-pr-notes`.

## When To Rebaseline

Rebaseline when any of these changes land:

- Economy constants (`gold`, `shop`, `church`, forge costs)
- Loot/shop tables (`data/lootTables.json`, price tables)
- Run policies (`tests/sim/RunPolicies.js`)
- Battle agent behavior that changes node outcomes
- Promotion gating rules/costs
- Ambush generation or ambush-shop flow changes (`villageAmbushChance`, ambush node routing, battle-first shop behavior)

Do not rebaseline for unrelated UI/scene instrumentation work.

## Guardrail Principles

- Keep deterministic seed sets fixed for PR slices.
- Prefer explicit min/max windows over disabling checks.
- If a threshold starts failing, investigate root cause first; do not widen immediately.
- Widen only when the shift is expected and documented by the gameplay/economy PR.
