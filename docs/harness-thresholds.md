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
  - `min_avg_recruits=0.00`
  - `min_promotion_by_act2_rate=0.00`, `max_promotion_by_act2_rate=50.00`
  - `max_avg_units_lost=0.00`
  - `max_avg_invalid_shop_entries=0.00`
- `ambush_hard_invincible`
  - `max_timeout_rate=0.00`
  - `min_win_rate=95.00`
  - `min_avg_nodes=25.00`
  - `min_avg_gold=9000`, `max_avg_gold=56800`
  - `min_avg_shop_spent=6400`, `max_avg_shop_spent=26000`
  - `max_avg_units_lost=0.00`
  - `max_avg_invalid_shop_entries=0.00`
  - `min_avg_ambush_battles=0.20`

## Anchor Commit Provenance

The current strict-slice windows are anchored to intentional gameplay shifts:

- `progression_invincible`: first-bad anchor `7be192d`
  - observed shift: `avg_shop_spent` moved to ~`10533` after recruit behavior change
- `ambush_hard_invincible`: first-bad anchor `3c372c0`
  - observed shift: `avg_gold` moved to ~`31285` and `avg_ambush_battles` to ~`0.25` after hard-map/ballista tuning

- `ambush_hard_invincible` (`max_avg_gold` 33000 → 52200): the Eclipse (visible run clock,
  `docs/specs/eclipse.md`) on branch `claude/eclipse`
  - observed shift: `avg_gold` 26554 → 41742, `avg_shop_spent` 18066 → 12267,
    `avg_ambush_battles` 0.75 → 0.50 (seeds 301-312, hard, invincible)
  - cause, isolated with the same seeds (full run with `gameData.eclipse` removed reproduces
    the old baseline exactly, 26554 / 18066): this slice's scripted agent averages ~26 turns
    a battle, far past par, so it reaches Totality by Act III (act-end shadow
    27 / 63 / 95 / 97). Burned villages remove ~5.8k of shop spending (gold that can no
    longer be spent), eclipsed elite battles add elite gold, and phase enemy levels add
    ~3.3k kill gold. Window per the procedure below: `ceil(41742 * 1.25)` ≈ 52200.
  - no other strict slice moved outside its window (`progression_invincible` gold
    8710 → 9731, shop spent 7036 → 6174; Act I pressure slices unchanged: they never win
    a battle, so no shadow is committed).

- `ambush_hard_invincible` (`min_avg_shop_spent` 8000 → 6770): Eclipse act pressure
  separated from the capped global meter (review R2, `docs/specs/eclipse.md` deviation 11)
  on branch `claude/review-fixes-rewind-eclipse`
  - attribution: `npm run sim:fullrun:triage -- --slice ambush_hard_invincible --range
    b9d248f..6c278a0` → `first_bad_sha=2444879e9f2e`, `parent_sha=fcee235017e2`;
    failing metric `avg_shop_spent=7964.92 < threshold=8000.00`; touched files: the Eclipse
    engine/UI/tests/docs only (`src/engine/EclipseSystem.js`, `src/engine/RunManager.js`,
    `src/ui/EclipseHudController.js`, `src/ui/PostCombatController.js`,
    `src/ui/ceremonyContent.js`, `src/ui/eclipseContent.js`, `src/utils/devStartup.js`,
    `sim/eclipse.js`, tests, docs, captures).
  - observed shift (seeds 301-312, hard, invincible): `avg_shop_spent` 11699 → 7965,
    `avg_gold` 42480 → 50296 (window max 52200 unchanged), `eclipse_avg_falls` 40.0 → 52.1,
    eclipsed battles 6.67 → 9.33, `avg_ambush_battles` 0.50, `avg_turns` 612.8 → 686.8;
    act-end shadow unchanged (24.8 / 61.9 / 94.2 / 97.0).
  - cause: this slice's agent sits at the shadow cap from Act III. Before, an act that
    opened at 97 could never lose a node (act shadow saturated at 3); now each slow victory
    still adds act pressure, so Act III/IV shops burn like Act I/II ones — less gold can be
    spent in shops (and eclipsed elite battles add gold). Intended by the R2 decision.
  - window per the procedure: `floor(7965 * 0.85)` = 6770. No other slice moved
    (`progression_invincible` and both Act I pressure slices are byte-identical: they never
    reach the cap).

