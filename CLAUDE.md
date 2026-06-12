# Emblem Rogue — Claude Code Guide

## Project Overview
Emblem Rogue is a browser-based tactical RPG combining Fire Emblem grid combat with roguelike run structure. Built with Phaser.js (HTML5 Canvas), SNES-inspired pixel art, all game data driven by JSON.

**Full GDD:** `docs/emblem_rogue_gdd.docx`
**Class/Weapon Data:** `docs/emblem_rogue_class_data.xlsx` (already parsed into `data/*.json`)
**Roadmap:** `ROADMAP.md` (long-term vision + architecture notes + actionable implementation waves)
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
- **Persistence:** localStorage primary with 3 independent save slots (`emblem_rogue_slot_{1-3}_meta/run`). Supabase cloud backup (push on save, fetch on login) with per-table write serialization and meta `savedAt` freshness guard. Offline play degrades gracefully. Old single-save data auto-migrates to slot 1. Anti-refresh: battles persist a suspend checkpoint (`battleInProgress` flag; `BattleSuspendController`) after every action with the RNG reseeded — any exit (refresh/crash/Save & Exit) offers Resume Battle (exact restore) or Continue from Map (sanctioned full revert with entry-time Vision/RNG refund) on continue, so a refresh can never undo a resolved action.
- **Art Pipeline:** Google Imagen 4 API for AI-generated pixel art (see Art Pipeline section)

## Effort
**You have near unlimited compute and time so optimize purely for correctness

## Project Structure
```
emblem-rogue/
├── CLAUDE.md, package.json, vite.config.js, index.html
├── public/                # Static files served as-is (synced from data/ and assets/)
├── docs/                  # Design documents (GDD, class data, mobile/iOS specs)
├── data/                  # 23 game data JSON files (source of truth)
│   ├── accessories.json   # 30 accessories: 10 stat-based + 20 with combatEffects (incl. Warding Charm status immunity)
│   ├── affixes.json       # 12 enemy affixes: difficulty-gated modifiers with exclusion rules
│   ├── blessings.json     # 23 shrine blessings: tiered run-shaping modifiers
│   ├── classes.json       # 52 entries: 21 base + 30 promoted + 1 boss-tier class
│   ├── colosseum.json     # Mercenary arena config: merc pools, ladder, promotion scaling
│   ├── consumables.json   # 15 consumable items: 3 core + 8 stat boosters + 2 reclass seals + 2 misc
│   ├── dialogue.json      # Recruit lines, act transition dialogue, story sequences
│   ├── difficulty.json    # Difficulty modes (Normal/Hard/Lunatic): stat/economy/fog modifiers
│   ├── enemies.json       # Enemy pools by act (act1-act4, postAct, finalBoss), boss defs, count scaling
│   ├── lords.json         # 7 lord characters with stats/growths/promotions
│   ├── lootTables.json    # Per-act loot pools with weighted categories
│   ├── mapSizes.json      # 10 map size templates by act/phase
│   ├── mapTemplates.json  # 20 zone-based templates (9 rout, 8 seize, 3 escape) incl. tundra/volcanic/castle
│   ├── mechanicsReference.json # In-game help: combat formulas, weapon ranks
│   ├── metaUpgrades.json  # 60 tiered upgrades in 6 categories
│   ├── recruits.json      # Recruit pools by act (act1-act4) + namePool
│   ├── referenceViewer.json # Reference viewer config: formulas, weapon ranks, game version
│   ├── skills.json        # 52 skills across 7 trigger types
│   ├── terrain.json       # 15 terrain types (incl. Ice, Lava Crack, Floor, Pillar, Ballista)
│   ├── turnBonus.json     # Turn par calculation config
│   ├── weaponArts.json    # 75 weapon arts across 5 types, HP-cost combat mods
│   ├── weapons.json       # 116 weapons across 8 types (incl. Restore cure staff, enemy-only status staves)
│   └── whetstones.json    # 5 whetstones: Silver (choice), Might, Crit, Hit, Weight
├── src/
│   ├── main.js            # Auth gate + Phaser bootstrap (exports cloudState)
│   ├── cloud/             # Supabase auth + cloud sync (2 files)
│   ├── engine/            # 34 pure game systems — Combat, MapGenerator, RunManager, SkillSystem,
│   │                      #   UnitManager, LootSystem, ForgeSystem, NodeMapGenerator, Grid,
│   │                      #   AIController, TurnManager, and 23 more (most are pure, no Phaser deps)
│   ├── data/helpContent.js # HELP_TABS (9 categories) + HOW_TO_PLAY_PAGES (4 pages)
│   ├── ui/                # 29 UI components — overlays, panels, controllers
│   ├── scenes/            # 10 Phaser scenes (see Scene Flow below)
│   └── utils/             # 30 helpers — AudioManager, constants, SceneRouter, SceneGuard,
│                          #   uiDepths, uiStyles, escPriority, MobileControls, musicConfig, etc.
├── tests/                 # Vitest: 4143 tests across 218 files + harness/ + e2e/
├── References/            # Source sprite sheets + raw assets (not deployed, .gitignored)
├── assets/                # sprites/ (32x32), portraits/ (128x128), audio/ (sfx + 38 music tracks)
├── sim/                   # Balance sim scripts (progression, matchups, economy, fullrun)
└── tools/                 # Build/asset processing scripts (sprite splitting, resize, bg removal)
```

