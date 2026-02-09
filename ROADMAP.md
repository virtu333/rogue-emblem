# Emblem Rogue — Roadmap

Long-term vision and architecture guide. Tracks what's shipped, what's next, and what's planned. For actionable near-term tasks, see **NEXT_STEPS.md**.

Last updated: February 2026

---

## Current State

**Build phases 1-8 complete. Phase 9 (Polish & Art) in progress.**

| Category | Count | Status |
|----------|-------|--------|
| Classes | 29 (15 base + 14 promoted) | Expanded: 8 lord-specific classes added |
| Lords | 4 (Edric, Kira, Voss, Sera) | Data complete; only Edric playable |
| Weapons | 51 across 8 types/tiers | Expanded: throwables, effectiveness, specials, poison, siege, 8 scrolls |
| Skills | 21 (4 personal + 17 combat/passive/defend) | Expanded: on-defend trigger, 9 class innate skills |
| Accessories | 18 (11 stat + 7 combatEffects) | Expanded: combat-time conditional accessories |
| Meta upgrades | 28 in 4 categories | Split growth/flat, lord SPD/RES added |
| Map objectives | 2 (Rout, Seize) | GDD specifies 6 |
| Node types | 5 (Battle, Rest, Boss, Shop, Recruit) | Elite/Miniboss missing |
| Tests | 283 passing | Vitest suite (save slot changes backward-compatible) |
| Audio | 18 SFX + 21 music tracks (per-act) | Complete |
| Art | Characters + tilesets partially replaced | Mostly placeholders |

**Key gaps vs. GDD:** Elite nodes, Trade/Swap actions, Dancer ability, additional map objectives, meta-progression depth, special characters.

**Recent additions:** Weapon forging system (shop forge tab + loot whetstones, max 3 forges/weapon), roster-based weapon filtering for shops/loot.

---

## Completed Systems

These are shipped and working. Listed for reference — no further work needed unless extending.

