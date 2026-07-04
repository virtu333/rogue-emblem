# Class Mastery + Traits & Merchant Caravan — Implementation Spec (2026-07-03)

Two features from the committed "next quarter" roadmap (docs/NextStepsPlanFeb182026.md). Ships as **two PRs**:

- **PR 1 — Class Mastery + Trait System** (one PR, two commits ok): they were explicitly planned to ship together because the cross-system interaction (traits affecting mastery) is what makes both worth their cost.
- **PR 2 — Merchant Caravan** (independent, can be built in parallel off main).

User design decisions (locked 2026-07-03):
1. Mastery bonus = **class-flavored perk** (data-driven per class family, permanent combat-mod perk).
2. Traits = **recruits only** (random recruits, boss recruits, colosseum mercs — NOT lords), 1–2 traits each, mix of stat and behavioral.
3. Mastery pace = **~8 battles** fought in the class.
4. Caravan = **BATTLE/ELITE nodes act2+ only**, reward shop draws from the act's **rare pool + forge-quality weapons** at normal prices, 3–4 items.

## Repo ground rules (do not skip)

- All engine logic in pure modules (no Phaser). New data files go in `data/` AND `public/data/` (`npm run sync-data`).
- Never mutate shared data-array refs — `structuredClone()` items on add.
- **Skill/trait/mastery modifiers are NOT baked into `unit.stats`** at combat time — computed via SkillSystem. (Trait *creation-time* stat mods are the deliberate exception; see below.)
- BattleScene: never add multi-step flows inline — extract a controller (`create(scene)`/`destroy()`).
- CI gates before PR: full suite (`npm test` — if `.bin` shims are missing use `node node_modules/vitest/vitest.mjs run`), `npm run check:reference`, `npm run check:data-parity`, `npm run sim:fullrun:harness:pr`.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; PR bodies end with the standard Claude Code attribution. Run a security/PII scan on staged diffs before every commit.
- UI: 640×480 base, `uiDepths.js` constants, test max-length strings (9px 'Press Start 2P' ≈ 8px/char).

## Verified architecture (file:line evidence, checked 2026-07-03 @ main c37e0cb + PR #52)

- **Unit creation:** `createUnit` (src/engine/UnitManager.js:237) builds the unit object; `createRecruitUnit` (UnitManager.js:504) is the **single chokepoint** for every roster-joining non-lord unit: RunManager.js:2346 (recruit flow), BossRecruitSystem.js:523/568, ColosseumEngine.js:325/344, BattleScene.js:1287/1320/1345/1361 (recruit-battle NPCs).
- **Serialization:** `serializeUnit` (src/engine/RunManager.js:226) does `{...unit}` — **new plain-data fields (`classBattles`, `traits`) persist automatically**. Phaser fields nulled via PHASER_FIELDS; battle-scoped `_battle*` fields deleted. Do NOT prefix persistent fields with `_battle`.
- **Promotion:** `promoteUnit` (UnitManager.js:998) mutates the unit in place — custom fields survive; `className`/`tier` change. Reclass exists too (UnitManager.js:1057+) and changes class family.
- **Battle completion:** PostCombatController.js:62-94 — deployed survivors are `[...scene.playerUnits, ...(scene.escapedUnits||[])]` (live units, serialized at :67), non-deployed appended at :70, then `runManager.completeBattle(allUnits, ...)` (:79; RunManager.js:2767). Increment mastery counters **on the live deployed-survivor units before `serializeUnit`** in PostCombatController — non-deployed units must NOT gain progress.
- **Combat-time mods:** `getSkillCombatMods(unit, opponent, allAllies, allEnemies, skillsData, terrain, isInitiating, affixData)` (src/engine/SkillSystem.js:171) returns flat `{hitBonus, avoidBonus, critBonus, atkBonus, defBonus, resBonus, spdBonus, ...}`; affix mods merge at :209-220. **Gotcha:** must not early-return for empty unitSkills. Mastery/trait combat mods merge here so forecast + battle stay in sync automatically.
- **Enemy AI targeting:** NPCs are already valid enemy targets (`attackableUnits = [...playerUnits, ...npcUnits]`, AIController.js:350); scoring in `_scoreAttackTarget` (AIController.js:848) — caravan priority is a score bonus keyed on a unit flag, mirroring the existing `aggressiveMode` bonuses (:857-863).
- **NPC spawn:** `battleConfig.npcSpawn` consumed at BattleScene.js:1168+, units pushed to `scene.npcUnits`; BattleSuspendController.js:106/145 already serializes/restores `npcUnits` (suspend/resume safety comes free if the caravan is a normal npcUnit).
- **Shop generation:** `generateShopInventory(actId, lootTables, allWeapons, consumables, allAccessories, roster, weaponArtSpawnConfig, generateOptions)` (src/engine/LootSystem.js:988) with `generateOptions.itemCountRange`; rare pool handling near LootSystem.js:684. Ruins shop variant precedent: ShopController (`applyRuinsMarkup`, ruins flags on NodeMapScene:226/1893).
- **Meta effects:** `getActiveEffects` (src/engine/MetaProgressionManager.js:608) — add a key to the effects object + a handler for the new upgrade's `effect` type in the loop at :645+.
- **Harness parity:** tests/harness/HeadlessBattle.js duplicates some BattleScene spawn logic (known ticket) — if the caravan or mastery increments affect harness sims, mirror minimally and note it.

