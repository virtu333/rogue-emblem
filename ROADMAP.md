# Rogue Emblem — Roadmap

## Current State

Phases 1-9 complete. 509 tests passing. Deployed to Netlify with Supabase auth + cloud saves. 41 meta upgrades across 6 categories, 51 weapons, 21 skills, 18 accessories, 29 classes, 21 music tracks. For architecture details, data file reference, and build order, see **CLAUDE.md**.

## Priority Order (Updated)

Organized by impact and logical sequencing:

### Now (Current Sprint)
1. **Balance & Progression Fixes** — Quick wins that improve existing gameplay immediately
2. **Battle Actions** — Trade, Swap, Dance (fills obvious gameplay gaps)
3. **Turn Bonus UI Integration** — Engine is ready, just needs BattleScene wiring

### Next (1-3 Months)
4. **Map Generation Enhancements** — Smarter enemy placement, template-specific tactics
5. **Elite/Miniboss Nodes + Post-Act** — Endgame content and difficulty curve
6. **Node Economy Rebalance** — Dynamic recruits, Church upgrades, shop frequency
7. **Expanded Skills** — Command skills, on-kill triggers (tactical depth)
8. **Blessing System** — Neow-style run modifiers, high replayability boost

### Later (3-6+ Months)
9. **Additional Map Objectives** — Defend, Survive, Escape (battle variety)
10. **Special Terrain Hazards** — Ice, lava, environmental effects
11. **Meta-Progression Expansion** — Full GDD §9.2 vision
11. **QoL** — Undo movement, battle log, battle speed (ongoing)
12. **Acts 2 & 3 content tuning** + Post-Act + Final Boss design
13. **Special Characters** + Lord selection
14. **Story scaffold + dialogue**
15. **Fog of war extras** — Torch items + vision skills
16. **Difficulty modes + run modifiers**
17. **Full battle animations**
18. **Additional biomes**
19. **Campaign system**

---

## Implementation Waves

### Completed Waves (Summary)
- **Wave 2A-C** (Accessories, Weapons, Forging) — Complete. 18 accessories, 51 weapons, forge system with shop tab + loot whetstones
- **Wave 2D** (Stat Boosters) — Complete. 7 stat boosters in consumables.json, loot-only (not in shops)
- **Wave 4A** (On-Defend Skills, New Skills) — Complete. 21 skills, 6 trigger types, 9 class innate skills, 8 scrolls
- **Wave 6A** (Home Base UI) — Complete. 6-tab UI, 41 upgrades, starting equipment/skills meta tabs
- **Wave 7A-B** (Inspection Panel, Danger Zone) — Complete

---

## NOW: Quick Wins & Core Features

### Wave 0: Balance & Progression Fixes (Quick Wins)
**Priority:** Critical — These are small changes with immediate impact on game feel
**Effort:** 1-2 days total

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

**Success Criteria:**
- [ ] Act 3 recruits arrive promoted and useful
- [ ] Early acts feel less punishing (fewer skilled enemies)
- [ ] Heavy weapons viable on high-STR units
- [ ] More shop encounters per run

---

### Wave 1: Battle Actions (Trade, Swap, Dance)
**Priority:** High — Core FE mechanics players expect
**Effort:** 1-2 weeks

- [ ] `findTradeTargets(unit)` — adjacent player units with inventory
- [ ] "Trade" in action menu, two-column UI, transfer items, ends turn
- [ ] Handle edge cases: full inventory (5 items), last weapon can't be traded away
- [ ] `findSwapTargets(unit)` — adjacent player units
- [ ] "Swap" in action menu, exchange grid positions, acting unit's turn ends
- [ ] `findDanceTargets(unit)` — adjacent acted player units
- [ ] "Dance" in action menu (Dancer class only), reset target's hasMoved/hasActed
- [ ] Dancer cannot Dance themselves or another Dancer
- [ ] All three actions appear under correct conditions, none when conditions aren't met
- [ ] Existing tests still pass

**Success Criteria:**
- [ ] Can redistribute weapons mid-battle via Trade
- [ ] Can rescue trapped units via Swap
- [ ] Dancer enables alpha strike combos (attack → dance → attack again)

---

### Wave 1.5: Turn Bonus UI Integration
**Priority:** High — Engine is done, just needs UI wiring
**Effort:** 2-3 days

- [ ] BattleScene: Call `TurnBonusCalculator.calculatePar()` at battle start
- [ ] Display par and current turn count in top-left corner (next to gold)
- [ ] Color-code turn counter: green (S pace), yellow (A), orange (B), red (C+)
- [ ] RunCompleteScene: Show rating badge (S/A/B/C) and bonus gold earned
- [ ] Add turn rating to cloud save schema (for future leaderboards)

