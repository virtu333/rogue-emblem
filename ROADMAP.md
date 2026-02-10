# Rogue Emblem — Roadmap

## Current State

Phases 1-9 complete. 571 tests passing. Deployed to Netlify with Supabase auth + cloud saves. 41 meta upgrades across 6 categories, 52 weapons, 21 skills, 18 accessories, 29 classes, 21 music tracks, battle actions (Trade/Swap/Dance), turn bonus system, boss recruit event, tutorial hints, dual currency meta. For architecture details, data file reference, and build order, see **CLAUDE.md**.

## Priority Order (Updated — Post-Playtest)

Organized by impact and logical sequencing:

### Now (Current Sprint)
1. **Playtest Bugfixes** — 4 confirmed bugs from playtesting (Canto+Wait, stale tooltip, enemy range, node freeze)
2. **UI Polish** — Weapon proficiency display, V-overlay tabs, shop forge hover, guaranteed consumables
3. **Anti-Juggernaut & Balance** — XP scaling rework, Sunder weapons, existing Wave 0 items

### Next (1-3 Months)
4. **Map Generation Enhancements** — Smarter placement + fog/recruit visibility + boss AI + guard enemies
5. **Elite/Miniboss Nodes + Post-Act** — Endgame content and difficulty curve
6. **Node Economy Rebalance** — Dynamic recruits, Church upgrades, shop frequency
7. **Expanded Skills** — Command skills, on-kill triggers (tactical depth)
8. **Blessing System** — Neow-style run modifiers, high replayability boost

### Later (3-6+ Months)
9. **Additional Map Objectives** — Defend, Survive, Escape (battle variety)
10. **Special Terrain Hazards** — Ice, lava, environmental effects
11. **Meta-Progression Expansion** — Full GDD §9.2 vision
12. **QoL** — Undo movement, battle log, battle speed (ongoing)
13. **Acts 2 & 3 content tuning** + Post-Act + Final Boss design
14. **Special Characters** + Lord selection
15. **Story Intro + Narrative** — Run-start story scene, character backstories, world lore
16. **Story scaffold + dialogue**
17. **Fog of war extras** — Torch items + vision skills
18. **Difficulty modes + run modifiers**
19. **Full battle animations**
20. **Additional biomes**
21. **Campaign system**

---

## Implementation Waves

### Completed Waves (Summary)
- **Wave 2A-C** (Accessories, Weapons, Forging) — Complete. 18 accessories, 52 weapons, forge system with shop tab + loot whetstones
- **Wave 2D** (Stat Boosters) — Complete. 7 stat boosters in consumables.json, loot-only (not in shops)
- **Wave 4A** (On-Defend Skills, New Skills) — Complete. 21 skills, 6 trigger types, 9 class innate skills, 8 scrolls
- **Wave 6A** (Home Base UI) — Complete. 6-tab UI, 41 upgrades, starting equipment/skills meta tabs
- **Wave 7A-B** (Inspection Panel, Danger Zone) — Complete
- **Wave 1** (Battle Actions) — Complete. Trade, Swap, Dance + Canto + Shove/Pull implemented
- **Wave 1.5** (Turn Bonus) — Complete. Par calculation, S/A/B/C rating, bonus gold on loot screen
- **Boss Recruit Event** — Complete. 3 recruit candidates after act boss, lord chance, 29 tests
- **Tutorial Hints** — Complete. 12 contextual hints, HintManager + HintDisplay
- **Loot Rebalance + Stat Boosters** — Complete. Act 1/2 pool restructuring, 7 stat boosters
- **Meta Rework Phase A** — Complete. Repricing, prerequisites, milestones
- **Wave P0** (Playtest Bugfixes) — Complete. Canto+Wait, stale tooltip, enemy range, recruit node freeze
- **Wave 0** (Balance + Anti-Juggernaut) — Complete. Sunder weapons, XP scaling, enemy skills, shop frequency, promoted recruits, guaranteed shop consumables
- **Wave P1** (UI Polish) — Complete. Weapon proficiency display, V-overlay Stats/Gear tabs, shop forge hover stats, guaranteed Vulnerary/Elixir
- **Church Upgrades** — Complete. 3-service menu: Heal All (free), Revive Fallen (1000G), Promote (3000G)

---

## NOW: Bugfixes, UI Polish & Balance