---

## PR 1 — Class Mastery + Trait System

### 1a. Class Mastery

**Model.** Units track battles fought per class: `unit.classBattles = { [className]: count }` (default absent → treat as `{}`). A unit is **mastered** when its progress in the *current class family* ≥ threshold.

- New pure module `src/engine/MasterySystem.js`:
  - `recordBattleParticipation(unit)` — increment `unit.classBattles[unit.className]`.
  - `getMasteryProgress(unit, classesData)` — sum of `classBattles[currentClass]` + `classBattles[baseClassOfCurrentClass]` (promoted classes credit battles fought pre-promotion in their base class; resolve base↔promoted mapping from classes.json promotion relationships — build a reverse map once). Reclass naturally resets progress (different family) — that's intended.
  - `isMastered(unit, classesData, traitsData?)` — progress ≥ effective threshold (threshold 8, minus trait adjustment, min 4).
  - `getMasteryPerk(unit, classesData)` — the perk object for the unit's class family, or null.
- **Threshold:** `MASTERY_BATTLES = 8` in src/utils/constants.js.
- **Perk data:** add `masteryPerk` to each **base-class** entry in data/classes.json (promoted classes inherit from their base; lord classes get their own). Shape: `{ "name": "…", "mods": { critBonus?: n, hitBonus?: n, avoidBonus?: n, atkBonus?: n, defBonus?: n, resBonus?: n, spdBonus?: n } }` — **only** the seven flat combat-mod fields `getSkillCombatMods` already returns; no new mechanics. Keep magnitudes small (crit +8-10, single stats +2, paired stats +1/+1). Flavor examples: Myrmidon line `Duelist's Edge` +10 crit; Knight line `Bulwark` +2 def; Cleric line `Devotion` +2 res +5 avoid; Archer line `Deadeye` +10 hit +5 crit; Cavalier line `Wayfarer` +1 atk +1 spd. Author all ~21 base families + the 7 lord class lines; keep names ≤ 16 chars (UI budget). Edit data JSON surgically (never parse→re-stringify whole file), then `npm run sync-data`.
- **Increment hook:** PostCombatController.js victory path, on each live unit in `scene.playerUnits` + `scene.escapedUnits` **before** the `serializeUnit` map (around :67). Escape-objective escaped units count; fallen and non-deployed don't. Detect newly-mastered units (compare isMastered before/after) and stash e.g. `scene._newlyMasteredNames` for the notice below.
- **Combat wiring:** in `getSkillCombatMods` (SkillSystem.js:171), after affix mods: if unit is mastered, merge perk mods and push `{id:'mastery', name: perk.name}` to `mods.activated` (shows in the existing skill-proc UI). Needs `classesData` — thread it the same way `affixData` was added (optional trailing param through Combat.js call sites + forecast; grep every `getSkillCombatMods(` call site and update).
- **UI:**
  - UnitDetailOverlay: one line — `Mastery: 5/8` (in-progress) or the perk name + mods when mastered. Test longest perk name.
  - Post-battle notice for newly mastered units: reuse the existing dropped-skills/level-up notice pattern (a queued toast/hint in the loot flow), no new overlay.
  - RosterOverlay: `★` marker next to class name when mastered (1 char, no layout risk).
- **Help:** short entry in src/data/helpContent.js (Skills or a Units tab).

### 1b. Trait System

**Model.** `unit.traits = ['trait_id', ...]` (0–2 entries). Rolled once at creation for roster-joining non-lord units. Lords never roll traits.

