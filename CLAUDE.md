# Emblem Rogue — Claude Code Guide

## Project Overview
Emblem Rogue is a browser-based tactical RPG combining Fire Emblem grid combat with roguelike run structure. Built with Phaser.js (HTML5 Canvas), SNES-inspired pixel art, all game data driven by JSON.

**Full GDD:** `docs/emblem_rogue_gdd.docx`
**Class/Weapon Data:** `docs/emblem_rogue_class_data.xlsx` (already parsed into `data/*.json`)
**Roadmap:** `ROADMAP.md` (long-term vision + architecture notes)
**Next Steps:** `NEXT_STEPS.md` (actionable implementation waves)

## Tech Stack
- **Engine:** Phaser.js 3 (HTML5 Canvas)
- **Language:** JavaScript (ES modules)
- **Data:** JSON files in `data/` (source of truth) synced to `public/data/` (runtime). Edit `data/*.json` then run `npm run sync-data` (or let `npm run build` auto-sync)
- **Build:** Vite for dev server and bundling
- **Hosting:** Netlify (static CDN) — https://emblem-rogue.netlify.app
- **Auth:** Supabase Auth (username/password, email confirmation disabled)
- **Cloud DB:** Supabase Postgres — 3 tables (`run_saves`, `meta_progression`, `user_settings`) with RLS per user
- **Persistence:** localStorage primary with 3 independent save slots (`emblem_rogue_slot_{1-3}_meta/run`). Supabase cloud backup (fire-and-forget push on save, fetch on login). Offline play degrades gracefully. Old single-save data auto-migrates to slot 1.
- **Art Pipeline:** PixelLab MCP for AI-generated pixel art assets

