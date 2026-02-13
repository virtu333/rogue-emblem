# Full-Run Simulation Harness

This harness extends the headless battle harness into full run traversal:

- Node traversal (`battle`, `recruit`, `shop`, `church`, `boss`)
- Real `RunManager` progression across acts
- Battle resolution via `tests/harness/GameDriver`
- Deterministic seeded execution for batch balance sweeps

## Commands

```bash
# Run full-run sim tests
cmd /c npm run test:sim

# Reporting run (20 seeds, normal)
cmd /c npm run sim:fullrun:harness

# Reporting run with invincibility (best for economy/progression balancing sweeps)
cmd /c npm run sim:fullrun:harness:invincible

# Strict smoke gate
cmd /c npm run sim:fullrun:harness:pr

# Strict single-run fallback
cmd /c npm run sim:fullrun:harness:pr:single

# List deterministic slices
cmd /c npm run sim:fullrun:harness:slices:list
```

## CLI options

`node tests/sim/fullrun-runner.js [options]`

- `--seed <n>` single seed
- `--seed-start <n>` range start (inclusive)
- `--seed-end <n>` range end (inclusive)
- `--seeds <n>` seed range `1..n`
- `--difficulty normal|hard`
- `--invincibility` prevent player unit death in battle
- `--agent scripted|fuzz`
- `--max-nodes <n>`
- `--max-battle-actions <n>`
- `--mode strict|reporting`
- `--timeout-rate-threshold <pct>` (reporting mode)
- `--max-timeout-rate <pct>` explicit timeout cap (all modes)
- `--min-win-rate <pct>`
- `--max-defeat-rate <pct>`
- `--min-avg-nodes <n>`
- `--max-avg-nodes <n>`
- `--min-avg-gold <n>`
- `--max-avg-gold <n>`
- `--min-avg-shop-spent <n>`
- `--max-avg-shop-spent <n>`
- `--min-avg-recruits <n>`
- `--max-avg-units-lost <n>`
- `--max-avg-turns <n>`
- `--min-promotion-by-act2-rate <pct>`
- `--max-promotion-by-act2-rate <pct>`
- `--max-avg-invalid-shop-entries <n>`

## Notes

- In reporting mode, defeats are treated as outcomes (not harness failures).
- Harness failures are `stuck` states and strict-mode timeouts.
- Invincibility mode converts battle action-budget exhaustion into forced node wins so full-run progression can continue for long-batch balancing telemetry.
- Threshold breaches fail the process with a dedicated `Threshold Breaches` section.

## Coverage And Non-Goals

Covered by full-run simulation:
- Run lifecycle and act progression through `RunManager`.
- Node traversal logic (`battle`, `recruit`, `shop`, `church`, `boss`).
- Battle execution through `tests/harness/GameDriver` + headless tactical state machine.
- Deterministic seeded execution for regression and balance telemetry.

Not covered by full-run simulation:
- Scene/UI input behavior (dragging, camera panning, click hitboxes, transitions).
- Visual correctness and animation sequencing.
- Device-specific interaction quirks (mobile pointer behavior, browser rendering differences).

## Strict slice suite

`sim:fullrun:harness:pr` now runs deterministic strict slices:

- `act1_pressure_normal` (normal opening stability/pacing)
- `act1_pressure_hard` (hard opening stress)
- `progression_invincible` (long-run progression/economy telemetry under invincibility)

Slice definitions live in `tests/sim/fullrun-slices.js`.
Calibration guidance lives in `docs/harness-thresholds.md`.

## Exit code semantics

- `victory` and `defeat` are valid simulation outcomes.
- `stuck` always fails the run process (exit code `1`).
- `timeout` fails only in `strict` mode.
- Reporting mode can still fail if `timeout_rate_pct` breaches `--timeout-rate-threshold`.
- Any configured threshold breach fails the run process (exit code `1`).
- `All runs passed.` means no harness failure condition was hit; it does not imply high win rate.

## Baseline Example (Invincible Balance Sweep)

Example high-volume reporting sweep used during harness hardening:

```bash
node tests/sim/fullrun-runner.js --seeds 200 --difficulty normal --invincibility --mode reporting --timeout-rate-threshold 8
```

Observed summary from that run:
- `runs=200 victories=200 defeats=0 stuck=0 timeouts=0`
- `win_rate_pct=100.00 timeout_rate_pct=0.00`
- `avg_nodes=21.00 avg_battles=18.41`
- `avg_turns=75.25 avg_gold=6575 avg_recruits=1.03 avg_units_lost=0.00`

Use this as a reference point, not a fixed guarantee. Re-baseline when game data or AI policy changes materially.

## Recommended Usage Pattern

1. PR gate: `npm run sim:fullrun:harness:pr`
2. Nightly/CI reporting sweep with thresholds:
   - start with `npm run sim:fullrun:harness`
   - add explicit metric gates (for example `--min-win-rate`, `--max-avg-turns`) as baselines stabilize
3. Balance sweeps:
   - use `npm run sim:fullrun:harness:invincible` for economy/progression telemetry
   - run normal (non-invincible) sweeps separately to track actual defeat pressure

## Commit checkpoint

```bash
# 1) Unit/sim smoke
cmd /c npm run test:sim

# 2) Strict harness gate (no stuck/timeout failures)
cmd /c npm run sim:fullrun:harness:pr

# 3) Optional long-run balancing sweep
cmd /c npm run sim:fullrun:harness:invincible
```
