# Rogue Emblem — Roadmap

## Current State

Phases 1-9 complete. 720 tests passing on `main` (Feb 2026 baseline). Deployed to Netlify with Supabase auth + cloud saves. 41 meta upgrades across 6 categories, 52 weapons, 21 skills, 18 accessories, 29 classes, 38 music tracks, battle actions (Trade/Swap/Dance), turn bonus system, boss recruit event, tutorial hints, dual currency meta, FE GBA-style combat forecast. Wave 2 map generation enhancements are merged on `main`; Wave 6 blessings Phase 2 plumbing is staged on `agent/wave6-blessings`. For architecture details, data file reference, and build order, see **CLAUDE.md**.

## Priority Order (Feb 2026)

Organized by impact and logical sequencing:

### Done
1. ~~**Playtest Bugfixes (P0)**~~ — Canto+Wait, stale tooltip, enemy range, node freeze
2. ~~**UI Polish (P1)**~~ — V-overlay tabs, combat forecast, weapon proficiency, forge hover
3. ~~**Anti-Juggernaut & Balance (Wave 0)**~~ — XP scaling, Sunder weapons, enemy skills, shop frequency
4. ~~**Church Upgrades**~~ — Heal/Revive/Promote 3-service menu
5. ~~**Playtest Fixes (Feb 2026)**~~ — Weapon reference integrity, proficiency enforcement, music overlap, volume curve, recruit spawn bias

### Now (Current Sprint)
6. **Wave 6 Blessings (Phase 2 Plumbing + PR Review)** — Contract-frozen schema, run-state migration, deterministic selection hook, telemetry, and test gates

### Next (1-3 Months)
7. **Elite/Miniboss Nodes + Post-Act** — Endgame content and difficulty curve
8. **Difficulty Foundation** — Normal/Hard selector, `difficulty.json` modifier layer, currency multiplier (Valor + Supply), extended leveling. Hard = same acts, harder parameters. Lunatic greyed "Coming Soon." (See `difficulty_spec.md` §1-3)
9. **Dynamic Recruit Nodes** — Roster-aware recruit frequency
10. **Expanded Skills** — Command skills, on-kill triggers (tactical depth)
11. **Blessing System** — Neow-style run modifiers, 1 per run, same pool across difficulties

### Later (3-6+ Months)
12. **Additional Map Objectives** — Defend, Survive, Escape (battle variety) + reinforcement system
13. **Status Staves + Countermeasures** — Sleep/Berserk/Plant staves (enemy Act 2+), Herbs/Pure Water/Remedy counter items (See `difficulty_spec.md` §10)
14. **Terrain Hazards + Act 4 Content** — Lava, Cracked Floor, Rift Portal terrain + Zombies/Dragons/Manaketes + Act 4 structure + Temporal Guardian boss (See `difficulty_spec.md` §4-5)
15. **Secret Act + Narrative** — Void terrain, Warp Tiles, Null Zones, Chronophage boss, dialogue system, true ending (See `difficulty_spec.md` §5-6)
16. **Meta-Progression Expansion** — Full GDD §9.2 vision + Act 4/Lunatic-specific sinks
17. **QoL** — Undo movement, battle log, battle speed (ongoing)
18. **Acts 2 & 3 content tuning** + Post-Act + Final Boss design
19. **Special Characters** + Lord selection
20. **Full battle animations**
21. **Additional biomes** (volcanic, void, cave, castle per act — See `difficulty_spec.md` §8)
22. **Campaign system**
23. **Endless mode + Lunatic+** — Post-Lunatic content (See `difficulty_spec.md` §12.3)

---

## Implementation Waves

### Completed Waves (Summary)
- **Wave 2A-C** (Accessories, Weapons, Forging) — Complete. 18 accessories, 52 weapons, forge system with shop tab + loot whetstones
- **Wave 2D** (Stat Boosters) — Complete. 7 stat boosters in consumables.json, loot-only (not in shops)
- **Wave 2 (Map Generation Enhancements 2A-2E)** — Complete. Terrain-aware enemy placement, template affinity, boss throne AI/guards, recruit visibility safety, and template-driven fog
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
- **Playtest Fixes (Feb 2026)** — Complete. FE GBA-style combat forecast with weapon cycling, weapon reference integrity after JSON round-trips (relinkWeapon), proficiency enforcement across all equip/heal/relink paths, music overlap singleton boot guard, quadratic volume curve, HP persistence hint, recruit spawn bias toward players