### Wave P0: Playtest Bugfixes
**Priority:** Critical — Bugs found during playtesting
**Effort:** 1-2 days
**Source:** Playtesting session (Feb 2026)

- [ ] **BUG: Canto activates after Wait**
  - **Symptom:** Walk → Wait → unit gets Canto movement → must Wait again
  - **Root cause:** `finishUnitAction()` always checks for Canto remaining movement, even when Wait was explicitly selected. Wait should unconditionally end the turn
  - **Fix:** Pass `skipCanto` flag from Wait handler: `finishUnitAction(unit, { skipCanto: true })`. In `finishUnitAction`, skip the Canto check when flag is set
  - Files: `src/scenes/BattleScene.js` (line ~1763 Wait handler, line ~1175 Canto check)

- [ ] **BUG: Stale weapon tooltip after trade**
  - **Symptom:** Trade spear away, floating tooltip still shows spear as equipped
  - **Root cause:** Inspection panel not hidden/refreshed when trade UI opens. `showBattleTradeUI()` doesn't close the inspection panel, so it retains stale weapon data
  - **Fix:** Call `this.inspectionPanel.hide()` at the start of `showBattleTradeUI()`
  - Files: `src/scenes/BattleScene.js` (line ~1358 trade UI open)

- [ ] **BUG: Right-click enemy range not visible**
  - **Symptom:** Right-clicking enemy doesn't show attack range overlay. Code exists in `onRightClick()` but user reports not seeing it
  - **Investigation needed:** Toggle logic may hide range immediately, or range display may be behind other overlays. Check depth ordering and toggle state
  - Files: `src/scenes/BattleScene.js` (line ~840 `onRightClick`)

- [ ] **BUG: Recruit node freeze in Act 3**
  - **Symptom:** Game freezes when clicking recruit node (music stops, map visible but unresponsive). Specific to one save state (user "virtu", abandoned)
  - **Root cause:** Unknown — guard clauses exist for missing class data, but something else may throw during BattleScene init
  - **Fix:** Add try/catch around entire BattleScene `create()` method. On error, log to console and transition back to NodeMapScene with error message instead of freezing
  - Files: `src/scenes/BattleScene.js` (create method)

**Success Criteria:**
- [ ] Wait always ends unit turn, no Canto follow-up
- [ ] Tooltip refreshes correctly after every trade
- [ ] Right-click enemy shows red movement + attack range overlay
- [ ] Node transition errors recover gracefully instead of freezing

---

### Wave P1: UI Polish
**Priority:** High — Quality of life issues that confuse players
**Effort:** 2-3 days

- [ ] **Weapon proficiency display**
  - Show weapon proficiencies in unit detail overlay (V-key view) Stats tab
  - Format: `Prof: Sword, Lance` or icon-based with proficiency level (Prof/Mast)
  - Files: `src/ui/UnitDetailOverlay.js`

