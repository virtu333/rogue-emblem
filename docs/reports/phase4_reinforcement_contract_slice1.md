# Phase 4 Slice 1: Reinforcement Contract Data + Validation

Date: 2026-02-13
Owner: gameplay roadmap stream
Status: In progress

## Scope Landed
- Added map-template contract validation for reinforcement metadata (`reinforcementContractVersion` + `reinforcements`).
- Wired validation into `DataLoader` startup checks.
- Added reinforcement contract entries to all four Act 4 templates (`frozen_pass`, `caldera`, `glacier_fortress`, `eruption_point`).
- Synced `data/mapTemplates.json` to `public/data/mapTemplates.json`.
- Added pass-through in `generateBattle` so battle configs include reinforcement metadata (deep-cloned, no runtime spawn behavior yet).

## Tests Added/Updated
- `tests/MapTemplateEngine.test.js` (new): bundled validation + malformed contract rejection.
- `tests/DataLoaderBlessings.test.js`: map template validation failure path.
- `tests/MapGenerator.test.js`: reinforcement pass-through + deep-clone guard.
- `tests/Act4ProgressionGuards.test.js`: Act 4 reinforcement field presence guard.

## Runtime Impact
- No scheduler/turn-flow behavior changed.
- No reinforcements spawn yet; this is contract/data plumbing only.
- Hardening update: `seize` template safety is now enforced at both validation and runtime.
  - Validation requires both `rout` and `seize` pools to be non-empty.
  - `generateBattle` no longer cross-falls back from `seize` to `rout`.
  - Pre-assigned `templateId` must match both act filter and objective pool.

## Next Slice
- Implement pure deterministic reinforcement scheduler (no scene dependency).
- Add spawn legality filtering + deterministic edge candidate selection.
- Then wire scheduler into battle turn flow.