### Scene Flow
Auth/offline gate (main.js) → Boot → Title → SlotPicker → HomeBase → DifficultySelect → BlessingSelect → NodeMap ↔ Battle → RunComplete → Title. Dev routing: `?qaStep=` or `?devScene=` query params skip to specific scenes.

## Data File Gotchas
Read the JSON files directly for full schemas. Non-obvious behaviors:
- **classes.json** — Base classes have `growthRanges` (string "55-70", rolled once at recruitment). Promoted classes have `promotionBonuses`. Some have `learnableSkills: [{ skillId, level }]`.
- **weapons.json** — Scrolls have `skillId` field (consumable, not equippable as weapons). Staves gain +1 use at MAG 8/14/20; uses tracked via `_usesSpent` (survives serialization). Prices: Iron=500, Steel=1000, Silver=2000, Legend=0, Scrolls=2500, Staves 300/600/1000/1200/0.
- **consumables.json** — Stat boosters are loot-only (not in shops). Reclass seals: Infantry Seal, Mounted Seal.
- **lootTables.json** — Act 1: no rare pool, limited forge pool. Loot weapons filtered by roster proficiencies.
- **accessories.json** — Stat accessories modify `unit.stats` directly on equip/unequip. Combat accessories have `combatEffects` evaluated at combat time by Combat.js + SkillSystem.js. Conditions: `below50`, `above75`, `on_forest`.
- **metaUpgrades.json** — Effects cumulative per tier (level 2 shows total bonus, not incremental). Growth and flat stat upgrades are independent tracks.
- **enemies.json** — Act 1 `levelRange` overridden per-node by `ACT_LEVEL_SCALING` in NodeMapGenerator.js (row 0: `[1,1]`, row 1: `[1,2]`, row 2: `[1,3]`, default: `[2,3]`).
- **recruits.json** — `levelRange` overridden at spawn. Recruit scaling is Edric-anchored (see `RecruitScaling.js`), not simple lord-level mirroring.
- **colosseum.json** — `crossActPoolAccess: true` pulls next-act recruit classes into merc generation. This means act2 can draw promoted act3 classes and must use promote-path handling.
- **mapTemplates.json** — Castle templates (corridor_siege, castle_ruins, great_hall) gated to act2+ via `"acts"` field. Escape templates require an `escapeZone` and use endless `repeatingWaves` pursuit reinforcements (active on Normal too — they ARE the objective pressure).
- **affixes.json** — `difficultyGating`: Normal=0%, Hard=12% chance/1 max, Lunatic=30%/2 max. Mutual exclusion + class exclusion rules enforced by AffixEngine.
- **turnBonus.json** — Par formula uses sqrt enemy scaling (capped at linear), area/terrain penalties, then `*0.8` and optional difficulty multiplier. See `TurnBonusCalculator.js:calculatePar()` for current logic. Late pressure: XP/gold decay at 5+ turns over par; boss enrage at turn 12 or 5 over par.
- **whetstones.json** — Applied immediately on loot pickup, never enter inventory.
- **skills.json** — 7 trigger types: passive, passive-aura, on-combat-start, on-attack, on-turn-start, on-defend, action. `activation` = proc chance type (SKL/SKL_HALF/LCK_THIRD/SPD/LCK/always).

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

## Build Order
Phases 1-9 complete ✅, Phase 10 (Deploy) live. (Grid → Combat → Units → Equipment → MapGen → NodeMap → RunLoop → MetaProg → Polish → Deploy). See GDD Section 14.2 for original spec. Phase 9 (Polish) includes: music/SFX, accessories, fog of war, 113 weapons, 52 skills, save slots, affixes, weapon arts, blessings, difficulty modes, terrain hazards, convoy, wyverns, reinforcements, boss recruit, tutorial hints, colosseum, entity boss, ballista, castle biome, recruit promotion, BattleScene decomposition (10 controllers extracted), narrative flavor. Phase 10: Supabase auth + cloud saves + Netlify auto-deploy.

## Art Style Guidelines
- SNES-era pixel art, 32x32 base tile / character sprite size
- 32-color master palette (define early, apply to everything)
- Character portraits: 128x128
- Battle sprites (post-MVP): 64x64 or 96x96
- Player units = blue palette, enemies = red palette, NPCs = green palette

