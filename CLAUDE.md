# Emblem Rogue — Claude Code Guide

## Project Overview
Emblem Rogue is a browser-based tactical RPG combining Fire Emblem grid combat with roguelike run structure. Built with Phaser.js (HTML5 Canvas), SNES-inspired pixel art, all game data driven by JSON.

**Full GDD:** `docs/emblem_rogue_gdd.docx`
**Class/Weapon Data:** `docs/emblem_rogue_class_data.xlsx` (already parsed into `data/*.json`)
**Roadmap:** `ROADMAP.md` (long-term vision + architecture notes)
**Next Steps:** `ROADMAP.md` (actionable implementation waves)
**Mobile Controls:** `docs/mobile-controls-spec.md` (HTML overlay, landscape, context-sensitive buttons)
**iOS Port:** `docs/ios-port-spec.md` (Capacitor wrapper, deferred until mobile web stable)

## Tech Stack
- **Engine:** Phaser.js 3 (HTML5 Canvas)
- **Language:** JavaScript (ES modules)
- **Data:** JSON files in `data/` (source of truth) synced to `public/data/` (runtime). Edit `data/*.json` then run `npm run sync-data` (or let `npm run build` auto-sync)
- **Build:** Vite for dev server and bundling
- **Hosting:** Netlify (static CDN) — https://emblem-rogue.netlify.app
- **Auth:** Supabase Auth (username/password, email confirmation disabled)
- **Cloud DB:** Supabase Postgres — 3 tables (`run_saves`, `meta_progression`, `user_settings`) with RLS per user
- **Persistence:** localStorage primary with 3 independent save slots (`emblem_rogue_slot_{1-3}_meta/run`). Supabase cloud backup (push on save, fetch on login) with per-table write serialization and meta `savedAt` freshness guard to reduce lost-update/rollback risk. Offline play degrades gracefully. Old single-save data auto-migrates to slot 1.
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
│   ├── emblem_rogue_class_data.xlsx
│   ├── mobile-controls-spec.md  # Mobile virtual controls spec (HTML overlay, landscape)
│   └── ios-port-spec.md         # iOS Capacitor port spec (deferred)
├── data/                  # Game data JSON (23 files, loaded at runtime)
│   ├── accessories.json   # 29 accessories: 10 stat-based + 19 with combatEffects ✅
│   ├── affixes.json       # 12 enemy affixes: difficulty-gated modifiers with exclusion rules ✅
│   ├── blessings.json     # 23 shrine blessings: tiered run-shaping modifiers ✅
│   ├── classes.json       # 47 entries: 19 base + 28 promoted (includes lord + Wyvern classes) ✅
│   ├── consumables.json   # 13 consumable items: 3 core + 8 stat boosters + 2 reclass seals ✅
│   ├── dialogue.json      # Recruit lines, act transition dialogue, story sequences ✅
│   ├── difficulty.json    # Difficulty modes (Normal/Hard/Lunatic): stat/economy/fog modifiers ✅
│   ├── enemies.json       # Enemy pools by act (act1-act4, postAct, finalBoss), boss defs, count scaling ✅
│   ├── lords.json         # 4 lord characters with stats/growths/promotions
│   ├── lootTables.json    # Per-act loot pools with weighted categories ✅
│   ├── mapSizes.json      # 10 map size templates by act/phase ✅
│   ├── mapTemplates.json  # 12 zone-based map templates (6 rout, 6 seize) including tundra + volcanic biomes ✅
│   ├── mechanicsReference.json # Advanced mechanics help content for in-game reference ✅
│   ├── metaUpgrades.json  # 58 tiered upgrades in 6 categories (recruit_stats, lord_bonuses, economy, capacity, starting_equipment, starting_skills) ✅
│   ├── recruits.json      # Recruit pools by act (act1-act4) + namePool ✅
│   ├── referenceViewer.json # Reference viewer config: combat formulas, weapon ranks, game version ✅
│   ├── skills.json        # 50 skills across 7 trigger types: passive, passive-aura, on-combat-start, on-attack, on-turn-start, on-defend, action ✅
│   ├── terrain.json       # 12 terrain types with move costs and bonuses (includes Ice, Lava Crack) ✅
│   ├── turnBonus.json     # Turn par calculation config: weights, brackets, per-act bonus gold ✅
│   ├── weaponArts.json    # 75 weapon arts across 5 types, HP-cost combat mods ✅
│   ├── weapons.json       # 106 weapons across 8 types (Sword 17, Lance 13, Axe 13, Bow 12, Tome 5, Light 4, Staff 5, Scroll 37) ✅
│   └── whetstones.json    # 5 whetstones: Silver (choice), Might, Crit, Hit, Weight ✅
├── .env.example           # Template for Supabase env vars
├── src/
│   ├── main.js            # Auth gate + Phaser bootstrap (exports cloudState)
│   ├── cloud/             # Supabase auth + cloud sync
│   │   ├── supabaseClient.js # Supabase singleton, signUp/signIn/signOut/getSession ✅
│   │   └── CloudSync.js   # Cloud save/load (fetchAllToLocalStorage, push*, delete*) with serialized updates + meta freshness guard ✅
│   ├── engine/            # Core game systems (30 files)
│   │   ├── AffixEngine.js # Enemy affix assignment: difficulty-gated, exclusion rules, scaling (pure) ✅
│   │   ├── AffixSystem.js # Affix combat resolution: trigger evaluation, effect application (pure) ✅
│   │   ├── AIController.js # Enemy AI decision-making, NPC targeting
│   │   ├── BlessingEngine.js # Blessing selection, persistence, modifier application (pure) ✅
│   │   ├── BossRecruitSystem.js # Post-boss recruit candidates, lord chance, pool generation (pure) ✅
│   │   ├── Combat.js      # Damage formula, weapon triangle, hit/crit calc, skill mods, weapon specials (drain/poison/siege), accessory combatEffects ✅
│   │   ├── DataLoader.js  # Load and parse JSON data files (including difficulty/blessings/weaponArts)
│   │   ├── DifficultyEngine.js # Difficulty mode modifiers: stat/economy/fog/XP scaling (pure) ✅
│   │   ├── ForgeSystem.js # Weapon forging: eligibility, stat bonuses, cost calculation, naming (pure) ✅
│   │   ├── Grid.js        # Grid rendering, tile management, pathfinding, fog of war, terrain hazards ✅
│   │   ├── HintManager.js # Tutorial hint state tracking, contextual trigger logic (pure) ✅
│   │   ├── LootSystem.js  # Gold calc, loot generation, shop inventory (pure) ✅
│   │   ├── MapGenerator.js # Procedural map gen from templates (pure functions) ✅
│   │   ├── MapTemplateEngine.js # Zone-based map template engine, biome support (pure) ✅
│   │   ├── MetaProgressionManager.js # Renown tracking, upgrade purchases, active effects, configurable storage key (pure) ✅
│   │   ├── NodeMapGenerator.js # Branching node map graph generation, per-node level scaling (pure) ✅
│   │   ├── ReinforcementScheduler.js # Reinforcement wave scheduling, turn-based spawning (pure) ✅
│   │   ├── RunManager.js  # Run state: roster, act progression, gold, slot-aware save/load ✅
│   │   ├── SkillSystem.js # Skill evaluation engine (pure functions), on-defend trigger, accessory combatEffects integration ✅
│   │   ├── SlotManager.js # Save slot utilities: 3 slots, migration, active slot tracking (pure) ✅
│   │   ├── TerrainHazards.js # Ice sliding + Lava Crack damage: movement preview, deterministic resolution (pure) ✅
│   │   ├── TradeFlow.js   # Unit item/weapon trade logic, convoy overflow routing (pure) ✅
│   │   ├── TurnBonusCalculator.js # Turn par calculation, S/A/B/C rating, bonus gold (pure) ✅
│   │   ├── TurnManager.js # Player phase / enemy phase flow, objective-aware, npcUnits
│   │   ├── TutorialHelpers.js # Tutorial battle setup, guided hints, first-battle scaffolding (pure) ✅
│   │   ├── UnitManager.js # Unit creation, stats, leveling, promotion, skill assignment, recruit creation, accessories ✅
│   │   └── WeaponArtSystem.js # Weapon art evaluation: HP cost, eligibility, combat mod application (pure) ✅
│   ├── data/              # Static help content
│   │   └── helpContent.js  # HELP_TABS (8 categories) + HOW_TO_PLAY_PAGES (4 pages) ✅
│   ├── ui/                # UI components (18 files)
│   │   ├── CampaignMapOverlay.js # Campaign/act progression map overlay ✅
│   │   ├── DangerZoneOverlay.js # Enemy threat range overlay (D key toggle) ✅
│   │   ├── DebugOverlay.js # Developer debug panel: state inspection, scene diagnostics ✅
│   │   ├── DialogueOverlay.js # Story dialogue display: speaker portrait, text box, auto-advance ✅
│   │   ├── HelpOverlay.js  # Tabbed help reference dictionary (8 tabs, paginated, depth 860-862) ✅
│   │   ├── HintDisplay.js  # Tutorial hint toast display, contextual positioning ✅
│   │   ├── HowToPlayOverlay.js # Linear How to Play guide (4 pages, depth 500-502) ✅
│   │   ├── LevelUpPopup.js # FE-style stat gain popup (supports promotion mode, stat colors) ✅
│   │   ├── PauseOverlay.js # Pause menu: Resume / Settings / Help / Save & Exit / Abandon Run (depth 800) ✅
│   │   ├── RosterOverlay.js # Node map roster management: stats, equip, trade, accessories (depth 700) ✅
│   │   ├── SettingsOverlay.js # Reusable volume control panel (depth 900) ✅
│   │   ├── UnitDetailOverlay.js # Extended unit detail view for roster/deploy screens ✅
│   │   ├── UnitInspectionPanel.js # Tabbed right-click unit inspection (160px wide, 9px font) — Stats/Gear tabs ✅
│   │   └── WeaponArtVisibility.js # Weapon art availability indicators in battle UI ✅
│   ├── scenes/            # Phaser scenes (9 files)
│   │   ├── BattleScene.js # Tactical battle, deploy, loot, recruitment, reinforcements, weapon arts, ESC pause, SFX ✅
│   │   ├── BlessingSelectScene.js # Pre-run blessing shrine: pick from 3 tiered blessings ✅
│   │   ├── BootScene.js   # Asset loading, settings/audio init, migration, cloud sync ✅
│   │   ├── DifficultySelectScene.js # Pre-run difficulty picker: Normal/Hard/Lunatic (unlock-gated) ✅
│   │   ├── HomeBaseScene.js # Meta-progression tabbed UI (6 tabs: Recruits/Lords/Economy/Battalion/Equip/Skills), Begin Run, ESC to title ✅
│   │   ├── NodeMapScene.js # Node map, shop, roster menu, convoy, auto-save, gear icon, ESC pause, music ✅
│   │   ├── RunCompleteScene.js # Victory/defeat end screen, clears run save, awards meta currency, Home Base / Title ✅
│   │   ├── SlotPickerScene.js # Save slot selection: 3 slots with summaries, select/delete ✅
│   │   └── TitleScene.js  # Animated pixel-art title screen: sky/castle/fireflies background, styled buttons, Press Start 2P font ✅
│   └── utils/             # Helpers (26 files)
│       ├── accessoryText.js # Accessory tooltip/description text generation ✅
│       ├── assetWarmup.js # Preload asset warmup for scene transition smoothness ✅
│       ├── AudioManager.js # Music/SFX playback wrapper (stored on Phaser registry) ✅
│       ├── blessingAnalytics.js # Blessing selection/usage telemetry tracking ✅
│       ├── constants.js   # Game-wide constants (ACT_CONFIG, NODE_TYPES, ROSTER_CAP, DEPLOY_LIMITS, gold/meta economy, VISION_RANGES, FOG_CHANCE, NODE_GOLD_MULTIPLIER, SHOP_REROLL_COST)
│       ├── debugMode.js   # Debug mode flag, dev-only feature gates ✅
│       ├── devStartup.js  # Dev-mode startup shortcuts: skip to scene, pre-populate state ✅
│       ├── errorReporter.js # Centralized error reporting and crash diagnostics ✅
│       ├── logger.js      # Structured logging utility with level filtering ✅
│       ├── MobileControls.js # Touch/mobile input overlay: context-sensitive action buttons ✅
│       ├── musicConfig.js # Centralized MUSIC config, getMusicKey(purpose, act), ALL_MUSIC_KEYS (38 tracks) ✅
│       ├── resourceSnapshot.js # Scene resource snapshot for leak detection diagnostics ✅
│       ├── retry.js       # Generic async retry utility with backoff ✅
│       ├── runtimeFlags.js # Runtime feature flags for conditional behavior ✅
│       ├── sceneCleanup.js # Shared scene teardown: timers, listeners, overlays, tweens ✅
│       ├── SceneGuard.js  # Transition diagnostics: state logging, overlay/input bleed detection ✅
│       ├── sceneLoader.js # Lazy scene loading, code-split entrypoints ✅
│       ├── SceneRouter.js # Canonical scene transition router: start/sleep/wake with reason codes ✅
│       ├── SettingsManager.js # Pure localStorage wrapper for user settings (volumes), onSave callback ✅
│       ├── startupTelemetry.js # Boot timing and startup health telemetry ✅
│       ├── tooltipTiming.js # Tooltip show/hide timing coordination ✅
│       └── uiStyles.js    # Centralized UI constants (fonts, colors, stat colors, HP bar gradient) ✅
├── tests/                 # Vitest test suite (2450 tests across 147 files, Feb 19 2026)
│   ├── testData.js        # Shared data loader for tests
│   ├── *.test.js          # 134 unit/integration test files covering: combat, map gen, run state,
│   │                      #   loot/forge, skills, accessories, fog, affixes, weapon arts, blessings,
│   │                      #   difficulty, terrain hazards, reinforcements, convoy, wyverns, tutorial,
│   │                      #   campaign map, mobile controls, scene router/guard, cloud sync, and more
│   ├── harness/           # Headless battle harness + determinism tests
│   └── e2e/               # Playwright E2E specs
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
47 entries: 19 base + 28 promoted (includes lord classes + Wyvern Rider/Wyvern Lord). Each class has: `name`, `tier` ("base"/"promoted"), `baseStats` (HP/STR/MAG/SKL/SPD/DEF/RES/LCK/MOV), `moveType`, `weaponProficiencies`, `role`. Base classes also have `growthRanges` (e.g. "55-70" = roll once at recruitment), `promotesTo`. Promoted classes have `promotesFrom`, `promotionBonuses`, `roleChange`. Some classes have `learnableSkills`: `[{ "skillId": "vantage", "level": 8 }]` — skills units learn automatically at the specified level.

