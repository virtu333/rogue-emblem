# Phase 2 Closeout and Next Steps (Archived)

## Status (Synced 2026-02-13)
- Phase 2 hazards/templates/AI work is landed on `main` (`edc7689`).
- Act 4 progression/runtime wiring is landed on `main` (`3b00a26`).
- Reinforcement runtime parity follow-up is landed (`58ccf29`, `9f8f009`).

## Notes
- The previous "open PR / prep Phase 3" checklist in this file is historical.
- Keep docs-only edits separate from runtime gameplay PRs for clean review and rollback.

## Current Follow-Ups
1. Run full merge-gate suites for reinforcement flow changes touching scene/harness runtime:
   - `npm run -s test -- tests/ReinforcementScheduler.test.js tests/RunManager.test.js tests/harness/Determinism.test.js`
   - `npm run -s test:harness`
   - `npm run -s sim:fullrun:pr`
   - `npm run -s test:e2e`
2. Keep harness/runtime parity checks for callers that pass custom `battleParams` (ensure `runSeed` and `nodeId` are provided or injected).