## Project Structure
```
emblem-rogue/
├── CLAUDE.md              # This file
├── package.json
├── vite.config.js
├── index.html
├── public/                # Static files served as-is
├── docs/                  # Design documents (reference only)
│   ├── emblem_rogue_gdd.docx
│   └── emblem_rogue_class_data.xlsx
├── data/                  # Game data JSON (loaded at runtime)
│   ├── classes.json       # 29 entries: 15 base + 14 promoted (includes lord classes) ✅
│   ├── lords.json         # 4 lord characters with stats/growths/promotions
│   ├── weapons.json       # 51 weapons across all types and tiers ✅
│   ├── terrain.json       # 10 terrain types with move costs and bonuses
│   ├── mapSizes.json      # 8 map size templates by act/phase
│   ├── skills.json        # 21 skills: personal, combat, class innate, on-defend ✅
│   ├── mapTemplates.json  # 6 zone-based map templates (4 rout, 2 seize) ✅
│   ├── enemies.json       # Enemy pools by act, boss defs, count scaling ✅
│   ├── consumables.json   # 3 consumable items: Vulnerary, Elixir, Master Seal ✅
│   ├── lootTables.json    # Per-act loot pools with weighted categories ✅
│   ├── recruits.json      # Recruit pools by act: 6 named NPCs per act ✅
│   ├── accessories.json   # 18 accessories: 11 stat-based + 7 with combatEffects ✅
│   ├── whetstones.json    # 5 whetstones: Silver (choice), Might, Crit, Hit, Weight ✅
│   ├── turnBonus.json     # Turn par calculation config: weights, brackets, per-act bonus gold ✅
│   └── metaUpgrades.json  # 41 tiered upgrades in 6 categories (recruit_stats, lord_bonuses, economy, capacity, starting_equipment, starting_skills) ✅
├── .env.example           # Template for Supabase env vars
├── src/
│   ├── main.js            # Auth gate + Phaser bootstrap (exports cloudState)
│   ├── cloud/             # Supabase auth + cloud sync
│   │   ├── supabaseClient.js # Supabase singleton, signUp/signIn/signOut/getSession ✅
│   │   └── CloudSync.js   # Fire-and-forget cloud save/load (fetchAllToLocalStorage, push*, delete*) ✅
│   ├── engine/            # Core game systems
│   │   ├── Grid.js        # Grid rendering, tile management, pathfinding, fog of war ✅
│   │   ├── Combat.js      # Damage formula, weapon triangle, hit/crit calc, skill mods, weapon specials (drain/poison/siege), accessory combatEffects ✅
│   │   ├── SkillSystem.js # Skill evaluation engine (pure functions), on-defend trigger, accessory combatEffects integration ✅
│   │   ├── MapGenerator.js # Procedural map gen from templates (pure functions) ✅
│   │   ├── NodeMapGenerator.js # Branching node map graph generation, per-node level scaling (pure) ✅
│   │   ├── RunManager.js  # Run state: roster, act progression, gold, slot-aware save/load ✅
│   │   ├── SlotManager.js # Save slot utilities: 3 slots, migration, active slot tracking (pure) ✅
│   │   ├── LootSystem.js  # Gold calc, loot generation, shop inventory (pure) ✅
│   │   ├── ForgeSystem.js # Weapon forging: eligibility, stat bonuses, cost calculation, naming (pure) ✅
│   │   ├── TurnBonusCalculator.js # Turn par calculation, S/A/B/C rating, bonus gold (pure) ✅
│   │   ├── MetaProgressionManager.js # Renown tracking, upgrade purchases, active effects, configurable storage key (pure) ✅
│   │   ├── TurnManager.js # Player phase / enemy phase flow, objective-aware, npcUnits
│   │   ├── UnitManager.js # Unit creation, stats, leveling, promotion, skill assignment, recruit creation, accessories ✅
│   │   ├── AIController.js # Enemy AI decision-making, NPC targeting
│   │   └── DataLoader.js  # Load and parse JSON data files
│   ├── data/              # Static help content
│   │   └── helpContent.js  # HELP_TABS (8 categories) + HOW_TO_PLAY_PAGES (4 pages) ✅
│   ├── ui/                # UI components
│   │   ├── LevelUpPopup.js # FE-style stat gain popup (supports promotion mode, stat colors) ✅
│   │   ├── UnitInspectionPanel.js # Tabbed right-click unit inspection (160px wide, 9px font) — Stats tab (stats/growths/proficiencies/terrain), Gear tab (inventory/consumables/accessory/skills). LEFT/RIGHT arrow keys or clickable tabs ✅
│   │   ├── DangerZoneOverlay.js # Enemy threat range overlay (D key toggle) ✅
│   │   ├── RosterOverlay.js # Node map roster management: stats, equip, trade, accessories (depth 700) ✅
│   │   ├── SettingsOverlay.js # Reusable volume control panel (depth 900) ✅
│   │   ├── PauseOverlay.js # Pause menu: Resume / Settings / Help / Save & Exit / Abandon Run (depth 800) ✅
│   │   ├── HelpOverlay.js  # Tabbed help reference dictionary (8 tabs, paginated, depth 860-862) ✅
│   │   └── HowToPlayOverlay.js # Linear How to Play guide (4 pages, depth 500-502) ✅
│   ├── scenes/            # Phaser scenes
│   │   ├── BootScene.js   # Asset loading, settings/audio init, migration, cloud sync ✅
│   │   ├── TitleScene.js  # Animated pixel-art title screen: sky/castle/fireflies background, styled buttons, Press Start 2P font ✅
│   │   ├── SlotPickerScene.js # Save slot selection: 3 slots with summaries, select/delete ✅
│   │   ├── HomeBaseScene.js # Meta-progression tabbed UI (6 tabs: Recruits/Lords/Economy/Battalion/Equip/Skills), Begin Run, ESC to title ✅
│   │   ├── NodeMapScene.js # Node map, shop, roster menu, auto-save, gear icon, ESC pause, music ✅
│   │   ├── BattleScene.js # Tactical battle, deploy, loot, recruitment, ESC pause, SFX, right-click enemy range ✅
│   │   └── RunCompleteScene.js # Victory/defeat end screen, clears run save, awards renown, Home Base / Title ✅
│   └── utils/             # Helpers
│       ├── AudioManager.js # Music/SFX playback wrapper (stored on Phaser registry) ✅
│       ├── musicConfig.js # Centralized MUSIC config, getMusicKey(purpose, act), ALL_MUSIC_KEYS (38 tracks) ✅
│       ├── SettingsManager.js # Pure localStorage wrapper for user settings (volumes), onSave callback ✅
│       ├── constants.js   # Game-wide constants (ACT_CONFIG, NODE_TYPES, ROSTER_CAP, DEPLOY_LIMITS, gold/renown economy, VISION_RANGES, FOG_CHANCE, NODE_GOLD_MULTIPLIER, SHOP_REROLL_COST)
│       └── uiStyles.js    # Centralized UI constants (fonts, colors, stat colors, HP bar gradient) ✅
├── tests/                 # Vitest test suite (359 tests, all pass)
│   ├── testData.js        # Shared data loader for tests
│   ├── MapGenerator.test.js # 37 tests: map gen, reachability, spawns, NPC spawn, deployCount, levelRange override ✅
│   ├── Combat.test.js     # 41 tests: damage, triangle, doubling, forecast, staff healing, weapon specials ✅
│   ├── UnitManager.test.js # 28 tests: creation, leveling, promotion, skills, recruit unit, cloning ✅
│   ├── NodeMapGenerator.test.js # 32 tests: node map structure, edges, reachability, RECRUIT nodes, per-node level scaling, column-lane system (non-crossing edges) ✅
│   ├── RunManager.test.js # 46 tests: run state, roster, act progression, save/load, meta equipment/skills ✅
│   ├── LootSystem.test.js # 35 tests: gold calc, loot gen, shop inventory, sell prices, forge loot, whetstones ✅
│   ├── SettingsManager.test.js # 7 tests: defaults, load, save, clamp, error handling ✅
│   ├── MetaProgressionManager.test.js # 55 tests: renown, upgrades, 5-tier growth, 3-tier flat, lord SPD/RES, split aggregation, calculateRenown, skill assignments, starting equipment ✅
│   ├── Accessories.test.js # 10 tests: equip, unequip, roundtrip, HP clamp, loot, shop, serialization ✅
│   ├── FogOfWar.test.js # 12 tests: vision range, boundaries, fog constants, node generation ✅
│   ├── ForgeSystem.test.js # 31 tests: forge eligibility, stat bonuses, naming, cost, limits ✅
│   └── TurnBonusCalculator.test.js # 25 tests: par calculation, rating brackets, bonus gold, edge cases ✅
├── References/            # Source sprite sheets + extracted assets (not deployed)
│   ├── *.png              # 4 Gemini-generated sprite sheets (player, enemy, terrain, UI)
│   ├── Music Fx Packs/    # Source WAV music + SFX (converted to OGG in assets/audio/)
│   └── split/             # Extracted individual sprites (see TODO.md for details)
│       ├── player_units/  # 128 blue-palette character sprites (~180x193px)
│       ├── enemy_units/   # 128 red-palette character sprites (~180x192px)
│       ├── terrain/       # 5 terrain tileset sections (variable size)
│       └── ui_icons/      # 56 UI icons (variable size)
├── assets/
│   ├── sprites/
│   │   ├── characters/    # Game-ready map sprites (32x32, transparent bg)
│   │   ├── tilesets/      # Terrain tiles (32x32)
│   │   ├── nodes/         # Node map icons (48x48, transparent bg) ✅
│   │   ├── ui/            # Cursor, highlights, menu frames
│   │   └── effects/       # Attack, magic, heal VFX
│   ├── portraits/         # Character portraits (128x128)
│   └── audio/
│       ├── sfx/           # 18 sound effects (OGG 96kbps mono) ✅
│       └── music/         # 38 background music tracks (OGG 128kbps stereo) ✅
│           └── _archived/ # 5 replaced tracks (music_exploration, battle_1/2, boss_1/2)
├── sim/                   # Balance simulation scripts (no Phaser deps)
│   ├── lib/
│   │   ├── SeededRNG.js       # Mulberry32 PRNG + Math.random override
│   │   ├── SimUnitFactory.js  # Unit creation wrappers, handles promoted enemies
│   │   ├── ExpectedValue.js   # Growth rate EV math (no RNG)
│   │   └── TableFormatter.js  # Console tables, CSV, arg parsing, recommendations
│   ├── progression.js         # Progression curves: EV stats, XP model, Monte Carlo growths
│   ├── matchups.js            # Combat matchups: class matrix, focus mode, scenario tests
│   ├── economy.js             # Economy flow: spending strategies, meta impact comparison
│   └── fullrun.js             # Full run Monte Carlo: abstract battles, act progression, meta sweep
└── tools/                 # Build/asset scripts
    ├── split_sprites.py   # FFT-based sprite sheet splitter (Python)
    ├── process_sprite.js  # Resize + bg removal for characters (Node/sharp)
    ├── process_tiles.js   # Batch resize terrain tiles (Node/sharp)
    └── process_node_icons_v2.js # Node map icon processor: dark bg removal, compositing, resize (Node/sharp)
```