### lords.json
Each lord has: `name`, `class`, `baseStats`, `personalGrowths` (fixed, added to class growths), `promotedClass`, `promotionBonuses`, `promotionWeapons`, `personalSkill`.

### weapons.json
106 weapons across 8 types (Sword 17, Lance 13, Axe 13, Bow 12, Tome 5, Light 4, Staff 5, Scroll 37). Each weapon has: `name`, `type`, `tier` (Iron/Steel/Silver/Legend/Rare), `rankRequired` (Prof/Mast), `might`, `hit`, `crit`, `weight`, `range`, `special`, `price`. Scroll items also have `skillId` (the skill they teach when used). Scrolls cannot be equipped as weapons — they're consumable items used from the equip menu. Prices: Iron=500, Steel=1000, Silver=2000, Legend=0 (not for sale), Scrolls=2500, range 1-2 +200, special effect +300, Staves 300/600/1000/1200/0.

**Weapon categories:**
- **Throwable (range 1-2):** Hand Axe, Javelin, Short Spear, Tomahawk, Spear — lower stats than pure melee
- **Effective (3x multiplier):** Armorslayer (vs Armored), Horseslayer (vs Cavalry)
- **Killer (high crit):** Killing Edge, Killer Lance (crit 30)
- **Legendary specials:** Ragnell (range 1-2, +5 DEF when equipped), Runesword (drains HP equal to damage dealt), Bolting (range 3-10 siege magic)
- **Poison:** Venin Edge (target loses 5 HP after combat)
- **Staves (5):** Heal (MAG+5, 3 uses), Mend (MAG+10, 2 uses), Physic (MAG+5, range 2+MAG bonuses, 1 use), Recover (MAG+15, 1 use), Fortify (MAG+5 AoE, range 2, 1 use). All staves gain +1 use at MAG 8/14/20. Heal amount = healer's MAG + `healBase`. Uses tracked via `_usesSpent` field (survives serialization).
- **Scrolls (37):** Sol, Luna, Astra, Vantage, Wrath, Adept, Miracle, Guard, and 29 more — each teaches the named skill via `skillId`

