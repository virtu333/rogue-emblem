# Phase 4 Slice 1 Spec: Reinforcement Contract, Validation, and Pass-Through

Date: 2026-02-17  
Owner: gameplay roadmap stream  
Status: Draft spec (ready for implementation/review)

## Objective
Add a versioned reinforcement contract to map templates and ensure it is validated at data-load and propagated into generated battle configs, without enabling runtime spawning yet.

## Scope Confirmed from Current Slice-1 Implementation
- Contract constants and schema validation are in `src/engine/MapTemplateEngine.js`:
  - `REINFORCEMENT_CONTRACT_VERSION` is defined and enforced.
  - `validateMapTemplatesConfig` now validates template-level reinforcement metadata and related map terrain/phase override fields.
  - Reinforcement fields are validated for required shape, types, bounds, and references.
- Data loading now executes reinforcement validation in `DataLoader.loadAll` via `validateMapTemplatesConfig`.
- `generateBattle` now passes cloned reinforcement metadata into the battle config.
- Reinforcement metadata has been added to map templates in both template stores:
  - `data/mapTemplates.json`
  - `public/data/mapTemplates.json`
- Slice-1 tests were added for validation, loader failure modes, and battle-config pass-through.

## Contract Definition (v1)
- `template.reinforcementContractVersion`
  - Integer.
  - Must equal `1` for v1-compliant templates.
  - Must exist only together with `template.reinforcements`.
- `template.reinforcements`
  - Required keys:
    - `spawnEdges`: non-empty array subset of `['left','right','top','bottom']`
    - `waves`: array, non-empty unless `scriptedWaves` has content
    - `difficultyScaling`: boolean
    - `turnOffsetByDifficulty`: object with exactly keys `normal|hard|lunatic`, integer values
    - `xpDecay`: non-empty array of finite numbers in `[0,1]`, non-increasing
  - Optional keys:
    - `turnJitter`: `[minDelta, maxDelta]` integers, `minDelta <= maxDelta`
    - `scriptedWaves`
- `reinforcements.waves[]` items:
  - `turn`: positive integer
  - `count`: `[min,max]` integers with `0 < min <= max`
  - optional `edges`: subset of `spawnEdges`
- `reinforcements.scriptedWaves[]` items:
  - `turn`: positive integer
  - `spawns`: non-empty array
  - each spawn has non-negative integer `col,row`; optional fields `className`, `level`, `sunderWeapon`, `aiMode`, `affixes`
  - optional `xpMultiplier`: `[0,1]` finite

## Slice-1 Delivery Requirements
1. Data contract is versioned and required in tandem (`reinforcementContractVersion` + `reinforcements`).
2. Loader rejects malformed map template payloads early with clear errors.
3. Generated battles include:
  - `reinforcementContractVersion`
  - deep-cloned `reinforcements` object
4. Reinforcement metadata is isolated from generation randomness/mutation.
5. No spawning behavior is introduced in `MapGenerator` (pure pass-through only).

## Acceptance Criteria
- `validateMapTemplatesConfig` returns valid for canonical bundled templates.
- `DataLoader.loadAll()` rejects:
  - missing required objective pools
  - malformed reinforcement entries in templates
- `generateBattle` returns reinforcement fields for act4 templates and scripted-only seize templates and does not share object references with template data.
- No runtime regression for non-reinforcement templates.

## Reviewed Artifacts
- `src/engine/MapTemplateEngine.js`
- `src/engine/DataLoader.js`
- `src/engine/MapGenerator.js`
- `tests/MapTemplateEngine.test.js`
- `tests/DataLoaderBlessings.test.js`
- `tests/MapGenerator.test.js`
- `tests/Act4ProgressionGuards.test.js`
- `data/mapTemplates.json`
- `public/data/mapTemplates.json`

## Known Follow-up Items for Slice 2/3 Boundary
- Preserve map-template sync process (`data/` and `public/data/`) for any future contract edits.
- Ensure no assumption changes for future contract versions without explicit schema migration path.
