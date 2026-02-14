# Act 4 Hybrid Boss Arena Spec

Status: Planned (Phase 4 extension, implementation-ready)
Owner: gameplay roadmap stream
Last updated: 2026-02-14

## 1. Scope

Introduce a boss-only hybrid map contract that combines:
- procedural approach region (existing zone-based generation), and
- authored arena overlay region (fixed tile matrix),
with optional deterministic phase terrain overrides and scripted boss reinforcements.

This scope is for boss encounters only (`bossOnly: true` templates).

## 2. Definition of Done

- Hybrid templates validate only when required hybrid fields are present and typed correctly.
- Non-hybrid templates continue to validate and generate exactly as before.
- For hybrid templates, arena overlay tiles are identical for every run regardless of seed.
- For hybrid templates, only the approach region can vary by seed.
- Same seed and same `battleParams` produce identical final map layout, anchor resolution, phase overrides, and reinforcement timing.
- Named anchors referenced by phase overrides or scripted waves resolve to in-bounds coordinates.
- Each phase override mutates only declared targets (tile coords or anchor refs), nothing else.
- At battle start, and after each applied phase override, at least one traversable path exists from a player spawn to the boss anchor.
- Scripted boss reinforcements still execute through shared scheduler APIs and obey spawn legality rules.
- Same-turn ordering is fixed: apply due `phaseTerrainOverrides` first, then resolve/spawn due reinforcements.
- At least one Act 4 boss template and one Act 3 dark champion template use the hybrid contract and pass scene + headless parity tests.

## 3. Non-goals

- No new objectives (`defend`, `survive`, `escape`).
- No new terrain mechanics beyond shipped behavior.
- No boss stat, skill, AI kit, or combat rebalance.
- No tutorial/title/onboarding changes.
- No reinforcement reward-scaling contract changes.
- No broad non-boss map generation refactor.

## 4. Hybrid Contract v1 (Template Additions)

Hybrid templates remain valid existing templates plus:

- `bossOnly: true` (required for hybrid templates)
- `hybridArena` object (required):
  - `approachRect`: normalized rect `[x1, y1, x2, y2]` for procedural zone scope.
  - `arenaOrigin`: `[col, row]` top-left destination for overlay placement.
  - `arenaTiles`: 2D terrain-name matrix (non-empty, rectangular).
  - `anchors`: object of `anchorName -> [col, row]` (global map coords).
- `phaseTerrainOverrides` array (optional):
  - each entry has deterministic trigger metadata and tile changes:
  - `turn` (positive integer trigger turn),
  - `setTiles` array where each item targets either:
  - `coord: [col, row]` or `anchor: "anchorName"`, and `terrain: "TerrainName"`.

Constraints:
- `arenaTiles` placement must remain fully in bounds.
- Anchor coordinates must be in bounds.
- Any anchor used by overrides or scripted waves must exist.
- Multiple `setTiles` entries targeting the same destination in one phase entry are invalid.

## 5. Affected Modules/Files

- `docs/act4-hardmode-rollout-plan.md`
- `docs/specs/difficulty_spec.md`
- `docs/specs/act4_hybrid_boss_arena_spec.md`
- `docs/reports/phase4_hybrid_boss_arena_implementation_plan.md`
- `data/mapTemplates.json`
- `public/data/mapTemplates.json`
- `src/engine/MapTemplateEngine.js`
- `src/engine/MapGenerator.js`
- `src/scenes/BattleScene.js`
- `tests/MapTemplateEngine.test.js`
- `tests/MapGenerator.test.js`
- `tests/harness/HeadlessBattle.js`
- `tests/harness/HeadlessBattle.test.js`
- `tests/harness/Determinism.test.js`
- `tests/Act4ProgressionGuards.test.js`

## 6. Invariants

- Determinism: seed + params fully determine map and reinforcement outcomes.
- Backward compatibility: templates without `hybridArena` are unaffected.
- Validation strictness: malformed hybrid fields fail with explicit errors.
- Spatial legality: overlays, anchors, and overrides remain in bounds.
- Spawn legality: no spawn on occupied or impassable tiles.
- Connectivity safety: overrides cannot create a no-path unwinnable state.
- Runtime parity: BattleScene and headless harness produce equivalent results.
- Boss-only gating: hybrid templates are never selected for non-boss nodes by random selection.

## 7. Edge Cases

- `arenaTiles` shape is ragged or empty.
- `arenaOrigin + arenaTiles` exceeds map bounds.
- `approachRect` overlaps arena region in a way that causes overlay clobber ambiguity.
- Duplicate anchor names, missing anchor references, or invalid anchor coordinate type.
- Override references unknown anchor or invalid coord.
- Two override entries write different terrain to the same tile in one trigger.
- Override turns collide with reinforcement turns and must still respect fixed override-first ordering.
- Save/load resume after one or more overrides restores wrong terrain/pathing state.
- Difficulty turn offsets plus scripted waves produce turn <= 0 after normalization.

## 8. Risks

- State risk: terrain visuals, pathing graph, and persisted battle state can desync.
- Performance risk: connectivity checks at override points can add turn-time cost.
- Compatibility risk: strict validation may reject legacy custom templates.
- Determinism risk: scene/harness timing mismatch around override application.
- Data drift risk: `data/` and `public/data/` template mirrors can diverge.
- Regression risk: boss exception logic leaking into non-boss template selection.

## 9. Implementation Plan Link

Implementation sequencing is tracked in:
`docs/reports/phase4_hybrid_boss_arena_implementation_plan.md`