### consumables.json
13 consumable items. Each has: `name`, `type` ("Consumable"), `effect` ("heal"/"healFull"/"promote"/"statBoost"/"reclass"), `value` (heal amount, 0 for non-heal), `uses`, `price`. Core items: Vulnerary (heal 10, 3 uses, 300g), Elixir (heal full, 1 use, 1500g), Master Seal (promote, 1 use, 2500g). Stat boosters (8): Energy Drop (+2 STR), Spirit Dust (+2 MAG), Secret Book (+2 SKL), Speedwing (+2 SPD), Dracoshield (+2 DEF), Talisman (+2 RES), Angelic Robe (+5 HP), Swiftsoles (+1 MOV). Reclass seals (2): Infantry Seal, Mounted Seal. Stat boosters are loot-only (not in shops).

### lootTables.json
Keyed by act (act1–finalBoss). Each entry has: `weapons[]`, `consumables[]`, `rare[]` (scrolls + legendary weapons), `accessories[]`, `forge[]` (whetstone names), `weights` (category probabilities: weapon/consumable/gold/rare/accessory/forge), `goldRange` ([min, max] for gold drops). Act 1 has no rare pool, forge pool excludes Crit/Silver whetstones; Act 2+ adds all 5 whetstones. Loot weapons filtered by roster proficiencies.