## Data Files Reference

### classes.json
Each class has: `name`, `tier` ("base"/"promoted"), `baseStats` (HP/STR/MAG/SKL/SPD/DEF/RES/LCK/MOV), `moveType`, `weaponProficiencies`, `role`. Base classes also have `growthRanges` (e.g. "55-70" = roll once at recruitment), `promotesTo`. Promoted classes have `promotesFrom`, `promotionBonuses`, `roleChange`. Some classes have `learnableSkills`: `[{ "skillId": "vantage", "level": 8 }]` — skills units learn automatically at the specified level.

### lords.json
Each lord has: `name`, `class`, `baseStats`, `personalGrowths` (fixed, added to class growths), `promotedClass`, `promotionBonuses`, `promotionWeapons`, `personalSkill`.

### weapons.json
52 weapons across 8 types (Sword 9, Lance 9, Axe 7, Bow 5, Tome 5, Light 4, Staff 5, Scroll 8). Each weapon has: `name`, `type`, `tier` (Iron/Steel/Silver/Legend/Rare), `rankRequired` (Prof/Mast), `might`, `hit`, `crit`, `weight`, `range`, `special`, `price`. Scroll items also have `skillId` (the skill they teach when used). Scrolls cannot be equipped as weapons — they're consumable items used from the equip menu. Prices: Iron=500, Steel=1000, Silver=2000, Legend=0 (not for sale), Scrolls=2500, range 1-2 +200, special effect +300, Staves 300/600/1000/1200/0.