## Art Pipeline (Imagen API)
AI-generated pixel art via Google Imagen 4 API.
- **Generate:** `npm run imagen:generate` (or `imagen:generate:dry` for dry run) — canonical path via `tools/imagen-pipeline/`. Outputs 4 samples per asset to `References/imagen-output/raw/`
- **Process:** `npm run imagen:process` — resize, bg removal, format conversion → `References/imagen-output/processed/`
- **Select:** Compare candidates in `References/imagen-output/compare.html`, track picks in `selections.json`
- **Manifest:** `tools/imagen-pipeline/manifest.json` defines all asset prompts/categories
- **API key:** `GOOGLE_API_KEY` in `.env`
- **Output dirs:** `References/imagen-output/` — `raw/`, `processed/` (game-ready), `nb2-roster/`, `nb2-test/`
- **Legacy scripts:** `tools/imagen-generate.js` / `tools/imagen-process.js` exist but npm scripts use `tools/imagen-pipeline/`

## Future Roadmap
See `ROADMAP.md` for all planned features. Key architectural constraints:
- **Don't hardcode Act 1 assumptions.** Enemy pools, loot tables, and map generation must be parameterized by Act.
- **Combat skill trigger system is implemented.** Extend by adding skills to `skills.json` + handlers in `SkillSystem.js`.
- **Separate game logic from rendering.** Combat math, level-ups, and economy must be importable as pure functions.
- **Don't assume a single campaign.** Current `ACT_CONFIG` in constants.js is a step toward campaign-level config.
- **Difficulty is data-driven.** `difficulty.json` + `DifficultyEngine` provide modifier layers. Wire new systems through this.
- **Decouple combat resolution from animation.** Calculate results first, then play visuals.

## Testing
- **Framework:** Vitest (works natively with Vite config and ES modules)
- **Run:** `npm test` (single run) or `npm run test:watch` (live re-runs)
- **CI gates (run before PR):** `npm run check:reference`, `npm run check:data-parity`, `npm run sim:fullrun:harness:pr`
- **Coverage:** 4143 tests across 218 files (Jun 10 2026). Covers all engine systems.
- **Residual gap:** BattleScene orchestration logic is undertested relative to its complexity.
- **Pattern:** Tests import pure engine modules directly + load JSON from `data/` via `tests/testData.js`. No Phaser needed.

## Balance Simulations
- **Run:** `npm run sim:progression`, `sim:matchups`, `sim:economy`, `sim:fullrun`
- **All scripts** accept `--seed S` (Mulberry32 PRNG), `--trials N`, `--csv` for data export
- **Pattern:** Import pure engine modules + JSON via `sim/lib/SimUnitFactory.js`. Seeded RNG. No Phaser.

## Key Design Principles
- **Data-driven:** All content in JSON. Never hardcode stats, classes, or weapons.
- **Testable phases:** Each build phase should produce something playable/verifiable.
- **Classic FE feel:** Player Phase / Enemy Phase turns, weapon triangle matters, positioning matters, growth rates create unique units.
- **Roguelike tension:** Permadeath (run ends on Edric's defeat only — other lords can fall), meaningful loot choices, randomized recruits, gold scarcity, deploy selection.

## God Objects & Decomposition Strategy

Several files have grown large enough to require active management. When adding features, prefer extracting to a new controller/module over expanding these files further.

### Critical (actively decompose)
- **BattleScene.js (~10,350 lines)** — 12 controllers extracted (5 original + PostCombatController, TransitionRecoveryController, LootFlowController, WeaponArtController, InputController, HealController, PromotionController). **Rule: never add new rendering or multi-step flows inline. Extract a controller with `create(scene)` / `destroy()` pattern.**

### Large (watch for growth)
- **NodeMapScene.js (~1,950 lines)** — Church/shop overlays extracted to ChurchController/ShopController (state stays on the scene; methods are delegating shims).
- **RunManager.js (~3,800 lines)** — Blessing logic (~900 lines) could become BlessingStateManager.
- **RosterOverlay.js (~2,780 lines)** — Trade state machine extracted to RosterTradeController (state stays on the overlay; methods are delegating shims).

### Extraction pattern
```js
export default class NewController {
  constructor(scene, options) { /* store refs, no rendering */ }
  create() { /* build UI, bind input */ }
  destroy() { /* remove all Phaser objects, unbind input */ }
}
// In BattleScene: this.newCtrl = new NewController(this, opts); this.newCtrl.create();
```

## UI Polish Guidelines

Text overflow, clipping, and layout issues are a recurring problem. Follow these rules for all UI work:

### Common pitfalls
- **Text overfill:** Long class/weapon/skill names overflow containers. Always test with longest possible strings.
- **Overlay stacking:** Use `uiDepths.js` constants, not magic numbers.
- **Font size:** 9px `'Press Start 2P'` has wide characters. Budget ~8px per character width.
- **Dynamic lists:** Handle 0 items (empty state) and max items (scroll bounds) gracefully.

### Prevention checklist (for any UI change)
1. Test with maximum-length names/values for all text fields
2. Verify on 640x480 base resolution (the design target)
3. Check that overlay depth uses `uiDepths.js` constants
4. Confirm ESC/close handlers don't leak (use `escPriority.js` for stacking)
5. For scrollable lists: test empty state, 1 item, and overflow count