### whetstones.json
5 whetstones: Silver Whetstone (`forgeStat: "choice"` — player picks stat), Might/Crit/Hit/Weight Whetstones (each applies specific forge stat). Applied immediately on loot pickup — never enter inventory. Each has `name`, `type` ("Whetstone"), `forgeStat`, `price`.

### turnBonus.json
Turn par calculation config. Fields: `enemyWeight` (0.6), `areaPenaltyPerTile` (0.01), `terrainMultiplier` (1), `difficultTerrainTypes` (Forest/Mountain/Water/Sand — matches terrain.json names), `objectiveBasePar` (rout=2, seize=4), `objectiveAdjustments` (rout=0, seize=1), `brackets` (ordered array: S≤0/A≤3/B≤6/C=rest with bonusMultiplier 1.0/0.6/0.25/0.0), `baseBonusGold` (act1=150, act2=300, act3=500, act4=700, finalBoss=900), `latePressure` (XP/gold decay starting at 5 turns over par, step every 2 turns; boss enrage at turn 12 or 5 over par). Par formula: `ceil(basePar + enemies×enemyWeight + area×areaPenaltyPerTile + difficultRatio×terrainMultiplier + adjustment)`. Used by `TurnBonusCalculator.js`.

### skills.json
50 skills across 7 trigger types. Each skill has: `id` (unique key), `name`, `description`, `trigger` (passive/passive-aura/on-combat-start/on-attack/on-turn-start/on-defend/action). Optional fields: `effects` (stat bonuses), `activation` (SKL/SKL_HALF/LCK_QUARTER/SPD/LCK for proc chance), `condition` (below50/adjacent_ally), `range` (for auras), `personal` (lord-only), `classInnate` (class name that gains this on promotion).

