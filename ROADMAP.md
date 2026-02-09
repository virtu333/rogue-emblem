# Rogue Emblem — Roadmap

## Current State

Phases 1-9 complete. 359 tests passing. Deployed to Netlify with Supabase auth + cloud saves. 41 meta upgrades across 6 categories, 51 weapons, 21 skills, 18 accessories, 29 classes, 21 music tracks. For architecture details, data file reference, and build order, see **CLAUDE.md**.

## Priority Order

Roughly ordered by impact and dependency:

1. **Battle Actions** — Trade, Swap, Dance (fills obvious gameplay gaps)
2. **Stat Boosters** — Permanent stat consumables (last item from equipment wave)
3. **Elite/Miniboss Nodes + Post-Act** (node map variety, difficulty progression)
4. **Expanded Skills** — Command skills, on-kill triggers (tactical depth)
5. **Additional Map Objectives** — Defend, Survive, Escape (battle variety)
6. **Meta-Progression Expansion** — Full GDD §9.2 vision
7. **QoL** — Undo movement, battle log, battle speed (ongoing)
8. **Acts 2 & 3 content tuning** + Post-Act + Final Boss design
9. **Special Characters** + Lord selection
10. **Story scaffold + dialogue**
11. **Fog of war extras** — Torch items + vision skills
12. **Difficulty modes + run modifiers**
13. **Full battle animations**
14. **Additional biomes**
15. **Campaign system**

## Implementation Waves

### Completed Waves (Summary)
- **Wave 2A-C** (Accessories, Weapons, Forging) — Complete. 18 accessories, 51 weapons, forge system with shop tab + loot whetstones
- **Wave 4A** (On-Defend Skills, New Skills) — Complete. 21 skills, 6 trigger types, 9 class innate skills, 8 scrolls
- **Wave 6A** (Home Base UI) — Complete. 6-tab UI, 41 upgrades, starting equipment/skills meta tabs
- **Wave 7A-B** (Inspection Panel, Danger Zone) — Complete

### Wave 1: Battle Actions (Trade, Swap, Dance)
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

### Wave 2D: Stat Boosters
- [ ] Add stat booster consumables to consumables.json (Energy Drop, Spirit Dust, Secret Book, Speedwing, Dracoshield, Talisman, Angelic Robe — 2000g each)
- [ ] Stat booster use logic in BattleScene item menu — permanently increase stat, consume item
- [ ] Add stat boosters to lootTables.json rare pools (NOT available in shops)

### Wave 3: Elite/Miniboss Nodes + Post-Act
- [ ] `NODE_TYPES.ELITE` in constants.js, ~10% chance in Act 2+ middle rows
- [ ] Elite battle params: +2 level, +1-2 enemies, at least one enemy with skill
- [ ] Elite node visual (orange icon) + tooltip in NodeMapScene
- [ ] Elite loot: 4 choices, pick 2 (vs normal 3/pick 1)
- [ ] Optional miniboss unit (named, guaranteed skill, higher stats)
- [ ] `postAct` in ACT_SEQUENCE between act3 and finalBoss (3 rows, all elite/battle)
- [ ] `enemies.json` postAct pool (promoted, level 16-20, Silver gear)
- [ ] `lootTables.json` postAct entry (Silver/Legendary tier)
- [ ] Tests: elite node generation, postAct in sequence, existing tests pass

### Wave 4 (Remaining): On-Kill, Commands, Shop Scrolls
- [ ] `on-kill` trigger in SkillSystem.js (Triumph: heal 20% on kill, Momentum: +2 SPD stacking)
- [ ] `on-kill` hook in Combat.resolveCombat() after lethal blow
- [ ] `trigger: "command"` type — Rally (+4 STR/SPD, 2-tile radius, once/battle), Inspire (+10 Hit/Avoid)
- [ ] "Skill" action in battle menu for command skills off cooldown
- [ ] Per-battle cooldown tracking, temporary buff application + clearing at turn start
- [ ] Skill scrolls in Act 2+ shops (1-2 random, 2500g each)
- [ ] Tests for on-kill, command skills, cooldowns, temporary buffs

