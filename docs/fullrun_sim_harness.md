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
```

## CLI options

`node tests/sim/fullrun-runner.js [options]`

- `--seed <n>` single seed
- `--seeds <n>` seed range `1..n`
- `--difficulty normal|hard`
- `--invincibility` prevent player unit death in battle
- `--agent scripted|fuzz`
- `--max-nodes <n>`
- `--max-battle-actions <n>`
- `--mode strict|reporting`
- `--timeout-rate-threshold <pct>` (reporting mode)

## Notes

- In reporting mode, defeats are treated as outcomes (not harness failures).
- Harness failures are `stuck` states and strict-mode timeouts.
- Invincibility mode converts battle action-budget exhaustion into forced node wins so full-run progression can continue for long-batch balancing telemetry.

## Exit code semantics

- `victory` and `defeat` are valid simulation outcomes.
- `stuck` always fails the run process (exit code `1`).
- `timeout` fails only in `strict` mode.
- Reporting mode can still fail if `timeout_rate_pct` breaches `--timeout-rate-threshold`.
- `All runs passed.` means no harness failure condition was hit; it does not imply high win rate.

## Commit checkpoint

```bash
# 1) Unit/sim smoke
cmd /c npm run test:sim

# 2) Strict harness gate (no stuck/timeout failures)
cmd /c npm run sim:fullrun:harness:pr

# 3) Optional long-run balancing sweep
cmd /c npm run sim:fullrun:harness:invincible
```
