# Act 4 Hybrid Boss Arena Spec

Status: Planned (Phase 4 extension)
Owner: gameplay roadmap stream
Last updated: 2026-02-13

## 1. Definition of Done

- Hybrid map templates validate only when all required hybrid fields are present and typed correctly.
- For hybrid templates, authored arena tiles are identical across runs with different seeds.
- For hybrid templates, only the procedural approach region may vary by seed.
- Same seed + same battle params produce identical map layout, anchors, phase overrides, and reinforcement timing.
- Named anchors referenced by phase or reinforcement data always resolve to in-bounds coordinates.
- Phase terrain overrides only modify explicitly targeted coordinates or anchors.
- A traversable path from any player spawn to the boss anchor exists at battle start and after each phase override.
- Scripted boss reinforcements (when configured) execute deterministically and still obey spawn legality.
- Non-hybrid templates remain valid and preserve current runtime behavior.
- At least one Act 4 boss template and one Act 3 dark champion template pass scene and headless parity tests.

## 2. Non-goals

- No new objective types (`defend`, `survive`, `escape`).
- No new terrain mechanics beyond currently shipped behavior.
- No boss combat kit rebalance as part of this scope.
- No tutorial, title, or other onboarding flow changes.
- No changes to existing reinforcement reward scaling rules.
- No broad non-boss map generation refactor.

## 3. Affected Modules/Files

- `docs/act4-hardmode-rollout-plan.md`
- `docs/specs/difficulty_spec.md`
- `data/mapTemplates.json`
- `public/data/mapTemplates.json`
- `src/engine/MapTemplateEngine.js`
- `src/engine/MapGenerator.js`
- `src/engine/ReinforcementScheduler.js` (if scripted boss waves are routed through the scheduler contract)
- `src/scenes/BattleScene.js` (phase override application + anchor usage)
- `tests/MapTemplateEngine.test.js`
- `tests/MapGenerator.test.js`
- `tests/ReinforcementScheduler.test.js`
- `tests/harness/HeadlessBattle.js`
- `tests/harness/HeadlessBattle.test.js`
- `tests/harness/Determinism.test.js`

## 4. Invariants

- Determinism: battle seed + params fully determine layout and spawn timing.
- Backward compatibility: legacy templates without hybrid fields remain unchanged.
- Validation strictness: malformed hybrid contract data fails with explicit errors.
- Spatial legality: all authored tiles, anchors, and overrides stay in bounds.
- Spawn legality: no spawn on impassable or occupied tiles.
- Connectivity: phase overrides cannot create an unwinnable no-path state.
- Runtime parity: scene and headless harness produce equivalent outcomes for the same seed.

## 5. Edge Cases

- Authored arena matrix size does not match declared overlay region dimensions.
- Overlapping overlays or overlays extending beyond map bounds.
- Duplicate anchor names or missing anchor references in phase/reinforcement data.
- Anchor resolves to impassable tile at start or after a phase override.
- Multiple overrides target the same tile in one phase transition.
- Phase override blocks all valid player-to-boss routes.
- Scripted waves reference invalid anchors/edges or illegal spawn tiles.
- Save/load resume after phase overrides restores incorrect terrain state.
- Difficulty offsets plus scripted timing cause turn <= 0 or duplicate trigger behavior.

## 6. Risks

- State risk: terrain override state can desync between visuals, pathing, and save/load state.
- Performance risk: repeated connectivity checks can add turn-transition cost on larger maps.
- Compatibility risk: stricter validation may reject existing or custom templates.
- Determinism risk: scene/harness ordering differences can create replay divergence.
- Data drift risk: `data/mapTemplates.json` and `public/data/mapTemplates.json` can diverge.
- Regression risk: boss exception handling can leak into non-boss reinforcement behavior.