**Weapon categories:**
- **Throwable (range 1-2):** Hand Axe, Javelin, Short Spear, Tomahawk, Spear — lower stats than pure melee
- **Effective (3x multiplier):** Armorslayer (vs Armored), Horseslayer (vs Cavalry)
- **Killer (high crit):** Killing Edge, Killer Lance (crit 30)
- **Legendary specials:** Ragnell (range 1-2, +5 DEF when equipped), Runesword (drains HP equal to damage dealt), Bolting (range 3-10 siege magic)
- **Poison:** Venin Edge (target loses 5 HP after combat)
- **Staves (5):** Heal (MAG+5, 3 uses), Mend (MAG+10, 2 uses), Physic (MAG+5, range 2+MAG bonuses, 1 use), Recover (MAG+15, 1 use), Fortify (MAG+5 AoE, range 2, 1 use). All staves gain +1 use at MAG 8/14/20. Heal amount = healer's MAG + `healBase`. Uses tracked via `_usesSpent` field (survives serialization).
- **Scrolls (8):** Sol, Luna, Astra, Vantage, Wrath, Adept, Miracle, Guard — each teaches the named skill

### consumables.json
Each consumable has: `name`, `type` ("Consumable"), `effect` ("heal"/"healFull"/"promote"), `value` (heal amount, 0 for non-heal), `uses`, `price`. Items: Vulnerary (heal 10, 3 uses, 300g), Elixir (heal full, 1 use, 1500g), Master Seal (promote, 1 use, 2500g).

### lootTables.json
Keyed by act (act1–finalBoss). Each entry has: `weapons[]`, `consumables[]`, `rare[]` (scrolls + legendary weapons), `accessories[]`, `forge[]` (whetstone names), `weights` (category probabilities: weapon/consumable/gold/rare/accessory/forge), `goldRange` ([min, max] for gold drops). Act 1 has no rare pool, forge pool excludes Crit/Silver whetstones; Act 2+ adds all 5 whetstones. Loot weapons filtered by roster proficiencies.

### whetstones.json
5 whetstones: Silver Whetstone (`forgeStat: "choice"` — player picks stat), Might/Crit/Hit/Weight Whetstones (each applies specific forge stat). Applied immediately on loot pickup — never enter inventory. Each has `name`, `type` ("Whetstone"), `forgeStat`, `price`.

### turnBonus.json
Turn par calculation config. Fields: `enemyWeight` (0.6), `areaPenaltyPerTile` (0.03), `terrainMultiplier` (3.0), `difficultTerrainTypes` (Forest/Mountain/Water/Sand — matches terrain.json names), `objectiveBasePar` (rout=5, seize=7), `objectiveAdjustments` (rout=1, seize=2), `brackets` (ordered array: S≤0/A≤3/B≤6/C=rest with bonusMultiplier 1.0/0.6/0.25/0.0), `baseBonusGold` (act1=80, act2=150, act3=250, finalBoss=350). Par formula: `ceil(basePar + enemies×enemyWeight + area×areaPenaltyPerTile + difficultRatio×terrainMultiplier + adjustment)`. Used by `TurnBonusCalculator.js`.