- [ ] **V-key detail overlay — Stats/Gear tabs**
  - Full overlay is getting crowded. Split into tabbed Stats/Gear view (same pattern as UnitInspectionPanel's existing tabs, but with more screen real estate)
  - Stats tab: stats, growths, weapon proficiencies, terrain bonuses
  - Gear tab: inventory (with equipped marker), consumables, accessory, skills
  - Arrow key or clickable tab navigation
  - Files: `src/ui/UnitDetailOverlay.js`

- [ ] **Shop forge: show weapon stats on hover**
  - When hovering over a weapon in the Forge tab, show Mt/Ht/Cr/Wt/Rng tooltip
  - Show current forge levels per stat `(N/3)` in the tooltip
  - Files: `src/scenes/NodeMapScene.js` (forge tab rendering)

- [ ] **Guaranteed Vulnerary/Elixir in shops**
  - Pin 1 Vulnerary + 1 Elixir in every shop inventory (always available, not random)
  - Remaining shop slots (2-4) still randomized from pool
  - Files: `src/engine/LootSystem.js` (`generateShopInventory`)

**Success Criteria:**
- [ ] Players can see weapon proficiencies without guessing
- [ ] Detail overlay is readable and organized, not overflowing
- [ ] Forge decisions are informed by current weapon stats
- [ ] Healing items always purchasable

---

### Wave 0: Balance & Anti-Juggernaut
**Priority:** High — Balance issues and anti-snowball mechanics
**Effort:** 3-5 days

#### Existing Balance Items
- [ ] **Act 3 Promoted Recruits**
  - Change `recruits.json` Act 3 pool to promoted classes only
  - Adjust level range from [12-15] to [5-8] (post-promotion levels)
  - Reasoning: Act 3 recruits arrive too late to promote naturally, should match player party power
  - Files: `data/recruits.json`

- [ ] **Enemy Skill Scaling by Act**
  - Enemies.json: Add `skillChance` per act (act1: 10%, act2: 25%, act3: 50%, finalBoss: 80%)
  - MapGenerator: Roll skill chance per enemy, assign random skill from pool if passes
  - Boss enemies: always get 1-2 skills regardless of act
  - Reasoning: Vantage/Wrath showing up in Act 1 is frustrating, should scale with difficulty
  - Files: `data/enemies.json`, `src/engine/MapGenerator.js`

- [ ] **Weight Mechanic Rework**
  - Change formula: `effectiveWeight = Math.max(0, weapon.weight - Math.floor(unit.stats.STR / 5))`
  - Every 5 STR negates 1 weight point
  - Reasoning: Late-game units with 25+ STR should handle most weapons fine
  - Files: `src/engine/Combat.js` (update `canDouble()` formula)

- [ ] **Shop/Church Frequency Rebalance**
  - NodeMapGenerator: Increase shop chance 15% → 25%, decrease church chance 10% → 5%
  - Reasoning: Shops are high-value player decision points, churches are weak (just heal spam)
  - Files: `src/engine/NodeMapGenerator.js` (NODE_TYPE weights)

#### Anti-Juggernaut: XP Scaling Rework
- [ ] **Steeper XP diminishing returns**
  - Current: linear −5 XP per level advantage (level 10 vs level 1 = 1 XP combat / 21 XP kill)
  - Proposed: exponential decay after +3 level advantage
    - +0 to +3 levels: current formula (−5 per level)
    - +4 to +6 levels: −8 per level (steeper)
    - +7+ levels: flat 1 XP (hard floor, even for kills)
  - Kill bonus also scales down: full bonus at +0-3, half at +4-6, zero at +7+
  - Reasoning: A level 12 unit killing level 3 enemies should gain essentially nothing
  - Files: `src/engine/UnitManager.js` (`calculateXP`)

#### Anti-Juggernaut: Sunder Weapons (Enemy-Only)
- [ ] **Sunder weapon class** — low might, halved DEF calculation, high accuracy
  - 4 weapons: Sunder Sword, Sunder Lance, Sunder Axe, Sunder Bow
  - Stats: Mt 3-5, Hit 90-95, Crit 10-15, Wt 4-6
  - Special: `"Halves target DEF"` — Combat.js calculates physical damage as if defender DEF is halved (round down)
  - Enemy-only: not in loot/shop pools, no `price` field
  - Files: `data/weapons.json`, `src/engine/Combat.js` (add DEF-halving special check)

- [ ] **Sunder enemy spawn rates**
  - `enemies.json`: Add `sunderChance` per act pool
    - Act 1: 0% (never)
    - Act 2: 8% of enemies get a Sunder weapon matching their proficiency
    - Act 3: 20% of enemies
    - Final Boss: 25% of enemies
  - MapGenerator: Roll sunder chance per enemy after class selection, replace equipped weapon if passes
  - Reasoning: Punishes overleveled frontliners who tank everything. Forces player to use positioning/range instead of sending one unit forward
  - Files: `data/enemies.json`, `src/engine/MapGenerator.js`

**Success Criteria:**
- [ ] Act 3 recruits arrive promoted and useful
- [ ] Early acts feel less punishing (fewer skilled enemies)
- [ ] Heavy weapons viable on high-STR units
- [ ] More shop encounters per run
- [ ] Overleveled units can't efficiently farm low-level enemies
- [ ] Sunder enemies create real threat to tanky frontliners without being unfair

---

## NEXT: Map Quality & Endgame

### Wave 2: Map Generation Enhancements
**Priority:** High — Biggest bang-for-buck improvement to tactical feel
**Effort:** 2-3 weeks (8 features, up from 5)

These include original map gen ideas plus critical fixes from playtesting.

#### 2A: Terrain-Aware Enemy Placement (Day 1-2)
- [ ] `scoreSpawnTile(tile, unit)` helper in MapGenerator
  - +3 fort/throne, +2 forest/mountain (infantry only), +1 plain (cavalry)
  - -2 forest/mountain (cavalry), +1 per adjacent wall
- [ ] Replace random placement with weighted random based on scores
- [ ] Test: Chokepoint map defenders cluster in gap, Forest Ambush has archers on trees

**Impact:** Enemies stop standing in dumb places. Feels smarter without hand-designing.

#### 2B: Composition-Template Affinity (Day 2-3)
- [ ] Add `enemyWeights` field to each mapTemplate.json entry
  - Forest Ambush: infantry ×1.5, cavalry ×0.5, archer ×1.3
  - River Crossing: archer ×1.5, mage ×1.2, cavalry ×0.7
  - Chokepoint: knight ×1.5, lance ×1.3
  - Castle Assault: knight ×1.5, archer ×1.3, mage ×1.2
  - Open Field: cavalry ×1.3
- [ ] MapGenerator: Apply multipliers to enemy pool weights before rolling classes
- [ ] Test: Forest Ambush spawns mostly infantry/archers, Open Field has cavalry

**Impact:** Templates feel distinct. "Ambush" maps actually feel like ambushes.

#### 2C: Boss Throne AI + Guard Enemies (Day 3-5)
- [ ] **Boss stays on throne (seize maps)**
  - AIController: If `unit.isBoss && objective === 'seize'`, boss movement clamped to within 1 tile of throne position
  - Boss still attacks units that enter range, just won't chase across the map
  - Non-seize maps: boss behaves normally (chases)
  - Files: `src/engine/AIController.js`

- [ ] **Guard enemy behavior** — enemies near boss that don't move until provoked
  - New `unit.aiMode = 'guard'` flag (default: `'chase'`)
  - Guard behavior: don't move until any player unit enters aggro range (3 tiles)
  - Once triggered, guard permanently switches to chase mode for rest of battle
  - MapGenerator: 15-25% of enemies spawning in boss half of map get `aiMode: 'guard'`
  - Visual indicator: guard enemies have slightly different tint or a shield icon
  - Files: `src/engine/AIController.js`, `src/engine/MapGenerator.js`

- [ ] **Anchor point system** (from original roadmap)
  - Add `anchors` array to mapTemplate.json entries (1-2 per template)
  - Chokepoint: `{ position: "center_gap", unit: "highest_level", required: true }`
  - Castle Assault: `{ position: "throne", unit: "boss_or_strongest" }`, `{ position: "gate_adjacent", unit: "knight" }`
  - River Crossing: `{ position: "bridge_ends", unit: "lance_user", count: 2 }`
  - MapGenerator: Place anchor enemies first (resolve position → tile), then fill remaining

**Impact:** Boss fights feel like real sieges. Guard enemies create defensive formations instead of everyone rushing player.

#### 2D: Fog of War + Recruit Visibility (Day 5-7)
- [ ] **Recruit NPC visible through fog**
  - Option A (preferred): Show a pulsing "?" marker at NPC tile position, visible through fog. Reveals identity when player gets within vision range
  - Option B: NPC has its own small vision radius (2 tiles) that's always revealed, like a beacon
  - Reasoning: Player literally cannot find NPC to recruit in fog. Defeats purpose of recruit node
  - Files: `src/scenes/BattleScene.js` (fog update logic), `src/engine/Grid.js`

- [ ] **River map NPC spawn bias**
  - `generateNPCSpawn()`: Bias NPC placement toward player side of river (left 40% of map)
  - Current: searches middle third [33%-67%], which overlaps river zone [40%-60%]
  - New: search [20%-45%] first (player side), fall back to middle third if no valid tiles
  - Reasoning: NPCs spawning across river are nearly impossible to reach in time
  - Files: `src/engine/MapGenerator.js` (`generateNPCSpawn`)

- [ ] **Threat radius for NPC placement** (from original roadmap)
  - MapGenerator.generateNPCSpawn(): Add rejection check
  - Count enemies within `Math.max(...npc.weapon.range) + npc.MOV` tiles
  - If >2 enemies can reach NPC on turn 1, reject position and retry
  - Max 10 retries before giving up (fallback: place anyway with warning log)

**Impact:** Recruit nodes are actually playable in fog and river maps.

#### 2E: Template-Driven Fog (Day 7-8)
- [ ] Add `fogChance` field to each mapTemplate.json entry
  - Open Field: 10%, Forest Ambush: 60%, Castle Assault: 0%, River Crossing: 30%
- [ ] MapGenerator: Use template's `fogChance` instead of global `FOG_CHANCE`
- [ ] Override with node-level fog if node already has `fogEnabled` set

**Impact:** Fog feels thematic. Forests are spooky, castles are clear.

**Success Criteria:**
- [ ] Enemy placement looks smart (defenders in chokepoints, archers on hills)
- [ ] Templates feel distinct (forest = infantry ambush, open field = cavalry charge)
- [ ] Boss stays on throne during seize maps, guards create defensive formation
- [ ] NPCs findable in fog, reachable on river maps
- [ ] Fog probability matches map theme

---

### Wave 3: Elite/Miniboss Nodes + Post-Act
**Priority:** High — Adds endgame content and difficulty curve
**Effort:** 1 week

- [ ] `NODE_TYPES.ELITE` in constants.js, ~10% chance in Act 2+ middle rows
- [ ] Elite battle params: +2 level, +1-2 enemies, at least one enemy with skill
- [ ] Elite node visual (orange icon) + tooltip in NodeMapScene
- [ ] Elite loot: 4 choices, pick 2 (vs normal 3/pick 1)
- [ ] Optional miniboss unit (named, guaranteed skill, higher stats)
- [ ] `postAct` in ACT_SEQUENCE between act3 and finalBoss (3 rows, all elite/battle)
- [ ] `enemies.json` postAct pool (promoted, level 16-20, Silver gear)
- [ ] `lootTables.json` postAct entry (Silver/Legendary tier)
- [ ] Tests: elite node generation, postAct in sequence, existing tests pass

**Success Criteria:**
- [ ] Players encounter 2-3 elite battles per act in Act 2+
- [ ] Elite loot rewards justify higher difficulty
- [ ] Post-Act gauntlet provides challenge before final boss

---

### Wave 4: Node Economy Rebalance
**Priority:** Medium-High — Improves run pacing and player agency
**Effort:** 3-4 days

#### 4A: Dynamic Recruit Nodes
- [ ] RunManager: Track `rosterSize` and `rosterCap`
- [ ] NodeMapGenerator: Increase recruit node chance if `rosterSize < rosterCap - 2`
  - Normal: 15% chance per eligible node
  - Low roster: 30% chance per eligible node
- [ ] Cap at 1 recruit per 2 rows (don't flood the map)

**Impact:** Players who lose units aren't punished with no recovery options.

#### 4B: Church Service Upgrades
- [ ] Add `NODE_TYPES.CHURCH` service menu (new UI in NodeMapScene)
- [ ] **Heal All Units** — Free (existing behavior)
- [ ] **Revive Fallen Unit** — 1000 gold, pick from `rm.fallenUnits[]` array
  - Revive at 50% HP, reset XP to nearest level threshold
  - Can only revive non-lords
  - Add `fallenUnits` array to RunManager state (push on unit death)
- [ ] **Promote Unit** — 3000 gold, pick promotable unit (level 10+)
  - Same as Master Seal but costs gold instead of item
  - Alternative if no Master Seals in loot/shop

**Impact:** Church becomes meaningful choice. Revive adds comeback mechanic without removing permadeath tension.

**Success Criteria:**
- [ ] Runs with early deaths still recoverable via revive
- [ ] Promotion accessible even without Master Seal loot RNG
- [ ] Church node worth visiting instead of skipping

---

### Wave 5: On-Kill, Commands, Shop Scrolls
**Priority:** Medium — Adds tactical depth
**Effort:** 1-2 weeks

- [ ] `on-kill` trigger in SkillSystem.js (Triumph: heal 20% on kill, Momentum: +2 SPD stacking)
- [ ] `on-kill` hook in Combat.resolveCombat() after lethal blow
- [ ] `trigger: "command"` type — Rally (+4 STR/SPD, 2-tile radius, once/battle), Inspire (+10 Hit/Avoid)
- [ ] "Skill" action in battle menu for command skills off cooldown
- [ ] Per-battle cooldown tracking, temporary buff application + clearing at turn start
- [ ] Skill scrolls in Act 2+ shops (1-2 random, 2500g each)
- [ ] Tests for on-kill, command skills, cooldowns, temporary buffs

**Success Criteria:**
- [ ] Sweeper builds viable (stack kills for snowball effect)
- [ ] Support units have active contribution beyond healing

---

### Wave 6: Blessing System (Run Start Modifiers)
**Priority:** High — Massive replayability boost, every run feels different
**Effort:** 1-2 weeks

**Concept:** Slay the Spire's Neow bonus for Emblem Rogue. At Home Base before run starts, player visits Shrine of Fate and chooses 1 blessing from 3-4 random options. Each blessing pairs a **boon** (powerful buff) with an optional **cost** (meaningful tradeoff). Stronger boons have steeper costs.

#### 6A: Core Blessing System (Days 1-4)
- [ ] Create `ShrineScene.js` — triggers after "Begin Run" from HomeBaseScene
  - Displays 3-4 blessing cards (tier 1-4) with boon + cost
  - Always includes one tier-1 free option (modest boon, no cost)
  - 20% chance of one tier-4 appearing (legendary boon, brutal cost)
- [ ] Add `data/blessings.json` — boons and costs organized by tier
  - **Tier 1 (Free):** +1 random stat, +100 gold, extra Vulnerary, +10% random growth
  - **Tier 2 (Minor Cost):** +2 to 2 stats, random accessory, free recruit, Steel weapon, Act 1 +5 Hit buff
  - **Tier 3 (Major Cost):** Silver weapon, skill scroll, Master Seal, rare accessory, +1 deploy, level-scaled recruit
  - **Tier 4 (Brutal Cost):** Legendary weapon, 2 skill scrolls, +1 MOV all units, +15% all growths
  - **Costs (matched to tier):** Growth penalties, stat debuffs, gold loss, fewer shop items, skip first shop, extra enemies, remove all shops, disable personal skill
- [ ] RunManager: Add `runBlessing` field to run state (stores chosen blessing for display/effects)
- [ ] RunManager: Apply blessing effects in `startRun()` after creating roster
- [ ] Tests: Blessing selection, effect application, cost enforcement, tier distribution

#### 6B: Blessing Effects Integration (Days 5-7)
- [ ] **Equipment Boons:** Steel/Silver/Legendary weapon, random accessory, combat accessory
- [ ] **Stat Boons:** Random lord stat +1/+2, random growth +10%, all growths +15%
- [ ] **Economy Boons/Costs:** Starting gold ±100-200, battle gold multiplier ±10-20%
- [ ] **Roster Boons:** Free recruit (level 1 or scaled), extra deploy slot
- [ ] **Act Buffs/Debuffs:** +5 Hit all units Act 1, -1 DEF all units Act 1
- [ ] **Node Modifiers:** Skip first shop, remove all shops, fewer shop items (-2)
- [ ] **Battle Modifiers:** First 3 battles get +2 enemies
- [ ] **Skill Modifiers:** Disable personal skill until Act 3

#### 6C: Blessing UI & Display (Days 7-8)
- [ ] ShrineScene blessing card design (similar to loot cards but taller)
- [ ] Blessing selection: Click card → confirm dialog → apply → transition to NodeMapScene
- [ ] RunCompleteScene: Display chosen blessing in victory summary
- [ ] NodeMapScene: Small blessing icon in top-right corner (hover shows full text)

#### 6D: Balance & Testing (Days 8-10)
- [ ] Create `tests/BlessingSystem.test.js`
- [ ] Balance: tier-1 free boons modest, tier-3 costs painful but workable, tier-4 costs enable broken combos
- [ ] Ensure costs trade resource axes (growth for gear, gold for stats, shops for skills)

**Design Principles:**
- **Costs should be felt, not fatal:** -10% growth hurts over 20 levels but doesn't brick the run
- **Trade one resource for another:** Lose DEF growth for skill scroll = great on tanky lords, risky on fragile mages
- **Reward game knowledge:** Expert players recognize when a "bad" cost is actually fine for their build
- **Immediate differentiation:** Every run starts feeling unique, not just after Act 1 loot RNG

**Success Criteria:**
- [ ] Every run start feels different (like Slay the Spire's Neow bonus)
- [ ] Players make meaningful tradeoff decisions (not obvious "always pick tier 4")
- [ ] Costs enable interesting challenge runs ("no shops" run with strong starting gear)
- [ ] No blessing feels mandatory or trap option

---

## LATER: Objectives & Content Expansion

### Wave 7: Additional Map Objectives
**Priority:** Medium — Adds battle variety
**Effort:** 2 weeks

- [ ] `objective: 'defend'` — protect tile for N turns, reinforcements every 2-3 turns, turn counter UI
- [ ] `objective: 'survive'` — endure N turns, heavier reinforcement waves, kill-scaled rewards
- [ ] `objective: 'escape'` — move all units to exit tiles, Lord escapes last
- [ ] 1-2 map templates per new objective type in mapTemplates.json
- [ ] Bonus objectives: under-par turns or no losses → extra gold/XP

**Success Criteria:**
- [ ] ~30% of battles use non-Rout/Seize objectives
- [ ] Defend maps feel tense (wave defense)
- [ ] Escape maps reward speed over kills

---

### Wave 8: Special Terrain Hazards
**Priority:** Low-Medium — Adds map variety, but content-heavy
**Effort:** 1-2 weeks

#### 8A: New Terrain Types
- [ ] Add to terrain.json: Ice (slippery), Lava (damage per turn), Quicksand (immobilize)
- [ ] Terrain effects in Combat.js
- [ ] Add terrain to mapTemplates.json (volcanic, tundra biomes)

#### 8B: Boss Arena Features
- [ ] Add `arenaFeatures` field to boss configs in enemies.json
- [ ] MapGenerator: Place arena features based on boss config

**Success Criteria:**
- [ ] Boss battles feel unique and memorable
- [ ] Terrain hazards create tactical decisions (risk damage for shortcut?)

---

### Wave 9: Meta-Progression Expansion
**Priority:** Medium — Full GDD §9.2 vision
**Effort:** 2-3 weeks

- [ ] Home Base scrolling support if upgrades overflow tab area
- [ ] Current effects summary at top of each tab
- [ ] Lord Weapon Proficiency — unlock second weapon type (300-500 Supply)
- [ ] Lord Weapon Mastery — upgrade primary to Mastery pre-promotion (400 Valor)
- [ ] Base Class Innate Skill unlocks (10 upgrades, 150-250 Supply each)
- [ ] Promoted Class Innate Skill unlocks (10 upgrades, 200-350 Supply each)
- [ ] Equipped Skill Slots — increase max from 2→3→4 (400→600 Valor)
- [ ] Better Shop Inventory — higher tier items 1 act earlier (2 tiers, 200→400 Supply)
- [ ] Extra Node Events — +1 RECRUIT guaranteed per act (350 Supply)
- [ ] NPC Warriors — recruit battle NPCs gain +2 all stats (200 Supply)
- [ ] Special Characters: `data/specialChars.json` (3-5 named units with fixed growths, personal skills, unlock via meta)
- [ ] Tests for new upgrade types, special character creation, equip slot meta

---

### Wave 10: QoL & Polish (Ongoing)
**Priority:** Low-Medium — Nice-to-haves
**Effort:** 1-2 days each

- [ ] Undo Movement — store pre-move position, cancel returns unit if no action taken
- [ ] Battle Log — scrollable log of combat results, level-ups, skill activations, defeats
- [ ] Battle Speed Controls — fast mode toggle (2x animations), persist via SettingsManager
- [ ] Auto-End Turn — button to skip remaining units (all units have acted or can't act)
- [ ] Keybind customization — rebind ESC, D, R, etc. via SettingsOverlay

---

## Known Deviations from GDD

| Item | GDD Says | Implementation | Reason |
|------|----------|---------------|--------|
| Inventory cap | 4 items | `INVENTORY_MAX = 5` | Extra slot for flexibility; may revert |
| Act 1 enemy levels | 1-5 | 1-3 (per-node: row0=[1,1], row1=[1,2], row2+=[2,3]) | Balance: original range too lethal |
| Knight in Act 1 | In pool | Removed from pool (still boss class) | Balance: too tanky for L1 party |
| Boss stat bonus | Not specified | `BOSS_STAT_BONUS = 2` (was 3) | Balance: 3 was overwhelming |
| Rescue mechanic | Classic rescue (carry + halved stats) | Simple swap (exchange positions) | Simpler; may upgrade later |
| Sim scripts location | `tools/balance/` | `sim/` | Better separation of concerns |
| Weight formula | Not specified | Reworked to `weight - STR/5` | Late-game viability of heavy weapons |
| Church services | Heal only | Heal + Revive (1K) + Promotion (3K) | Makes church nodes worth visiting |
| Sunder weapons | Not in GDD | Enemy-only, halves target DEF | Anti-juggernaut mechanic from playtesting |

---

## Residual Risk / Test Gaps

- **Heal action hidden for non-proficient staff (no scene-level test):** `hasStaff()`/`getStaffWeapon()` now enforce `canEquip`, so the Heal button won't appear for units without Staff proficiency. This is validated by unit tests on the helpers, but no integration test explicitly asserts "Heal action hidden in BattleScene action menu." Validated by behavior inference + manual playtesting for now.

---

## Long-Term Vision (6-12+ Months)

- **Full Battle Animations** — Side-view combat animations (64x64 or 96x96) for each class. Combat resolution already decoupled from animation
- **Additional Biomes** — Castle/fortress, cave/dungeon, forest, volcanic, tundra biomes beyond grassland. Map generator takes biome parameter
- **Narrative & Dialogue** — Brief dialogue at rest/recruitment/boss events. Simple text box with speaker portrait, no VN engine
- **Difficulty Modes** — Normal/Hard/Lunatic modifier layers on enemy stats, economy, loot. Ascension-style run modifiers for bonus Renown
- **Story Scaffold** — Light narrative: per-Lord motivation, recruitment dialogue, boss encounter lines. Data in `dialogue.json`
- **Campaign System** — Multiple campaigns with different biome progressions, boss rosters, enemy pools. Campaign = JSON config
- **Additional Lords** — Kira, Voss, Sera playable (data exists in lords.json). Lord selection at run start
- **Special Characters** — Named units with fixed growths and personal skills, unlocked via meta-progression
- **Monetization** — If commercial: cosmetic palette swaps, campaign DLC. Never sell gameplay advantages
- **Mobile Web Support** — Responsive scaling (ENVELOP mode or 960×640), touch controls (floating buttons, long-press), orientation lock
- **iOS Port** — Capacitor wrapper after mobile web support stable (6-week effort, see `docs/ios-port-spec.md`)

---

## Roadmap Decisions & Tradeoffs

### Why Bugfixes Before Everything?
- **Reasoning:** Bugs degrade trust in the game. Canto+Wait is confusing, stale tooltips are misleading, freezes are game-ending. Small fixes, huge impact on perceived quality.
- **Tradeoff:** Delays new features by 1-2 days. Worth it.

### Why Anti-Juggernaut Before Map Generation?
- **Reasoning:** Juggernauting is a dominant strategy that makes most tactical decisions irrelevant. If one unit can solo everything, map improvements don't matter. XP scaling + Sunder weapons together create a soft ceiling on single-unit dominance.
- **Tradeoff:** Sunder weapons require new weapon data + Combat.js special handling. ~2 days of work for a mechanic that fundamentally changes late-game strategy.

### Why UI Polish as Its Own Wave?
- **Reasoning:** Multiple small UI issues (proficiency display, overlay tabs, forge hover) don't fit cleanly into balance or map gen waves. Grouping them lets us batch the UI work.
- **Tradeoff:** Could be done incrementally alongside other waves, but batching avoids context-switching.

### Why Boss AI + Guard Enemies in Wave 2?
- **Reasoning:** Boss leaving throne on seize maps makes the objective trivial. Guard enemies create the defensive formation that makes approaching the boss tactically interesting. Both are AI changes that pair naturally with map gen improvements.
- **Tradeoff:** Adds 2 days to Wave 2, but the boss AI fix is nearly mandatory for seize maps to feel right.

### Why "Map Generation" Before "Elite Nodes"?
- **Reasoning:** Map gen improvements affect 100% of battles. Elite nodes are 10% of battles.
- **Tradeoff:** Elite nodes would be higher-stakes content, but low-quality maps hurt baseline experience.

### Why "Blessing System" After "Skills Expansion"?
- **Reasoning:** Blessings make every run feel different from the start. Huge replayability boost for medium-high effort. Positioned after tactical depth (skills, map gen) is established so blessings modify interesting systems.
- **Tradeoff:** Could come earlier for immediate variety, but more valuable when there's a deeper game to modify.

---

## Next Actions

1. ~~**Wave P0** (Bugfixes)~~ ✅ Done
2. ~~**Wave P1** (UI Polish)~~ ✅ Done
3. ~~**Wave 0** (Balance + Anti-Juggernaut)~~ ✅ Done
4. **Wave 2** (Map Generation Enhancements) — Next up
5. **Playtest** after Wave 2, then proceed to Wave 3+

## Deployment

Auto-deploys via Netlify GitHub integration. Pushing to `main` triggers build + publish automatically. No manual `netlify deploy` needed.