**Skill breakdown by trigger:** 11 on-attack + 14 on-combat-start + 11 passive + 4 passive-aura + 2 on-turn-start + 5 on-defend + 3 action (Dance/Shove/Pull). Class innate skills: Swordmaster (Crit+15), Sniper (Sure Shot), Assassin (Lethality), General (Pavise), Paladin (Aegis), Warrior (Colossus), Falcon Knight (Discipline), Bishop (Renewal), Hero (Vigilance).

### terrain.json
12 terrain types (Plain, Forest, Mountain, Fort, Throne, Wall, Water, Bridge, Sand, Village, Ice, Lava Crack). Each has: `name`, `moveCost` (by move type), `avoidBonus`, `defBonus`, `special`. Ice causes sliding movement; Lava Crack deals end-of-turn damage.

### mapTemplates.json
Two top-level keys: `rout` (6 templates) and `seize` (6 templates), including tundra + volcanic biomes. Each template has: `id`, `name`, `zones[]`, `features[]`. Zones have `rect` (normalized [x1,y1,x2,y2]), `terrain` (weighted probabilities), `priority` (higher overwrites lower), optional `role` ("playerSpawn"/"enemySpawn"). Features place specific terrain (e.g. Throne) at named positions. River template has `minBridges`.

### recruits.json
Keyed by act (act1–act4) plus `namePool` for generated recruit names. Each entry has: `levelRange` ([min, max]), `pool` (array of `{className, name}`). Used by `MapGenerator.generateNPCSpawn()` to pick a random recruit for RECRUIT battle nodes. Note: `levelRange` from recruits.json is overridden at spawn time — BattleScene scales recruit level to lord level or lord level - 1 (50/50 chance, minimum 1).