### skills.json
21 skills across 6 trigger types. Each skill has: `id` (unique key), `name`, `description`, `trigger` (passive/passive-aura/on-combat-start/on-attack/on-turn-start/on-defend). Optional fields: `effects` (stat bonuses), `activation` (SKL/SKL_HALF/LCK_QUARTER/SPD/LCK for proc chance), `condition` (below50/adjacent_ally), `range` (for auras), `personal` (lord-only), `classInnate` (class name that gains this on promotion).

**Skill breakdown:** 4 personal (lord-only) + 5 on-attack (Sol, Luna, Astra, Lethality, Adept) + 3 on-combat-start (Vantage, Wrath, Guard) + 3 passive (Crit+15, Sure Shot, Colossus, Discipline, Vigilance) + 1 passive-aura (Charisma) + 1 on-turn-start (Renewal) + 3 on-defend (Pavise, Aegis, Miracle). Class innate skills: Swordmaster (Crit+15), Sniper (Sure Shot), Assassin (Lethality), General (Pavise), Paladin (Aegis), Warrior (Colossus), Falcon Knight (Discipline), Bishop (Renewal), Hero (Vigilance).

### terrain.json
Each terrain has: `name`, `moveCost` (by move type), `avoidBonus`, `defBonus`, `special`.

### mapTemplates.json
Two top-level keys: `rout` (4 templates) and `seize` (2 templates). Each template has: `id`, `name`, `zones[]`, `features[]`. Zones have `rect` (normalized [x1,y1,x2,y2]), `terrain` (weighted probabilities), `priority` (higher overwrites lower), optional `role` ("playerSpawn"/"enemySpawn"). Features place specific terrain (e.g. Throne) at named positions. River template has `minBridges`.

### recruits.json
Keyed by act (act1–act3). Each entry has: `levelRange` ([min, max]), `pool` (array of `{className, name}`). 6 named NPCs per act. Used by `MapGenerator.generateNPCSpawn()` to pick a random recruit for RECRUIT battle nodes. Note: `levelRange` from recruits.json is overridden at spawn time — BattleScene scales recruit level to lord level or lord level - 1 (50/50 chance, minimum 1).

### enemies.json
`pools`: keyed by act (act1–finalBoss), each with `levelRange`, `base` class list, `promoted` class list. Act 1 pool: `["Myrmidon", "Fighter", "Archer", "Cavalier"]` (Knight removed — too tanky for L1 party). `bosses`: keyed by act, array of `{className, level, name}`. `enemyCountByTiles`: maps tile count → [min, max] enemy count. Note: Act 1 `levelRange` is overridden per-node by `ACT_LEVEL_SCALING` in `NodeMapGenerator.js` (row 0: `[1,1]`, row 1: `[1,2]`, row 2+: `[2,3]`).

### accessories.json
Array of 18 accessories in two categories. Each has: `name`, `type` ("Accessory"), `effects` (stat bonuses object), `price`. Optional: `combatEffects` (combat-time modifiers with conditions).

**Stat accessories (11):** Effects applied directly to `unit.stats` on equip, reversed on unequip. Power Ring (+2 STR), Magic Ring (+2 MAG), Speed Ring (+2 SPD), Shield Ring (+2 DEF), Barrier Ring (+2 RES), Skill Ring (+3 SKL), Goddess Icon (+5 LCK), Seraph Robe (+5 HP), Boots (+1 MOV), Delphi Shield (+3 DEF +3 RES), Veteran's Crest (+1 STR/SPD/DEF).

**Combat accessories (7):** Have `combatEffects` field evaluated at combat time by Combat.js and SkillSystem.js. Wrath Band (+15 crit below 50% HP), Counter Seal (prevent enemy double attacks), Pursuit Ring (reduce double threshold by 2), Nullify Ring (negate weapon effectiveness), Life Ring (+3 atk/+2 def above 75% HP), Forest Charm (+10 avoid/+2 def on forest terrain). Conditions: `below50`, `above75`, `on_forest`.

