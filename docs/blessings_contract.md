# Blessings Contract

## 1. Purpose
1. This document freezes the Wave 6 Blessings contract.
2. This contract applies to data schema, runtime application order, save schema additions, replay metadata, and compatibility rules.
3. Any breaking change to this contract requires a contract version bump and migration plan.

## 2. Contract Version
1. Contract name is `blessings`.
2. Contract version is `3` (`BlessingEngine.BLESSINGS_CONTRACT_VERSION`). Version `2` configs (rolled tier `costPools`) still validate and select as before, so old fixtures and saves keep working.
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

## 3.1 Prices (v3, docs/specs/blessings-v3.md §3)
1. `priceCatalog` maps a price id to `{ label, points, tags?, effects }`. `points` is the price's weight on one scale; `tags` (`gold`, `xp`, `growth`, `shop`) name what it touches.
2. A tier II or III blessing lists its candidate `prices`: each a catalog id, or an array of ids paid together. A tier IV blessing carries a fixed `pact`: an array of ids. A tier I blessing has neither.
3. `tierBands` gives each tier's `[min, max]` price points; every candidate and pact sits inside its tier's band.
4. A price never shares an effect type with its blessing's boons, and a blessing tagged `gold` never carries a price tagged `gold`.
5. A Debt price's `owed` is set for Dusk; `debtScale` (rung -> multiplier) scales it when the price is rolled, rounded to 50, and the rolled price stores the amount owed and says it in its label.
6. Price effect types: every boon effect type, plus `burden` (`{ id, ...params }`, through `Burdens.addBurden`; a `wounded` burden with `target: 'commander'` falls on the commander, its stat drawn from the run seed), `vision_delta`, `act_deploy_cap_delta` (`{ act, value }`), `church_revive_disabled`, `eclipse_shadow_delta` and a negative `shop_price_discount`.
7. `costPools` stays for saves rolled before v3.
8. A tier II or III blessing whose own boon carries its cost (Slow Fuse's Act 1 dip, Gambler's Toss's bad tosses) names an `intrinsicPrice` `{ label, points }` in place of `prices`/`pact`. It is validated against the tier's band like any price, may not sit beside `prices` or `pact`, and is not allowed on tier I or IV. Rolling it spends one price draw (as a pact does, so no neighbouring offer moves) and stores `{ label, effects: [], kind: 'intrinsic' }`; there is no effect to apply, and a load never rolls a pool price for it. The shrine names it a **Price** (not a Cost or Pact). An intrinsic blessing is never safe for an event or a church to grant (granted later it would be a free boon).
9. Boons that carry an intrinsic price: `lord_stat_arc` `{ stats, dipAct, dip, riseAct, rise }` (the starting lords: the dip applies in `dipAct` and is given back as it ends, the rise lands as `riseAct` begins, once; HP never below 1 and other stats never below 0; the tracker `blessingRuntimeModifiers.lordStatArcs` is saved; `engine/LordStatArc.js`) and `battle_gold_gamble` `{ chance, win, lose }` (each victory's gold is multiplied by `win` with probability `chance`, else `lose`, floored, on a toss hashed from the run seed and node id, after the elite/blessing/rung multipliers and before a Debt garnishes; `blessingRuntimeModifiers.battleGoldGamble` is saved; `engine/BattleGoldGamble.js`).
10. `player_weapon_art_boon` `{ hpCostDelta, mapUsesBonus }` (Bloodless Art): `blessingRuntimeModifiers.playerArtHpCostDelta` (added to a **player** unit's art HP cost, floor 1 kept) and `playerArtMapUsesBonus` (extra per-map uses for a player unit, only for an art that has a `perMapLimit`); both saved. A missing param counts as 0, an integer is required (`hpCostDelta` ≤ 0, `mapUsesBonus` ≥ 0), and a boon that changes neither is refused by the validator and skipped by the handler (`invalid_player_weapon_art_boon_params`; `WeaponArtSystem.parsePlayerWeaponArtBoon` is the one reading). Foes never get either. This is separate from the price effect `weapon_art_hp_cost_delta`, which taxes every faction's arts. Every weapon-art call reads the run through `WeaponArtSystem.weaponArtRunOptions(run)`, never the modifiers by hand (`tests/WeaponArtBlessingBoundary.test.js`); the menus show the real limit and cost (`weaponArtUsesText` takes those options).

## 4. Selection Rules
1. Run start presents 3 to 4 blessing options.
2. At least one tier-1 option must be present: slot 1 is always a free tier I.
3. v3: each later slot draws a tier by `offerWeights` (never one already drawn), then a blessing of that tier by its `weight`; a blessing at weight 0 is never offered. v2: later slots draw from the whole pool by weight.
4. A price that would cost the run nothing (shadow with the Eclipse off, Vision with no charge, a deforge with nothing forged) is not rolled.
5. The offered run's seed is kept for its slot until the run begins, so backing out and returning shows the same offer.
6. Candidate selection uses seeded RNG path only.
7. Selection output stores stable IDs and the rolled price (`rolledCost`: `{ label, effects, kind? }`; `kind` is `pact` or `intrinsic`).

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
7. Run save payload carries `blessingBoonRevision` (an integer, `BLESSING_BOON_REVISION` in
   `src/engine/BlessingBoonMigration.js`). A run saved at an older revision (or none) holds
   its blessings' effects in the OLD form inside `blessingRuntimeModifiers`; see section 8.

## 8. Save Migration Rules
1. Migration is executed during `RunManager.fromJSON` before any blessing-dependent relink or runtime restoration steps.
2. Saves without blessing fields are migrated by adding defaults.
3. Saves with legacy blessing key names are normalized to contract keys.
4. Migration must be idempotent.
5. Migration must not alter deterministic seed state.
6. Blessing boon revisions: handlers never re-run on load, so a boon whose effect changed
   is converted in the saved runtime modifiers instead. `RunManager.fromJSON` runs
   `migrateHeldBlessingBoons` once for a save below `BLESSING_BOON_REVISION`, after
   `activeBlessings` is normalized and `blessingHistory` is loaded (it reads the old
   handlers' records to take back exactly what they added), then stamps the current
   revision. `startRun` and `startPrologue` stamp it too, so a new run is never migrated; the
   prologue is never migrated. Any held entry migrates, whether taken at the shrine, a church
   or an event. Revision 1 converts Steady Hands, Frugal Smith, Terrain Mastery, Pilgrim Coin,
   Coin of Fate and Quartermaster Cache (docs/specs/blessings-v3.md, "As built"). A new
   revision adds a rule to that module and bumps the constant; figures in a rule are frozen at
   its revision.

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