### enemies.json
`pools`: keyed by act (act1–act4, postAct, finalBoss), each with `levelRange`, `base` class list, `promoted` class list. Act 1 pool: `["Myrmidon", "Fighter", "Archer", "Cavalier"]` (Knight removed — too tanky for L1 party). Act 4 pool includes Wyvern Rider. `bosses`: keyed by act (act1–act4, finalBoss), array of `{className, level, name}`. `enemyCountByTiles`: maps tile count → [min, max] enemy count. Note: Act 1 `levelRange` is overridden per-node by `ACT_LEVEL_SCALING` in `NodeMapGenerator.js` (row 0: `[1,1]`, row 1: `[1,2]`, row 2+: `[2,3]`).

### accessories.json
Array of 29 accessories in two categories. Each has: `name`, `type` ("Accessory"), `effects` (stat bonuses object), `price`. Optional: `combatEffects` (combat-time modifiers with conditions).

**Stat accessories (10):** Effects applied directly to `unit.stats` on equip, reversed on unequip. Power Ring (+2 STR), Magic Ring (+2 MAG), Speed Ring (+2 SPD), Shield Ring (+2 DEF), Barrier Ring (+2 RES), Skill Ring (+3 SKL), Goddess Icon (+5 LCK), Boots (+1 MOV), Delphi Shield (+3 DEF +3 RES), Veteran's Crest (+1 STR/SPD/DEF).

**Combat accessories (19):** Have `combatEffects` field evaluated at combat time by Combat.js and SkillSystem.js. Wrath Band (+15 crit below 50% HP), Counter Seal (prevent enemy double attacks), Pursuit Ring (reduce double threshold by 2), Nullify Ring (negate weapon effectiveness), Life Ring (+3 atk/+2 def above 75% HP), Forest Charm (+10 avoid/+2 def on forest terrain). Conditions: `below50`, `above75`, `on_forest`.

### metaUpgrades.json
Array of 58 upgrade definitions. Each has: `id`, `name`, `description`, `category` ("recruit_stats"/"lord_bonuses"/"economy"/"capacity"/"starting_equipment"/"starting_skills"), `maxLevel`, `costs[]` (renown cost per tier), `effects[]` (cumulative effect per tier). Growth and flat stat upgrades are independent: recruit growth (6 upgrades × 5 tiers, +5%/tier via `{recruitGrowth, growthValue}`), recruit flat (6 × 3 tiers via `{stat, value}`), lord growth (5 × 5 tiers via `{lordGrowth, growthValue}` — includes SPD/RES), lord flat (5 × 3 tiers via `{lordStat, value}` — includes SPD/RES). Economy upgrades have `{goldBonus}` / `{battleGoldMultiplier}` / `{extraVulnerary}` / `{lootWeaponWeightBonus}`, capacity upgrades have `{deployBonus}` / `{rosterCapBonus}` / `{recruitRandomSkill}`. Equipment upgrades: `weapon_forge` (3 tiers, `{startingWeaponForge}`), `weapon_tier` (1 tier, `{deadlyArsenal}`), `starting_accessory` (3 tiers, `{startingAccessoryTier}`), `staff_upgrade` (2 tiers, `{startingStaffTier}`). Skills upgrades: 8+ skill unlocks (`{skillUnlock, skillId}`). Effects are cumulative per tier (level 2 shows total bonus, not incremental).

