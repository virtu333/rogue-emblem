# Phase 4 Slice 2: Deterministic Reinforcement Scheduler (Pure Module)

Date: 2026-02-13  
Owner: gameplay roadmap stream  
Status: In progress

## Scope Landed
- Added `src/engine/ReinforcementScheduler.js` as a pure scheduling module.
- Implemented deterministic per-turn wave resolution with:
  - template + global difficulty turn offsets,
  - seeded wave count rolls,
  - xp multiplier resolution from `xpDecay`.
- Implemented spawn legality filtering for edge spawns:
  - in-bounds,
  - passable edge tile,
  - unoccupied edge tile,
  - inward-path legality (next step into map must be passable and unoccupied).
- Implemented deterministic edge candidate selection and blocked-spawn accounting.

## Tests Added
- `tests/ReinforcementScheduler.test.js`
  - wave timing and difficulty offset behavior,
  - edge legality filtering,
  - deterministic same-seed output,
  - blocked spawn accounting and xpDecay fallback,
  - count scaling behavior with `difficultyScaling`.

## Runtime Impact
- No scene or turn-flow wiring yet.
- No enemies are spawned by this module unless a caller integrates it.
- This slice provides the deterministic API surface for the next turn-flow wiring step.

## Next Slice
- Integrate scheduler into battle turn flow.
- Connect scheduled spawns to enemy generation and placement.
- Add XP/economy anti-farm guardrails at reinforcement kill accounting points.
