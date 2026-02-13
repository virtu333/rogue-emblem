# Phase 4 Slice 3: Reinforcement Turn-Flow Wiring + Kill Reward Guardrails

Date: 2026-02-13  
Owner: gameplay roadmap stream  
Status: In progress (merge gates validated for slices 1-3 on 2026-02-13)

## Scope Landed
- Wired deterministic reinforcement scheduling into enemy-phase turn flow in `BattleScene`.
- Added runtime spawn pipeline for scheduled reinforcements (edge spawn placement -> enemy unit instantiation).
- Reused existing enemy creation rules (difficulty scaling, promoted/base class handling, Sunder weapon handling).
- Added reinforcement metadata on spawned enemies (`_isReinforcement`, wave/turn, reward multiplier).
- Applied anti-farm guardrails at kill accounting points:
  - XP from kills is scaled by reinforcement `xpDecay` multiplier.
  - Gold from kills is scaled by the same reinforcement multiplier.
- Wired difficulty modifier pass-through for `reinforcementTurnOffset` in `RunManager.getBattleParams`.
- Mirrored reinforcement runtime behavior in headless harness (`HeadlessBattle`) for parity.

## Tests Added/Updated
- `tests/ReinforcementScheduler.test.js`
  - Added regression for intra-wave inward-neighbor occupancy revalidation.
- `tests/harness/HeadlessBattle.test.js`
  - Added enemy-phase integration coverage for due-turn reinforcement spawning.
- `tests/harness/Determinism.test.js`
  - Added deterministic replay coverage for an Act 4 reinforcement-active scenario.
- `tests/RunManager.test.js`
  - Added battle-param assertion for `reinforcementTurnOffset`.

## Runtime Impact
- Reinforcements now spawn during enemy phase on templates that define the reinforcement contract.
- Spawn timing is deterministic for a given battle seed + turn + board occupancy.
- Reinforcement kill rewards are decay-scaled, reducing farm potential from later waves.

## Validation Completed
- Merge-gate suite validated on 2026-02-13:
  - `npm run -s test:unit` -> pass (`68` files, `1165` tests)
  - `npm run -s test:harness` -> pass (`5` files, `59` tests)
  - `npm run -s sim:fullrun:pr` -> pass (all `pr` slices)
  - `npm run -s test:e2e` -> pass (`15/15` Playwright tests)

## Remaining Follow-up
- Finish docs cleanup sweep and keep docs-only changes separable from runtime PR when landing.