### affixes.json
12 enemy affixes across 2 tiers and 6 trigger types (on-defend, on-turn-start, on-attack, passive-aura, passive, on-death). Top-level keys: `version`, `affixes[]`, `config`. Each affix has: `id`, `name`, `description`, `tier` (1-2), `trigger`, `effects` (modifier object), `weight`, `icon`, `narrativeHint`. Optional: `aiOverride`. Config contains `difficultyGating` (Normal=0%, Hard=12% chance/1 max, Lunatic=30%/2 max), `actScaling` (per-act chance multiplier), `bossAffixRules` (disabled — bosses use hand-crafted skills), and `exclusions` (mutual exclusion + class exclusion rules).

### blessings.json
23 shrine blessings across 4 tiers. Top-level keys: `version`, `blessings[]`. Each blessing has: `id`, `name`, `tier` (1-4), `description`, `weight`, `boons[]` (positive effects), `costs[]` (trade-offs). Boon/cost types include: `act_hit_bonus`, `battle_gold_multiplier_delta`, `run_start_max_hp_bonus`, `lord_stat_bonus`, `deploy_cap_delta`, `all_growths_delta`, `starting_weapon_tier`, `xp_multiplier_delta`, `forge_cost_discount`, `recruit_level_bonus`, `terrain_combat_bonus`, and more. Higher tiers offer stronger boons with meaningful costs.

### dialogue.json
Recruit lines keyed by class name (arrays of flavor text), plus `actTransitions` keyed by event (runStart, act1_to_act2, etc.) with `{speaker, portrait, line}` objects. Used by DialogueOverlay for story sequences between acts and at recruit events.

### difficulty.json
Top-level keys: `version`, `modes` (normal/hard/lunatic). Each mode has: `label`, `color`, stat modifiers (`enemyStatBonus`, `enemyCountBonus`, `enemyEquipTierShift`, `enemySkillChance`, `enemyPoisonChance`), economy modifiers (`goldMultiplier`, `shopPriceMultiplier`, `lootQualityShift`, `xpMultiplier`, `currencyMultiplier`), gameplay modifiers (`fogChanceBonus`, `deployLimitBonus`, `reinforcementTurnOffset`), and progression flags (`actsIncluded`, `extendedLevelingEnabled`). Hard unlocks after Normal victory.

### mechanicsReference.json
In-game help content for advanced mechanics. Contains `help` (tab label/title, notes), `combat` (formula strings for atk/AS/doubling/effectiveness), `weaponRanks` (display order, legendary tier info). Used by HelpOverlay to display combat reference.

### referenceViewer.json
Reference viewer config with `gameVersion`, `helpTabLabel`, and duplicate combat/weaponRank formulas for the standalone reference viewer. Includes `rankRequirements` with total weapon counts per rank tier.

