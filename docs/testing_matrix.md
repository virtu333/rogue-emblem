# Testing Matrix

This project has multiple validation lanes with different scope and runtime cost.

## Lanes

| Lane | Scope | Command | Typical Use |
|---|---|---|---|
| Unit/Core | Engine, systems, data loaders, managers | `npm run test:unit` | Fast local verification for gameplay/data logic |
| All Vitest | All Vitest suites | `npm run test` or `npm run test:all` | Pre-commit confidence check |
| Harness | Headless tactical battle harness | `npm run test:harness` | Battle loop/invariant regressions |
| Harness PR Sweep | Scenario fuzz sweep with strict checks | `npm run test:harness:pr` | PR gate for tactical stability |
| Sim Unit | Simulation driver/policy tests | `npm run test:sim` | Validate full-run simulation logic |
| Full-Run Sim (Reporting) | Multi-seed run telemetry | `npm run sim:fullrun:harness` | Balance trends and timeout/stuck detection |
| Full-Run Sim (Invincible) | Deterministic progression stress lane | `npm run sim:fullrun:harness:invincible` | Economy/pacing analysis without wipe noise |
| Full-Run PR Slices | Strict seed slices with threshold gates | `npm run sim:fullrun:pr` | PR guardrail for sim regressions |

## Recommended Usage

Local quick check:

```bash
npm run test:unit
npm run test:harness
```

Pre-push:

```bash
npm run test:all
npm run sim:fullrun:pr
```

## Notes

- Keep existing script names stable for parallel agents/CI while introducing aliases.
- `test:unit` intentionally excludes `tests/harness` and `tests/sim` to stay fast.
- Additional nightly seed sweeps can use existing fuzz/full-run commands in `package.json`.