- **Grid Engine & Movement** (Phase 1) — Tiled maps, unit placement, A* pathfinding, movement ranges, terrain costs
- **Combat System** (Phase 2) — Damage formula, weapon triangle (including mastery bonuses), attack/counter, hit/crit/dodge, weapon effectiveness (3x multipliers), combat forecast
- **Unit System** (Phase 3) — 9 stats, XP/leveling, growth rates (class + personal), promotion at L10+, weapon ranks (Can't Use/Proficient/Mastery)
- **Equipment & Skills** (Phase 4) — Inventory management, weapon swapping, staff healing, 21 skills across 6 trigger types (including on-defend), skill acquisition (class level-up + scrolls), enemy skill assignment, MAX_SKILLS=5, weapon specials (drain, poison, siege, equipped stat bonuses), 8 skill scrolls
- **Map Generation** (Phase 5) — Procedural maps from 6 zone-based templates, Rout + Seize objectives, enemy pools by act, boss enemies, NPC spawn placement, reachability checks
- **Node Map** (Phase 6) — Branching node map per act, battle/rest/boss/shop/recruit nodes, act progression (act1→act2→act3→finalBoss), per-node enemy level scaling, column-lane system (5 lanes, non-crossing edges, StS-style)
- **Run Loop** (Phase 7) — Gold economy, shops, loot drops, mid-battle recruitment, deploy selection, title screen, settings, pause menu, run save/load, weapon forging (shop forge tab + loot whetstones)
- **Meta-Progression** (Phase 8) — Home Base scene with tabbed UI (Recruits/Lords/Economy/Capacity), Renown currency, 28 tiered upgrades (split growth/flat, lord SPD/RES), Begin Run flow (Title→Home Base→NodeMap), Save & Exit from pause menu, localStorage persistence
- **Audio** (Phase 9 partial) — Music + SFX integration, AudioManager, SettingsManager with volume controls, per-act music expansion (21 tracks via `musicConfig.js`: title, home base, 3 exploration, 6 battle, 4 boss, shop, rest, 4 stingers)
- **Save Slots & User Flow** (Phase 9) — 3 independent save slots (each with own meta + run state), SlotManager utility module, SlotPickerScene, new player flow (skip Home Base on first run), migration from old single-save format
- **Balance Simulations** — 4 sim scripts in `sim/` (progression, matchups, economy, fullrun), seeded RNG, shared libs

---

## Post-MVP: Core Features

Features described in the GDD (§1-14) that are expected in the complete game. Ordered roughly by implementation priority.

### Equipment Expansion: Accessories ✅ & Weapons ✅ & Forging ✅ & Stat Boosters 📋
- **Accessories** ✅ — 18 accessories in `data/accessories.json`. Two categories: stat accessories (11, applied to `unit.stats` on equip/unequip) and combat accessories (7, with `combatEffects` evaluated at combat time). In loot drops and shops by act. Team pool in `RunManager.accessories[]`.
  - **Combat accessories:** Wrath Band (+15 crit below 50%), Counter Seal (prevent enemy double), Pursuit Ring (reduce double threshold by 2), Nullify Ring (negate effectiveness), Life Ring (+3 atk/+2 def above 75%), Forest Charm (+10 avoid/+2 def on forest). Conditions evaluated in `SkillSystem.getSkillCombatMods()`.
- **Weapons** ✅ — Expanded from 32 to 51. New categories: throwable (range 1-2), effective (3x vs Armored/Cavalry), killer (high crit), legendary specials (Ragnell +5 DEF, Runesword drain, Bolting siege), poison (Venin Edge), 8 skill scrolls.
- **Stat Boosters** 📋 — Permanent +1-2 stat consumables (Energy Drop, Spirit Dust, etc.). GDD §7.4. Not yet implemented.
- **Weapon Forging** ✅ — `ForgeSystem.js` pure engine module. Max 3 forges/weapon: +1 Mt, +5 Crit, +5 Hit, or -1 Wt per forge with nonlinear costs. Shop forge tab (tabbed Buy/Sell/Forge with per-shop limits). Loot whetstones (5 types in `data/whetstones.json`, applied immediately via multi-step picker). Forge loot category in `lootTables.json` (10-15% weight). Roster-based weapon filtering for shops and loot. Forged weapons display green text + "+N" suffix. Metadata survives serialization.
- **Architecture note:** Stat accessories use direct `unit.stats` modification (HP clamped on unequip). Combat accessories use `combatEffects` field evaluated at combat time by `Combat.js` (doubleThresholdReduction, preventEnemyDouble, negateEffectiveness) and `SkillSystem.js` (conditional bonuses). Weapon specials parsed by `getWeaponStatBonuses()`, `parsePoisonDamage()`, and drain logic in `resolveCombat()`. Forge stats mutated in place on weapon objects — Combat.js reads `weapon.might` etc. directly, zero changes needed to combat pipeline.

### Elite & Miniboss System 📋
- GDD §2.3 and §11.2 — Named enemies with higher stats, unique skills, and sometimes unique AI behaviors
- Elite nodes on the node map: tougher encounters, reward choice of 2 from 4 loot (vs standard 1 from 3)
- Miniboss examples: General with Pavise turtling behind soldiers; Assassin with Lethality targeting weakest unit; Sage with long-range magic
- `NODE_TYPES.ELITE` does not exist yet; no elite enemy generation logic
- **Architecture note:** Elite battles reuse existing battle infrastructure. `battleParams.isElite` flag controls enemy scaling (+2 levels, +1-2 count) and loot screen behavior (2 picks from 4). Miniboss units are just enemies with named status + guaranteed skill.

### Battle Actions: Trade, Swap, Dance 📋
- **Trade** (GDD §3.2) — Swap items with adjacent ally. Standard FE feature, important for inventory management. Not implemented.
- **Swap** — Exchange positions with adjacent ally. Simpler alternative to classic FE Rescue. Enables repositioning fragile units. Not implemented.
- **Dance** (GDD §5.1) — Dancer class exists in `classes.json` but its signature ability (grant adjacent ally a second turn) is not implemented. Needs: target selection (adjacent acted allies), refresh acted ally's flags, end Dancer's turn.
- **Architecture note:** Action menu in `BattleScene.showActionMenu()` is fully dynamic — adding new actions requires a condition check, menu item, and handler. Pattern is well-established from Attack/Heal/Talk/Seize.

### Additional Map Objectives 📋
- Currently only **Rout** (defeat all) and **Seize** (Lord captures tile) are implemented
- GDD §3.7 specifies 4 more:
  - **Defend** — Protect a tile or NPC for X turns against waves
  - **Escape** — Move all surviving units to exit tiles
  - **Survive** — Endure X turns of enemy waves; rewards scale with kills
  - **Protect & Recruit** — Partially exists (recruit maps), but not as a formal timed objective
- **Bonus objectives** — Complete in fewer turns, no unit losses → extra gold/XP (GDD §3.7)
- **Reinforcements** — Enemy waves spawning mid-battle (required for Defend/Survive). Not implemented.
- **Architecture note:** `TurnManager.js` checks win/loss conditions each phase. New objectives need: turn counter tracking, reinforcement spawn logic, and new win condition checks. Map templates need objective-specific spawn zones (exit tiles, defend points).

### Acts 2 & 3 + Post-Act + Final Boss 🔨
- Act progression (act1→act2→act3→finalBoss) and node maps: **done**
- Enemy pools parameterized by act: **done**
- Per-node level scaling (Act 1): **done**
- **Remaining:**
  - Post-Act elite skirmish gauntlet — `postAct` not in `ACT_SEQUENCE`, needs 3-4 elite/battle rows before final boss
  - Multi-phase Final Boss (GDD §11.4) — currently `finalBoss` is a single node with standard battle
  - Fixed boss encounter design (GDD §11.3) — bosses currently use procedural maps, not hand-crafted learnable layouts
- **Addressed:** Act 1 enemy levels tuned, Knight removed from act1 pool, BOSS_STAT_BONUS=2, starting Vulneraries
- **Architecture note:** Map generation, enemy pools, and loot tables are already parameterized by Act. Don't hardcode Act 1 assumptions.

### Expanded Skill System 🔨
- **Done:** 21 skills, 6 trigger types (passive, passive-aura, on-combat-start, on-attack, on-turn-start, on-defend), SkillSystem evaluation engine, combat integration via `skillCtx`, skill acquisition (class level-up + scrolls), enemy skill assignment, `rollDefenseSkills()` for on-defend trigger
  - **On-defend** ✅ — Pavise (SKL% halve physical), Aegis (SKL% halve magical), Miracle (LCK% survive lethal with 1 HP). Wired into `Combat.rollStrike()`.
  - **New class innate skills** ✅ — General (Pavise), Paladin (Aegis), Warrior (Colossus), Falcon Knight (Discipline), Bishop (Renewal), Hero (Vigilance)
  - **New general skills** ✅ — Adept (SPD% extra strike), Miracle (LCK% survive lethal), Guard (+3 DEF/RES near allies)
  - **New activation types** ✅ — SPD (Adept), LCK (Miracle) alongside existing SKL/SKL_HALF/LCK_QUARTER
  - **Learnable skills on base classes** ✅ — Myrmidon (Vantage L8), Knight (Guard L8), Fighter (Wrath L8), Cavalier (Sol L10), Archer (Adept L10), Cleric (Miracle L8), Thief (Luna L8), Pegasus Knight (Sol L10), Mercenary (Astra L10)
  - **8 skill scrolls** ✅ — Sol, Luna, Astra, Vantage, Wrath, Adept, Miracle, Guard
- **Remaining:**
  - **Command skills** (GDD §6.2) — Activated abilities with cooldowns (e.g., Rally: +4 STR/SPD to adjacent allies for 1 turn). New trigger type `command`. Needs per-battle cooldown tracking and "Skill" action in battle menu.
  - **On-kill trigger** — Skills that activate on defeating an enemy (e.g., Triumph: heal 20% HP)
  - **Skill scrolls in shops** — Currently scrolls only appear as loot; shops should stock them too
  - **Meta-progression skill unlocks** — Innate skills for base and promoted classes, unlocked via Home Base (see Meta-Progression below)
- **Architecture note:** Skill trigger hooks are in place in `Combat.js`. To add new skills: add entry to `skills.json`, add handler in `SkillSystem.js`. `BattleScene` assembles the `skillCtx` bridge. `rollDefenseSkills()` handles on-defend triggers in `rollStrike()`.

### Meta-Progression Expansion 📋
Current implementation: 28 upgrades in 4 categories (recruit_stats, lord_bonuses, economy, capacity). Growth and flat bonuses are independent upgrades with 5 and 3 tiers respectively. Lord SPD/RES bonuses added. Home Base has tabbed UI. The GDD §9.2 envisions significantly deeper systems:

**Lord Upgrades (GDD §9.2.1):**
- Improve Lord growth rates — ✅ done (5 lord growth upgrades: HP/STR/DEF/SPD/RES, 5 tiers each)
- Improve Lord starting stats — ✅ done (5 lord flat upgrades: HP/STR/DEF/SPD/RES, 3 tiers each)
- Unlock additional weapon proficiencies for Lord — 📋 not implemented
- Upgrade weapon proficiencies to Mastery — 📋 not implemented
- Customize starting skills (innate + equipped) — 📋 not implemented
- Unlock starting weapons (begin with better gear) — 📋 not implemented
- Unlock alternative Lord classes / promotion paths — 💡 future (complex)

**Class & Recruit Upgrades (GDD §9.2.2):**
- Improve recruit base stats / growth rates — ✅ done (6 recruit growth upgrades + 6 recruit flat upgrades, independent tiers)
- Unlock innate skills for base classes — 📋 not implemented
- Unlock innate skills for promoted classes — 📋 not implemented
- Increase equipped skill slot count (1→2→3) — 📋 not implemented
- Unlock new classes for recruitment pool — 💡 future
- Unlock new weapon proficiencies for classes — 💡 future

**Special Character Unlocks (GDD §9.2.3):**
- Named units with fixed personal growths, unique portraits, sometimes unique class trees — 📋 not implemented
- `data/specialChars.json` does not exist
- Appear in recruit pool when unlocked via meta-progression

**General Upgrades (GDD §9.2.4):**
- Starting gold bonus — ✅ done (War Chest, 3 tiers)
- Battle gold multiplier — ✅ done (Plunder, 2 tiers)
- Starting Vulnerary — ✅ done (Field Supplies, 1 tier)
- Loot quality bonus — ✅ done (Lucky Finds, 2 tiers)
- Deploy limit bonus — ✅ done (Tactical Advantage, 1 tier)
- Roster cap bonus — ✅ done (Expanded Ranks, 1 tier)
- Better shop inventories — 📋 not implemented (higher tier items earlier)
- Additional node map events — 📋 not implemented
- NPC warrior improvements — 📋 not implemented

**Home Base UI** — ✅ Redesigned as tabbed UI (Recruits/Lords/Economy/Capacity) with progress bars and sub-headers. Begin Run button starts new games. Can accommodate more upgrades within existing tab structure.

- **Architecture note:** `MetaProgressionManager.js` is pure with no Phaser deps. `getActiveEffects()` is the single integration point — all consumers (RunManager, UnitManager, BattleScene, LootSystem) read from the flat effects object. New upgrade categories need: new entries in `metaUpgrades.json`, extended effect aggregation in `getActiveEffects()`, and consumer code to apply the new effects.

### Additional Lord Characters 📋
- Kira (Tactician), Voss (Ranger), Sera (Light Sage) already have full stats in `data/lords.json`
- **Lord classes added to classes.json** ✅ — Lord, Tactician, Ranger, Light Sage (base) + Great Lord, Grandmaster, Vanguard, Light Priestess (promoted). Total classes: 29 (15 base + 14 promoted).
- **Lord selection at run start** — deferred for now; Edric is the only playable lord
- More Lords beyond the four as long-term unlocks (GDD §5.2 lists 8 lord class lines; only 4 implemented)
- Each Lord should fundamentally change team composition strategy
- **Architecture note:** Lord selection at run start, Lord-specific personal skills, and Lord-specific promotion paths must be supported. TitleScene "New Game" flow needs a Lord picker before starting NodeMap.

### Special Characters 📋
- Named units with unique portraits, fixed personal growths, and sometimes unique class trees (GDD §9.2.3)
- Unlocked via meta-progression, appear in recruitment pool during runs
- Unlike generic recruits, they retain identity across runs but must be re-recruited each run
- Data file: `data/specialChars.json` (TODO — does not exist)
- **Architecture note:** Unit generation must distinguish between generic recruits (randomized growths) and special characters (fixed identity). `createRecruitUnit()` in UnitManager needs a special character path.

### Fog of War ✅
- Implemented as random map modifier (30% of battle nodes, boss/recruit excluded)
- Vision ranges per move type: Infantry/Armored=3, Cavalry=4, Flying=5 tiles
- Player-side only (enemies have full map knowledge)
- **Remaining:** Torch items, vision-extending skills, Thief/Assassin bonus vision

### Full Battle Animations 💡
- Side-view combat animations (64x64 or 96x96) for each class (GDD §12.1.2)
- Idle, attack, hit, dodge, critical, defeat frames
- MVP uses attack flash + damage number; this replaces that
- **Architecture note:** Combat resolution is already decoupled from animation. Calculate results first, then play visuals. This enables quick mode toggle.

### Additional Biomes & Tilesets 💡
- Castle/fortress, cave/dungeon, forest biomes beyond grassland (GDD §12.1.4)
- Each biome has its own tileset, terrain distribution rules, and visual feel
- **Architecture note:** Map generator should take a biome parameter that controls terrain distribution and tileset selection.

### Narrative & Dialogue System 💡
- Brief dialogue scenes at rest nodes, recruitment events, boss encounters
- Lord-specific dialogue lines
- Light story scaffolding — see "Story Scaffold" section below
- Data file: `data/dialogue.json` (TODO — does not exist)
- **Architecture note:** Don't build a visual novel engine. A simple sequential text display with speaker portrait is sufficient.

---

## Difficulty & Modifiers 💡

### Difficulty Modes
- **Normal:** Base experience as designed
- **Hard:** Enemies gain +1-2 to key stats, tighter gold economy, fewer loot choices
- **Lunatic:** Enemies have skills, bosses gain additional phases, reduced XP gain
- Implementation: Difficulty is a multiplier/modifier layer applied to enemy generation, gold rewards, and loot tables
- **Architecture note:** Enemy stat generation and reward calculation should accept a difficulty modifier. Even MVP can pass `difficultyMod: 1.0` through `battleParams`.

### Run Modifiers (Ascension-style)
- After first clear, unlock optional modifiers that increase difficulty for bonus Renown
- Examples: "Enemies always have weapon triangle advantage," "No shops," "Fog on all maps," "Deploy limit -1"
- Similar to Slay the Spire's Ascension system or Hades' Heat gauge
- **Architecture note:** Best implemented as boolean/numeric flags in a `runModifiers` object in run state.

### Iron Man Mode
- No mid-battle save scumming (auto-save only at node map)
- Already somewhat implied by roguelike structure but worth making explicit

---

## Story Scaffold 💡

A light narrative framework to give runs thematic context without heavy writing investment.

### Campaign Premise
- The Lord leads a warband through a collapsing kingdom / rising threat
- Each Act represents a stage of the journey (border skirmishes → occupied territory → enemy stronghold)
- Boss encounters have brief pre-battle dialogue establishing the antagonist

### Per-Lord Story Hooks
- Each Lord has a 2-3 sentence motivation that colors their dialogue
- Edric: Reclaiming a fallen kingdom. Kira: Seeking forbidden knowledge. Voss: Vengeance for a destroyed homeland. Sera: Protecting refugees.
- Lord-specific lines at key moments (boss encounters, recruitment, run failure)

### Recruitment Dialogue
- Short 2-3 line exchanges when the Lord recruits an NPC
- Generic recruits: class-flavored lines ("Another sword for the cause" / "I can mend your wounds")
- Special characters: unique recruitment scenes

### Implementation
- Dialogue stored in `data/dialogue.json` keyed by event type, Lord, and character
- Simple text box system over the game view — no cutscenes, no branching dialogue trees
- **Architecture note:** Don't build a visual novel engine. A simple sequential text display with speaker portrait is sufficient.

---

## Campaign System (Multiple Campaigns) 💡

### Concept
- After completing the base campaign, unlock additional campaigns with different Act 1-3 structures
- Each campaign has: different biome progression, boss roster, enemy pools, story premise
- Same meta-progression carries across campaigns

### Example Campaign Structures
- **Base Campaign:** Grassland → Castle → Dark Fortress (included in MVP/core)
- **Campaign 2: Sea of Sand:** Desert → Oasis City → Buried Temple. Cavalry disadvantaged, fliers strong.
- **Campaign 3: Frozen March:** Tundra → Mountain Pass → Ice Citadel. Movement-restricted terrain.

### Implementation
- Each campaign is a JSON config defining: Act sequence, biome per Act, boss pool, enemy pool overrides, story text, node map generation parameters
- Campaign selection at run start (after Lord selection)
- **Architecture note:** The Act/node map system should not assume a single fixed campaign. Parameterize so swapping campaigns = loading a different config. This is the single most important extensibility consideration.

---

## Balance Simulation ✅

**Implemented in `sim/` directory.** Four simulation scripts with seeded RNG (Mulberry32):

- `sim/progression.js` — EV stats, XP model, Monte Carlo growths, player vs enemy power curves
- `sim/matchups.js` — Class matchup matrix, focus mode, scenario tests (Wrath+crit, Brave+Astra, Knight viability)
- `sim/economy.js` — Gold flow with spending strategies, meta impact comparison
- `sim/fullrun.js` — Full run Monte Carlo, abstract battle resolution, act progression, meta sweep

All scripts accept `--seed S`, `--trials N`, `--csv`. Run via `npm run sim:progression` etc. Shared libs in `sim/lib/`. Pure engine imports — no Phaser.

**Future expansion:** Update sims when accessories, new skills, and new objectives are added. Add sim for elite/miniboss difficulty validation.

---

## Quality of Life & Polish 📋

### Unit Inspection Panel (Right-Click) ✅
- Implemented as `src/ui/UnitInspectionPanel.js` — right-click opens detailed panel with all stats, skills, inventory, growths, terrain bonuses. Works for all factions.

### Danger Zone Overlay ✅
- Implemented as `src/ui/DangerZoneOverlay.js` — D key toggles orange overlay of all enemy-threatened tiles. Cached until invalidated by unit death or phase change.

### Undo Movement
- Allow undoing a unit's movement if no action has been taken yet (standard FE feature)
- Store pre-move position, restore on cancel
- **Priority:** High

### Battle Log
- Scrollable log of combat results, level-ups, and events for the current battle
- Helps track what happened during enemy phase
- **Priority:** Medium

### Battle Speed Controls
- Fast mode: skip animations, instant damage numbers
- Auto-battle: AI plays player phase with basic heuristics
- **Priority:** Medium

### Unit Sorting & Filtering
- Sort roster by class, level, stat, weapon type
- Filter by promoted/unpromoted, weapon type, role
- **Priority:** Low

### Accessibility
- Colorblind-friendly palette options for faction colors and terrain highlights
- Keyboard-only navigation support
- Screen reader support for menus and stat screens
- **Priority:** Low (but important for inclusivity)

---

## Monetization Considerations (If Applicable) 💡

Not currently planned, but if the game goes commercial:
- Cosmetic palette swaps for Lords and units
- Additional campaign packs as DLC
- Never sell meta-progression currency or gameplay advantages
- The base game with 1 campaign and all core systems should be complete and satisfying standalone

---

## Status Legend

| Marker | Meaning |
|--------|---------|
| ✅ | Done — shipped and working |
| 🔨 | In Progress — partially built, work remaining |
| 📋 | Planned — designed, ready to build (see NEXT_STEPS.md for timing) |
| 💡 | Future — long-term vision, not yet scheduled |

---

## Priority Order

Roughly ordered by impact and dependency:

1. **Battle Actions** — Trade, Swap, Dance (fills obvious gameplay gaps)
2. ~~**Accessories**~~ ✅ (18 items, combatEffects) | ~~**Weapons Expansion**~~ ✅ (51 weapons) | ~~**Forging**~~ ✅ (shop + loot whetstones) | **Stat Boosters** 📋
3. **Elite/Miniboss Nodes + Post-Act** (node map variety, difficulty progression)
4. **Expanded Skills** — ~~on-defend~~ ✅ | command skills, on-kill triggers (tactical depth)
5. **Additional Map Objectives** — Defend, Survive, Escape (battle variety)
6. **Meta-Progression Expansion** — full GDD §9.2 vision + Home Base UI overhaul
7. **QoL** — ~~inspection panel~~ ✅, ~~danger zone~~ ✅, undo, battle log, battle speed (ongoing)
8. **Acts 2 & 3 content tuning** + Post-Act + Final Boss design
9. **Special Characters** + Lord selection
10. **Story scaffold + dialogue**
11. ~~**Fog of war**~~ ✅ (basic implementation; Torch items + vision skills remaining)
12. **Difficulty modes + run modifiers**
13. **Full battle animations**
14. **Additional biomes**
15. **Campaign system**
