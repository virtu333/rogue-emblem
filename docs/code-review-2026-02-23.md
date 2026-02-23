# Codebase Review — February 23, 2026

**Scope:** Full codebase sweep across 8 subsystems (Combat/Skills, BattleScene/Turns, Save/Load/Cloud, UI/Overlays, Economy/Loot, Map/Grid, Scenes/Routing, Data/Units). Each agent read all source + data + test files in its domain.

**Totals:** ~155 raw findings across 8 agents, deduplicated and merged below into **68 unique issues**.

---

## CRITICAL (1)

### C1. `this.endPlayerPhase()` calls non-existent method
- **File:** `src/scenes/BattleScene.js:9854`
- **Source:** BattleScene agent
- **Description:** When all player units are sleeping and auto-advance triggers, it calls `this.endPlayerPhase()` which does not exist on BattleScene. Should be `this.turnManager.endPlayerPhase()`. This is a runtime TypeError crash.
- **Trigger:** All player units have sleep status simultaneously (multiple enemy Sleep Staff users).
- **Fix:** Change `this.endPlayerPhase()` to `this.turnManager.endPlayerPhase()`.

---

## HIGH (6)

### H1. Double `settleEndRunRewards` on victory — potential double currency
- **File:** `src/scenes/NodeMapScene.js:3283` + `src/scenes/RunCompleteScene.js:80`
- **Source:** Scenes agent
- **Description:** On victory, `settleEndRunRewards(meta, 'victory')` is called first in NodeMapScene.checkActComplete(), then again in RunCompleteScene.create(). If not idempotent, players get double meta currency.
- **Fix:** Verify RunManager has a `_settled` guard. If not, remove the NodeMapScene call and let RunCompleteScene handle it exclusively.

### H2. Silent localStorage failures — invisible data loss
- **Files:** `src/engine/RunManager.js:3360`, `src/engine/MetaProgressionManager.js:658`, `src/engine/SlotManager.js:37/49/93/113`
- **Source:** Save/Load agent
- **Description:** Every `localStorage.setItem()` is wrapped in try/catch that silently swallows quota-exceeded errors. The player sees no indication that saving failed. Run data and meta progression can be silently lost.
- **Fix:** Return success/failure boolean from save operations. Show user-visible warning on failure for critical saves.

### H3. `onSave` callback fires even when localStorage write fails
- **Files:** `src/engine/RunManager.js:3358-3363`, `src/engine/MetaProgressionManager.js:656-662`
- **Source:** Save/Load agent
- **Description:** The cloud push callback (`onSave`) executes unconditionally, even if the preceding `localStorage.setItem` threw. Cloud receives newer data while local stays stale, creating desync.
- **Fix:** Move `onSave()` inside the try block, after successful `localStorage.setItem`.

### H4. Grid A* pathfinding ignores Ice terrain sliding
- **File:** `src/engine/Grid.js:545-605`
- **Source:** Map agent
- **Description:** `findPath` (A*) treats Ice tiles as normal terrain with cost 1, while `getMovementRange` (Dijkstra) properly handles ice slides. AI enemies use `findPath`, so on Act 4 tundra maps they navigate ice incorrectly — walking normally instead of sliding, producing invalid movement paths.
- **Fix:** Add ice slide handling to `findPath`, or have AI use `getMovementRange` + `reconstructIcePath` on ice maps.

### H5. Haste affix MOV bonus incorrectly added to combat SPD
- **File:** `src/engine/SkillSystem.js:216`
- **Source:** Combat agent
- **Description:** `mods.spdBonus += affixMods.movBonus || 0` maps the Haste affix's movement range bonus to combat Attack Speed. Enemies with Haste get +2 effective SPD in combat (easier to double attack), which is unintended — MOV and AS are distinct stats.
- **Fix:** Remove the line. MOV bonuses should only apply in movement-range calculations, not combat speed.

### H6. No TurnManager unit tests
- **File:** `src/engine/TurnManager.js` (no test file exists)
- **Source:** BattleScene agent
- **Description:** TurnManager manages phase transitions, victory/defeat detection, and turn counting. Zero dedicated tests. Its `_checkBattleEnd` only checks `playerUnits.length === 0` for defeat, missing the Edric-specific check (if Edric dies but others survive, game should end). This discrepancy would be caught immediately by tests.
- **Fix:** Create `tests/TurnManager.test.js` covering phase flow, victory/defeat conditions, and the Edric check.

