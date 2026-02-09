# Emblem Rogue — Next Steps

Actionable implementation tracker for the next wave of development. Each wave is ~1-2 weeks of work, testable independently, and dependency-ordered.

For long-term vision and architecture notes, see **ROADMAP.md**.

Last updated: February 2026

---

## Wave Overview

| Wave | Focus | Dependencies | Key Files |
|------|-------|-------------|-----------|
| 1 | Battle Actions (Trade, Swap, Dance) | None | BattleScene.js |
| 2 | Accessories ✅ + Weapons ✅ + Forging ✅ + Stat Boosters 📋 | None | accessories.json, weapons.json, whetstones.json, ForgeSystem, UnitManager, Combat, LootSystem |
| 3 | Elite/Miniboss Nodes + Post-Act | None | constants.js, NodeMapGenerator, NodeMapScene, MapGenerator |
| 4 | Expanded Skills (partially ✅) | None | skills.json, SkillSystem, Combat, BattleScene |
| 5 | Additional Map Objectives | Wave 3 (elite maps benefit from varied objectives) | TurnManager, MapGenerator, mapTemplates.json |
| 6 | Meta-Progression Expansion | Wave 2 (accessories) + Wave 4 (skills to unlock) | metaUpgrades.json, MetaProgressionManager, HomeBaseScene. **Partial: Home Base tabbed UI + 28 upgrades done** |
| 7 | QoL & Polish | None (can interleave) | BattleScene, Grid, new UI components |

```
Wave 1 ─── independent
Wave 2 ─── independent
Wave 3 ─── independent
Wave 4 ─── independent
Wave 5 ─── after Wave 3 (elite maps can use new objectives)
Wave 6 ─── after Wave 2 + Wave 4 (meta references accessories + skills)
Wave 7 ─── independent, interleave anytime
```

---

## Wave 1: Battle Actions (Trade, Swap, Dance)

High player-impact, independent of everything else. Fills obvious gaps in the FE tactical vocabulary.

### 1A. Trade Action
Allow units to swap inventory items with adjacent allies.

- [ ] Add `findTradeTargets(unit)` — returns adjacent player units with inventory
- [ ] Add "Trade" to action menu in `showActionMenu()` when targets exist
- [ ] Build trade UI: two-column layout showing both units' inventories, click to transfer items
- [ ] Trade ends the unit's action (calls `finishUnitAction`)
- [ ] Handle edge cases: full inventory (5 items), last weapon can't be traded away

**Files:** `src/scenes/BattleScene.js`
**Test:** Manual — select unit adjacent to ally, Trade appears in menu, items transfer correctly, unit's turn ends

### 1B. Swap Action
Exchange grid positions with an adjacent ally. Simple repositioning tool.

- [ ] Add `findSwapTargets(unit)` — returns adjacent player units
- [ ] Add "Swap" to action menu when targets exist
- [ ] On select: if multiple adjacent allies, enter target selection mode; if one, swap immediately
- [ ] Swap both units' `row`/`col` and sprite positions
- [ ] Swap ends the acting unit's action; the other unit is unaffected (can still act)

**Files:** `src/scenes/BattleScene.js`
**Test:** Manual — swap positions, verify both sprites move, acting unit's turn ends, swapped unit can still move

### 1C. Dance Action (Dancer Class)
Dancer grants an adjacent already-acted ally a second turn.

- [ ] Add `findDanceTargets(unit)` — returns adjacent player units where `hasActed === true`
- [ ] Add "Dance" to action menu only when unit's class is "Dancer" and targets exist
- [ ] On select: pick target, reset target's `hasMoved`/`hasActed` to false, restore sprite (clearTint, alpha 1.0)
- [ ] Dance ends the Dancer's action
- [ ] Dancer cannot Dance themselves; cannot Dance another Dancer (prevent infinite loop)
- [ ] Play a distinct SFX for Dance

**Files:** `src/scenes/BattleScene.js`, `src/engine/TurnManager.js` (if refresh logic lives there)
**Test:** Manual — Dancer adjacent to acted unit, Dance appears, target gets fresh turn, Dancer's turn ends