### weaponArts.json
75 weapon arts across 5 weapon types (Sword 19, Lance 14, Axe 15, Bow 14, Tome 13). Top-level keys: `version`, `mvp` (cost model notes), `arts[]`. Each art has: `id`, `name`, `weaponType`, `unlockAct` (act1-act3), `requiredRank` (Prof/Mast), `hpCost` (HP deducted before combat), `perTurnLimit`, `perMapLimit`, `targeting`, `description`, `combatMods` (hit/crit/damage bonuses, stat scaling, activated effects). Arts use HP-cost model — no durability/stamina. Unlocked progressively by act.

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
4. **Equipment & Skills** ✅ — inventory, weapon swapping, staff healing, skill system (50 skills, 7 trigger types including on-defend + action), promotion UI, weapon effectiveness multipliers, skill acquisition/learning (class level-up + scroll consumables), enemy skill assignment, MAX_SKILLS=5 cap, weapon specials (drain, poison, siege, equipped stat bonuses)
5. **Map Generation** ✅ — procedural maps from templates, randomized terrain, Rout + Seize objectives, enemy pools by act, boss enemies, reachability checks
6. **Node Map** ✅ — branching node map per act, battle/rest/boss nodes, unit persistence between battles, act progression (act1→act2→act3→finalBoss), RunManager run state, victory/defeat end screen
7. **Run Loop** ✅ — gold economy, shops, loot drops ✅ | recruit nodes ✅ | deploy selection ✅ | title screen, settings, pause, run save ✅
8. **Meta-Progression** ✅ — Home Base scene (6-tab UI: Recruits/Lords/Economy/Battalion/Equip/Skills), meta currency (Valor/Supply, earned per run), 58 tiered upgrades (split growth/flat, lord SPD/RES, starting equipment, starting skills, recruit skills, deadly arsenal), Begin Run flow (Title→HomeBase→DifficultySelect→BlessingSelect→NodeMap), Save & Exit, localStorage persistence
9. **Polish & Art** — Music & SFX ✅ | Per-act music expansion (21 tracks) ✅ | UI inspection panel ✅ | Danger zone ✅ | HP bar gradient ✅ | Dynamic objectives ✅ | Accessories (29 items, combatEffects system) ✅ | Fog of war ✅ | Expanded weapons (106 total, throwables, effectiveness, specials) ✅ | Expanded skills (50 total, 7 trigger types) ✅ | Lord classes + Wyvern classes in classes.json (47 total) ✅ | **3 save slots + user flow rework** ✅ | Enemy affixes (12) ✅ | Weapon arts (75) ✅ | Blessings (23) ✅ | Difficulty modes (Normal/Hard/Lunatic) ✅ | Terrain hazards (Ice/Lava Crack) ✅ | Convoy ✅ | Wyvern classes ✅ | Reinforcements ✅ | Boss recruit events ✅ | Tutorial hints ✅ | Scene Router/Guard ✅ | Dialogue scaffold ✅
10. **Deployment** ✅ — Supabase auth (username/password) + cloud saves (3 tables with RLS) + Netlify static hosting. Auto-deploys via Netlify GitHub integration (push to `main` → build + publish). Auth gate in `index.html` before Phaser boots. Cloud sync is callback-driven via `onSave` with hardening against write races/older-meta overwrite. Offline play supported.

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
- **Combat skill trigger system is implemented.** `SkillSystem.js` provides hooks for on-attack/on-combat-start/on-turn-start/on-defend/action; `Combat.js` accepts `skillCtx` for all modifiers including `rollDefenseSkills()`. Extend by adding new skills to `skills.json` + handlers in `SkillSystem.js`.
- **Separate game logic from rendering.** Combat math, level-ups, and economy must be importable as pure functions (enables balance simulations and headless testing).
- **Don't assume a single campaign.** The Act/node map system should accept a campaign config, not hardcode a fixed structure. Current `ACT_CONFIG` in constants.js is a step toward this — replace with campaign-level config when multi-campaign support lands.
- **Difficulty is data-driven and live.** `difficulty.json` + `DifficultyEngine` provide Normal/Hard/Lunatic modifier layers. Keep new systems wired through this layer instead of hardcoding per-mode logic. Lunatic content gated behind future Act 4+ stabilization.
- **Decouple combat resolution from animation.** Calculate results first, then play visuals. Enables quick mode toggle and future full battle animations.

## Testing
- **Framework:** Vitest (works natively with Vite config and ES modules)
- **Run:** `npm test` (single run) or `npm run test:watch` (live re-runs)
- **Coverage (2450 tests across 147 files, Feb 19 2026):** Includes map generation, combat, run-state/save migration, AI, fog, wave expansion, loot/forge, accessories, affixes, weapon arts, blessings, difficulty, terrain hazards, reinforcements, scene router/guard, convoy, wyverns, tutorial, campaign map, mobile controls, cloud-sync guard tests, and deterministic run hooks
- **Residual testing gap:** Scene-level integration assertions for some menu/UX states (for example difficulty unlock messaging and certain mobile touch parity paths) still rely on behavior tests + manual verification.
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