---

## MEDIUM (28)

### Bugs

**M1. `removeUnitGraphic` doesn't null references after destroy**
`src/scenes/BattleScene.js:3016-3032` — `unit.graphic`, `unit.label`, `unit.hpBar` remain as truthy destroyed Phaser objects. Code checking `if (unit.graphic)` will find a truthy but dead object. Fix: null all three after destroying.

**M2. On-death AoE cascade can corrupt faction arrays**
`src/scenes/BattleScene.js:9769-9801` — Recursive `removeUnit` calls from AoE affixes can mutate arrays mid-iteration and trigger multiple `checkBattleEnd` calls. Fix: Queue deaths rather than processing recursively.

**M3. `processTurnStartEffects` race condition**
`src/scenes/BattleScene.js:9893-9895` — Turn-start effects run after 1200ms delay but player input is already enabled. Player can move units before Renewal heals apply. Fix: Block input during effect processing or apply effects immediately with delayed visuals only.

**M4. Duplicate battle-end check logic**
`src/engine/TurnManager.js:70-82` vs `src/scenes/BattleScene.js:10564-10583` — TurnManager only checks `playerUnits.length === 0` for defeat; BattleScene checks for Edric specifically. TurnManager also lacks the reinforcement-pending guard for rout victory. Fix: Consolidate into BattleScene's version and have TurnManager delegate.

**M5. AffixSystem aura loop missing `isLivingOnMap` check**
`src/engine/AffixSystem.js:52-65` — Unlike SkillSystem (which uses `isLivingOnMap`), affixes don't check if aura-providing allies are alive/on-map. Dead enemies could provide aura buffs. Fix: Add `ally.currentHP <= 0` guard.

**M6. `serializeUnit` shallow-copies stats but not inventory/skills arrays**
`src/engine/RunManager.js:184-216` — After serialization, mutations to the original unit's `inventory`, `skills`, `consumables` arrays also mutate the serialized roster data. Fix: Clone arrays: `data.inventory = [...unit.inventory]`, etc.

**M7. `saveRun` active slot fallback could write to wrong slot**
`src/engine/RunManager.js:3346-3364` — Falls back to `getActiveSlot()` if slot not provided. Stale `ACTIVE_SLOT_KEY` could silently overwrite another slot's data. Fix: Make `slotNumber` required.

**M8. `migrateOldSaves` overwrites slot 1 without checking existing data**
`src/engine/SlotManager.js:122-143` — If old-format keys exist AND slot 1 already has data, migration unconditionally overwrites. Fix: Check if slot 1 already has data before migrating.

**M9. `MetaProgressionManager` default storage key targets legacy key**
`src/engine/MetaProgressionManager.js:55` — Default `storageKey` is the old pre-slot key. Any construction without passing the correct slot key reads/writes to the wrong location. Fix: Make `storageKey` required.

**M10. Biased shuffle in BossRecruitSystem**
`src/engine/BossRecruitSystem.js:316` — `sort(() => Math.random() - 0.5)` is a well-known biased shuffle. Some recruit candidates appear more often than others. Fix: Replace with Fisher-Yates shuffle.

**M11. `villageAmbushChance` defaults mismatch**
`src/engine/DifficultyEngine.js:52` vs `data/difficulty.json:23` — Defaults have 0, normal mode has 0.10. New difficulty modes would incorrectly default to no ambushes. Normal mode's modifier summary misleadingly shows "10% village ambush chance" as if it's a penalty. Fix: Align defaults to 0.1.

**M12. Paladin missing `growthBonuses` field**
`data/classes.json:505-523` — Only recruit-accessible promoted class without growth bonuses. Paladins get no growth advantage from promotion (unlike Dark Knight which gets `{MAG: 10}`). Fix: Add appropriate `growthBonuses` (e.g., `{"RES": 5}`).

### Inconsistencies

