# Blessings Contract

## 1. Purpose
1. This document freezes the Wave 6 Blessings contract.
2. This contract applies to data schema, runtime application order, save schema additions, replay metadata, and compatibility rules.
3. Any breaking change to this contract requires a contract version bump and migration plan.

## 2. Contract Version
1. Contract name is `blessings`.
2. Contract version is `1`.
3. Runtime implementation must expose this version for diagnostics and telemetry.

## 3. Data Schema
1. Source file is `data/blessings.json`.
2. Top-level keys are `version`, `blessings`, and optional `rules`.
3. `version` is a number and must match contract version for strict mode.
4. `blessings` is an array of blessing definitions.
5. Each blessing definition includes required fields `id`, `name`, `tier`, `description`, `boons`, and `costs`.
6. `id` is a stable string key and is immutable after release.
7. `tier` is an integer in range 1 through 4.
8. `boons` is a non-empty array of effect descriptors.
9. `costs` is an array of effect descriptors and may be empty for free-tier entries.
10. Each effect descriptor includes required fields `type` and `params`.
11. `type` is a stable enum key mapped by engine handlers.
12. `params` is an object with effect-specific numeric or string fields.
13. Optional fields are `weight`, `tags`, `requires`, `excludes`, and `ui`.
14. Unknown fields are ignored in non-strict mode and rejected in strict mode.

## 4. Selection Rules
1. Run start presents 3 to 4 blessing options.
2. At least one tier-1 option must be present.
3. Tier-4 appearance is controlled by weighted chance.
4. Candidate selection uses seeded RNG path only.
5. Selection output stores only stable IDs and not mutable display text.

## 5. Application Order
1. Global modifier order is fixed.
2. Order is base, meta, difficulty, blessings, temporary combat effects.
3. Blessings order is fixed within the blessings layer as run-init effects, persistent run effects, battle-init effects, and reward/economy effects.
4. Within each sub-stage, blessings are applied in deterministic sorted order by blessing ID.
5. Effect handler order inside a blessing is deterministic by array order.

## 6. Stacking And Conflict Rules
1. Stacking behavior is defined per effect type as additive, multiplicative, max, min, or override.
2. Multiplicative stacks are applied in deterministic sorted order by blessing ID.
3. Overrides require explicit priority and lower priority is ignored.
4. Caps and clamps are applied after all contributions for the same stat or metric are resolved.
5. Missing handler for a configured effect type is a validation error in strict mode and a soft error in compatibility mode.

## 7. Save Schema Additions
1. Run save payload adds `activeBlessings` as an array of blessing IDs.
2. Run save payload may add `blessingHistory` as an array of event records.
3. Event record schema is `timestamp`, `stage`, `eventType`, `blessingId`, `effectType`, and optional `details`.
4. Save additions are additive and must not mutate unrelated fields.
5. Missing blessing fields in old saves must default safely to empty values.
6. Unknown blessing IDs in loaded saves must be preserved as inert entries and logged.

## 8. Save Migration Rules
1. Migration is executed during `RunManager.fromJSON` before any blessing-dependent relink or runtime restoration steps.
2. Saves without blessing fields are migrated by adding defaults.
3. Saves with legacy blessing key names are normalized to contract keys.
4. Migration must be idempotent.
5. Migration must not alter deterministic seed state.

## 9. Replay Metadata Contract
1. Replay metadata is additive and optional.
2. If present, replay metadata field is `blessings` with `contractVersion`, `activeBlessings`, and optional `selectionSeed`.
3. Harness action schema must remain unchanged.
4. Replay readers must ignore missing blessing metadata.
5. Replay readers must tolerate unknown blessing IDs.

## 9.1 Selection Telemetry Contract
1. Selection telemetry is additive and optional.
2. If present, it should include `seed`, `candidatePoolIds`, `offeredIds`, and `chosenIds`.
3. `offeredIds` contains generated run-start options.
4. `chosenIds` contains player-selected blessing IDs and may be empty when skipped.
5. Legacy telemetry that stored offered IDs under `chosenIds` must be migrated safely.

## 10. Determinism Rules
1. Blessing selection and blessing-triggered random effects must use seeded RNG path.
2. No direct `Math.random` calls are allowed inside BlessingEngine logic.
3. Same seed and same blessing loadout must produce equal outcomes for deterministic harness scenarios.
4. Determinism tests are required for repeated-run consistency.

## 11. Error Handling Contract
1. Validation errors fail fast at load-time in strict mode.
2. Runtime application errors are captured with blessing ID, effect type, and stage context.
3. Error reporting hooks send normalized events to centralized alerts.
4. Recoverable errors degrade by skipping the failing effect and preserving run continuity when safe.
5. Non-recoverable errors halt blessing application for that stage and raise escalation.

## 12. Compatibility Rules
1. Harness integration must remain backward-compatible.
2. Wave 2 map, AI, and fog contracts are treated as external and must not be implicitly coupled.
3. Context shape changes for battle or rewards must be additive only.
4. Any required breaking change mandates a contract version bump and compatibility shim.

## 13. Validation Requirements
1. Schema validation tests are mandatory.
2. Stacking and precedence tests are mandatory.
3. Migration tests are mandatory.
4. Serialization round-trip tests are mandatory.
5. Single-application tests are mandatory to prevent double counting.
6. Deterministic repeated-run tests are mandatory.

## 14. Change Control
1. Patch changes may add new effect types or fields only if additive and backward-compatible.
2. Minor changes may alter balancing weights and params without schema break.
3. Major changes require version bump when field semantics or processing order changes.
4. Contract updates must include docs update, migration strategy, and compatibility verification.