- `progression_invincible` (`min_avg_recruits` 0.50 → 0.00): the army heals to full after
  each act boss (`RunManager.advanceAct`), on branch `claude/eloquent-edison-98qbyl`
  - attribution: `npm run sim:fullrun:triage -- --slice progression_invincible --range
    edf39134..651f2f3e` → `first_bad_sha=651f2f3e4024`, `parent_sha=edf39134fe9b`; failing
    metric `avg_recruits=0.00 < threshold=0.50`; touched files `src/engine/RunManager.js`,
    `tests/RunManager.test.js`.
  - observed shift (seeds 201-206, normal, invincible): `avg_recruits` 0.50 → 0.00,
    `avg_gold` 9821 → 10329, `avg_shop_spent` 7564 → 5981, `avg_turns` 188.0 → 166.5; win
    rate, nodes, units lost and invalid shop entries unchanged.
  - cause: this slice's scripted agent never goes for a recruit. Its 3 recruits (of ~40
    recruit battles) were incidental Talks. Which battles produce one depends on the HP the
    lords bring in (invincibility only floors them at 1), so starting each act at full HP
    changes those battles and, on these seeds, none ends in a Talk. Recruiting itself is unchanged;
    it is covered by the harness Talk tests (`tests/harness/HeadlessBattle.test.js`), the
    scene's `executeTalk` tests, the recruit-battle e2e (`strategy-layer.spec.js`) and the
    RescueAgent recruit routes in `sim/strategy.js`, not by this slice.
  - window per the procedure: `floor(0.00 * 0.85)` = 0.00. No other slice moved outside
    its window.

- `ambush_hard_invincible` (`max_avg_gold` 52200 → 54400 → 56800): two raises recorded
  only in their PR notes until now (`docs/playtest-triage-2026-09-28.md`, PRs #152 and
  #161).
  - 52200 → 54400: the difficulty ladder (Nightfall now runs on to the Entity);
    first_bad_sha `6a3778b8`, parent_sha `3539f856`; `avg_gold` 50460 → 52607 (+1 act,
    35 → 37 nodes, 29 → 30 battles). Same ~3.4% headroom.
  - 54400 → 56800: Wounded (the Grievous affix joins the tier-1 pool Hard rolls from);
    first_bad_sha `e6e7f191`, parent_sha `887c03c2`; `avg_gold` 53483 → 54901. Same
    ~3.4% headroom.

- `ambush_hard_invincible` (`min_avg_shop_spent` 6770 → 6400): Dusk pressure part 3
  (hold-position garrisons and the seize par fix, `docs/specs/dusk-pressure.md` §2b, §6)
  on branch `claude/dusk-pressure-pr3`
  - attribution: `npm run sim:fullrun:triage -- --slice ambush_hard_invincible --range
    68e0b968..2d95a4f9` → `first_bad_sha=2d95a4f9`, `parent_sha=68e0b968`; failing metric
    `avg_shop_spent=6749.83 < threshold=6770.00`; touched files: `data/difficulty.json`
    (holdShare, objectiveParOffset), the hold and seize-par engine
    (`src/engine/HoldActivation.js`, `HoldDisturbance.js`, `SeizeParFloor.js`,
    `AIController.js`, `MapGenerator.js`, `TurnBonusCalculator.js`, `RunManager.js`,
    `DifficultyEngine.js`, `ReinforcementSpawns.js`, `UnitHealth.js`,
    `StatusConditionSystem.js`), `src/scenes/BattleScene.js`,
    `tests/harness/HeadlessBattle.js`, tests and docs.
  - observed shift, re-measured after the review fixes (seeds 301-312, hard, invincible),
    main `2a5f12f3` → branch: `avg_shop_spent` 8210 → 7175, `avg_gold` 47265 → 48184
    (+1.9%, inside 56800), `avg_ambush_battles` 0.33 → 0.25; win rate, timeouts, units
    lost and invalid shop entries unchanged. (At `f49275a2`, before the harness learned
    the scene's lava and acid: shop spent 6746, gold 49059.)
  - cause: per-seed divergence, not lower income (gold rose). The scripted runs take
    different roads once seize ratings and holders change; shop spending moves both ways
    per seed (at `f49275a2`: 303 −13003, 304 −7744, 307 −3587; 306 +2908, 311 +2898),
    and seed 303 alone was 1084 of that 1464 average drop.
  - window: 6400, 11% under the final 7175 and 5% under the 6746 low point, tighter
    than the procedure's `floor(7175 * 0.85)` = 6098 so a real shop regression on this
    slice still fails.
  - **ambush coverage margin:** 3 of 12 runs see an ambush (0.25) against the
    `min_avg_ambush_battles=0.20` floor, which needs 3. One run fewer fails the slice.
    The floor is kept; if it breaches next, first check the per-seed roads (the same
    divergence as above) before touching ambush generation.
  - no other strict slice left its window (`progression_invincible` gold 7737, shop
    spent 8206; Act I pressure slices 384 / 200 gold).

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
