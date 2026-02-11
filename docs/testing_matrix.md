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
| Manual Audio Transition Soak | Scene-to-scene music ownership/overlap checks | `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` | Catch dual-track overlap or music dropouts across rapid transitions |

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

Pre-release audio sanity:

```bash
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Then run the manual Audio Transition Soak flow (below).

## Notes

- Keep existing script names stable for parallel agents/CI while introducing aliases.
- `test:unit` intentionally excludes `tests/harness` and `tests/sim` to stay fast.
- Additional nightly seed sweeps can use existing fuzz/full-run commands in `package.json`.
- For high-risk scene/audio/input changes, review `docs/issues/frequent_regressions.md` before merge.

## Manual Audio Transition Soak

Goal: verify only one music track is audible during aggressive scene changes.

1. Start from Title and perform quick clicks: `New Game` -> `Begin Run` -> `Confirm difficulty` -> `Confirm blessing`.
2. On NodeMap, immediately enter a battle node as soon as it is interactable.
3. In battle, end/complete quickly and return through victory/loot back to NodeMap.
4. Repeat steps 2-3 at least 3 times in one session, including one longer battle (2+ minutes) before returning.
5. Open pause/settings once in NodeMap and once in battle, then close; confirm no second track starts.

Pass criteria:

- At all times, exactly one music bed is audible.
- No persistent low-volume "ghost" track remains after scene change.
- No battle-entry freeze/crash when quickly transitioning from NodeMap.
- Returning to NodeMap restores the expected act map track.