### Wave 1 Acceptance Criteria
- [ ] All three actions appear in menu under correct conditions
- [ ] None appear when conditions aren't met
- [ ] No crashes when inventory is empty/full (Trade), no adjacent allies (Swap), no acted allies (Dance)
- [ ] Existing tests still pass

---

## Wave 2: Accessories ✅ + Weapons ✅ + Stat Boosters 📋

### 2A. Accessories ✅ COMPLETE

18 accessories implemented across two categories:

**Stat accessories (11):** Applied directly to `unit.stats` on equip/unequip.
- Power Ring (+2 STR), Magic Ring (+2 MAG), Speed Ring (+2 SPD), Shield Ring (+2 DEF), Barrier Ring (+2 RES), Skill Ring (+3 SKL), Goddess Icon (+5 LCK), Seraph Robe (+5 HP), Boots (+1 MOV), Delphi Shield (+3 DEF +3 RES), Veteran's Crest (+1 STR/SPD/DEF)

**Combat accessories (7):** `combatEffects` field evaluated at combat time by `Combat.js` and `SkillSystem.js`.
- Wrath Band (+15 crit below 50%), Counter Seal (prevent enemy double), Pursuit Ring (reduce double threshold by 2), Nullify Ring (negate effectiveness), Life Ring (+3 atk/+2 def above 75%), Forest Charm (+10 avoid/+2 def on forest)

In per-act loot pools (`lootTables.json` `accessories` category) and shops. Team pool in `RunManager.accessories[]`. Serialization complete.

### 2B. Weapons Expansion ✅ COMPLETE

Expanded from 32 to 51 weapons. New weapon categories:
- **Throwable (range 1-2):** Hand Axe, Javelin, Short Spear, Tomahawk, Spear
- **Effective (3x):** Armorslayer (vs Armored), Horseslayer (vs Cavalry)
- **Killer (high crit):** Killing Edge, Killer Lance (crit 30)
- **Legendary specials:** Ragnell (range 1-2, +5 DEF), Runesword (drain HP), Bolting (range 3-10 siege)
- **Poison:** Venin Edge (5 HP after combat)
- **Scrolls (8):** Sol, Luna, Astra, Vantage, Wrath, Adept, Miracle, Guard

Weapon specials wired into `Combat.js`: `getWeaponStatBonuses()`, `parsePoisonDamage()`, drain logic in `resolveCombat()`.

### 2C. Weapon Forging ✅ COMPLETE

Forge system allowing weapon upgrades via shop and loot drops:

- **ForgeSystem.js** — Pure engine module with `canForge`, `applyForge`, `isForged`, `getForgeCost`, `getForgeDisplayInfo`
- **Max 3 forges per weapon** — +1 Mt, +5 Crit, +5 Hit, or -1 Wt per forge. Nonlinear costs (Mt: 400/700/1100g)
- **Shop Forge tab** — Tabbed Buy/Sell/Forge interface in NodeMapScene. Per-shop limits (act1:2, act2:3, act3:4). Stat picker modal
- **Loot whetstones** — 5 whetstone types in `data/whetstones.json`. Applied immediately at loot screen via multi-step picker (unit → weapon → stat for Silver)
- **Forge loot category** — New `forge` weight in loot tables (10-15%). Act 1: Might/Hit/Weight. Act 2+: all 5 including Silver/Crit
- **Roster weapon filtering** — Shop and loot weapons filtered to roster proficiency types. Non-weapon categories unaffected
- **Visual**: Forged weapons green (#44ff88) in inspection panel, roster, and trade screen. "+N" name suffix
- **Forge metadata** (`_forgeLevel`, `_forgeBonuses`, `_baseName`) survives JSON roundtrip. Stats mutated in place — Combat.js reads automatically
- 39 new tests (31 forge + 8 loot). Total: **283 tests**

### 2D. Stat Boosters 📋 (remaining)

- [ ] Add stat booster consumables to `data/consumables.json`:

| Name | Effect | Price |
|------|--------|-------|
| Energy Drop | +2 STR permanently | 2000 |
| Spirit Dust | +2 MAG permanently | 2000 |
| Secret Book | +2 SKL permanently | 2000 |
| Speedwing | +2 SPD permanently | 2000 |
| Dracoshield | +2 DEF permanently | 2000 |
| Talisman | +2 RES permanently | 2000 |
| Angelic Robe | +5 HP permanently | 2000 |

- [ ] Add stat booster use logic in BattleScene item menu — permanently increase stat, consume item
- [ ] Add stat boosters to `lootTables.json` rare pools
- [ ] Stat boosters NOT available in shops (loot/reward only — economy balance)

### Wave 2 Acceptance Criteria
- [x] Accessories appear as loot drops and in shops (18 items, per-act pools)
- [x] Equipping a stat accessory modifies the correct stats
- [x] Combat accessories apply conditional bonuses at combat time
- [x] Save/load preserves equipped accessories and team pool
- [x] Weapon specials (drain, poison, siege, DEF bonus) work in combat
- [x] Forging available in shop (tabbed UI) and loot screen (whetstones)
- [x] Forge caps, costs, and per-shop limits enforced
- [x] Forged weapons display green text and "+N" suffix
- [x] Roster weapon filtering in shops and loot
- [x] Forge data survives save/load round-trip
- [ ] Stat boosters permanently modify stats and are consumed
- [ ] Add tests for combat accessories and weapon specials

---

## Wave 3: Elite/Miniboss Nodes + Post-Act Phase

Adds meaningful difficulty variety and completes the act structure.

### 3A. Elite Node Type

- [ ] Add `ELITE: 'elite'` to `NODE_TYPES` in `constants.js`
- [ ] Update `pickNodeType()` in `NodeMapGenerator.js`:
  - ~10% chance in middle rows (rows 2 through n-2)
  - Never on row 0, row 1, or boss row
  - Act 1: 0% elite (too early). Act 2+: 10% elite.
- [ ] Update `buildBattleParams()` for elite nodes:
  - `params.isElite = true`
  - Enemy level boost: +2 to level range
  - Enemy count boost: +1-2 additional enemies
  - Guarantee at least one enemy has a skill
- [ ] Update `NodeMapScene.js`:
  - Add elite node color (orange/red-ish) and icon
  - Add tooltip: "Elite Battle — Challenging enemies, better rewards"
  - Handle elite node click → same as battle but with `isElite` flag
- [ ] Update `BattleScene.js` loot screen:
  - When `battleParams.isElite`: show 4 loot choices, player picks 2
  - Normal: 3 choices, pick 1 (existing behavior)
- [ ] Update `MapGenerator.js`:
  - When `battleParams.isElite`: apply level boost, count boost
  - Optionally assign a "miniboss" unit (named, guaranteed skill, higher stats)

**Files:** `src/utils/constants.js`, `src/engine/NodeMapGenerator.js`, `src/scenes/NodeMapScene.js`, `src/scenes/BattleScene.js`, `src/engine/MapGenerator.js`

### 3B. Post-Act Phase

- [ ] Add `'postAct'` to `ACT_SEQUENCE` between `'act3'` and `'finalBoss'`
- [ ] Add `ACT_CONFIG.postAct`: `{ name: 'The Final Approach', rows: 3 }`
- [ ] Post-Act node distribution: all ELITE or BATTLE (no rest/shop — this is the endgame gauntlet)
- [ ] Ensure `enemies.json` has `postAct` pool (promoted enemies, level 16-20, Silver gear)
- [ ] Ensure `lootTables.json` has `postAct` entry (Silver/Legendary tier)
- [ ] Update `RunManager` if needed for post-act state transitions

**Files:** `src/utils/constants.js`, `src/engine/NodeMapGenerator.js`, `data/enemies.json`, `data/lootTables.json`

### 3C. Tests

- [ ] Update `NodeMapGenerator.test.js`: test ELITE node generation, distribution constraints
- [ ] Update `NodeMapGenerator.test.js`: test postAct in ACT_SEQUENCE
- [ ] Verify existing tests still pass

### Wave 3 Acceptance Criteria
- [ ] Elite nodes appear on Act 2+ node maps with distinct visual
- [ ] Elite battles have stronger enemies and 2-pick loot
- [ ] Post-Act phase appears between Act 3 and Final Boss
- [ ] Full run progression works: act1 → act2 → act3 → postAct → finalBoss

---

## Wave 4: Expanded Skills (Partially ✅)

More tactical depth through new trigger types and activated abilities.

### 4A. New Trigger Types — On-Defend ✅ COMPLETE

- [x] `on-defend` trigger in `SkillSystem.js` — `rollDefenseSkills()` evaluates defender skills during `rollStrike()`
- [x] **Pavise** — SKL% chance to halve physical damage (classInnate: General)
- [x] **Aegis** — SKL% chance to halve magical damage (classInnate: Paladin)
- [x] **Miracle** — LCK% chance to survive lethal hit with 1 HP (once per battle)
- [x] New activation types: SPD (Adept), LCK (Miracle)

### 4A2. New Skills ✅ COMPLETE (9 new, 12→21 total)

- [x] **Class innate skills:** Pavise (General), Aegis (Paladin), Colossus (Warrior, +3 damage), Discipline (Falcon Knight, +10 Hit/+5 Avoid), Renewal (Bishop, 10% HP/turn), Vigilance (Hero, +15 Avoid)
- [x] **General skills:** Adept (SPD% extra strike), Miracle (LCK% survive lethal), Guard (+3 DEF/RES near allies)
- [x] **Learnable skills on base classes:** Myrmidon (Vantage L8), Knight (Guard L8), Fighter (Wrath L8), Cavalier (Sol L10), Archer (Adept L10), Cleric (Miracle L8), Thief (Luna L8), Pegasus Knight (Sol L10), Mercenary (Astra L10)
- [x] **3 new scrolls:** Adept Scroll, Miracle Scroll, Guard Scroll (8 total scrolls now)

### 4A3. On-Kill Trigger 📋 (remaining)

- [ ] Add `on-kill` trigger to `SkillSystem.js`:
  - Evaluated when a unit defeats an enemy
  - Example: **Triumph** — Heal 20% max HP on kill
  - Example: **Momentum** — +2 SPD for the rest of the battle on kill (stacking)
- [ ] Add `on-kill` hook in `Combat.resolveCombat()` — trigger after lethal blow confirmed

### 4B. Command Skills 📋 (remaining)

- [ ] Add `trigger: "command"` type to SkillSystem
- [ ] Add **Rally** skill to `skills.json`:
  - Activated command: +4 STR, +4 SPD to all allies within 2 tiles for 1 turn
  - Cooldown: once per battle
- [ ] Add **Inspire** skill to `skills.json`:
  - Activated command: +10 Hit, +10 Avoid to all allies within 2 tiles for 1 turn
  - Cooldown: once per battle
- [ ] Add "Skill" action to BattleScene action menu when unit has command skills off cooldown
- [ ] Build skill activation UI: show list of available command skills, select to use
- [ ] Track per-battle cooldowns (reset at battle start)
- [ ] Apply temporary buffs: track buffed units, clear buffs at next turn start

**Files:** `data/skills.json`, `src/engine/SkillSystem.js`, `src/scenes/BattleScene.js`

### 4C. Skill Scrolls in Shops 📋 (remaining)

- [ ] Add skill scrolls to `LootSystem.generateShopInventory()` — 1-2 random scrolls in Act 2+ shops
- [ ] Price: 2500g (matches existing scroll pricing in weapons.json)

**Files:** `src/engine/LootSystem.js`

### 4D. Tests

- [ ] Add tests for on-defend skills (Pavise, Aegis, Miracle)
- [ ] Add tests for Adept extra strike, Guard condition, Renewal heal
- [ ] Add tests for combat accessories (`combatEffects`)
- [ ] Add tests for weapon specials (Ragnell DEF, Runesword drain, Venin Edge poison, Bolting range)
- [ ] Test cooldown tracking for command skills (when implemented)
- [ ] Test temporary buff application and clearing (when implemented)

### Wave 4 Acceptance Criteria
- [x] Pavise/Aegis reduce damage when triggered
- [x] Adept grants extra strike on proc
- [x] Miracle survives lethal hit with 1 HP
- [x] Guard gives +3 DEF/RES when adjacent to ally
- [x] Renewal heals 10% HP at turn start
- [x] Class innate skills assigned on promotion
- [x] Base class learnable skills gained at specified levels
- [ ] On-kill trigger skills work
- [ ] Rally activatable from action menu, buffs nearby allies, goes on cooldown
- [ ] Skill scrolls appear in Act 2+ shops
- [ ] Tests cover new combat mechanics; existing tests unaffected

---

## Wave 5: Additional Map Objectives

Currently only Rout and Seize. Adds 3 new objective types for battle variety.

### 5A. Defend Objective
Protect a point for X turns.

- [ ] Add `objective: 'defend'` support to `TurnManager.js`
- [ ] Defend win condition: survive N turns (e.g., 8-12) without losing the defend tile
- [ ] Defend lose condition: enemy unit occupies the defend tile for a full turn, OR lord dies
- [ ] Add reinforcement spawning: new enemies appear at enemy spawn zones every 2-3 turns
- [ ] Add turn counter display to BattleScene UI
- [ ] Create 1-2 defend map templates in `mapTemplates.json` (defend zone + 2 enemy approach routes)
- [ ] Wire defend objective into `buildBattleParams()` for appropriate node types

**Files:** `src/engine/TurnManager.js`, `src/engine/MapGenerator.js`, `src/scenes/BattleScene.js`, `data/mapTemplates.json`

### 5B. Survive Objective
Endure X turns. Rewards scale with kills.

- [ ] Add `objective: 'survive'` support to `TurnManager.js`
- [ ] Survive win condition: N turns elapsed (regardless of tile control)
- [ ] Reinforcements every 2 turns (heavier waves than Defend)
- [ ] Gold/XP rewards proportional to enemies defeated during survival
- [ ] Reuse defend templates with different enemy wave patterns

**Files:** `src/engine/TurnManager.js`, `src/scenes/BattleScene.js`

### 5C. Escape Objective
Get all surviving units to exit tiles.

- [ ] Add `objective: 'escape'` support to `TurnManager.js`
- [ ] Add "Exit" terrain type to `data/terrain.json` (same stats as Plain, marked as escape point)
- [ ] Escape win condition: all surviving player units reach exit tiles
- [ ] Units on exit tiles are "escaped" — removed from map, safe
- [ ] Lord must escape last (classic FE rule)
- [ ] Create 1-2 escape map templates (exit zone on opposite side from player spawn)

**Files:** `src/engine/TurnManager.js`, `src/engine/MapGenerator.js`, `src/scenes/BattleScene.js`, `data/terrain.json`, `data/mapTemplates.json`

### 5D. Bonus Objectives (Stretch)

- [ ] Track turn count and unit losses during battle
- [ ] At victory: award bonus gold/XP if completed under par turns or with no losses
- [ ] Display bonus on victory screen

**Files:** `src/scenes/BattleScene.js`

### Wave 5 Acceptance Criteria
- [ ] Defend maps spawn reinforcements; holding defend tile for N turns wins
- [ ] Survive maps endure wave assault; victory after N turns with kill-scaled rewards
- [ ] Escape maps require moving units to exit; Lord escapes last
- [ ] All three objectives work in both standalone and run modes
- [ ] Existing rout/seize objectives unaffected

---

## Wave 6: Meta-Progression Expansion

Expand from 28 upgrades to ~35-40. Accessories (Wave 2) done; skills (Wave 4) partially done.

### 6A. Home Base UI Overhaul ✅

Redesigned as tabbed UI with 4 categories (Recruits/Lords/Economy/Capacity). Progress bars, sub-headers (Growth Bonuses / Stat Bonuses), Begin Run button, ESC to title. 28 upgrades with split growth/flat tiers and lord SPD/RES.

**Remaining:**
- [ ] Add scrolling support if more upgrades overflow the tab content area
- [ ] Show current effects summary at top of each tab

### 6B. Lord Upgrades (GDD §9.2.1)

New entries in `metaUpgrades.json` + handler logic:

- [ ] **Lord Weapon Proficiency** — Unlock a second weapon type for the starting Lord (e.g., Edric gains Lances (P) before promotion). Cost: 300-500 Renown.
- [ ] **Lord Weapon Mastery** — Upgrade Lord's primary weapon to Mastery rank pre-promotion. Cost: 400 Renown.
- [ ] **Lord Starting Weapon** — Begin runs with a Steel weapon instead of Iron. Cost: 250 Renown.
- [ ] **Lord Starting Skill** — Choose 1 equipped skill from unlocked pool at run start. Cost: 350 Renown.
- [ ] Wire new effects into `UnitManager.createLordUnit()` and `RunManager.createInitialRoster()`
- [ ] Extend `getActiveEffects()` in `MetaProgressionManager.js` for new effect types

**Files:** `data/metaUpgrades.json`, `src/engine/MetaProgressionManager.js`, `src/engine/UnitManager.js`, `src/engine/RunManager.js`

### 6C. Class & Recruit Upgrades (GDD §9.2.2)

- [ ] **Base Class Innate Skill** — Unlock 1 innate skill for each base class (10 upgrades, one per class). Cost: 150-250 each. Effect: units of that class start with the skill.
- [ ] **Promoted Class Innate Skill** — Unlock 1 innate skill granted on promotion (10 upgrades). Cost: 200-350 each.
- [ ] **Equipped Skill Slots** — Increase max equipped skills from default 1 → 2 → 3. Cost: 400 → 600 Renown. 2 tiers.
- [ ] Wire innate skill unlocks into `UnitManager.createUnit()` and `createRecruitUnit()`
- [ ] Wire equip slot count into skill assignment logic

**Files:** `data/metaUpgrades.json`, `src/engine/MetaProgressionManager.js`, `src/engine/UnitManager.js`

### 6D. General Upgrades (GDD §9.2.4) — Expand Existing

- [ ] **Better Shop Inventory** — Higher tier items appear 1 act earlier. 2 tiers. Cost: 200 → 400.
- [ ] **Extra Node Events** — +1 RECRUIT node guaranteed per act. 1 tier. Cost: 350.
- [ ] **NPC Warriors** — NPCs in recruit battles gain +2 to all stats. 1 tier. Cost: 200.
- [ ] Wire shop tier into `LootSystem.generateShopInventory()`
- [ ] Wire extra recruit into `NodeMapGenerator.distributeRecruitNodes()`
- [ ] Wire NPC stat bonus into recruit battle NPC generation

**Files:** `data/metaUpgrades.json`, `src/engine/MetaProgressionManager.js`, `src/engine/LootSystem.js`, `src/engine/NodeMapGenerator.js`, `src/engine/UnitManager.js`

### 6E. Special Characters — Data Foundation (GDD §9.2.3)

- [ ] Create `data/specialChars.json` with 3-5 initial characters:

| Name | Class | Archetype | Personal Skill | Unlock Cost |
|------|-------|-----------|----------------|-------------|
| Gareth | Cavalier | Frontline bruiser | +3 STR/DEF on first combat per turn | 500 |
| Lina | Mage | Glass cannon | +5 MAG, -3 DEF (passive) | 500 |
| Thane | Thief | Utility/scout | +2 vision range, +15 Avoid in fog | 400 |
| Maren | Cleric | Sustain healer | Heals restore +50% more HP | 450 |
| Darius | Fighter | Berserker | +10 Crit per enemy adjacent to target | 500 |

- [ ] Add unlock entries to `metaUpgrades.json` (category: "special_characters")
- [ ] Wire unlocked special chars into recruit pool — appear at RECRUIT nodes when unlocked
- [ ] Distinguish from generic recruits: fixed personal growths, named, have personal skill
- [ ] Copy to `public/data/`

**Files:** `data/specialChars.json` (new), `data/metaUpgrades.json`, `src/engine/MetaProgressionManager.js`, `src/engine/UnitManager.js`, `src/engine/NodeMapGenerator.js`, `src/engine/DataLoader.js`, `src/scenes/BootScene.js`

### 6F. Tests

- [ ] Extend `MetaProgressionManager.test.js` for new upgrade types
- [ ] Test new effect types in `getActiveEffects()`
- [ ] Test special character creation with fixed growths
- [ ] Test equip slot count meta upgrade affects unit skill capacity

### Wave 6 Acceptance Criteria
- [ ] Home Base shows tabbed UI with all upgrade categories
- [ ] ~35-40 total upgrades available across categories
- [ ] Lord upgrades modify starting weapon/proficiency/skill
- [ ] Class innate skill unlocks apply to recruited units
- [ ] Special characters appear in recruit pool when unlocked
- [ ] All meta effects survive save/load round-trip

---

## Wave 7: QoL & Polish

Player experience improvements. Independent — can be interleaved with other waves.

### 7A. Unit Inspection Panel ✅

Implemented as `src/ui/UnitInspectionPanel.js` — right-click opens detailed panel with stats, skills, inventory, growths, terrain. Works for all factions.

### 7B. Danger Zone Overlay ✅

Implemented as `src/ui/DangerZoneOverlay.js` — D key toggles orange overlay of all enemy-threatened tiles. Cached until stale (unit death, phase change).

### 7C. Undo Movement

- [ ] Store unit's pre-move position when movement begins
- [ ] If unit hasn't taken an action yet, allow cancel (right-click or ESC) to return to pre-move position
- [ ] Clear stored position after any action (Attack, Heal, Wait, etc.)

**Files:** `src/scenes/BattleScene.js`

### 7D. Battle Log

- [ ] Scrollable log panel (collapsible, bottom of screen)
- [ ] Log entries: combat results (damage, hit/miss/crit), level-ups, skill activations, unit defeats, recruitment, turn transitions
- [ ] Auto-scroll to latest entry; manual scroll to review history

**Files:** `src/scenes/BattleScene.js`, new `src/ui/BattleLog.js`

### 7E. Battle Speed Controls

- [ ] Fast mode toggle: reduce/skip combat animations, instant damage numbers
- [ ] Persist setting via SettingsManager
- [ ] Add to settings overlay

**Files:** `src/scenes/BattleScene.js`, `src/utils/SettingsManager.js`, `src/ui/SettingsOverlay.js`

### Wave 7 Acceptance Criteria
- [x] Right-click shows full unit details for any faction
- [x] Danger zone correctly highlights all enemy-threatened tiles
- [ ] Undo restores unit to pre-move position before action
- [ ] Battle log captures all combat events and scrolls
- [ ] Fast mode visibly speeds up enemy phase resolution

---

## Known Deviations from GDD

Track intentional differences so they don't get "fixed" accidentally:

| Item | GDD Says | Implementation | Reason |
|------|----------|---------------|--------|
| Inventory cap | 4 items | `INVENTORY_MAX = 5` | Extra slot for flexibility; may revert |
| Act 1 enemy levels | 1-5 | 1-3 (per-node: row0=[1,1], row1=[1,2], row2+=[2,3]) | Balance: original range too lethal |
| Knight in Act 1 | In pool | Removed from pool (still boss class) | Balance: too tanky for L1 party |
| Boss stat bonus | Not specified | `BOSS_STAT_BONUS = 2` (was 3) | Balance: 3 was overwhelming |
| Rescue mechanic | Classic rescue (carry + halved stats) | Simple swap (exchange positions) | Simpler; may upgrade later |
| Sim scripts location | `tools/balance/` | `sim/` | Better separation of concerns |
