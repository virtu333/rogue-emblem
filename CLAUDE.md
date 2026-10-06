# Rogue Dawn — Claude Code Guide

## Project Overview
Rogue Dawn (formerly "Emblem Rogue" / "Rogue Emblem") is a browser-based tactical RPG combining Fire Emblem grid combat with roguelike run structure. Built with Phaser.js (HTML5 Canvas), SNES-inspired pixel art, all game data driven by JSON.

**Name:** the player-facing name lives in `src/utils/gameIdentity.js` (`GAME_TITLE`); `tests/GameIdentity.test.js` holds index.html, the web manifest, Capacitor and Info.plist to it. Internal identifiers keep the old spelling on purpose and must not be renamed: `emblem_rogue_*` storage keys, `__emblemRogue*` window globals, the `@emblem-rogue.local` auth email domain, the iOS bundle ID `com.davechen.emblemrogue`, the npm package name, the repo and the Netlify site.

**Full GDD:** `docs/emblem_rogue_gdd.docx`
**Class/Weapon Data:** `docs/emblem_rogue_class_data.xlsx` (already parsed into `data/*.json`)
**Roadmap:** `ROADMAP.md` (long-term vision + architecture notes + actionable implementation waves)
**Mobile Controls:** `docs/mobile-controls-spec.md` (HTML overlay, landscape, context-sensitive buttons)
**Portrait mode:** `docs/portrait-battles.md` (upright play on phones, on by default; Settings → Portrait mode or `?portrait=0` turns it off; iPad app stays landscape. `html.portrait-ui` keys every portrait layout, and every such rule sits inside `@media (orientation: portrait)` (`tests/PortraitCssGating.test.js`); battles turn the board by a Grid presentation transform and orientation switches re-open from the battle checkpoint; upright browser specs live in the `portrait` e2e lane and share `tests/e2e/portraitHelpers.js`)
**iOS Port:** `docs/ios-port-spec.md` (Capacitor wrapper, deferred until mobile web stable)

