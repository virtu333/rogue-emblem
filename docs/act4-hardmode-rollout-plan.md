# Act 4 Hard-Mode Acceleration Plan

Date: 2026-02-13  
Owner: gameplay roadmap stream  
Status: active planning and execution kickoff

## Goal

Ship meaningful new content earlier by inserting Act 4 into Hard mode before Defend/Survive/Escape objective expansion.

## Priority Order (Locked)

1. Contract alignment
2. Terrain hazards and new tilesets
3. Act 4 progression
4. Reinforcement system

## Decision Locks

- Canonical terrain and biome source is `References/GDDExpansion/gdd_biomes_maps.md`.
- Reinforcements use one generic contract for procedural battles.
- Fixed boss maps may use explicit per-map reinforcement scripts as a controlled exception.
- Defend/Survive/Escape are deferred for this wave.
- Objective scope remains `rout|seize` during this rollout.

## Baseline Gaps (Read-Only Audit)

- Objective runtime supports Rout/Seize only.
- Reinforcement fields exist in data but no live gameplay scheduler is active.
- Terrain data does not yet include Act 4 hazard entries.
- Core act sequence still ends at `finalBoss`; no `act4` entry in run sequence.
- No biome-to-tileset production pipeline for Tundra/Volcano is formalized.

## Canonical Act 4 Terrain Direction

- Act 4 biome focus: Tundra plus Volcano.
- Hazard mechanics in scope: Ice slide and Lava Crack damage.
- Mechanic IDs remain stable across biomes; visual tiles vary by biome.
- Cracked Floor, Pit, Rift Portal, Quicksand remain deferred.

## Execution Model (Phase-Gated)

Each phase must pass this lifecycle before moving forward:
1. Implement scoped changes.
2. Run required automated tests.
3. Perform regression review and risk check.
4. Update roadmap/spec/status docs.
5. Merge as a small PR slice.

No phase starts until prior phase is marked `READY`.

## Phase 1: Contract Alignment

Goal: remove roadmap/spec contradictions and lock runtime contract decisions before code expansion.

### Entry Criteria

- `ROADMAP.md` and `docs/specs/difficulty_spec.md` are editable and synced to latest `main`.
- This plan is treated as execution source for Act 4 order and scope.

### Implementation Tasks

- Align all docs to: `contract -> hazards/tilesets -> act4 progression -> reinforcements`.
- Confirm explicit deferral of Defend/Survive/Escape.
- Lock initial Hard sequence target: `act1 -> act2 -> act3 -> act4 -> finalBoss`.
- Add reinforcement contract versioning note (`reinforcementContractVersion: 1`).

### File Touchpoints

- `ROADMAP.md`
- `docs/specs/difficulty_spec.md`
- `docs/act4-hardmode-rollout-plan.md`

### Test Gate

- Documentation consistency review checklist passes (no contradictory scope statements).

### Exit Criteria

- One canonical hazard scope in all docs.
- One canonical reinforcement contract reference point.
- One explicit deferred-scope list.

### Rollback Trigger

- If any P0 roadmap conflict is found during review, stop and revert that doc slice before merging.

## Phase 2: Terrain Hazards and New Tilesets

Goal: ship Act 4 gameplay identity with deterministic hazard behavior and biome art support.

### Entry Criteria

- Phase 1 is `READY`.
- Terrain IDs and behavior contract are approved.

### Implementation Tasks

- Add `Ice` and `Lava Crack` to terrain data and constants.
- Implement deterministic Ice slide resolution and movement preview behavior.
- Implement Lava Crack end-turn damage and combat-log/UI feedback.
- Add Tundra and Volcano tileset asset mapping.
- Wire biome-specific rendering without changing mechanical terrain IDs.

### File Touchpoints

- `data/terrain.json`
- `src/utils/constants.js`
- `src/engine/Grid.js`
- `src/scenes/BattleScene.js`
- `src/engine/MapGenerator.js`
- `tools/imagen-pipeline/manifest.json`

### Test Gate

- `npm run test:unit`
- `npm run test:harness`
- Targeted battle/hazard scenario coverage added and passing.

### Exit Criteria

- Ice/Lava behavior deterministic and covered.
- Hazard tiles render for Tundra and Volcano.
- No regressions in current Rout/Seize map generation and traversal.

### Rollback Trigger

- Any non-deterministic hazard behavior in harness or replay drift blocks merge.

## Phase 3: Act 4 Progression

Goal: make Hard mode include Act 4 with stable content hooks and save/load compatibility.

### Entry Criteria

- Phase 2 is `READY`.
- Hazard-enabled maps are stable in harness.

### Implementation Tasks

- Add `act4` to run flow/state progression.
- Add Act 4 map size and generation presets.
- Add initial enemy pool/boss roster entries for Act 4.
- Add Act 4 loot/music/economy hooks for end-to-end playability.
- Keep first pass content lean by reusing existing promoted families where possible.

### File Touchpoints