- **New data file `data/traits.json`** (+ public mirror): ~14 traits, shape:
  ```json
  { "id": "steady", "name": "Steady", "description": "+1 DEF, +5 growth HP",
    "creationMods": { "stats": { "DEF": 1 }, "growths": { "HP": 5 } },
    "combatMods": { "avoidBonus": 5, "condition": "below50" },
    "xpMultiplier": 1.1, "masteryBattlesDelta": -2, "masteryPerkOverride": { "atkBonus": 2, "defBonus": -1 } }
  ```
  All fields optional. Conditions restricted to ones SkillSystem/accessories already evaluate (`below50`, `above75`, `no_ally_within_2`, `on_forest`). Author a mix: ~6 pure stat/growth traits (small: ±1 stat, ±5-10 growth), ~4 conditional combat traits, ~4 behavioral. **Required cross-system traits:** `Studious` (masteryBattlesDelta −2), `Lazy` (+1 to two stats but masteryBattlesDelta +2), `Reckless` (masteryPerkOverride: when mastered, perk becomes +2 atk / −1 def in addition to nothing else — i.e. replaces the class perk), `Quick Study` (xpMultiplier 1.15). Balance: no trait strictly better than another; tradeoff traits allowed.
- **Roll site:** inside `createRecruitUnit` (UnitManager.js:504) — new `options.traitsData` + `options.rng`; roll count (50% one, 35% two, 15% none — tune freely but document), pick without replacement, **apply `creationMods` immediately** (stats + currentHP for HP, growths) — creation-time baking is correct here (same philosophy as rolled growths; serialization-safe, no combat-time plumbing for flat mods). Thread `traitsData`+rng through all five call-site families (RunManager.js:2346, BossRecruitSystem.js:523/568, ColosseumEngine.js:325/344, BattleScene.js recruit NPCs :1287-1361). Use each site's existing seeded rng where one exists (determinism: sim/harness use Mulberry32); `Math.random` fallback only where the site already uses it.
- **Combat wiring:** in `getSkillCombatMods`, merge trait `combatMods` (condition-checked) — thread `traitsData` alongside `classesData` (one combined optional context param `{classesData, traitsData}` is acceptable to avoid a 10-arg function; keep backward-compatible defaults so existing tests pass unmodified where possible).
- **XP wiring:** apply `xpMultiplier` at the XP-award site (find `awardXP`/xp gain in UnitManager or BattleScene; single multiply, floor).
- **Mastery interaction:** `isMastered` reads `masteryBattlesDelta`; `getMasteryPerk` respects `masteryPerkOverride`.
- **UI:**
  - **Recruit choice surfaces must show traits** (the player decides with this info): recruit card in the recruit-battle flow, BossRecruitOverlay candidate cards, Colosseum merc card. Short form: trait names, comma-joined; test 2 longest names.
  - UnitDetailOverlay: `Traits: Steady, Reckless` + description lines (wrap; budget like the lore lines added in PR #43).
- **Compendium:** optional; skip unless trivial (a Traits list could ride the existing tab framework — if the row-table invariant (navY=422 clearance, exported PER_PAGE_BY_KEY) can't be met cheaply, leave it out and note as follow-up).

### PR 1 tests

- MasterySystem unit tests: increment, base+promoted continuity across `promoteUnit`, reclass reset, threshold with Studious/Lazy deltas, perk lookup incl. Reckless override.
- Serialization round-trip: `classBattles` + `traits` survive serializeUnit → deserialize (existing round-trip test pattern in RunManager tests).
- createRecruitUnit trait rolls: deterministic with seeded rng; lords never get traits; creationMods applied exactly once (re-serialization doesn't reapply).
- getSkillCombatMods: mastered perk merges; trait conditional mods respect conditions; empty-skills unit still gets mastery/trait mods (regression on the known early-return gotcha).
- Data contract test: every base class + lord class has `masteryPerk` with only whitelisted mod keys; traits.json schema validation (whitelist fields/conditions); `check:data-parity` covers the public mirror.
- Sim/harness: run `sim:fullrun:harness:pr` — if mastery mods shift balance beyond tolerance, reduce perk magnitudes rather than touching sim baselines.

---

## PR 2 — Merchant Caravan

**Concept.** Rare escort micro-objective on ordinary battles: a green merchant NPC spawns near the enemy side, walks 1 tile/turn toward the nearest map edge, enemies prioritize killing it. If it's alive (or exited) when you win, a 3–4 item rare shop opens after the battle. If it dies: nothing (no other penalty).

- **Spawn roll:** in the battle-config path used by BATTLE/ELITE nodes for act2+ (exclude recruit battles — they already have an NPC — plus boss/escape/colosseum/ambush/tutorial). Base chance `CARAVAN_SPAWN_CHANCE = 0.15` (constants.js) + meta bonus. Roll where the node's battleConfig is generated so the result lands in `battleConfig.caravanSpawn = { col, row }` (spawn tile: edge-adjacent open tile on the enemy half; validate passable + unoccupied like npcSpawn placement). Being part of battleConfig makes suspend/resume and revert deterministic-safe.
- **Unit:** create via a small helper (engine, not BattleScene inline): name "Merchant", `isCaravan: true`, faction npc/green, MOV 1, unarmed (`weapon: null`), modest HP scaled by act (e.g. 18 + 4/act), no XP value. Push to `scene.npcUnits` (BattleScene.js:1168 area — mirror the npcSpawn block; suspend serialization at BattleSuspendController.js:106 covers npcUnits already — **verify `isCaravan` survives its serializeSuspendUnit**).
- **Movement:** 1 tile/turn toward the nearest map edge, at the start of enemy phase (before enemy actions, so enemies can react). Straight-line greedy step via Grid passability (no full pathing needed; skip the step if blocked). When it reaches an edge tile, it **exits**: remove from map, set `scene._caravanExited = true` (counts as survived). Implement as a small `CaravanController` (ui/ or engine helper called from BattleScene turn hooks) — do NOT inline a multi-step flow in BattleScene.
- **Enemy priority:** in `_scoreAttackTarget` (AIController.js:848): `if (target.isCaravan) score += 40;`. Also make guard-type enemies NOT break guard for it (guards use trigger ranges — leave their logic alone; the score bonus only affects active enemies).
- **Survival + reward:** on victory (PostCombatController victory path), survived = caravan alive in `scene.npcUnits` OR `_caravanExited`. Set `runManager.pendingCaravanShop = { actId }` (serialize with run state) — then NodeMapScene, on entry with the flag set, opens the shop overlay with caravan stock and clears the flag (mirrors existing pending-state patterns like `pendingAmbushNodeId`, RunManager.js:2822). Reuse ShopController with a `caravan` variant: inventory from a new `generateCaravanInventory(actId, …)` in LootSystem — 3–4 items biased to the act's rare pool + forge-quality weapons, normal prices, no reroll, no Forge tab (follow the ruins-variant precedent: NodeMapScene:1893 `applyRuinsMarkup`, ShopController ruins flags — but no markup).
- **Meta upgrade:** 2-tier upgrade in data/metaUpgrades.json (e.g. "Trade Contacts", Supply): +7%/+15% caravan chance (cumulative display per existing convention — level 2 shows total). New `caravanChanceBonus` key in `getActiveEffects` (MetaProgressionManager.js:608) → read where the spawn roll happens (RunManager has metaEffects).
- **UX:** first-encounter hint via HintManager ("A merchant caravan is caught in the fighting — if it survives, it will trade with you.") gated by `shouldShow`; caravan gets a distinct label/tint (gold?) so it doesn't read as a recruit NPC; a small "Caravan escaped!"/"Caravan destroyed" toast on exit/death.

### PR 2 tests

- Spawn-roll gating: act1 never, excluded node types never, chance honors meta bonus (seeded rng).
- Movement: steps toward nearest edge, blocked-tile skip, exit removal sets the survived flag.
- AI: enemy prefers caravan over equal-score player target; guards unaffected.
- Reward: pendingCaravanShop set only on victory+survival; cleared after opening; survives run serialization round-trip; inventory 3–4 items, rare-pool membership, act scaling.
- Suspend/resume: caravan position + exit state round-trips through BattleSuspendController.
- Fuzz/regression: existing MapGeneratorFuzz + validators stay green (caravanSpawn tile validity if added to battleConfig validation — extend validateBattleConfig whitelist so the boot gate doesn't reject the new key; see DataLoader validator whitelists from PR #46).

---

## Verification (both PRs)

1. Full suite + the three CI gates (reference check, data parity, harness PR sim).
2. Live smoke at 640×480 (`?devScene=battle&preset=battle_smoke` boots a battle in dev): PR 1 — recruit with traits visible on card + UnitDetail; mastery line renders; PR 2 — force-spawn caravan (temporarily set chance 1.0 locally, do not commit), watch movement/AI/exit, win, confirm shop on NodeMap.
3. UI checklist: max-length strings, empty states (0 traits, no mastery data on old saves), uiDepths constants, ESC handling for any new overlay states.
4. **Back-compat:** loading a pre-feature save (no `classBattles`/`traits`) must not crash — all reads default gracefully. Add an explicit test.
5. Security/PII scan on staged diffs before each commit.
