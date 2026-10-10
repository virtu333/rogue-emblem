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
5. Each blessing definition includes required fields `id`, `name`, `tier`, `description`, `boons`, and `costs`. An earned blessing (rule 15) has no `tier`.
6. `id` is a stable string key and is immutable after release.
7. `tier` is an integer in range 1 through 4.
8. `boons` is a non-empty array of effect descriptors.
9. `costs` is an array of effect descriptors and may be empty for free-tier entries.
10. Each effect descriptor includes required fields `type` and `params`.
11. `type` is a stable enum key mapped by engine handlers.
12. `params` is an object with effect-specific numeric or string fields.
13. Optional fields are `weight`, `tags`, `requires`, `excludes`, and `ui`.
14. Unknown fields are ignored in non-strict mode and rejected in strict mode.
15. `earned` (optional boolean; docs/specs/blessings-v3.md §6): `true` marks a blessing the run awards (the act boss's pick) instead of offering it at the start. An earned blessing has no `tier`, `prices`, `pact` or `intrinsicPrice`, its `costs` are empty, and its `weight` is its draw weight among the earned blessings. A non-boolean `earned`, or a tier or price on an earned blessing, is a validation error. The flag is additive: the contract version stays 3.
16. Optional top-level `earnedOffer` `{ actBoss, weightByHeld }`: how many earned cards an act boss offers (default 2), and the chance it offers any for a run already holding 0, 1, 2+ earned blessings (default `[1, 0.85, 0.7]`; one bad entry sends the whole list to its default).

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
11. `adjacent_ally_def_bonus` `{ perAlly, max }` (Phalanx Rite) and `isolated_combat_bonus` `{ radius, avoidBonus, critBonus }` (Duelist's Creed): player-unit combat bonuses on both sides of an exchange, read in `engine/BlessingCombatMods.js` from the profile's `adjacentAllyDef` / `isolated` lists (`blessingRuntimeModifiers.adjacentAllyDefBonuses` / `isolatedCombatBonuses`, saved). Phalanx Rite adds `min(max, perAlly x allies on a cardinal neighbour tile)` DEF; Duelist's Creed adds Avoid and Crit while no living ally is within `radius` tiles (Manhattan). Allies are the unit's own side (never foes or NPCs), the unit itself and the fallen excluded (`SkillSystem.countAdjacentAllies` / `hasAllyWithin`, shared with the `adjacent_ally` / `no_ally_within_2` accessory conditions). Every param is a positive integer (`avoidBonus` / `critBonus` may be omitted, not both, and `max` is at least `perAlly`); the validator refuses anything else and the handler skips it (`invalid_adjacent_ally_def_bonus_params`, `invalid_isolated_combat_bonus_params`). Both are safe to hand out in an event. Phalanx Rite ships as `{ perAlly: 2, max: 3 }` (+2 with one neighbour, +3 with two or more). Both apply to DEF / Avoid / Crit in a combat exchange (attacker or defender) and to nothing else; the effects that ignore every DEF mod ignore them (an area or line art's blows on victims other than the primary target, rams, the ballista, Deathburst). The enemy AI's target scoring does not see blessing mods (as for every blessing), and arena bouts get no blessing.
12. The rest of the §5 starting blessings (docs/specs/blessings-v3.md §5, "As built (the rest of §5, PR D4)"): eleven boon types whose params, run state and load defaults live in `engine/ShrineBoons.js` (`shrineBoonErrors` is the one reading for the validator and the handler; a malformed boon is refused and skipped as `invalid_<type>_params`; `sanitizeShrineBoonModifiers` gives a save from before them the defaults). `act_clear_army_stats` `{ value, stats }` (Late Bloom: an act-start grant `{ kind: 'army_stats', value, stats, paidActs }`, paid from the next act on to the roster and the fallen, +value in each unit's `stats` highest growths (`stats` an integer 1-8; the unit's own growths, else its class's; ties in the order HP, STR, MAG, SKL, SPD, DEF, RES, LCK; never MOV; no randomness; a grant saved without `stats` reads as 8); the fallen gain no current HP); `under_par_gold` `{ perTurn }` (at most 500; Dawn Tithe: `underParGoldPerTurn`, paid in `prepareBattleRewards` for turns under the map's own par, never garnished); `move_type_battle_stats` `{ bonuses: [{ moveTypes, stat, value }] }` (Cavalier's Hour: `moveTypeBattleStats`, uid-keyed `battleParams.battleDebuffs` at a fresh start); `staff_uses_bonus` `{ value }` (at most 3; Saint's Reserve: `staffUsesBonus`, read only through `StaffBlessings.staffRunOptions`, player units); `carrier_luck` `{ carryMultiplier, stealIgnoresSpeed }` (Cutpurse's Luck: `carryMultiplier` → `battleParams.carryPasses`, `stealIgnoresSpeed` → Steal's `ignoreSpeed` for a player thief); `recruit_alternate` `{ value: 1 }` (Open Roll: `recruitAlternates`; `node.recruitAlternate`, swapped by `RunManager.swapRecruitCandidate` until the encounter is locked); `boss_battle_vision` `{ value }` (at most 3; Watcher's Grace: `bossBattleVision`; `battleInProgress.bossVisionGranted`, taken back unspent at the victory, and given back when the battle's flag is dropped before its first checkpoint); `par_turn_delta` `{ value }` (at most 5; Patient Dawn: `parTurnDelta` → `battleParams.blessingParTurns`, added last by `calculatePar`); `church_extra_vows` `{ value }` (Twin Chapel: `extraChurchVows`; a church's saved vow is a string, or the list of distinct vows); `eclipse_omen` `{ foretell, spare }` (Omen Reader: `eclipseForetell`, `eclipseSpareTypes`); `next_act_loot_card` `{ count }` (Lottery Loot: `nextActLootCards`; `draw.lotteryActId` / `lotteryCards` / `lotteryKey` on the reward record). Every random draw a boon makes is on its own keyed stream (`recruit-preview-alt:`, `enemy-carry#n`, `lottery-loot:`), never the node-map, battle, loot or recruit stream. All eleven are safe to hand out in an event; Lone Banner (`deploy_cap_delta` + `xp_multiplier_delta` behind an `intrinsicPrice`) never is. The capped totals are the same on take and on load. Known limitation: a build from before these types drops a Late Bloom grant and a church's list of vows when it loads and re-saves a newer save (spec §5, "Known limitation").

## 4. Selection Rules
1. Run start presents 3 to 4 blessing options.
2. At least one tier-1 option must be present: slot 1 is always a free tier I.
2a. An earned blessing is never offered at the start, by a church or by an event (`BlessingEngine.isEarnedBlessing`); `RunManager.addBlessingMidRun(id, { earned: true })` is its only way in, called by `engine/EarnedBlessings.js` when a pick is taken.
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
5a. Run save payload carries `earnedBlessingPicks`: the earned-pick ledger, one entry per act (`{ version, source, actId, nodeId, offered, status: 'owed' | 'taken' | 'skipped' | 'none', chosen }`). A save without it loads as `{}`; `sanitizeEarnedBlessingPicks` drops malformed entries, acts the run does not have and offered ids the catalog no longer has as earned (an owed pick left with none becomes `none`). Taking a pick records an `earned_pick` event in `blessingHistory`.
6. Unknown blessing IDs in loaded saves must be preserved as inert entries and logged.
7. Run save payload carries `blessingBoonRevision` (an integer, `BLESSING_BOON_REVISION` in
   `src/engine/BlessingBoonMigration.js`). A run saved at an older revision (or none) holds
   its blessings' effects in the OLD form inside `blessingRuntimeModifiers`; see section 8.

## 8. Save Migration Rules
1. Migration is executed during `RunManager.fromJSON` before any blessing-dependent relink or runtime restoration steps. The one exception is the blessing boon migration (rule 6), which runs LAST in `fromJSON` (also before the early return for a rejected battle checkpoint), because it reads the finished map, Eclipse and roster; its ordering is stated there.
2. Saves without blessing fields are migrated by adding defaults.
3. Saves with legacy blessing key names are normalized to contract keys.
4. Migration must be idempotent.
5. Migration must not alter deterministic seed state.
6. Blessing boon revisions: handlers never re-run on load, so a boon whose effect changed
   is converted in the saved runtime modifiers instead. `RunManager.fromJSON` runs
   `migrateHeldBlessingBoons` once for a save below `BLESSING_BOON_REVISION`, as the LAST
   step of the load (every other step has settled the map, the Eclipse and the roster; a
   rejected battle checkpoint is migrated before its early return), reading the loaded
   `activeBlessings` and `blessingHistory`: the old handlers' records say exactly what they
   added (positive `appliedValue` for a boon, negative for a price; the figures changed over
   the game's life, so a rule falls back to its frozen constant only for a blessing with no
   records at all). Pilgrim Coin also stamps its extra shop on the current map, ahead of the
   party, because the blessing is taken away at once. It then stamps the current
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

