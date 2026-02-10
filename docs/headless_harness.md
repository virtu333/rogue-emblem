# Headless Battle Harness

The headless harness runs tactical battles without Phaser, so we can gate PRs and run nightly seeded regressions with replay artifacts.

## Quick Start

```bash
# Harness unit tests
cmd /c npm run test:harness

# PR gate (small seeded matrix, timeout is failure)
cmd /c npm run test:harness:pr

# Ad-hoc multi-scenario run
cmd /c npm run fuzz -- --seeds 10 --all-scenarios

# Nightly-style larger matrix with summary metrics
cmd /c npm run fuzz:nightly

# Nightly strict mode (optional)
cmd /c npm run fuzz:nightly:strict
```

## PR Gate Command

`npm run test:harness:pr` runs:

```bash
node tests/agents/fuzz-runner.js --seeds 10 --all-scenarios --mode strict --use-default-scenario-budgets
```

Expected behavior:
- Runs all registered fixtures.
- Treats timeout as failure.
- Writes replay artifact on failure/timeout.
- Prints totals and per-scenario summary.
- Uses scenario-specific max-action budgets.

## Nightly Command

`npm run fuzz:nightly` runs:

```bash
node tests/agents/fuzz-runner.js --seeds 150 --all-scenarios --mode reporting --timeout-rate-threshold 5 --use-default-scenario-budgets
```

Expected summary metrics:
- `failures`
- `timeouts`
- `timeout_rate_pct`
- `avg_turns`
- `win_rate_pct`
- per-scenario run/failure/timeout/avg_turns/win_rate

Nightly reporting behavior:
- Invariant/engine failures still fail immediately.
- Timeouts are report-only unless timeout rate exceeds threshold.
- This distinguishes expected long scenarios from broad regressions.

Optional strict nightly:

```bash
node tests/agents/fuzz-runner.js --seeds 150 --all-scenarios --mode strict --use-default-scenario-budgets
```

## Scenario Budgets and Seed Filters

Supported controls:
- `--use-default-scenario-budgets`: apply built-in per-scenario action budgets.
- `--scenario-budget <scenario>=<maxActions>`: override one scenario budget (repeatable).
- `--allow-seeds 1,5,8`: run only these seeds in the requested range.
- `--deny-seeds 13,37`: skip known noisy seeds.

Example:

```bash
node tests/agents/fuzz-runner.js --seeds 50 --all-scenarios --mode reporting --timeout-rate-threshold 3 --use-default-scenario-budgets --scenario-budget healer_heavy=3600 --deny-seeds 13,21
```

## Fixtures Covered

- `act1_rout_basic`: baseline rout battle.
- `act2_seize_basic`: seize objective + boss behavior.
- `fog_recruit_visibility`: fog-enabled recruit battle for visibility/talk flow.
- `healer_heavy`: staff-heavy roster for heal behavior.

## Invariants Enforced

Checked after each action step:

1. HP bounds and dead-unit exclusion from active arrays.
2. No overlapping positions.
3. Weapon/equip consistency (equipped weapon must be in inventory).
4. State legality.
5. Turn and phase monotonicity.
6. Objective consistency:
   - rout victory requires no enemies alive
   - seize victory requires boss dead and lord on throne
7. Edric liveness before battle end.
8. Canto remains disabled in headless MVP.
9. Anti-loop watchdogs (repeated selection, repeated state hash).

## Failure Triage Workflow

1. Run PR gate command.
2. On failure, note `seed`, `scenario`, `action`, and replay path from output.
3. Open replay file in `tests/artifacts/replays/`.
4. Inspect:
   - `failure.invariant`
   - `failure.message`
   - `failure.actionIndex`
   - `actions` near the failing index
5. Reproduce exactly (same scenario + same seed + same max-actions).

## Reproduce a Failing Run Exactly

If output shows:

- `seed=37`
- `scenario=fog_recruit_visibility`
- `max-actions=2000`

Run:

```bash
node tests/agents/fuzz-runner.js --seed 37 --scenario fog_recruit_visibility --mode strict --scenario-budget fog_recruit_visibility=2800
```

This uses deterministic seeded RNG, so the run should reproduce the same behavior.

## Replay Artifacts

Failed runs are written to:

`tests/artifacts/replays/`

Filename format:

`<timestamp>-seed<seed>-<scenario>-<result>.json`

The replay JSON includes action log, periodic state snapshots, final turn/phase/state, and failure details.