---

## NOW: Wave 6 Blessings

### Wave 2: Map Generation Enhancements (Completed Feb 2026)
**Priority:** High — Biggest bang-for-buck improvement to tactical feel
**Effort:** 2-3 weeks (8 features, up from 5)

These include original map gen ideas plus critical fixes from playtesting. This section remains as the implementation breakdown reference now that the Wave 2 slice is merged.

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

### Wave 4: Dynamic Recruit Nodes
**Priority:** Medium-High — Improves run pacing and player agency
**Effort:** 1-2 days

*Note: Church Service Upgrades (4B) already complete — Heal/Revive/Promote 3-service menu shipped.*

- [ ] RunManager: Track `rosterSize` and `rosterCap`
- [ ] NodeMapGenerator: Increase recruit node chance if `rosterSize < rosterCap - 2`
  - Normal: 15% chance per eligible node
  - Low roster: 30% chance per eligible node
- [ ] Cap at 1 recruit per 2 rows (don't flood the map)

**Impact:** Players who lose units aren't punished with no recovery options.

**Success Criteria:**
- [ ] Depleted rosters get more recruit opportunities
- [ ] Recruit frequency doesn't flood the map

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
- **Difficulty Modes** — Normal/Hard/Lunatic modifier layers, currency multiplier (Valor + Supply), Act 4, Secret Act, extended leveling, new enemies (Zombies/Dragons), status staves. Full spec: `difficulty_spec.md`. Foundation (modifier layer) ships early; content (Act 4+) ships after objectives/terrain waves.
- **Story Scaffold** — Light narrative: per-Lord motivation, recruitment dialogue, boss encounter lines. Data in `dialogue.json`
- **Campaign System** — Multiple campaigns with different biome progressions, boss rosters, enemy pools. Campaign = JSON config
- **Additional Lords** — Kira, Voss, Sera playable (data exists in lords.json). Lord selection at run start
- **Special Characters** — Named units with fixed growths and personal skills, unlocked via meta-progression
- **Monetization** — If commercial: cosmetic palette swaps, campaign DLC. Never sell gameplay advantages
- **Mobile Web Support** — Responsive scaling (ENVELOP mode or 960×640), touch controls (floating buttons, long-press), orientation lock
- **iOS Port** — Capacitor wrapper after mobile web support stable (6-week effort, see `docs/ios-port-spec.md`)

---

## Roadmap Decisions & Tradeoffs

### Why Map Generation Next?
- Map gen improvements affect 100% of battles. Boss throne AI is nearly mandatory for seize maps. Guard enemies + terrain-aware placement make every fight feel smarter.

### Why Blessing System After Skills?
- Blessings modify game systems — more valuable when there are deeper systems to modify. Positioned after tactical depth (skills, map gen) is established.

### Why Difficulty Foundation Before Blessings/Skills?
- The numeric modifier layer (enemy stats, gold, prices, XP, fog, enemy count) touches only existing systems — zero new features required. Shipping it after Elite Nodes means every subsequent wave is difficulty-aware from the start. Hard is fully playable with just the modifier layer (same acts, tighter economy, tougher enemies). Act 4/Secret Act content ships later when terrain hazards and new enemy types are ready.

### Why Status Staves in Later?
- Status effects are a significant new combat system (3 conditions, hit formula, AI targeting, countermeasure items). They add the most value alongside Act 4's harder enemies where status management becomes a core tactical concern. Countermeasure items (Herbs, Pure Water, Remedy) should be available in shops before status staves appear on enemies.

---

## Next Actions

1. ~~**Waves P0/P1/Wave 0** (Bugfixes, UI Polish, Balance)~~ ✅ Done
2. ~~**Church Upgrades + Playtest Fixes (Feb 2026)**~~ ✅ Done
3. ~~**Wave 2** (Map Generation Enhancements)~~ ✅ Done
4. **Wave 6** (Blessings) — **Current in PR branch `agent/wave6-blessings`**
5. **Wave 3** (Elite/Miniboss Nodes) → **Difficulty Foundation** → **Wave 4** (Dynamic Recruits) → **Wave 5** (Skills)
6. **Playtest** after Wave 6 merge
7. **Later:** Wave 7 (Objectives) → Status Staves → Terrain/Act 4 → Secret Act/Narrative → Meta Expansion

## Deployment

Auto-deploys via Netlify GitHub integration. Pushing to `main` triggers build + publish automatically. No manual `netlify deploy` needed.