**M13. Luna skill description doesn't match implementation**
`data/skills.json:57` vs `src/engine/SkillSystem.js:486` — Description says "halve enemy DEF/RES" but code does `normalDamage * 1.5`. Fix: Update description to "1.5x damage on hit".

**M14. `lootQualityShift` declared and validated but never consumed**
`src/engine/DifficultyEngine.js:20,48` + `data/difficulty.json` — Present in required keys, defaults, and all modes (all set to 0), but no code reads it. Fix: Wire it into `generateLootChoices` or remove.

### Missing Edge Cases

**M15. Missing `isTransitioning` guard in DifficultySelectScene**
`src/scenes/DifficultySelectScene.js:92-121` — Both `_confirm()` and `_back()` use fire-and-forget transitions with no double-press guard. Every other scene has this. Fix: Add `isTransitioning` flag.

**M16. Missing `isTransitioning` guard in BlessingSelectScene**
`src/scenes/BlessingSelectScene.js:84-125` — Same issue as M15. Fix: Add flag.

**M17. HomeBaseScene `requestCancel` bypasses `runTransition` guard**
`src/scenes/HomeBaseScene.js:1761-1770` — ESC exit calls `transitionToScene` directly instead of going through `runTransition()` which gates with `isTransitioning`. Fix: Route through `runTransition()`.

**M18. No username validation in `signUp`/`signIn`**
`src/cloud/supabaseClient.js:12-29` — No length, character, or empty-string validation. Relies entirely on Supabase server-side validation. Fix: Add basic client-side validation.

**M19. `supabaseClient.js` doesn't guard null in `signUp`/`signIn`**
`src/cloud/supabaseClient.js:12-29` — `signOut` and `getSession` check for null `supabase`, but `signUp`/`signIn` don't. Calling them in offline mode throws TypeError. Fix: Add null guard.

### Test Gaps

**M20. No SlotManager tests**
Functions like `migrateOldSaves()`, `deleteSlot()`, `getSlotSummary()`, `getNextAvailableSlot()` lack dedicated tests.

**M21. No serialization roundtrip fidelity test**
No test verifies `save -> load -> save` produces identical data.

**M22. No loot table weapon name validation test**
Typos in weapon names in `lootTables.json` would silently prevent drops. No test cross-references against `weapons.json`.

**M23. No enemy/recruit class name validation tests**
No comprehensive test checks every class name in `enemies.json` pools and `recruits.json` classPool against `classes.json`.

**M24. No blessing + difficulty modifier stacking test**
Both engines tested individually but no integration test for combined effects.

**M25. No SceneGuard.js tests**
640 lines of instrumentation code with monkey-patching, zero test coverage.

**M26. No Grid A* pathfinding unit tests**
A* is only tested indirectly through headless battle harness. No direct tests for obstacles, move types, unreachable goals.

**M27. No Grid Dijkstra/fog/bridge dedicated tests**
`getMovementRange`, fog of war edge cases, and bridge enforcement lack isolated tests.

**M28. No DialogueOverlay/LevelUpPopup tests**
DialogueOverlay has complex async/keyboard logic. LevelUpPopup has extended level display logic. Neither tested.

---

## LOW (33)

### Bugs / Dead Code

**L1.** `Combat.js:767` — Dead `combatSkillState` in `getCombatForecast`, never referenced.
**L2.** `LootSystem.js:825` — `rollsForCategory` parameter in `applyFinalBossWeaponBonus` is unused.
**L3.** `LootSystem.js:145` — `weightedRandom` `<=` comparison gives micro-bias to first entry.
**L4.** `RunManager.js:3234-3246` — `applyDifficultySelection` in `fromJSON` sets modifiers immediately overwritten.
**L5.** `RunManager.js:2783` — `version: 1` written in `toJSON()` but never read in `fromJSON()`.
**L6.** `LevelUpPopup.js:54-56` — `lines` array built but never used.
**L7.** `BattleScene.js:9803` — `unit._removing = false` reset at end of `removeUnit` serves no purpose.
**L8.** `CloudSync.js:67` — `migrateCloudData` uses numeric key `1` instead of string `"1"`.

### Inconsistencies