**Success Criteria:**
- [ ] Players see turn par and understand speed expectations
- [ ] Bonus gold incentivizes efficient play without feeling mandatory

---

## NEXT: Map Quality & Endgame

### Wave 2: Map Generation Enhancements
**Priority:** High — Biggest bang-for-buck improvement to tactical feel
**Effort:** 1-2 weeks (5 small features)

These are all from your `mapgenerationideas.txt` file — low effort, high impact.

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

#### 2C: Anchor Point System (Day 3-5)
- [ ] Add `anchors` array to mapTemplate.json entries (1-2 per template)
  - Chokepoint: `{ position: "center_gap", unit: "highest_level", required: true }`
  - Castle Assault: `{ position: "throne", unit: "boss_or_strongest" }`, `{ position: "gate_adjacent", unit: "knight" }`
  - River Crossing: `{ position: "bridge_ends", unit: "lance_user", count: 2 }`
- [ ] MapGenerator: Place anchor enemies first (resolve position → tile), then fill remaining
- [ ] Define position helpers: `center_gap`, `throne`, `gate_adjacent`, `bridge_ends`

**Impact:** Every template has a guaranteed tactical puzzle. Boss on throne, knights at gates, etc.

#### 2D: Threat Radius for NPC Placement (Day 5-6)
- [ ] MapGenerator.generateNPCSpawn(): Add rejection check
  - Count enemies within `Math.max(...npc.weapon.range) + npc.MOV` tiles
  - If >2 enemies can reach NPC on turn 1, reject position and retry
- [ ] Max 10 retries before giving up (fallback: place anyway with warning log)

**Impact:** Recruit doesn't die instantly before you can reach them.

#### 2E: Template-Driven Fog (Day 6-7)
- [ ] Add `fogChance` field to each mapTemplate.json entry
  - Open Field: 10%, Forest Ambush: 60%, Castle Assault: 0%, River Crossing: 30%
- [ ] MapGenerator: Use template's `fogChance` instead of global `FOG_CHANCE`
- [ ] Override with node-level fog if node already has `fogEnabled` set

**Impact:** Fog feels thematic. Forests are spooky, castles are clear.

**Success Criteria:**
- [ ] Enemy placement looks smart (defenders in chokepoints, archers on hills)
- [ ] Templates feel distinct (forest = infantry ambush, open field = cavalry charge)
- [ ] Every map has a "signature moment" (boss on throne, knights at gate)
- [ ] NPCs survive turn 1 reliably
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
- [ ] Add `data/blessings.json` — boons and costs organized by tier (see downloaded file)
  - **Tier 1 (Free):** +1 random stat, +100 gold, extra Vulnerary, +10% random growth
  - **Tier 2 (Minor Cost):** +2 to 2 stats, random accessory, free recruit, Steel weapon, Act 1 +5 Hit buff
  - **Tier 3 (Major Cost):** Silver weapon, skill scroll, Master Seal, rare accessory, +1 deploy, level-scaled recruit
  - **Tier 4 (Brutal Cost):** Legendary weapon, 2 skill scrolls, +1 MOV all units, +15% all growths
  - **Costs (matched to tier):** Growth penalties, stat debuffs, gold loss, fewer shop items, skip first shop, extra enemies, remove all shops, disable personal skill
- [ ] RunManager: Add `runBlessing` field to run state (stores chosen blessing for display/effects)
- [ ] RunManager: Apply blessing effects in `startRun()` after creating roster
  - Stat bonuses applied to lords/roster
  - Equipment/consumables/recruits added to starting roster
  - Modifiers (shop penalties, extra enemies) stored for later application
- [ ] Tests: Blessing selection, effect application, cost enforcement, tier distribution

#### 6B: Blessing Effects Integration (Days 5-7)
- [ ] **Equipment Boons:** Steel/Silver/Legendary weapon, random accessory, combat accessory
  - Add to lord inventory matching proficiency type (reuse existing weapon/accessory pools)
- [ ] **Stat Boons:** Random lord stat +1/+2, random growth +10%, all growths +15%
  - Apply directly to lord `baseStats` and `personalGrowths` in RunManager
- [ ] **Economy Boons/Costs:** Starting gold ±100-200, battle gold multiplier ±10-20%
  - Modify `rm.gold` and `metaEffects.battleGoldMultiplier`
- [ ] **Roster Boons:** Free recruit (level 1 or scaled), extra deploy slot
  - Call `createRecruitUnit()` at run start, increment `metaEffects.deployBonus`