### metaUpgrades.json
Array of 41 upgrade definitions. Each has: `id`, `name`, `description`, `category` ("recruit_stats"/"lord_bonuses"/"economy"/"capacity"/"starting_equipment"/"starting_skills"), `maxLevel`, `costs[]` (renown cost per tier), `effects[]` (cumulative effect per tier). Growth and flat stat upgrades are independent: recruit growth (6 upgrades × 5 tiers, +5%/tier via `{recruitGrowth, growthValue}`), recruit flat (6 × 3 tiers via `{stat, value}`), lord growth (5 × 5 tiers via `{lordGrowth, growthValue}` — includes SPD/RES), lord flat (5 × 3 tiers via `{lordStat, value}` — includes SPD/RES). Economy upgrades have `{goldBonus}` / `{battleGoldMultiplier}` / `{extraVulnerary}` / `{lootWeaponWeightBonus}`, capacity upgrades have `{deployBonus}` / `{rosterCapBonus}` / `{recruitRandomSkill}`. Equipment upgrades: `weapon_forge` (3 tiers, `{startingWeaponForge}`), `weapon_tier` (1 tier, `{deadlyArsenal}`), `starting_accessory` (3 tiers, `{startingAccessoryTier}`), `staff_upgrade` (2 tiers, `{startingStaffTier}`). Skills upgrades: 8 skill unlocks (`{skillUnlock, skillId}`). Effects are cumulative per tier (level 2 shows total bonus, not incremental).

## Core Formulas (from GDD Section 3.3)
```
Physical Damage = (STR + Weapon Might) - enemy DEF
Magical Damage  = (MAG + Weapon Might) - enemy RES
Hit Rate        = Weapon Hit + (SKL × 2) + LCK - Enemy Avoid
Avoid           = (SPD × 2) + LCK + Terrain Bonus
Critical Rate   = SKL / 2 + Weapon Crit + Skill Bonuses - Enemy LCK
Critical Damage = 3× normal damage
Double Attack   = attacker SPD >= defender SPD + 5
```

### Weapon Triangle
Swords → Axes → Lances → Swords: +10 Hit, +1 Damage (advantage) / -10 Hit, -1 Damage (disadvantage). Mastery rank: +15/+2 advantage, -5/-1 disadvantage. Magic and Bows are outside the triangle.

## Build Order (from GDD Section 14.2)
Follow this order — each phase should be testable:
1. **Grid Engine & Movement** ✅ — tiled map rendering, unit placement, movement ranges, A* pathfinding
2. **Combat System** ✅ — damage formula, weapon triangle, attack/counter, turn phases, enemy AI, combat UI
3. **Unit System** ✅ — stats, leveling, growth rates, promotion framework, weapon ranks, XP system
4. **Equipment & Skills** ✅ — inventory, weapon swapping, staff healing, skill system (21 skills, 6 trigger types including on-defend), promotion UI, weapon effectiveness multipliers, skill acquisition/learning (class level-up + scroll consumables), enemy skill assignment, MAX_SKILLS=5 cap, weapon specials (drain, poison, siege, equipped stat bonuses)
5. **Map Generation** ✅ — procedural maps from templates, randomized terrain, Rout + Seize objectives, enemy pools by act, boss enemies, reachability checks
6. **Node Map** ✅ — branching node map per act, battle/rest/boss nodes, unit persistence between battles, act progression (act1→act2→act3→finalBoss), RunManager run state, victory/defeat end screen
7. **Run Loop** ✅ — gold economy, shops, loot drops ✅ | recruit nodes ✅ | deploy selection ✅ | title screen, settings, pause, run save ✅
8. **Meta-Progression** ✅ — Home Base scene (6-tab UI: Recruits/Lords/Economy/Battalion/Equip/Skills), Renown currency (earned per run), 41 tiered upgrades (split growth/flat, lord SPD/RES, starting equipment, starting skills, recruit skills, deadly arsenal), Begin Run flow (Title→HomeBase→NodeMap), Save & Exit, localStorage persistence
9. **Polish & Art** — Music & SFX ✅ | Per-act music expansion (21 tracks) ✅ | UI inspection panel ✅ | Danger zone ✅ | HP bar gradient ✅ | Dynamic objectives ✅ | Accessories (18 items, combatEffects system) ✅ | Fog of war ✅ | Expanded weapons (51 total, throwables, effectiveness, specials) ✅ | Expanded skills (21 total, on-defend trigger) ✅ | Lord classes in classes.json (29 total) ✅ | **3 save slots + user flow rework** ✅
10. **Deployment** ✅ — Supabase auth (username/password) + cloud saves (3 tables with RLS) + Netlify static hosting. Auto-deploys via Netlify GitHub integration (push to `main` → build + publish). Auth gate in `index.html` before Phaser boots. Fire-and-forget cloud sync via `onSave` callbacks. Offline play supported.

