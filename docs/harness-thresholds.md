# Harness Threshold Calibration

This document defines how to calibrate and maintain strict full-run harness thresholds without introducing flaky CI failures.

## Scope

Applies to deterministic full-run slices in `tests/sim/fullrun-slices.js`, especially economy and progression windows:

- `avg_gold`
- `avg_shop_spent`
- `promotion_by_act2_rate_pct`
- `avg_invalid_shop_entries`

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
  - `min_avg_gold=250`, `max_avg_gold=650`
  - `max_avg_shop_spent=200`
  - `min_avg_nodes=1.00`
  - `max_avg_turns=10.00`
  - `max_avg_units_lost=1.50`
  - `max_avg_invalid_shop_entries=0.00`
- `progression_invincible`
  - `max_timeout_rate=0.00`
  - `min_win_rate=95.00`
  - `min_avg_nodes=10.00`
  - `min_avg_gold=4000`, `max_avg_gold=6500`
  - `min_avg_shop_spent=1000`, `max_avg_shop_spent=6500`
  - `min_avg_recruits=0.50`
  - `min_promotion_by_act2_rate=10.00`, `max_promotion_by_act2_rate=50.00`
  - `max_avg_units_lost=0.00`
  - `max_avg_invalid_shop_entries=0.00`

## Recalibration Procedure

1. Confirm intentional change scope.
   - Recalibrate only after intentional gameplay/economy/policy changes.
2. Capture baseline from deterministic slices.
   - Run `npm run sim:fullrun:harness:pr`.
   - Record summary metrics per slice from stdout.
3. Update threshold windows.
   - Keep integrity checks strict:
     - `max_avg_invalid_shop_entries` should stay `0.00`.
     - `max_timeout_rate` should stay `0.00` for invincible progression slice.
   - For value windows (`avg_gold`, `avg_shop_spent`, promotion rate), use bounded windows around observed baseline, not single-point targets.
   - Recommended default windowing:
     - Lower bound: `floor(observed * 0.85)`
     - Upper bound: `ceil(observed * 1.25)`
   - Use tighter bounds only after repeated stable runs.
4. Apply changes in `tests/sim/fullrun-slices.js`.
5. Re-run verification.
   - `npm run test:sim`
   - `npm run sim:fullrun:harness:pr`

## When To Rebaseline

Rebaseline when any of these changes land:

- Economy constants (`gold`, `shop`, `church`, forge costs)
- Loot/shop tables (`data/lootTables.json`, price tables)
- Run policies (`tests/sim/RunPolicies.js`)
- Battle agent behavior that changes node outcomes
- Promotion gating rules/costs

Do not rebaseline for unrelated UI/scene instrumentation work.

## Guardrail Principles

- Keep deterministic seed sets fixed for PR slices.
- Prefer explicit min/max windows over disabling checks.
- If a threshold starts failing, investigate root cause first; do not widen immediately.
- Widen only when the shift is expected and documented by the gameplay/economy PR.