- [ ] **Act Buffs/Debuffs:** +5 Hit all units Act 1, -1 DEF all units Act 1
  - Store in `runBlessing.actModifiers[]`, apply in BattleScene at battle start, clear at act transition
- [ ] **Node Modifiers:** Skip first shop, remove all shops, fewer shop items (-2)
  - NodeMapGenerator: Check `runBlessing` and modify node generation accordingly
- [ ] **Battle Modifiers:** First 3 battles get +2 enemies
  - MapGenerator: Check `runBlessing.extraEnemies`, apply count if `battleIndex < threshold`
- [ ] **Skill Modifiers:** Disable personal skill until Act 3
  - BattleScene/SkillSystem: Filter out personal skill if `runBlessing.disablePersonalSkill && currentAct < 3`

#### 6C: Blessing UI & Display (Days 7-8)
- [ ] ShrineScene blessing card design (similar to loot cards but taller)
  - Top section: Boon name + description in green
  - Middle section: Cost name + description in red (or "No cost" in gray)
  - Bottom: Tier badge (I/II/III/IV), hover preview of full effects
- [ ] Blessing selection: Click card → confirm dialog → apply → transition to NodeMapScene
- [ ] RunCompleteScene: Display chosen blessing in victory summary (name + tier badge)
- [ ] NodeMapScene: Small blessing icon in top-right corner (hover shows full text)

#### 6D: Balance & Testing (Days 8-10)
- [ ] Create `tests/BlessingSystem.test.js`
  - Blessing selection, tier distribution, effect application, cost enforcement
  - Edge cases: all tier-4 costs survivable (not instant-lose), free option always present
- [ ] Balance tuning:
  - Tier-1 free boons modest enough to not feel mandatory
  - Tier-3 costs painful but workable ("lose DEF growth on Voss = fine, on Edric = risky")
  - Tier-4 costs brutal but enable broken combos ("no shops but start with Ragnell = fun challenge run")
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
- [ ] Terrain effects in Combat.js:
  - Ice: Units slide 1 extra tile in movement direction (after moving)
  - Lava: 5 HP damage at end of turn if standing on it
  - Quicksand: -3 MOV penalty, cannot be flown over
- [ ] Add terrain to mapTemplates.json (volcanic, tundra biomes)

#### 8B: Boss Arena Features
- [ ] Add `arenaFeatures` field to boss configs in enemies.json
  - Lava ring around throne (forces approach through damage)
  - Ice patches on flanks (limits mobility)
  - Healing tiles near boss (boss regenerates if not pressured)
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

### Why "Balance Fixes" Before "Battle Actions"?
- **Reasoning:** Balance issues frustrate existing players immediately. Battle actions are new features that can wait.
- **Tradeoff:** Delays Trade/Swap/Dance by 1-2 days, but improves experience for current build.

### Why "Map Generation" Before "Elite Nodes"?
- **Reasoning:** Map gen improvements affect 100% of battles. Elite nodes are 10% of battles.
- **Tradeoff:** Elite nodes would be higher-stakes content, but low-quality maps hurt baseline experience.

### Why "Church Upgrades" Before "Additional Objectives"?
- **Reasoning:** Church upgrade is 1 day of work, objectives are 2 weeks. Quick wins first.
- **Tradeoff:** Objectives add more variety, but church fixes an existing underutilized node type.

### Why "Blessing System" After "Skills Expansion"?
- **Reasoning:** Blessings make every run feel different from the start (like Slay the Spire's Neow bonus). Huge replayability boost for medium-high effort. Positioned after tactical depth (skills, map gen) is established so blessings modify interesting systems.
- **Tradeoff:** Could come earlier for immediate variety, but more valuable when there's a deeper game to modify. A blessing that grants a skill is boring if there are only 5 skills total — better after Wave 5 expands the skill pool.

### Why "Special Terrain" So Late?
- **Reasoning:** Hazard terrain is content-heavy (new art, biome templates, balance tuning) with medium impact.
- **Tradeoff:** Would add "wow factor" to boss fights, but core tactical loop needs depth first (skills, objectives).

---

## Next Actions

1. **Review & Approve** this roadmap structure
2. **Start Wave 0** (Balance Fixes) — highest ROI, 1-2 days
3. **Prototype Wave 2A** (Terrain-Aware Placement) — validate map gen improvements early
4. **Playtest** after each wave — iterate based on feedback

**Questions for Review:**
- Does the NOW/NEXT/LATER sequencing make sense?
- Any items that should move up or down in priority?
- Should we timebox Wave 2 (Map Gen) to prevent scope creep?
