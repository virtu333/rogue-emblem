# Wave 8 Difficulty Kickoff (Part A)

## 1. Mission
1. Implement Wave 8 as a data-driven difficulty modifier layer for Normal and Hard while keeping Lunatic disabled in UI.
2. Preserve determinism, save compatibility, and branch isolation from harness and Wave 2 contracts.
3. Ship in small PR slices with explicit test gates before expanding into broader gameplay effects.

## 2. Locked Scope
1. Add `data/difficulty.json` and `public/data/difficulty.json`.
2. Add loader validation and clean failure behavior in `src/engine/DataLoader.js`.
3. Persist run-selected difficulty and resolved modifier snapshot in `src/engine/RunManager.js`.
4. Add Home Base selector in `src/scenes/HomeBaseScene.js` for Normal and Hard.
5. Show Lunatic as disabled "Coming Soon" until Part B content ships.
6. Wire Part A modifiers to existing engine seams only.

## 3. Modifier Surfaces
1. Enemy generation modifiers in map and unit creation paths.
2. Gold and shop pricing multipliers in economy/shop paths.
3. XP multiplier in XP award path.
4. Fog chance bonus in node map generation path.
5. Currency multiplier in meta reward path.

## 4. Out of Scope
1. Reinforcement timing activation remains no-op (contract key allowed, behavior deferred).
2. Act 4 and Secret Act content remain in Part B.
3. Status staff rollout remains in later wave.

## 5. Contract Rules
1. Data first: all difficulty values come from `difficulty.json`, not hardcoded constants.
2. Deterministic behavior: same seed plus same difficulty produces reproducible outcomes.
3. Additive save schema only: migration defaults must protect older saves.
4. Harness and Wave 2 contracts are treated as external surfaces.

## 6. Test Gates
1. Data schema validation and source/public sync tests.
2. Run state default, save/load round-trip, and legacy migration tests.
3. Deterministic tests for same-seed and same-difficulty parity.
4. Directional tests for Normal versus Hard outcomes.
5. Focused regression checks for Wave 2 gameplay flows and harness compatibility surfaces.

## 7. PR Plan
1. PR-A: W8-01 to W8-03 contract, loader, run state and migration tests.
2. PR-B: W8-04 to W8-07 gameplay/UI wiring, deterministic checks, focused integration tests.
3. PR-C: W8-08 to W8-09 regression guardrails, docs updates, rollout notes.

## 8. Merge Gates
1. Every PR must pass its targeted tests.
2. Final PR in the stack must pass full `npm test` and `npm run build`.
3. Any cross-stream edit requires explicit compatibility rationale in PR description.

## 9. Operator Checklist
1. Confirm only intended files changed before push.
2. Confirm no AI/map/harness contract file edits outside declared scope.
3. Include exact test command outputs in PR body.
4. Call out known baseline issues only if pre-existing and reproducible on `main`.