## Art Style Guidelines
- SNES-era pixel art, 32x32 base tile / character sprite size
- 32-color master palette (define early, apply to everything)
- Character portraits: 128x128
- Battle sprites (post-MVP): 64x64 or 96x96
- Player units = blue palette, enemies = red palette, NPCs = green palette

## PixelLab MCP Integration
The PixelLab MCP is available for AI-generated pixel art. Reference: https://api.pixellab.ai/mcp/docs
- `create_character` — 4/8-directional character sprites
- `animate_character` — add walk/idle/attack animations
- `create_topdown_tileset` — Wang tilesets for terrain transitions
- `create_map_object` — trees, rocks, buildings with style matching
- Chain tileset generation: create base tile, use its ID for transitions

## Future Roadmap
See `ROADMAP.md` (repo root) for all planned post-MVP features. Key architectural constraints from the roadmap that affect MVP decisions:
- **Don't hardcode Act 1 assumptions.** Enemy pools, loot tables, and map generation must be parameterized by Act.
- **Combat skill trigger system is implemented.** `SkillSystem.js` provides hooks for on-attack/on-combat-start/on-turn-start/on-defend; `Combat.js` accepts `skillCtx` for all modifiers including `rollDefenseSkills()`. Extend by adding new skills to `skills.json` + handlers in `SkillSystem.js`.
- **Separate game logic from rendering.** Combat math, level-ups, and economy must be importable as pure functions (enables balance simulations and headless testing).
- **Don't assume a single campaign.** The Act/node map system should accept a campaign config, not hardcode a fixed structure. Current `ACT_CONFIG` in constants.js is a step toward this — replace with campaign-level config when multi-campaign support lands.
- **Grid renderer needs a visibility layer.** Don't bake "all tiles visible" — fog of war is coming.
- **Difficulty is a modifier layer.** Enemy stat generation and rewards should accept a difficulty multiplier from the start.
- **Decouple combat resolution from animation.** Calculate results first, then play visuals. Enables quick mode toggle and future full battle animations.

## Testing
- **Framework:** Vitest (works natively with Vite config and ES modules)
- **Run:** `npm test` (single run) or `npm run test:watch` (live re-runs)
- **Coverage (359 tests):** MapGenerator (37), Combat (41), UnitManager (28), NodeMapGenerator (32), RunManager (46), LootSystem (35), SettingsManager (7), MetaProgressionManager (55), Accessories (10), FogOfWar (12), ForgeSystem (31), TurnBonusCalculator (25)
- **Untested new features:** combat accessories (`combatEffects`), on-defend skills (Pavise/Aegis), weapon specials (Ragnell DEF bonus, Runesword drain, Bolting siege), Adept skill
- **Pattern:** Tests import pure engine modules directly + load JSON from `data/` via `tests/testData.js`. No Phaser needed.

## Balance Simulations
- **Run:** `npm run sim:progression`, `sim:matchups`, `sim:economy`, `sim:fullrun`
- **All scripts** accept `--seed S` (Mulberry32 PRNG), `--trials N`, `--csv` for data export
- `sim:progression` — `[--lord NAME]` EV stats, XP model, Monte Carlo growths, player vs enemy power
- `sim:matchups` — `[--level L] [--focus CLASS]` class matrix, scenario tests (crit stacking, Brave+Astra, Knight viability)
- `sim:economy` — `[--meta 0-3]` spending strategies, promotion affordability, meta impact
- `sim:fullrun` — `[--meta 0-3] [--verbose]` abstract battle resolution, full act progression, win/death rates
- **Pattern:** Sim scripts import pure engine modules directly + load JSON from `data/` via `sim/lib/SimUnitFactory.js`. Seeded RNG overrides `Math.random` globally. No Phaser needed.

## Key Design Principles
- **Data-driven:** All content in JSON. Never hardcode stats, classes, or weapons.
- **Placeholder-first:** Use colored rectangles and simple shapes during phases 1-4. Real art comes in phase 9.
- **Testable phases:** Each build phase should produce something playable/verifiable.
- **Classic FE feel:** Player Phase / Enemy Phase turns, weapon triangle matters, positioning matters, growth rates create unique units.
- **Roguelike tension:** Permadeath (run ends on Edric's defeat only — other lords can fall), meaningful loot choices, randomized recruits, gold scarcity, deploy selection.