- `src/utils/constants.js`
- `data/difficulty.json`
- `data/mapSizes.json`
- `data/enemies.json`
- `data/lootTables.json`
- `src/engine/RunManager.js`
- `src/engine/NodeMapGenerator.js`
- `src/utils/musicConfig.js`

### Test Gate

- `npm run test:unit`
- `npm run test:harness`
- `npm run sim:fullrun:pr`

### Exit Criteria

- Hard runs reach Act 4 and continue to Final Boss.
- Save/load works across the new act sequence.
- At least one full-run harness slice includes Act 4 without deadlock.

### Rollback Trigger

- Save compatibility break or full-run deadlock in Act 4 path blocks merge.

## Phase 4: Reinforcement System

Goal: activate deterministic reinforcements on Act 4 rout/seize templates using one generic contract.

### Entry Criteria

- Phase 3 is `READY`.
- Turn scheduling and spawn validation hooks are available.

### Reinforcement Contract v1

```json
{
  "reinforcementContractVersion": 1,
  "reinforcements": {
    "spawnEdges": ["right", "top"],
    "waves": [
      { "turn": 3, "count": [2, 3], "edges": ["right"] },
      { "turn": 5, "count": [2, 4], "edges": ["top", "right"] }
    ],
    "difficultyScaling": true,
    "turnOffsetByDifficulty": { "normal": 0, "hard": -1, "lunatic": -1 },
    "xpDecay": [1.0, 0.75, 0.5, 0.25]
  }
}
```

### Fixed Boss Exception Interface

- Fixed boss maps may define `scriptedWaves` with exact turn and spawn coordinates.
- `scriptedWaves` must execute through the same scheduler API as procedural waves.
- Shared scheduler guarantees telemetry parity and deterministic testability.

### Implementation Tasks

- Add wave scheduler in turn flow.
- Add spawn legality checks (occupied/out-of-bounds/path-block).
- Add difficulty offset handling.
- Add anti-farm economy/XP guardrails for reinforcement kills.

### Test Gate

- `npm run test:unit`
- `npm run test:harness`
- `npm run sim:fullrun:pr`
- `npm run test:e2e`

### Exit Criteria

- Reinforcements fire deterministically on selected Act 4 templates.
- No deadlocks, spawn illegalities, or XP/economy runaway loops.
- Fixed boss exception path is validated by contract tests.

### Rollback Trigger

- Any reinforcement-induced infinite turn loop, economy exploit, or replay divergence blocks merge.

## Deterministic Test Matrix (By Phase)

| Phase | Required commands | Purpose |
|---|---|---|
| 1 | Manual doc consistency review | Prevent contract drift before code |
| 2 | `npm run test:unit`, `npm run test:harness` | Hazard determinism and runtime safety |
| 3 | `npm run test:unit`, `npm run test:harness`, `npm run sim:fullrun:pr` | Sequence stability with Act 4 in flow |
| 4 | `npm run test:unit`, `npm run test:harness`, `npm run sim:fullrun:pr`, `npm run test:e2e` | Reinforcement correctness and end-to-end behavior |

## Asset Production Plan (Tundra + Volcano)

### Required Asset Categories

- Base tiles: floor, rough, wall, choke, hazard border variants.
- Hazard overlays: Ice sheen, Lava Crack active/inactive states.
- Biome accents: snowbank, frost fracture, ash, magma seam.

### Pipeline Integration

- Add Act 4 terrain batches to `tools/imagen-pipeline/manifest.json`.
- Keep authored assets in `assets/`; generated/runtime copies remain downstream.
- Track source prompt IDs and generated output IDs for reproducibility.

### Asset Acceptance Checklist

- Tile readability at gameplay zoom levels.
- Hazard state distinguishable without color-only cues.
- No collision/passability mismatch between art and mechanical terrain.

## PR Slicing and Milestones

### Milestone A (Phase 1)

- Docs-only alignment PR.
- Expected scope: `ROADMAP.md`, `docs/specs/difficulty_spec.md`, this plan.

### Milestone B (Phase 2)

- Hazard mechanics PR.
- Separate asset/tileset PR if needed to keep review size small.

### Milestone C (Phase 3)

- Act 4 progression wiring PR.
- Follow-up balance PR allowed, but flow must be complete in first merge.

### Milestone D (Phase 4)

- Reinforcement scheduler contract PR.
- Optional fixed-boss exception PR immediately after core scheduler if needed.

## Deferred Scope (Explicit)

- Defend objective
- Survive objective
- Escape objective
- Full fixed boss-map set
- Cracked Floor, Pit, Rift Portal, Quicksand
- Secret Act and void terrain

## Immediate Kickoff (Begin Now)

Status: `in_progress`

1. Complete Phase 1 consistency sweep and resolve any remaining wording drift across roadmap/spec/plan docs.
2. Add reinforcement contract version marker and scheduler interface notes to spec docs.
3. Open Milestone A docs-only PR with scope/deferral lock and acceptance checklist.