**L9.** `SkillSystem.js:49-57` — `applyAuraEffects` handles 6 bonus types but drops `spdBonus`. No current aura uses it, but latent gap.
**L10.** `Combat.js:816-831` — Forecast affix warnings use hardcoded string IDs instead of data-driven lookup.
**L11.** `Combat.js:257` — `getConditionalWeaponBonuses` only handles "if no adjacent allies" but name suggests general purpose.
**L12.** CLAUDE.md says "Venin Edge" but weapon is "Venin Blade"; says Goddess Icon +5 LCK (actual: +8); says Delphi Shield +3/+3 (actual: +1/+1).
**L13.** `NodeMapScene.js:2200-2202` — Shop tab objects double-pushed to both `shopTabObjects` and `shopOverlay`, causing double-destroy.
**L14.** `TurnBonusCalculator.js:47` — Hardcoded 0.8 multiplier should be in `turnBonus.json`.
**L15.** `lootTables.json` uses `"accessories"` (plural) while code tries `accessory` first.
**L16.** HomeBaseScene + NodeMapScene duplicate 5 lifecycle functions instead of sharing a module.
**L17.** `CloudSync.js:472-488` — `shouldPreferLocalMeta` uses `>` while `shouldPreferLocalRun` uses `>=` (intentional but underdocumented).
**L18.** `referenceViewer.json` weapon counts may be stale.
**L19.** Lord base classes use string `promotesTo` while recruitable classes use arrays (handled in code, but inconsistent schema).

### Edge Cases

**L20.** `ForgeSystem.js:76` — `getStatForgeCount` returns float on corrupted data. Wrap in `Math.round()`.
**L21.** `TurnBonusCalculator.js:71` — `normalizeMultiplier` clamps to [0,1], preventing any future buff multipliers >1.
**L22.** `LootSystem.js:879` — Unknown actId silently falls back to act3 loot with no warning.
**L23.** `MapGenerator.js:1656` — `makeUniqueRecruitName` has unbounded `while(true)` loop.
**L24.** `BlessingEngine.js:242` — Empty costPool makes a blessing free (no costs).
**L25.** `MapGenerator.js:211` — `ensureReachability` runs before `ensureBridges`, causing extra terrain carving.
**L26.** `NodeMapGenerator.js:161-184` — RECRUIT conversion keeps original (possibly seize) templateId.
**L27.** `NodeMapGenerator.js:187-207` — Colosseum conversion doesn't clear stale `templateId`/`fogEnabled`.
**L28.** `enemies.json` missing tile count entries for 234 and 260.
**L29.** Chevalier RES growth range "18-20" abnormally narrow (2 pts vs normal 10-15).
**L30.** `BattleScene.js:526-528` — Deploy uses name-based identity; duplicate names would break selection.
**L31.** `TurnManager.js:65-68` — Sleeping units count as "available", preventing auto-phase-end.
**L32.** `CloudSync.js:43-48` — `withTimeout` leaks timer on success (minor, 2-second lifetime).
**L33.** `TitleScene.js:982-985` — `update()` calls `_refreshCloudSyncStatusNotice()` every frame.

---

## Summary

| Severity | Count | Action |
|----------|-------|--------|
| Critical | 1 | Fix immediately |
| High | 6 | Fix this sprint |
| Medium | 28 | Fix soon / next sprint |
| Low | 33 | Fix when convenient |
| **Total** | **68** | |

### Top 10 Most Impactful Fixes

1. **C1** — `endPlayerPhase()` crash on all-sleep (1-line fix)
2. **H1** — Double victory rewards (verify idempotency or remove duplicate call)
3. **H2+H3** — Silent save failures + cloud desync (move `onSave` inside try, add user warning)
4. **H4** — AI pathfinding ignores ice (affects Act 4 tundra gameplay)
5. **H5** — Haste gives unintended combat speed (remove 1 line)
6. **M10** — Biased recruit shuffle (replace with Fisher-Yates)
7. **M15+M16** — Missing transition guards (add flag to 2 scenes)
8. **M6** — Shallow clone in serializeUnit (potential roster corruption)
9. **M4** — Consolidated battle-end checks (prevent missed defeat detection)
10. **M13** — Luna description mismatch (player-facing misinformation)