### Wave 5: Additional Map Objectives
- [ ] `objective: 'defend'` — protect tile for N turns, reinforcements every 2-3 turns, turn counter UI
- [ ] `objective: 'survive'` — endure N turns, heavier reinforcement waves, kill-scaled rewards
- [ ] `objective: 'escape'` — move all units to exit tiles, Lord escapes last
- [ ] 1-2 map templates per new objective type in mapTemplates.json
- [ ] Bonus objectives: under-par turns or no losses → extra gold/XP

### Wave 6 (Remaining): Meta-Progression Expansion
- [ ] Home Base scrolling support if upgrades overflow tab area
- [ ] Current effects summary at top of each tab
- [ ] Lord Weapon Proficiency — unlock second weapon type (300-500R)
- [ ] Lord Weapon Mastery — upgrade primary to Mastery pre-promotion (400R)
- [ ] Base Class Innate Skill unlocks (10 upgrades, 150-250R each)
- [ ] Promoted Class Innate Skill unlocks (10 upgrades, 200-350R each)
- [ ] Equipped Skill Slots — increase max from 1→2→3 (400→600R)
- [ ] Better Shop Inventory — higher tier items 1 act earlier (2 tiers, 200→400R)
- [ ] Extra Node Events — +1 RECRUIT guaranteed per act (350R)
- [ ] NPC Warriors — recruit battle NPCs gain +2 all stats (200R)
- [ ] Special Characters: `data/specialChars.json` (3-5 named units with fixed growths, personal skills, unlock via meta)
- [ ] Tests for new upgrade types, special character creation, equip slot meta

### Wave 7 (Remaining): QoL & Polish
- [ ] Undo Movement — store pre-move position, cancel returns unit if no action taken
- [ ] Battle Log — scrollable log of combat results, level-ups, skill activations, defeats
- [ ] Battle Speed Controls — fast mode toggle, persist via SettingsManager

## Known Deviations from GDD

| Item | GDD Says | Implementation | Reason |
|------|----------|---------------|--------|
| Inventory cap | 4 items | `INVENTORY_MAX = 5` | Extra slot for flexibility; may revert |
| Act 1 enemy levels | 1-5 | 1-3 (per-node: row0=[1,1], row1=[1,2], row2+=[2,3]) | Balance: original range too lethal |
| Knight in Act 1 | In pool | Removed from pool (still boss class) | Balance: too tanky for L1 party |
| Boss stat bonus | Not specified | `BOSS_STAT_BONUS = 2` (was 3) | Balance: 3 was overwhelming |
| Rescue mechanic | Classic rescue (carry + halved stats) | Simple swap (exchange positions) | Simpler; may upgrade later |
| Sim scripts location | `tools/balance/` | `sim/` | Better separation of concerns |

## Long-Term Vision

- **Full Battle Animations** — Side-view combat animations (64x64 or 96x96) for each class. Combat resolution already decoupled from animation
- **Additional Biomes** — Castle/fortress, cave/dungeon, forest biomes beyond grassland. Map generator takes biome parameter
- **Narrative & Dialogue** — Brief dialogue at rest/recruitment/boss events. Simple text box with speaker portrait, no VN engine
- **Difficulty Modes** — Normal/Hard/Lunatic modifier layers on enemy stats, economy, loot. Ascension-style run modifiers for bonus Renown
- **Story Scaffold** — Light narrative: per-Lord motivation, recruitment dialogue, boss encounter lines. Data in `dialogue.json`
- **Campaign System** — Multiple campaigns with different biome progressions, boss rosters, enemy pools. Campaign = JSON config
- **Additional Lords** — Kira, Voss, Sera playable (data exists in lords.json). Lord selection at run start
- **Special Characters** — Named units with fixed growths and personal skills, unlocked via meta-progression
- **Monetization** — If commercial: cosmetic palette swaps, campaign DLC. Never sell gameplay advantages