## Tech Stack
- **Engine:** Phaser.js 3 (HTML5 Canvas)
- **Language:** JavaScript (ES modules)
- **Data:** JSON files in `data/` (source of truth) synced to `public/data/` (runtime). Edit `data/*.json` then run `npm run sync-data` (or let `npm run build` auto-sync)
- **Build:** Vite for dev server and bundling
- **Hosting:** Netlify (static CDN) — https://emblem-rogue.netlify.app
- **Auth:** Supabase Auth (username/password, email confirmation disabled)
- **Cloud DB:** Supabase Postgres — 3 tables (`run_saves`, `meta_progression`, `user_settings`) with RLS per user
- **Persistence:** localStorage primary with 3 independent save slots (`emblem_rogue_slot_{1-3}_meta/run`). Supabase cloud backup (push on save, fetch on login) with per-table write serialization and meta `savedAt` freshness guard. Offline play degrades gracefully. Old single-save data auto-migrates to slot 1. Anti-refresh: battles persist a suspend checkpoint (`battleInProgress` flag; `BattleSuspendController`) after every action with the live and resumed RNG streams aligned — any exit (refresh/crash/Save & Exit) offers Resume Battle (exact restore) or Continue from Map (sanctioned full revert with entry-time Vision/RNG refund) on continue, so refresh restores resolved actions from the latest durable checkpoint. If device storage refuses writes, Retry blocks the next action boundary; choosing Keep playing accepts that a close or crash loses changes since the last durable checkpoint. This storage-refusal case is the bounded exception to the anti-refresh guarantee.
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
│   ├── accessories.json   # 33 accessories: 10 stat-based + 23 with combatEffects (incl. legendaries: Mentor's Band EXP Share, Mercury Sandals)
│   ├── affixes.json       # 12 enemy affixes: difficulty-gated modifiers with exclusion rules
│   ├── blessings.json     # 23 shrine blessings: tiered run-shaping modifiers
│   ├── classes.json       # 53 entries: 22 base + 30 promoted + 1 boss-tier class
│   ├── colosseum.json     # Mercenary arena config: merc pools, ladder, promotion scaling
│   ├── consumables.json   # 15 consumable items: 3 core + 8 stat boosters + 2 reclass seals + 2 misc
│   ├── dialogue.json      # Recruit lines, story sequences, map/shop flavor, unitVoice (level-up / promotion / last words: class × trait × temperament, 7 lord voices)
│   ├── difficulty.json    # The ladder: normal/dusk/hard/lunatic, shown as First Light/Dusk/Nightfall/Black Sun
│   ├── eclipse.json       # The Eclipse (visible run clock): shadow gain/relief, fall thresholds, phases
│   ├── enemies.json       # Enemy pools by act (act1-act4, postAct, finalBoss), boss defs, count scaling
│   ├── imbues.json        # 6 weapon imbues (rare blessings) + Imbuing Stone / Prismatic Stone defs
│   ├── lords.json         # 7 lord characters with stats/growths/promotions
│   ├── lootTables.json    # Per-act loot pools with weighted categories
│   ├── mapSizes.json      # 10 map size templates by act/phase
│   ├── mapTemplates.json  # 20 zone-based templates (9 rout, 8 seize, 3 escape) incl. tundra/volcanic/castle
│   ├── mechanicsReference.json # In-game help: combat formulas, weapon ranks
│   ├── metaUpgrades.json  # 79 tiered upgrades in 6 categories
│   ├── prologue.json      # The prologue: authored units (Edric, Sera, Tamsin), chapters (P1–P4), beats, route (row-2 fork, the watchtower), joins, Varro (`boss`), the ending's scenes, grant; engine/Prologue.js documents and validates it (docs/specs/prologue-chapter.md)
│   ├── recruits.json      # Recruit pools by act (act1-act4) + namePool
│   ├── referenceViewer.json # Reference viewer config: formulas, weapon ranks, game version
│   ├── skills.json        # 59 skills across 7 trigger types
│   ├── terrain.json       # 19 terrain types (incl. Ice, Lava Crack, Floor, Pillar, Ballista, Swamp, Bog, Acidic Swamp/Bog)
│   ├── turnBonus.json     # Turn par calculation config
│   ├── weaponArts.json    # 75 weapon arts across 5 types, HP-cost combat mods
│   ├── weapons.json       # 136 weapons across 8 types (incl. Restore cure staff, enemy-only status staves, lord personal weapons)
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
├── tests/                 # Vitest unit tests + harness/ + sim/, Playwright e2e/ (browser CI lanes: tests/e2e/lanes.json)
├── References/            # Source sprite sheets + raw assets (not deployed, .gitignored)
├── assets/                # sprites/ (32x32), portraits/ (128x128), audio/ (sfx, 98 original music files + 142 ceremony stingers)
├── sim/                   # Balance sim scripts (progression, matchups, economy, fullrun)
└── tools/                 # Build/asset processing scripts (sprite splitting, resize, bg removal)
```

### Scene Flow
Auth/offline gate (main.js) → Boot → Title → SlotPicker → HomeBase → DifficultySelect → BlessingSelect → NodeMap ↔ Battle → RunComplete → Title. Dev routing: `?qaStep=` or `?devScene=` query params skip to specific scenes.

### The Prologue (the first thread)
`docs/specs/prologue-chapter.md`; the story is complete (P1 → P2 → the fork → P3 → the Old Watchtower → P4 → the ending → Home Base). The prologue is a run that never counts (`RunManager.mode: 'standard' | 'prologue'`, serialized; old saves are standard): `data/prologue.json` (authored chapters P1 "Banner at Dawn", P2 "Old Hands" and P3 "The Seer on the Road" with their maps, kits, `villageTile`, `loot`, `showPar`, P3's green `npc` Sera, and P4 "The Quarry Gate" (four units for three spawns: a `deploy` rule with its note, `formation` spares, `rosterEquip` for the replay's Gaspar, Captain Varro on the throne, seize, par); the `route` with the row-2 fork, Harrow's Market (authored `stock`, no Restock) | Harrow's Chapel (blessings greyed), node `preview`s, row 4's Old Watchtower (a Ruins node with its own `stock` and arrival `lines`, Sera's vision), P4's node `bossLine`; `joins` (`afterChapter`, `atNode`: Tamsin joins unarmed at either fork node, her bow granted there if the army lacks one); `boss` (Varro: in no act pool; the boss card reads his epithet from here); `ending` (`music`, `scenes` of lines, ceremony cues, a shake, veils, PROLOGUE COMPLETE (`card`) on a `won`-only scene, the title card)) → `engine/Prologue.js` (`buildPrologueBattleConfig`, `buildPrologueNodeMap`, `buildPrologueRoster`, `buildPrologueNpcUnit` (the one NPC builder BattleScene and HeadlessBattle share), `buildPrologueShopStock`, `buildPrologueLootChoices`, `prologueBeatsFor`, `prologueProtectedNames`; validated by `npm run validate:data`) → `RunManager.startPrologue` (Edric alone, the literal route with every chapter pre-locked in `battleConfigsByNodeId`, Vision 0, Eclipse off, Act 1 on Normal, no meta effects; `joins.afterChapter` commit in `completeBattle`; `arriveAtPrologueNode` for arrival joins (`ui/PrologueArrival.js`: saved, then the recruit card); `grantPrologueVision` once per run, reverted with the battle; `restartPrologueBattle` reverts to the chapter's entry even past a fatal checkpoint; `failRun` refuses) → `BattleScene` + `ui/PrologueController.js` (coach, gates, highlights, notes, tips, lines, Talk/heal/rewind beats, the protected-unit intercept, victory records; every hook returns a task that settles once its notes and lines are read and the scene awaits it through `safeBattlePresentation` at the site the beat belongs to (`removeUnit` for a fall, the Seize command before the victory flow), so a blocking sequence owns its interval of the simulation, and the player turn-start pipeline awaits `idle()` before it reads the battle state; its teaching state rides the suspend checkpoint via `snapshot`/`onResume` (version 2: spent beats, the gate, the ledgers, the damage ledger and the unread notes/lines as `pending` records, replayed on resume; a hint is marked read only when its note is acknowledged), so a resume never replays `battleStart`; the hook contract and what survives suspend are the tables in spec §9). Density (spec §2 "Core and reinforcement"): each chapter's small core is its blocking `note`s (P1 2, P2 2, P3 3, P4 2 with the deploy note; `prologueNoteBudget`); everything else is a `tip`, never awaited, never pending: a `GuidanceNote` beside the map (`ui/PrologueTip.js`) or, raised by a forecast, one line in its notes (`prepareForecast` before the render; read only on Confirm/Cancel). A tip marks its hints only once read, so an unread lesson is still taught at its Act 1 point of use (`tests/PrologueDensity.test.js`). P3's rout requires Sera (`requiredRecruits`, validated; `engine/RoutObjective.js` `isRoutComplete` is the one rout predicate `BattleScene.checkBattleEnd` and the harness read: the last Soldier's fall leaves the battle playable until the Talk, which then checks the end; a standard run requires nobody). A practised lesson is marked only when the skill was shown: `combatResolved` carries the committed `distance` and `damagedBy` (P2's chip-then-finish needs Gaspar's damage on that foe, P3's range-two a strike from 2 tiles), `deployed` is raised from the deploy screen's confirmation (`scene._deployConfirmation`), and the roster lesson's Withdraw/Equip read the army's state after the action. The row-2 roster lesson (core Withdraw → Equip, then Trade and Store offered as more; once, skippable, never blocks travel) is `engine/PrologueRosterLesson.js` (pure ledger on `RunManager.prologueRosterLesson`, `more: null | accepted | declined`) + `ui/PrologueRosterCoach.js` (the strip in `MobileRosterSheet`, which every browser Roster uses); travelling on from the fork with Tamsin unarmed asks Open Roster / Continue anyway, once per attempt, never a gate (`engine/PrologueDeparture.js`, `ui/PrologueDepartureWarning.js`, in `NodeMapScene.onNodeClick`) → `ui/PrologueEnding.js` (the ending's scenes with existing tools: `music_explore_deep`, the `sealed` / `eclipse` / `rewind` cues, PROLOGUE COMPLETE after a win (never after a skip, `prologueWasWon`), the Hollow Sun veil, THE THREAD BREAKS card (never the game over's words); lines adapt to a skip via `endingLinesFor`; then the handoff (`ui/PrologueHandoff.js`: what ends a run, fallen allies, what starts over, what stays, Vision; once), `meta.completePrologue` with the grant paid once, the run save cleared, Home Base). Routing is pure: `engine/PrologueRouting.js` (`routeForSlot`, `routeForBeginRun`: a lost prologue run save (state left `in_progress`) gets the offer again at Begin Run; `meta.prologue.state ∈ none | in_progress | skipped | complete`, merged on cloud fetch by `mergePrologueState`), the starts live in `utils/firstRunFastPath.js` (`startPrologueRun`, `skipPrologueToFirstRun`). A fresh slot's New Game (Title and Slot Picker) offers Play the Prologue ("about 30 minutes": a harness estimate for a first-timer, a playtest hypothesis, spec §9) / Skip; a fresh device's title "Prologue · Start here" starts the run; with saves it offers Continue the prologue (an unfinished prologue run), Play the Prologue as a new save (next free slot), then Replay a chapter: a chapter select whose standalone replays set the slot aside (`prologueReplayStash`) and never write it. Copy: coach/note/offer/Home Base text in `src/data/prologueContent.js`, spoken lines in `dialogue.json` `prologue`. Harness: `tests/harness/PrologueP1/P2/P3/P4.test.js` (each chapter starts from the previous one's real end states: `prologueP2Policies.js`, `prologueP3Policies.js`, `prologueP4Policies.js`).

Three predicates in `engine/ScriptedBattle.js`, and every run-layer reader uses one of them, never a mode string or a private flag (`tests/ScriptedBattleSuppression.test.js` drives each reader in both modes): `isScriptedBattle(battleParams)` is the teaching suppression in both the run and a standalone replay (Eclipse, Guidance, contextual hints, deeds, formation (unless the chapter names `formation`: P4), rolled caravans/villages, story beats, commander last words, the first-battle theme); `isStandaloneScriptedBattle(bp, rm)` means no run layer (no suspend/intent writes, no slot); `isPrologueRun(rm)` switches the run layer itself (no cold open or act card on its route map, no Abandon Run, no boss recruit, third lord, Vision grant or advanceAct, no act milestone, the loom header "Prologue · The Quarry Road"). A chapter with `showPar: false` has no par. The chapter never counts: no `runsStarted`, no Vision grant from a chapter; a protected unit's fall restarts the chapter ("Not this thread"), with an unspent Vision charge offered first. Completion keeps the device-wide keys `emblem_rogue_tutorial_completed` / `emblem_rogue_tutorial_lessons` (`ui/prologueLessons.js`, `applyCompletedTutorialHints` for new slots) and, in the run, marks the slot's hints as the notes show; the `.re-tutorial-note` / `mb-tutorial-*` CSS hooks and the `TUTORIAL_HINT` battle state keep their names. The prologue's run save is local-only: `CloudSync.isLocalOnlyRunSave` never pushes a `mode: 'prologue'` run (older clients would load it as a standard run); the slot's meta, including `meta.prologue`, still syncs. Logout's backup says what it could not carry (`backupAllLocalSlots` → `{ ok, localOnly }`), and sign-out asks before discarding an unfinished prologue (Keep playing / Sign out anyway), even after a confirmed backup. The grant's receipt travels with the economy that holds it: the cloud fetch keeps one meta payload whole, so `grantPaid` comes from that payload only (`reconcilePickedPrologue`; a completion only the other copy saw is paid into it once), while the local adopt-merge, which keeps both economies at their max, unions it (spec §9 "RunManager"). Browser specs: the `prologue` e2e lane, and `portrait-prologue.spec.js` in the `portrait` lane. Its ordinary-play specs (`prologue-journey-market` / `-chapel`, `prologue-falls`, `prologue-resume`, `prologue-skip`, `portrait-prologue`) never call onVictory, removeUnit, completeBattle or a setter: they play through `tests/e2e/prologueDriver.js` (clicks, taps and keys on the real board, menu, rail and DOM; a planner that reads the board to choose a move; waits on state) and `tests/e2e/prologueJourney.js` (each chapter as a player plays it).

**Act 1 follow-through** (spec §7): essential Guidance notes taught at the point of use in a real run, once per slot, never in the prologue run or a scripted battle, never over their subject: `guide_first_shop` / `guide_first_church` (the service menu's status line; the prologue's Market or Chapel marks its own read), `guide_prepare` (the route map after a battle that left someone below half HP; replaced `nodemap_hp_persist`), `guide_objective_changed` (a seize map's boss fell: points at the throne), `guide_specialist_dance` / `guide_specialist_flyer` (first selection), `guide_armor` (a blade's forecast on armour, in the forecast's notes). Outside battle they go through `ui/guidanceGate.js` (`canShowRunNote`), in battle through `GuidanceController`.

## Data File Gotchas
Read the JSON files directly for full schemas. Non-obvious behaviors:
- **classes.json** — Base classes have `growthRanges` (string "55-70", rolled once at recruitment). Promoted classes have `promotionBonuses`. Some have `learnableSkills: [{ skillId, level }]`.
- **Item names are identity** (saves store whole items; weapon-art gates, siege lookups, icons and fx key on names). Renaming an item goes through `ITEM_RENAMES` + `ITEM_NAMES_REVISION` in `engine/ItemNameMigration.js`, which `RunManager.fromJSON` runs over old saves (`docs/specs/item-names.md`). Weapon names follow the family grammar there; rule tags come from `engine/ItemKeywords.js` (`docs/specs/item-keywords.md`).
- **weapons.json** — Scrolls have `skillId` field (consumable, not equippable as weapons). `signatureOf: "<Lord>"` marks a lord's personal weapon: Deadly Arsenal I gives it to that lord as commander (`engine/SignatureWeapons.js`), and it never enters loot (the validator enforces one per lord, wieldable, not in loot tables). Staves gain +1 use at MAG 8/14/20; uses tracked via `_usesSpent` (survives serialization). Prices: Iron=500, Steel=1000, Silver=2000, Legend=0, Scrolls=2500, Staves 300/600/1000/1200/0.
- **consumables.json** — Stat boosters are loot-only (not in shops). Reclass seals: Infantry Seal, Mounted Seal.
- **lootTables.json** — Act 1: no rare pool, limited forge pool. Loot weapons filtered by roster proficiencies.
- **accessories.json** — Stat accessories modify `unit.stats` directly on equip/unequip. Combat accessories have `combatEffects` evaluated at combat time by Combat.js + SkillSystem.js. Conditions: `below50`, `above75`, `on_forest`, `adjacent_ally`, `no_ally_within_2`, and more (see SkillSystem.isAccessoryConditionMet).
- **metaUpgrades.json** — Effects cumulative per tier (level 2 shows total bonus, not incremental). Growth and flat stat upgrades are independent tracks. A price change credits past buyers through a frozen `BALANCE_REVISIONS` entry in `MetaProgressionManager`; a removed upgrade is refunded once through `RETIRED_UPGRADES` and the `retiredUpgradeRefunds` ledger (Expanded Ranks: there is no roster cap).
- **enemies.json** — Act 1 `levelRange` overridden per-node by `ACT_LEVEL_SCALING` in NodeMapGenerator.js (row 0: `[1,1]`, row 1: `[1,2]`, row 2: `[1,3]`, default: `[2,3]`; boss nodes take the act's `default` row range for their escorts). A pool's `promotedShare` is the chance each filler enemy comes from its promoted list (default `DEFAULT_ENEMY_PROMOTED_SHARE` 0.3; Act IV 0.6). Act bosses keep their listed `level` plus the rung's `bossLevelBonus` (difficulty.json; Dusk +2, Nightfall +3, Black Sun +4): `enemyLevelBonus` never reaches them.
- **terrain.json Ice** — Slides are priced (`engine/IceMovement.js`): stepping onto Ice costs the tile, the first tile slid past it is free, each further tile costs its move cost, and a slide the unit can no longer pay for stops on the ice and ends the move. `Grid.computeMovementRange` (also the harness grid's, never a copy) marks those tiles `slideStop`; `reconstructRangePath` carries the mark on the path's last tile, and `computeEffectivePath` stops a slide early only on a marked path (an A* path always slides to its end). `FogAmbush.pathCostTo` prices slides the same way, so Canto's remaining MOV agrees. A unit another unit's action puts on Ice (Shove, Smite, a weapon-art push or ram) slides too, free, over the same slide: `IceMovement.slideAcrossIce` is the one slide (walking's `resolveIceSlide` and the forced `traceForcedSlide` call it), `ForcedMovement.traceForcedMove` composes a push with it; fliers don't slide, the slide ends on the first non-Ice tile (hazards included) or stops on the last Ice tile at an edge, a unit or ground the move type can't stand on, and a slid tile counts as a tile of the push. A unit moving itself (Pull's puller, art advance/retreat/through/swap, Swap) and teleports don't slide. Previews trace the slide over known units only (`ui/forcedMoveProbes.js`); execution traces the real board, so a hidden unit stops it like a walk's ambush (`docs/specs/utility-abilities.md`).
- **recruits.json** — `levelRange` overridden at spawn. Recruit scaling is Edric-anchored (see `RecruitScaling.js`), not simple lord-level mirroring.
- **colosseum.json** — `crossActPoolAccess: true` pulls next-act recruit classes into merc generation. This means act2 can draw promoted act3 classes and must use promote-path handling. Arena bouts are fought to the finish, round by round (`engine/ArenaBout.js`, cap `arena.maxRounds`); the fee is paid at the start, and the forecast's odds come from a seeded simulation that never touches the run's `Math.random`.
- **mapTemplates.json** — Castle templates (corridor_siege, castle_ruins, great_hall) gated to act2+ via `"acts"` field. Escape templates require an `escapeZone` and use endless `repeatingWaves` pursuit reinforcements (active on Normal too — they ARE the objective pressure). `"caravan": false` (chokepoint, great_hall) keeps a template off nodes that rolled a Merchant Caravan (`pickTemplateForNode`); `generateBattle` redraws a caravan node's layout (up to `CARAVAN_PLACEMENT_ATTEMPTS`) before giving up, and a locked map with no caravan drops the route-map tag (`RunManager._settleCaravanPromise`).
- **affixes.json** — `difficultyGating`: First Light 5%, Dusk 8% (1 max, none in Act 1), Nightfall 12%/1 max, Black Sun 30%/2 max. Mutual exclusion + class exclusion rules enforced by AffixEngine.
- **difficulty.json** — Four rungs, easiest first (`DifficultyEngine.DIFFICULTY_IDS`); ids are save data and never change, names are `label`s. First Light (`normal`) ends at the Lieutenant, Dusk (`dusk`) at the Emperor (Act IV), Nightfall (`hard`) and Black Sun (`lunatic`) at the Entity. `enemySkillChance` is added to the act's enemy combat-skill chance (`UnitManager.assignEnemySkills`, via `enemyDifficultyConfigFromParams`). First Light's `villageMinRow` (`{ act1: 3 }`: act id -> first node row that may hold a village) keeps villages out of Act 1's first three rows; `NodeMapGenerator` still rolls the village and drops the result, so the node-map stream is unchanged. Compare rungs with `isDifficultyAtLeast`, never with id lists; `enemyClassEarliestAct` holds a gated enemy class back until an act (Dusk: no Dragon before Act IV); unlocks are `DIFFICULTY_UNLOCKS`. Every table keyed by difficulty (affix gating, par multiplier, Eclipse gain, template turn offsets and reinforcement gates) needs a `dusk` entry. Dusk+ turn pressure (`docs/specs/dusk-pressure.md`): Dusk and Nightfall rout maps get a finite reinforcement ladder with XP decay (`routLadder`, `engine/RoutLadder.js`) written into the battle config at generation; on seize/escape maps part of the garrison holds in packs until a packmate is threatened, hurt or killed (`engine/HoldActivation.js`); seize par has a reachable floor (`engine/SeizeParFloor.js`). `objectiveParOffset` takes `rout`/`seize`/`escape`, each a number or a table by act (`{ act4: -2 }`, resolved by `MapGenerator.objectiveParOffsetFor` and locked with the map); `turnBonus.firstLightParInflation` must equal First Light's `parInflation` (it caps the seize floor). Status staves and siege tomes (`statusStaffConfig` / `siegeWeaponConfig` with `perBattle: true`) are one per-battle chance, rolled in `engine/CasterGear.js` off `Math.random` only when an eligible caster stands on the map; Dusk fields Silence only from Act III and siege only in Act IV. A config without `perBattle` is a saved run's old per-spawn roll. `shopCureGating` must be true in every act with a staff chance. A run keeps the act list it started with, so a Hard run saved before the ladder still ends at the Emperor.
- **turnBonus.json** — Par formula uses sqrt enemy scaling (capped at linear), area/terrain penalties, then `*0.8` and optional difficulty multiplier. See `TurnBonusCalculator.js:calculatePar()` for current logic. Late pressure (`latePressure`): XP/gold decay once more than `startOverPar` (2) turns over par; boss enrage from turn min(`bossEnrageTurn` 12, par + `bossEnrageOverPar` 2) (`TurnBonusCalculator.getBossEnrageTurn`).
- **whetstones.json** — Applied immediately on loot pickup, never enter inventory.
- **imbues.json** — One imbue per weapon, instance-only state (`weapon._imbueId`; canonical weapons.json never gains imbue fields). Effects resolve catalog-side at combat time via `ImbueSystem.js`; combat mods merge like weapon-art mods in `Combat.js`. Imbuing Stones are whetstone-like `forge`-category loot (act2+), stone names listed in lootTables forge pools (whetstones doubled so stones drop ~half as often as Silver Whetstone).
- **eclipse.json** — The Eclipse (`docs/specs/eclipse.md`, `EclipseSystem.js`): shadow is committed only at battle victory (`completeBattle({ turnCount, turnPar })`), never mid-battle. Node falls transform nodes (never delete); thresholds are computed from `runSeed` + node id; conversions run on their own seeded stream. Late-pressure XP/gold decay past par still applies while it runs.
- **dialogue.json `unitVoice`** — Recruits speak from merged class + temperament + trait pools (temperament is derived per run from name + run seed, never stored); lords only from `lords.<name>`. Picks are pure (`UnitVoice.js`, no RNG / narrative log). Lines ≤ 90 chars; tokens `{leader}` (recruit pools only), `{name}`, `{skill}` (skills pool only). A line naming another lord plays only when that lord is in the army. Voice rules: `docs/lore-style-guide.md`.
- **traits.json** — Rules v2 (`docs/specs/traits-v2.md`). Rolling is class-aware: `roll` blocks gate or weight traits by role. `ATTACK` in creationMods resolves to the class's attack stat (STR/MAG), and traits never replace a mastery perk (`masteryPerkMultiplier` only amplifies it). Retired v1 ids stay defined so old saves load; `migrateUnitTraits` converts them once. Per-unit trait text comes from `src/ui/traitContent.js`.
- **dialogue.json fall lines** — `lordQuips.onAllyFall.<lord>` (`{fallen}`): a living lord answers an ally's death (commander first, else the nearest). `commanderFall.<lord>`: a fallen commander's last words before the run ends. `bossEncounters['The Lieutenant'].vision`: plays once in an Act III boss battle on roads that never fight him. `maxRunsStarted` (the run being played counts) gates the first run's cold open.
- **dialogue.json `finaleRally`** — The Entity finale's rally (`engine/FinaleRally.js`, pure, hashed from the run seed). `lords.<Lord>`: `open` (the commander opens), `lines`, `reply.<Other lord>` (answers whoever just spoke; must name them), `memory` (this save has met the Entity), `wounded` (speaker below half HP), `fallen` (`{fallen}` = a unit lost this run, lords first); `lords.Sera.close` (she speaks last). `recruits.<temperament>` (`{leader}`): the two strongest recruits join. At most 7 lines. Lines mentioning bleeding only play once the Entity is wounded. Same voice rules as `unitVoice`; outside `reply`, a line never names another lord.
- **skills.json** — 7 trigger types: passive, passive-aura, on-combat-start, on-attack, on-turn-start, on-defend, action. `activation` = proc chance type (SKL/SKL_HALF/LCK_THIRD/SPD/LCK/always).
- **Action skills with `actionAbility`** (Blink, Rally Cry, Healing Circle, Ensnare, Smite, Transfuse) run from the Ability menu through `engine/ActionAbilitySystem.js` (rules) and `ui/AbilityController.js`; Smite and Transfuse pick an adjacent unit in `SELECTING_ABILITY_TILE` (`ui/AbilityTargetingController.js`). `perMapLimit` is required only for the four older kinds; `usableWhileSilenced` lets bodily acts ignore Silence. Smite is blocked by bosses, the Entity, Anchored and root; Transfuse never takes the giver below 1 HP and skips a Wounded ally. Shove, Pull and Dance stay hardcoded (no `actionAbility`); Swap is an innate command, not a skill. Shove and Smite are forced moves: a unit pushed onto Ice slides on (see the Ice line above). Spec: `docs/specs/utility-abilities.md`.
- **Skill loadout** — `unit.skills` is the equipped list (≤ `MAX_SKILLS`, all battle reads); `unit.benchedSkills` holds known skills set aside. A player unit that learns at the cap keeps the skill benched (`learnSkill` returns `benched: true`, reason still `at_cap`), never loses it; enemies never bench. Swaps, lock rules (lord and class skills can't be benched) and the bench notice (`benchedUnseen`) live in `engine/SkillLoadout.js`. Check "knows a skill" with `knowsSkill`, not `skills.includes`.

## Core Formulas (from GDD Section 3.3)
```
Physical Damage = (STR + Weapon Might) - enemy DEF
Magical Damage  = (MAG + Weapon Might) - enemy RES
Hit Rate        = Weapon Hit + (SKL × 2) + LCK - Enemy Avoid
Avoid           = (SPD × 2) + LCK + Terrain Bonus
Critical Rate   = SKL / 2 + Weapon Crit + Skill Bonuses - Enemy LCK
Critical Damage = 3× normal damage
Attack Speed    = SPD - max(0, Weapon Weight - floor(STR / 5))   (+ weapon/skill SPD bonuses; staves: SPD)
Double Attack   = attacker Attack Speed >= defender Attack Speed + 5
```
Doubling reads attack speed, never raw SPD: `calculateEffectiveSpeed` / `canDouble` in `Combat.js` (threshold `DOUBLE_ATTACK_SPD_THRESHOLD`; the Pursuit Ring lowers it, `preventEnemyDouble` effects block the foe's double, an active weapon art gives up its follow-up, and Quick Riposte forces a defender's double). Sims should read `getCombatForecast(...).attacker.doubles` rather than recompute it.

### Weapon Triangle
Swords → Axes → Lances → Swords: +10 Hit, +1 Damage (advantage) / -10 Hit, -1 Damage (disadvantage). Mastery rank: +15/+2 advantage, -5/-1 disadvantage. Magic and Bows are outside the triangle.

## Build Order
Phases 1-9 complete ✅, Phase 10 (Deploy) live. (Grid → Combat → Units → Equipment → MapGen → NodeMap → RunLoop → MetaProg → Polish → Deploy). See GDD Section 14.2 for original spec. Phase 9 (Polish) includes: music/SFX, accessories, fog of war, 113 weapons, 59 skills, save slots, affixes, weapon arts, blessings, difficulty modes, terrain hazards, convoy, wyverns, reinforcements, boss recruit, tutorial hints, colosseum, entity boss, ballista, castle biome, recruit promotion, BattleScene decomposition (10 controllers extracted), narrative flavor. Phase 10: Supabase auth + cloud saves + Netlify auto-deploy.

## Art Style Guidelines
- SNES-era pixel art, 32x32 base tile / character sprite size
- 32-color master palette (define early, apply to everything)
- Character portraits: 128x128
- Battle sprites (post-MVP): 64x64 or 96x96
- Player units = blue palette, enemies = red palette, NPCs = green palette

## Music (composed in code)
All music is original: 54 loop scores in `tools/music/scores/` and 30 ceremony cues (stingers) in `tools/music/stingers/`, rendered by `tools/music/engine/` (sampler + mixer) to `assets/audio/music/` and `assets/audio/stingers/`. Read `tools/music/SCORE.md` (leitmotifs, the Entity's finale, cue list, boss cards and enrage layers, device budget) and `tools/music/README.md` (setup, build, lint/analyze/pitchcheck tools).
- **Rebuild:** `python3 tools/music/build.py <score>` (or `--all`; `--stingers [names]` for cues), then `npm run sync-assets`. The build regenerates `src/utils/musicLoops.js` (loop points + each track's `tonic`) and `src/utils/musicStingers.js`, so never hand-edit them. A form check refuses any score with a bar where nothing sounds (declare intended silence in `score.silent_ok`).
- **The palette:** `tools/music/engine/palette.py` picks each instrument's library at render time. The game ships `HOUSE` (the sound lab's blind-A/B verdicts): Sonatina Symphonic Orchestra 4 for string sections, solo violin (the performer's `clean` style), oboe, celesta, choir and oohs; Virtual Playing Orchestra 3 for horns/trumpets/trombones; the legacy registry (VSCO 2 CE, GeneralUser GS) for the rest. A score may change one for itself (`s.palette`). Any other `--palette` is an audition and never writes game assets. Those licences need credit: the help overlay's Meta › Music Credits page and `docs/music-credits.md` (the soundtrack is CC BY-SA 4.0; `tests/MusicCredits.test.js` holds the credit to the palette). `bash tools/music/fetch_libraries.sh` fetches every library.
- **Seamless loops:** each file is an intro plus a loop region. `AudioManager` plays it through `LoopedMusic` (Web Audio `loopStart`/`loopEnd`) and falls back to a whole-file loop without Web Audio. A layer that can't share the primary's timeline (stale cache) is dropped, never mis-looped.
- **Entering a battle:** the route map hands its track to the battle (`audio.handOffMusic(this, 'Battle')`) instead of stopping it: it bridges the deploy screen and the battle track's fetch/decode (seconds on a phone), then crossfades into it; a battle track that fails to load takes the bridge down with it (`tests/MusicHandoff.test.js`, `battle-entry-music.spec.js`).
- **Adaptive battles:** field battle themes ship as `<key>` + `<key>_calm` on one timeline (`MUSIC_LAYERS`). `BattleMusicController` + `engine/MusicIntensity.js` crossfade calm↔full on combat and threat; `audio.setMusicIntensity()` is the API.
- **Which battle theme:** `engine/BattleMusicSelection.js` (pure) picks a non-boss battle's track from `battleMusicContext(...)`: escape → eclipsed / village under attack / recruit rescue / elite, each act its own company (`MUSIC.battleSituation`; an entry is a key, a pool, or a table by act) → the map's biome (`MUSIC.battleBiome`) → a caravan, a bandit village, fog of war → the act pool (`MUSIC.battle`). Escape (`MUSIC.escape`), place and situation entries are each a key, a pool, or a table by act: escapes, rescues, castles and fog have two themes each, split by act (SCORE.md, "Which battle theme plays"). Castles, caravans, bandit villages and fog take only a share of their battles (`THEME_SHARE`). Picks are hashed from the run seed (a resumed battle keeps its track); the act pool, and any pool, is walked per run by node row, so a path never repeats a theme until the pool is spent, and every run opens on Ember Dusk. A new place or situation theme is a score plus one table entry; `MusicLibrary.test.js` checks every one is adaptive and every biome key is a real template biome.
- **Boss enrage:** each boss theme ships `<theme>_enrage_<boss>` (same timeline, `getBossEnrageLayer`); `BattleMusicController.onBossEnrage()` crossfades to it when turn pressure enrages the boss (`setMusicIntensity('enrage')`).
- **Entity finale (`ENTITY_FINALE`):** the Entity has no enrage layer. Its first wound (`onCombatResolved`, or turn-pressure enrage first) cuts its theme, leaves 2 s of silence, plays the `entity_answer` hinge cue and starts `music_boss_entity_finale` on the cue's `handoff` downbeat (`playMusic(..., { startAt })`, sample-aligned). The `_hum` stem is an additive layer (`layerGains`) whose level follows the Entity's HP (`audio.setMusicLayerGain`). A resumed battle with a wounded Entity opens on the finale. On the finale's downbeat the army answers, one line every two bars over each speaker's unit (`onFinale` → `BattleBeatsController.entityRally`, composed by `engine/FinaleRally.js`).
- **Stingers:** `audio.playStinger(name, { fallbackSfx, duck, waitMs })` plays a cue in the key of the current track (keyed cues exist per tonic) and ducks the music; `stopStingers()` fades them. Ceremonies call them through `src/ui/ceremonyMusic.js`; boss cards map in `BOSS_CARD_CUES` (the Entity: silence).
- **The iOS app's music:** the TestFlight workflow re-encodes every music track at LAME V6 (`tools/ios/compactMusic.mjs`, about a quarter smaller, checked sample-for-sample against the original's length) so the app stays under Apple's 200 MB cellular download limit; the web game keeps the build's V4.
- **Adding a cue:** write a score (or stinger), build it, add the key to `musicConfig.js`. `tests/MusicLibrary.test.js` fails on missing files, orphans, bad loop points, a boss without an enrage layer (the Entity excepted) or a keyed stinger missing a key.

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
- **XP is applied before it is drawn.** `awardScaledXP` applies every battle gain at once and queues plain records: an EXP gauge (`scene._pendingXpGauges`, `ui/xpGaugeModel.js`) and level-up cards (`_pendingLevelUpPopups`). `presentQueuedProgress` (`ui/BattlePresentationCheckpoint.js`; `presentQueuedLevelUps` is an alias) plays each unit's gauge (`ui/XpGaugeController.js`), then its cards, then the prologue's level-up beat, never over a prologue note. Only pending cards make a boundary a recovery; clear both queues together (rewind, fatal, restart). Spec: `docs/specs/exp-bars.md`.
- **HP changes go through `engine/UnitHealth.js`; rendering never changes game state.** `setUnitHP` / `healUnit` / `damageUnit` / `applyCombatHP` keep the rules that ride on HP (HP accessory debt is settled the moment a unit is full or down) whether or not anything is drawn. Scenes and UI never write `currentHP` (`tests/HpWriteBoundary.test.js`); `tests/HealthPresentationInvariance.test.js` resolves the same combat with strikes shown, not shown and bars never drawn and requires identical state. Combat results carry everything that changes HP (Thorns sets `strikerHPAfter`), never the animation.
- **Previews read what the player knows.** Anything shown before a commit (blue range, path/slide preview, Danger, pinned/inspected reach, Threat Sight) reads `engine/PlayerKnowledge.js` (via `BattleScene.buildUnitPositionMap()` / `buildOccupiedSet(u, { seenOnly: true })`); only execution and the enemy AI see every unit. A staff never counts as damage reach (`ThreatForecast`). `tests/PlayerKnowledgePreviews.test.js` pairs worlds that differ only by a hidden unit.

## Testing
- **Framework:** Vitest (works natively with Vite config and ES modules)
- **Run:** `npm test` (single run) or `npm run test:watch` (live re-runs)
- **CI gates** (`.github/workflows/ci.yml`; run the relevant ones before a PR):
  - `lint`: `npm run format:check`, `npm run lint`
  - `test`: `npm run validate:data`, `check:data-parity`, `check:ui-theme`, `check:sprites`, `check:reference`, `build`, `test:unit`
  - `harness`: `npm run check:threshold-pr-notes`, `test:sim` and `test:harness` (every vitest file in `tests/sim` and `tests/harness`; `test:unit` excludes both), `test:harness:pr`, `sim:fullrun:pr`
  - `e2e`: one job per lane shard of `tests/e2e/lanes.json`, the only list of browser lanes. Run one with `npm run test:e2e:lane -- <lane>` (`npm run test:e2e:lanes` lists them). `npm run check:e2e-lanes` fails when a spec is in no lane and not excluded with a reason, or when a lane names a missing spec. A new spec goes into a lane.
  - `E2E_PORT=<port>` gives a checkout its own dev server; the default 3000 is reused if something already listens there.
- **Coverage is measured, not counted.** A fault-injection pilot (Sep 2026) found about half of realistic injected bugs survive the whole unit suite. Gaps, rules and the delete/rewrite procedure: `docs/specs/compression-plan-2026-09-25.md`.
- **Residual gap:** BattleScene orchestration logic is undertested relative to its complexity. `tests/harness/HeadlessBattle` mirrors the scene's state machine (Canto off, no async presentation, no resume), so a green harness run does not prove the production action lifecycle. Operations move out of the mirror as they are isolated: post-combat effects run from `engine/PostCombatEffects.js` (a generator the scene drives with presentation and the harness drives without), timed weapon-art buffs from `engine/TimedWeaponArtBuffs.js`, battle stat deltas from `engine/BattleStatDeltas.js`, battle XP (who earns what, the battle's multipliers, the gain and its skills) from `engine/BattleXp.js`. When you extract another, delete the harness copy; don't keep both.
- **Writing tests:**
  - List the realistic ways a change can fail first; each test should catch one of them.
  - Assert outcomes (player-visible or persisted state, RNG cursor), not internal call order.
  - Derive expected values independently, never by re-running the code under test.
  - Before a refactor, pin current behaviour with tests that pass before and after; a bug fix gets a test that fails before it.
  - Prove a new test can fail by planting the bug once.
  - Every `tests/e2e` spec must belong to a CI lane or have a stated exclusion (`tests/e2e/lanes.json`, enforced by `npm run check:e2e-lanes`).
  - In browser specs, wait on state, never on time: a sleep that "usually" suffices rots under load (see `padTap` in `tests/e2e/helpers.js` for driving the gamepad reader).
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
- **BattleScene.js (~11,000 lines)** — 13 controllers extracted (5 original + PostCombatController, TransitionRecoveryController, LootFlowController, WeaponArtController, InputController, HealController, PromotionController, PrologueController). **Rule: never add new rendering or multi-step flows inline. Extract a controller with `create(scene)` / `destroy()` pattern.**

### Large (watch for growth)
- **NodeMapScene.js (~1,950 lines)** — ChurchController/ShopController now own lifecycle and persistence only; ChurchMenu/ShopMenu and ArenaMenu are the sole service renderers. Do not restore headless canvas branches for tests—use rendering-only test adapters and real engine commands.
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
