# Changelog

## Unreleased

### Changed
- **Unit inspection panel width reduced** — 210px→160px (24% reduction) to reduce map obstruction. Font 10px→9px, line height 15→13, padding 8px→5px. Terrain labels abbreviated (Terrain→Trn, Avo→Av, Def→Df). All separator lines extended to 25 dashes. No functionality changes

### Added
- **Turn Bonus / Par Calculation System** — pure calculation layer for rating battle performance by turn count
  - `src/engine/TurnBonusCalculator.js` (new): Pure module — `calculatePar(mapParams, config)` computes target turn count from map size, enemy count, terrain difficulty, and objective type. `getRating(turnsTaken, par, config)` returns S/A/B/C rating with bonus multiplier. `calculateBonusGold(rating, actId, config)` converts rating + act into bonus gold
  - `data/turnBonus.json` (new): Par formula weights (enemyWeight, areaPenaltyPerTile, terrainMultiplier), difficult terrain types, objective base pars (rout=5, seize=7), rating brackets (S≤0, A≤3, B≤6, C=rest), per-act bonus gold (act1=80, act2=150, act3=250, finalBoss=350)
  - Par formula: `ceil(basePar + enemies×0.6 + area×0.03 + difficultRatio×3.0 + adjustment)`
  - Rating brackets: at/under par → S (100%), 1-3 over → A (60%), 4-6 over → B (25%), 7+ over → C (0%)
  - BattleScene/UI integration deferred — calculation layer only
  - 25 new tests: `tests/TurnBonusCalculator.test.js`. Total: **328 tests**

### Changed
- **`src/engine/DataLoader.js`**: Loads `turnBonus.json` (16 total files)
- **`tests/testData.js`**: Includes `turnBonus` in `loadGameData()`

### Fixed
- **Item menu greyed-out items**: Consumables (Vulnerary, Elixir, Master Seal) now always visible in Item menu, greyed out (#666666) when unusable instead of hidden. Fixes confusing empty-menu UX when unit at full HP had only healing items. Usable items remain green (#88ff88) with full interactivity

### Changed
- **Tabbed unit inspection panel**: UnitInspectionPanel split into two tabs — Stats (stats/growths/proficiencies/terrain) and Gear (inventory/consumables/accessory/skills). Navigate with LEFT/RIGHT arrow keys or clickable tab buttons. Active tab has gold highlight (#ffdd44) with dark bg, inactive tab gray with subtle border. Arrow hint (◄ ►) shows keyboard navigation. Fixes overflow when units have full loadouts

### Changed
- **Game length extended**: Added rows to each act for longer runs. Act 1: 5→6 rows (~13→16 nodes avg), Act 2: 6→7 rows (~16→19 nodes avg), Act 3: 5→7 rows (~13→19 nodes avg). Total ~12 additional nodes across all acts (~2 hours extra gameplay at 10min/node). Single-line config change in `ACT_CONFIG` (constants.js)
- **Title screen menu order**: Continue button moved above How to Play for easier access to existing saves. New order: New Game → Continue → How to Play → Settings → Log Out

### Fixed
- **Node map edge crossings**: Fixed rendering bug where edges crossed visually despite correct generation logic. NodeMapScene was normalizing x-positions by per-map `maxCol` instead of using fixed column grid (0-4), distorting the column-lane spacing. Changed to `xFrac = node.col / (NUM_COLUMNS - 1)` for fixed positions matching NodeMapGenerator's 5-lane system
- **Shared weapon state bug**: All units were sharing references to same weapon objects from data arrays, causing staff `_usesSpent` counters and consumable `uses` to affect all instances globally. Fixed by adding `structuredClone()` to `addToInventory()`, `addToConsumables()`, and all unit creation functions (`createLordUnit`, `createEnemyUnit`, `createRecruitUnit`). Each unit now has independent weapon/consumable instances

### Added
- **Staff Mechanics Overhaul** — MAG-based healing with limited uses and MAG scaling bonuses
  - **MAG-based healing**: Heal amount = healer's MAG + staff's `healBase` (was flat hardcoded). Heal staff: MAG+5, Mend: MAG+10, Recover: MAG+15
  - **Limited uses with MAG scaling**: All staves have base uses + dynamic bonus uses. Bonus: +1 at MAG 8, +1 at 14, +1 at 20. Example: Heal base 3 → 4/5/6 with MAG scaling
  - **Physic staff** (new): Ranged heal (range 2, +1 at MAG 10, +1 at MAG 18). Silver tier, 1000g, healBase 5, 1 use. Appears in Act 3 loot
  - **Fortify rework**: Now AoE heal-all in range 2 (no target selection). Heals all damaged allies automatically, single use consumed
  - **Staff depletion**: When remaining uses reach 0, staff removed from inventory and first combat weapon auto-equipped
  - **UI updates**: Staves display `(remaining/max)` uses format. Inspection panel shows effective range with MAG bonuses (e.g., `"Physic (1/2) Rng2-3"`)
  - **Metadata persistence**: `_usesSpent` field survives JSON roundtrip (same pattern as forge metadata)
  - 20 new tests covering MAG scaling, bonus uses at thresholds, range bonuses, AoE heal, data integrity. Total: **303 tests**

### Changed
- **`src/utils/constants.js`**: Added `STAFF_BONUS_USE_THRESHOLDS` [8,14,20], `PHYSIC_RANGE_BONUSES`
- **`src/engine/Combat.js`**: `calculateHealAmount()` and `resolveHeal()` now take `healer` param. New functions: `calculateBonusUses()`, `getStaffMaxUses()`, `getStaffRemainingUses()`, `spendStaffUse()`, `getEffectiveStaffRange()`
- **`src/scenes/BattleScene.js`**: `findHealTargets()` checks remaining uses + effective range. `executeHeal()` spends uses + handles depletion. New `executeHealAll()` for Fortify AoE
- **`src/ui/UnitInspectionPanel.js`**: Staves show `(remaining/max)` + effective range
- **`src/ui/RosterOverlay.js`**: Both main and trade inventory display staves with `(remaining/max)` format
- **`data/weapons.json`**: All staves updated with `healBase` and `uses` fields. Physic added (5th staff). Fortify range changed to `"2"` with `healAll: true` flag
- **`data/lootTables.json`**: Physic added to act3 weapons pool

### Fixed
- **Roster overlay layout issues**: Panel backgrounds now positioned below header (y=44 instead of overlapping y=25), HP bar text right-aligned to prevent overflow, character portraits displayed (48x48 in detail header, resolves lord→generic→promoted fallback), skill names interactive with hover tooltips (description box, canvas-clamped)
- **Music overlap during scene transitions**: Added shutdown event handlers to BattleScene and NodeMapScene that forcefully stop music before scene destruction. Prevents race condition where `sound.destroy()` async cleanup overlapped with new scene's music start. Improved AudioManager defensive cleanup to stop long-duration sounds (>10s) in addition to looping sounds

### Added
- **Onboarding: Help Menu + How to Play Guide** — In-game reference and new player tutorial
  - `src/data/helpContent.js` (new): All text content — `HELP_TABS` (8 categories: Stats, Combat, Terrain, Arms, Skills, Promo, Goals, Meta) with 1-3 pages each, `HOW_TO_PLAY_PAGES` (4 pages: The Run, Combat Basics, Getting Stronger, Meta-Progression)
  - `src/ui/HelpOverlay.js` (new): Tabbed reference dictionary (~160 lines, depth 860-862). 8 clickable tabs, page navigation (Prev/Next), ESC to close. Accessible from Pause menu
  - `src/ui/HowToPlayOverlay.js` (new): Linear paginated guide (~150 lines, depth 500-502). Left/Right arrow keys + click navigation, ESC to close. Accessible from Title Screen
  - **Help button in Pause menu**: Added between Settings and Save & Return. Button order: Resume → Settings → Help → Save & Return → Abandon Run
  - **HOW TO PLAY button on Title Screen**: Added between NEW GAME and CONTINUE. Pulsing red "NEW" badge on first visit (localStorage flag `emblem_rogue_seen_how_to_play`). Badge disappears permanently after opening guide once
  - Content covers: 9 stats, damage formulas, weapon triangle, terrain effects, 8 weapon types, weapon specials, 6 skill trigger types, promotion requirements, battle objectives, 5 node types, meta-progression system
  - All content verified against game data: damage formula, weapon triangle (+10 Hit/+1 Dmg), doubling (SPD+5), crit (3x), terrain bonuses, weapon prices, skill mechanics

### Added
- **Weapon Forging System** — Upgrade existing weapons at shops and via loot drops
  - `src/engine/ForgeSystem.js` (new): Pure engine module — `canForge`, `applyForge`, `isForged`, `getForgeCost`, `getForgeDisplayInfo`. Max 3 forges per weapon. Stats mutated in place; Combat.js reads automatically
  - `data/whetstones.json` (new): 5 whetstone types — Silver (player's choice), Might (+1 Mt), Crit (+5 Crit), Hit (+5 Hit), Weight (-1 Wt). Applied immediately, never enter inventory
  - **Shop Forge tab**: NodeMapScene shop restructured with tabbed Buy/Sell/Forge interface. Per-shop forge limits (act1: 2, act2: 3, act3: 4). Stat picker modal for choosing forge bonus
  - **Loot screen forge cards**: Orange-styled forge cards in post-battle loot. Multi-step picker: unit → weapon → stat (Silver Whetstone) or unit → weapon (specific whetstones)
  - **Forge costs** (nonlinear per level): Might 400/700/1100g, Crit 300/550/900g, Hit 250/450/750g, Weight 250/450/750g
  - Forged weapons display green (#44ff88) in inspection panel, roster, and trade screen
  - Forge metadata (`_forgeLevel`, `_forgeBonuses`, `_baseName`) survives JSON serialization automatically
  - Forged weapon names show "+N" suffix (e.g., "Iron Sword +2")
  - Sell price reflects forge investment (forge cost added to `weapon.price`)
- **Roster-based weapon filtering**: Shop and loot weapons filtered to match current roster's weapon proficiency types. Non-weapon categories unaffected
- **Forge loot category**: New `forge` category in loot tables (10-15% weight). Act 1: Might/Hit/Weight whetstones. Act 2+: all 5 including Silver and Crit
- 39 new tests: `tests/ForgeSystem.test.js` (31 tests), `tests/LootSystem.test.js` (+8 tests). Total: **283 tests**

### Changed
- **`src/utils/constants.js`**: Added `FORGE_MAX_LEVEL`, `FORGE_BONUSES`, `FORGE_COSTS`, `SHOP_FORGE_LIMITS`
- **`src/engine/DataLoader.js`**: Loads `whetstones.json` (14 total files)
- **`src/engine/LootSystem.js`**: `generateLootChoices()` accepts `allWhetstones` (param 8) and `roster` (param 9) for forge loot + weapon filtering. `generateShopInventory()` accepts `roster` (param 6). New helpers: `getRosterWeaponTypes()`, `filterByRosterTypes()`
- **`src/scenes/NodeMapScene.js`**: Shop overlay rewritten with tabbed interface (`activeShopTab`: buy/sell/forge). New methods: `drawShopTabs()`, `drawActiveTabContent()`, `drawShopForgeList()`, `showForgeStatPicker()`, `closeForgeStatPicker()`. Passes roster to shop/loot generation
- **`src/scenes/BattleScene.js`**: Forge loot card rendering (orange #ff8844). New methods: `showForgeLootPicker()`, `showForgeWeaponPicker()`, `showForgeStatPickerLoot()`. Passes whetstones + roster to `generateLootChoices()`
- **`src/ui/UnitInspectionPanel.js`**: Forged weapons render in green (#44ff88)
- **`src/ui/RosterOverlay.js`**: Forged weapons render in green in detail panel and trade screen
- **`data/lootTables.json`**: Added `forge` arrays per act. Rebalanced weights: weapon -5%, consumable -5%, forge +10-15%
- **Login screen music**: Separate calmer track (`music_login.ogg` — "Hometown in Ashes" 70 BPM) for the auth/login screen. TitleScene still plays `music_title.ogg` via Phaser

### Changed
- **Auth screen text size**: "Don't have an account? Register" and "Play offline" text enlarged from `min(9px, 1.4vw)` to `min(12px, 1.9vw)` to match Log In button size

---

### Added
- **Enemy range on right-click**: Right-clicking an enemy/NPC in PLAYER_IDLE shows their movement range (red tiles) and full attack reach (red highlights from all reachable positions). Dismissing the inspection panel clears both overlays. FE-style per-unit threat preview

### Fixed
- **Music overlap after repeated battles**: Orphaned looping sound instances could accumulate across scene transitions (Phaser `sound.destroy()` edge cases). `AudioManager.playMusic()` now defensively stops all lingering looping sounds before creating new music
- **Roster trade picker Cancel button overlapping names**: Trade partner picker used inconsistent positioning formulas — Cancel button and unit buttons had different vertical math. Rewritten with unified layout: filters targets first, positions title/buttons/cancel sequentially from computed top, background sized to actual content

### Changed
- **Recruit level scaling**: Recruits now spawn at lord level or lord level - 1 (50/50) instead of using the act-wide pool range. Prevents underleveled recruits in late-act nodes

### Added
- **Node map column-lane system**: StS-style non-crossing edges. 5 fixed column lanes (0-4), `pickColumnsWithCoverage()` ensures every previous-row column has a ±1 neighbor in the current row, center-band column (1/2/3) guaranteed for boss reachability. `connectRows()` uses `wouldCross()` crossing detection. Single-node rows (start/boss) relax constraints since convergent/divergent edges can't cross. Backward pass ensures penultimate row can reach boss
- 7 new node map tests (column range, no duplicate columns, ±1 edges between multi-node rows, no-crossing verification across 100 trials, sorted columns). Total: **244 tests**

### Changed
- **`NodeMapGenerator.js`**: Complete rewrite with column-lane system. New `pickColumnsWithCoverage(desiredCount, prevCols)` function replaces random column assignment. `connectRows()` rewritten with `wouldCross()` edge-crossing check and `isValidTarget()` column-distance check. `skipConstraints` flag relaxes rules for single-node rows. Middle rows generate 2-4 nodes (was 2-3)
- **`NodeMapScene.js`**: Node x-position now based on `node.col / maxCol` (fixed column lanes) instead of even distribution within row. Preserves vertical layout

### Added
- **Animated pixel-art title screen**: Complete TitleScene rewrite with CanvasTexture-based animated background — dusk sky gradient, 80 twinkling stars, drifting pixel clouds, 3 mountain layers, castle silhouette with flickering window lights, foreground hills/trees, rising firefly particles. Vignette and scanline overlays. Gold-bordered menu buttons with hover/press effects and staggered entry animations. "Press Start 2P" Google Font. "ALPHA TESTING" tag
- **Game renamed to Rogue Emblem**: Title screen, auth overlay, and page title updated
- **Animated auth/login screen**: Full-viewport canvas-animated background matching TitleScene — same sky gradient, stars, clouds, mountains, castle with flickering windows, foreground hills/trees, firefly particles, vignette, and scanlines. Title/subtitle/alpha-tag/divider drawn on canvas. HTML5 Audio plays title music (starts on first user interaction). Form styled to match TitleScene buttons (dark bg, gold hover). Scales with Phaser FIT aspect ratio for seamless transition to game

### Changed
- **`TitleScene.js`**: Full rewrite (~660 lines). Animated background via CanvasTexture redrawn every frame in `update()`. Styled buttons via `createMenuButton()` helper with gold hover states, corner accents, cursor arrow, scale tweens. Title block with shadow emboss, subtitle, alpha tag, sword divider — all with entry animations. Canvas textures cleaned up on shutdown event. Fixed 640x480 coordinate system
- **`index.html`**: Complete auth overlay rewrite. Full-viewport layout with `<canvas>` element rendering TitleScene-identical animated background via inlined drawing functions (no Phaser). HTML5 `<audio>` for title music with user-gesture unlock. `window.stopAuthScreen()` exposed for cleanup. Press Start 2P font for all form elements. CSS scales canvas wrapper to match Phaser `Scale.FIT` + `CENTER_BOTH`
- **`main.js`**: `bootGame()` calls `window.stopAuthScreen()` to halt auth canvas animation and HTML5 audio before Phaser takes over

---

### Added
- **Shop reroll**: "Reroll" button in shop UI regenerates inventory. Base cost 150g, +50g per subsequent reroll at the same shop
- **Node type gold multipliers**: Kill gold multiplied by node type — recruit nodes 1.2x, boss nodes 1.5x. New `NODE_GOLD_MULTIPLIER` constant in `constants.js`, applied in `calculateBattleGold()`
- **Miracle status in combat forecast**: Shows "Miracle: Ready" or "Miracle: Used" for both attacker and defender when they have the skill
- **Weapon auto-switch tooltip**: Brief "Switched to [weapon]" floating text when auto-switching from Staff to combat weapon on Attack action
- 9 new tests: `_miracleUsed` serialization reset, `removeFromInventory` combat-weapon filtering, dual poison `poisonEffects` array, node gold multipliers. Total: **237 tests**

### Fixed
- **Miracle skill permanently disabled across run**: `_miracleUsed` flag was never reset — persisted through `serializeUnit()` into saved roster data. Now reset in both `serializeUnit()` and at battle start
- **Selling equipped weapon could leave non-weapon "equipped"**: `removeFromInventory()` blindly set `unit.weapon = inventory[0]` which could be a Consumable/Scroll/Accessory, causing NaN damage. Now filters to combat weapons only, falls back to `null`. Added defensive null/staff check in `getCombatForecast()`
- **Dual poison overwrite**: When both combatants had poison weapons, only one poison was reported. `resolveCombat()` now returns `poisonEffects[]` array tracking both independently. BattleScene loops over all entries. Backward-compat `poisonDamage`/`poisonTarget` fields preserved
- **BootScene silent crash on data load failure**: Missing or corrupt JSON caused black screen with no feedback. Now wrapped in try/catch with visible red error message
- **Roster bar overflow at 4+ units**: Node map roster bar used fixed 300px spacing on 640px canvas, only fitting 3 units. Now dynamically spaces based on roster size with compact labels and scaled HP bars

### Changed
- **`constants.js`**: Added `NODE_GOLD_MULTIPLIER` (per-node-type gold multiplier), `SHOP_REROLL_COST = 150`, `SHOP_REROLL_ESCALATION = 50`
- **`LootSystem.js`**: `calculateBattleGold()` accepts optional `nodeType` param, applies `NODE_GOLD_MULTIPLIER`
- **`RunManager.js`**: `serializeUnit()` resets `_miracleUsed`. `completeBattle()` looks up node type and passes to `calculateBattleGold()`
- **`UnitManager.js`**: `removeFromInventory()` auto-equips only combat weapons (excludes Staff/Scroll/Consumable/Accessory)
- **`Combat.js`**: `getCombatForecast()` returns zeroed forecast for null/staff weapons. `resolveCombat()` returns `poisonEffects[]` array
- **`BattleScene.js`**: Resets `_miracleUsed` at battle start. Poison display loops over `poisonEffects`. Miracle indicator in forecast. Auto-switch tooltip. New `showAutoSwitchTooltip()` method
- **`NodeMapScene.js`**: Dynamic roster bar spacing. Shop reroll button with escalating cost. New `drawRerollButton()` method
- **`BootScene.js`**: try/catch around `DataLoader.loadAll()` with error display

---

### Added
- **3 Save Slots + User Flow Rework** — Complete overhaul of save system and new player experience
  - `src/engine/SlotManager.js` (new): Pure utility module for save slot management. 3 independent slots, each with own meta progression + run state. Functions: `getMetaKey/getRunKey`, `getSlotCount/getOccupiedSlots`, `getNextAvailableSlot`, `getSlotSummary`, `deleteSlot`, `getActiveSlot/setActiveSlot`, `migrateOldSaves`, `clearAllSlotData`
  - `src/scenes/SlotPickerScene.js` (new): Slot selection screen with 3 slot cards showing renown, runs completed, active run status. Select/Delete buttons with confirmation dialog. Back to Title navigation
  - **New player flow**: Title shows only "New Game" + Settings → creates slot, skips Home Base, goes straight to NodeMap → die → RunComplete awards renown → Home Base (first time, now has renown to spend) → Begin Run
  - **Existing player flow**: Title shows "New Game" + "Continue" → Continue opens SlotPicker → pick slot with active run → resume NodeMap directly; pick slot without active run → Home Base → Begin Run
  - **Run end flow**: RunComplete now shows "Home Base" (primary) and "Title" (secondary) buttons instead of single "Play Again"
  - **Migration**: Old single-save data (`emblem_rogue_meta_save` / `emblem_rogue_run_save`) auto-migrates to slot 1 on first boot via `migrateOldSaves()` in BootScene
  - **localStorage keys**: `emblem_rogue_slot_{1-3}_meta`, `emblem_rogue_slot_{1-3}_run`, `emblem_rogue_active_slot` (settings remain global)

### Changed
- **`MetaProgressionManager.js`**: Constructor accepts optional `storageKey` parameter (defaults to legacy key). `_save()` and load use `this.storageKey` — enables per-slot meta persistence
- **`RunManager.js`**: `saveRun`, `loadRun`, `hasSavedRun`, `clearSavedRun` accept optional `slotNumber` parameter. Internal `resolveRunKey()` reads active slot from localStorage when not provided. Backward compatible — tests work without slot param
- **`BootScene.js`**: Removed MetaProgressionManager creation (deferred to slot selection). Removed `meta.onSave` cloud callback. Added `migrateOldSaves()` call. Meta is now created per-slot in TitleScene/SlotPickerScene
- **`TitleScene.js`**: Complete menu rework. "New Game" creates fresh slot → NodeMap (skip Home Base). "Continue" → SlotPickerScene. Slot count check for button visibility. Log Out clears all slot data
- **`RunCompleteScene.js`**: Two buttons: "Home Base" (primary, goes to HomeBase) and "Title" (secondary). Run save cleared using active slot
- **`main.js`**: Registers SlotPickerScene in Phaser scene array

---

### Added
- **Save & Return to Title** — New "Save & Return to Title" button in PauseOverlay (shown between Settings and Abandon Run). Preserves last auto-save; battle progress lost if mid-combat. Wired in both NodeMapScene and BattleScene pause menus
- **Lord SPD & RES meta upgrades** — 4 new lord upgrades: Lord Swiftness (SPD growth), Lord Wisdom (RES growth), Lord Celerity (SPD flat), Lord Warding (RES flat)
- 8 new tests in `MetaProgressionManager.test.js` (split aggregation, 5-tier growth, 3-tier flat, lord SPD/RES, old ID handling, category distribution). Total: **224 tests**

### Changed
- **Meta upgrades expanded**: 15 → 28 upgrades in `data/metaUpgrades.json`. Each old combined growth+flat upgrade split into independent upgrades: 6 recruit growth (5 tiers, +5%/tier), 6 recruit flat (3 tiers), 5 lord growth (5 tiers), 5 lord flat (3 tiers). Economy (4) and capacity (2) unchanged. Old save IDs silently ignored by `getActiveEffects()`
- **HomeBaseScene.js rewritten** — Tabbed category UI (Recruits/Lords/Economy/Capacity) replaces flat list. Active tab has gold text + underline. Recruit/Lord tabs show "Growth Bonuses" and "Stat Bonuses" sub-headers. Progress bars use unicode blocks (█░). `[ Begin Run ]` button starts new run (clears old save, routes to NodeMap). `[ Back to Title ]` always visible. ESC key returns to title
- **TitleScene.js** — "New Game" removed. "Home Base" is now the first/primary menu option. Game flow: Title → Home Base → Begin Run. Continue still skips directly to NodeMap
- **PauseOverlay.js** — Constructor accepts `onSaveAndExit` callback (optional). Dynamic panel height based on button count (2-4 buttons). Button order: Resume → Settings → Save & Return to Title → Abandon Run
- **NodeMapScene.js** — `showPauseMenu()` wires `onSaveAndExit` callback (stops music, navigates to Title; auto-save already exists on NodeMap entry)
- **BattleScene.js** — `showPauseMenu()` wires `onSaveAndExit` callback when `runManager` exists (stops music, returns to Title; battle progress lost, last NodeMap auto-save preserved)

---

### Added
- **Roster Menu Overlay** (`src/ui/RosterOverlay.js`): Full inventory management on node map — view unit stats, equip weapons, use consumables (heal + Master Seal promotion), manage accessories (equip/unequip/swap from team pool), trade items between units. Opened via `[ Roster ]` button on node map. Depth 700, ESC to close. Auto-saves on close
  - **Unit list** (left panel): Clickable unit entries with HP bars, gold highlight for selected unit
  - **Unit details** (right panel): Two-column stats, inventory with action buttons, accessory management, skills, growth rates
  - **Equip weapon**: `[Equip]` button on non-equipped weapons (excludes Consumable/Scroll)
  - **Use consumables**: `[Use]` on Vulnerary/Elixir (if damaged) and Master Seal (if promotable). Full promotion logic including new weapon grants for gained proficiencies
  - **Accessory management**: `[Unequip]` equipped accessory, `[Equip]` from team pool, automatic swap handling
  - **Trade items**: `[ Trade ]` → pick target unit → side-by-side inventories → click items to transfer (respects INVENTORY_MAX=5)

### Changed
- **NodeMapScene.js**: Added `[ Roster ]` button (bottom-right). ESC handler prioritizes roster overlay. Auto-saves after roster close. Removed click-to-inspect hit zones from `drawRoster()` (replaced by roster menu). UnitInspectionPanel import replaced by RosterOverlay

---

### Added
- **Deployment: Supabase Auth + Cloud Saves + Netlify Hosting**
  - `src/cloud/supabaseClient.js` (new): Supabase singleton from `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` env vars. Auth wrappers: `signUp(username, password)`, `signIn()`, `signOut()`, `getSession()`. Username→email mapping via `{username}@emblem-rogue.local` (email confirmation disabled)
  - `src/cloud/CloudSync.js` (new): Fire-and-forget cloud sync — `fetchAllToLocalStorage(userId)` (called once on login, populates localStorage before Phaser boots), `pushRunSave()`, `pushMeta()`, `pushSettings()`, `deleteRunSave()`. All catch errors → `console.warn`, never throw
  - **Auth gate in `index.html`**: HTML login/register form overlay before game container. Dark theme matching `#1a1a2e`. Username (3-20 chars) + password (6+ chars) inputs, Login/Register toggle, "Play offline" skip link
  - **Supabase Postgres tables**: `run_saves`, `meta_progression`, `user_settings` — each with `user_id` UUID PK (references `auth.users`), `data` JSONB, `updated_at` timestamp. Row Level Security: users can only access their own rows
  - `.env.example` (new): Template for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  - `public/_redirects` (new): Netlify SPA fallback (`/* → /index.html 200`)
  - `@supabase/supabase-js` added to dependencies

### Changed
- **`main.js`**: Phaser no longer boots unconditionally. Auth flow: check session → fetch cloud saves → `bootGame(user)`. Exports `cloudState` (userId + displayName) for BootScene. Falls back to offline mode (no auth overlay) when Supabase env vars missing
- **`BootScene.js`**: Imports `cloudState` from main.js. After creating managers, wires `onSave` callbacks for cloud sync (`pushSettings`, `pushMeta`). Stores `cloudState` on Phaser registry as `'cloud'`
- **`SettingsManager.js`**: Added `onSave` callback property — called after every `_save()` with settings data
- **`MetaProgressionManager.js`**: Added `onSave` callback property — called after every `_save()` with `{totalRenown, purchasedUpgrades}`
- **`RunManager.js`**: `saveRun()` accepts optional 2nd param `onSave` callback (called with JSON data). `clearSavedRun()` accepts optional `onClear` callback. Both backward compatible (callbacks optional)
- **`TitleScene.js`**: Shows "Logged in as: {displayName}" when cloud connected. Added "Log Out" menu item (signs out, clears localStorage, reloads page). `clearSavedRun` passes cloud callback
- **`NodeMapScene.js`**: `saveRun` and `clearSavedRun` pass cloud callbacks (pushRunSave/deleteRunSave). Gets `cloud` from registry with null-check
- **`BattleScene.js`**: `clearSavedRun` in pause abandon passes cloud callback
- **`RunCompleteScene.js`**: `clearSavedRun` passes cloud callback
- **`index.html`**: Restructured with `#auth-overlay` (visible by default) and `#game-container` (hidden until auth). Canvas now parented to `#game-container`
- **`.gitignore`**: Added `.env.local`, `.netlify`

---

### Added
- **Music Expansion: Per-Act Themes** — 11→21 tracks with centralized config
  - `src/utils/musicConfig.js` (new): Centralized `MUSIC` config object, `getMusicKey(purpose, act)` resolver (handles strings, per-act objects, and random-pick arrays), `pickTrack()`, `ALL_MUSIC_KEYS` (flat array of all 21 unique keys, derived from MUSIC — used by BootScene preload)
  - **17 new OGG tracks** converted from WAV sources at 128kbps stereo:
    - Title: "Adventure Awaits" (124 BPM) — heroic, sets the tone
    - Home Base: "Twilight Gaze" (62 BPM, live piano) — calm, reflective
    - 3 exploration tracks (per-act): "Courage Within" (act1), "Overworld Crossing" (act2), "Valley of the Dead" (act3, live choir-orchestra)
    - 6 battle tracks (2 per act, random pick): "Field Battle"/"Tactical Strike" (act1), "Ambushed"/"Attack Unit Strike" (act2), "Powerful Foes"/"Mystic Melee" (act3)
    - 4 boss tracks (1 per act + final): "Knight Assault" (act1), "Kingdom Retaliation" (act2), "Apprentice of Darkness" (act3), "Ultimate Showdown" (final)
    - New shop: "Shopper's Delight" (replaces old)
    - New rest: "Pure Heart" (replaces old)
  - **Kept unchanged:** music_victory, music_defeat, music_run_win, music_loot

### Changed
- **BootScene.js**: Music loading uses `ALL_MUSIC_KEYS` from `musicConfig.js` instead of hardcoded 11-track array (now loads 21 tracks)
- **TitleScene.js**: Plays `MUSIC.title` (was `music_exploration` — shared with all overworld scenes)
- **HomeBaseScene.js**: Plays `MUSIC.homeBase` (was `music_exploration`)
- **NodeMapScene.js**: Plays `getMusicKey('nodeMap', act)` for per-act exploration music at 5 locations (create, rest-complete, shop-leave, shop-open uses `MUSIC.shop`, rest uses `MUSIC.rest`)
- **BattleScene.js**: Plays `getMusicKey('battle'/'boss', act)` for per-act battle/boss music. Stingers use `MUSIC.victory`, `MUSIC.loot`, `MUSIC.defeat`
- **RunCompleteScene.js**: Uses `MUSIC.runWin` / `MUSIC.defeat`
- Old music files (`music_exploration`, `music_battle_1/2`, `music_boss_1/2`) archived to `assets/audio/music/_archived/`

---

### Added
- **Phase 9: UI Polish, Accessories & Fog of War**
  - **Right-click Unit Inspection Panel** (`src/ui/UnitInspectionPanel.js`): Comprehensive unit info on right-click — header with name/level/class/faction, all 9 stats with color coding, weapon proficiencies, full inventory with weapon stats (Mt/Hit/Wt/Rng), equipped accessory, skills with full descriptions (from `skills.json`), growth rates (player/NPC only), terrain bonuses, move type. Positioned opposite side of screen from unit, depth 150
  - **Danger Zone Overlay** (`src/ui/DangerZoneOverlay.js`): Press D to toggle enemy threat range overlay. Shows all tiles any enemy could move+attack in orange (0xff8800, alpha 0.25, depth 4). Cached until stale (unit death or phase change). Auto-hides on unit selection
  - **Centralized UI styles** (`src/utils/uiStyles.js`): `STAT_COLORS` (HP=red, STR/MAG/SKL=gold, SPD=cyan, DEF/RES=green, LCK/MOV=white), `HP_BAR_COLORS`, `getHPBarColor(ratio)` (green >70%, yellow 40-70%, red <40%)
  - **Accessories system** (`data/accessories.json` + `public/data/`): 10 accessories with pure stat bonuses — Power Ring (+2 STR), Magic Ring (+2 MAG), Speed Ring (+2 SPD), Shield Ring (+2 DEF), Barrier Ring (+2 RES), Skill Ring (+3 SKL), Goddess Icon (+5 LCK), Seraph Robe (+5 HP), Boots (+1 MOV), Delphi Shield (+3 DEF +3 RES). Effects applied directly to `unit.stats` on equip, reversed on unequip — no Combat.js changes needed
  - **Accessory equip/unequip** in `UnitManager.js`: `equipAccessory(unit, accessory)` / `unequipAccessory(unit)` with `applyAccessoryStats()` helper. HP clamped on unequip. Returns old accessory for pool management
  - **Accessory action menu** in BattleScene: "Accessory" option shows current + team pool, allows equip/swap/unequip mid-battle
  - **Accessories in loot/shop**: `lootTables.json` updated with per-act accessory pools and weights. `LootSystem.js` `generateLootChoices()` 7th param + `generateShopInventory()` 5th param for accessory support. Loot accessories go to `runManager.accessories[]` team pool
  - **Fog of War** in `Grid.js`: Constructor 6th param `fogEnabled`, fog overlays at depth 3 (above tiles, below highlights/units). `updateFogOfWar(playerUnits)` computes vision union (Manhattan distance per move type), updates overlay alpha (0=visible, 0.3=previously seen, 0.7=unseen). `getVisionRange()` pure function, `isVisible()` query
  - **Fog vision ranges**: Infantry/Armored=3, Cavalry=4, Flying=5 tiles (`VISION_RANGES` in constants.js)
  - **Fog on 30% of battle nodes**: `NodeMapGenerator.js` assigns `node.fogEnabled = true` with `FOG_CHANCE=0.3` probability. Boss and recruit nodes excluded
  - **Fog BattleScene hooks**: Enemy/NPC visibility toggled per tile visibility. Fog updates after player movement + phase change. Attack targets filtered by visibility. Hover info hidden for fog-obscured tiles. "FOG OF WAR" indicator shown when active. Enemies have full map knowledge (player-side fog only, AI unchanged)
  - 22 new tests: `tests/Accessories.test.js` (10 tests: equip/unequip/roundtrip/swap/HP clamp/MOV/loot/shop/serialization), `tests/FogOfWar.test.js` (12 tests: vision constants/range/boundaries/range-0/enable-disable/multi-unit/move-type/node-assignment/boss-exclusion). Total: **216 tests**

### Changed
- **BattleScene.js**: Right-click → inspection panel (was: cancel/back). ESC handler reworked: hide inspection → hide pause → show pause (IDLE) → cancel. D key toggles danger zone. `handleCancel()` extracted from old right-click logic. HP bars use `getHPBarColor()` color gradient. Dynamic objective text (`updateObjectiveText()`) replaces static label — shows enemy count for rout, boss/throne status for seize, recruit hint if NPC present. Instruction text updated to `Right-click: inspect | ESC: cancel/back | [D] Danger`
- **NodeMapScene.js**: Propagates `node.fogEnabled` into `battleParams` before starting BattleScene. Passes `gameData.accessories` to shop/loot generation. Handles accessory buy (goes to `runManager.accessories[]` pool)
- **LevelUpPopup.js**: Stat lines use `STAT_COLORS` for non-gained stats (gained stays green)
- **RunManager.js**: Added `this.accessories = []` team pool, serialized in `toJSON()`/`fromJSON()`
- **DataLoader.js**: Loads `accessories.json` (13 total files)

### Removed
- **StatPanel.js**: Deleted, fully replaced by `UnitInspectionPanel.js`

---

### Added
- **Lord Bonuses meta upgrade category**: 3 new upgrades (Lord Vitality, Lord Combat Training, Lord Resilience) providing growth-first (+10%) and optional flat bonuses (+1-2 stat) for lord characters
  - `lordGrowth`/`lordStat` effect keys in `metaUpgrades.json`, handled by `MetaProgressionManager.getActiveEffects()`
  - `RunManager._applyLordMetaBonuses()` applies `lordStatBonuses` + `lordGrowthBonuses` to Edric and Sera at run start
  - HomeBaseScene displays "Lord Bonuses" as second category after Recruit Bonuses

### Changed
- **Recruit stat upgrades rebalanced** — growth-first, flat-second design:
  - L1 (cheap): +10% growth rate bonus applied before auto-leveling. Costs 75-100R
  - L2 (expensive): +10% growth + flat stat bonus (+1 or +2 HP). Costs 250-350R
  - Old design gave flat bonuses only (+1/+2 per level), which was too strong for cheap early purchases
  - `recruit_hp` reduced from 3 levels to 2
  - New effect keys: `recruitGrowth`/`growthValue` for growth bonuses, `stat`/`value` for flat bonuses
- **`MetaProgressionManager.getActiveEffects()`** returns 3 new fields: `growthBonuses`, `lordStatBonuses`, `lordGrowthBonuses`
- **`UnitManager.createRecruitUnit()`** accepts 5th param `growthBonuses` — applied to unit growths before auto-leveling so growth boosts affect level-up rolls
- **`metaUpgrades.json`**: 15 upgrades in 4 categories (was 12 in 3). New category: `lord_bonuses`
- 5 new tests (recruit growth/flat bonuses, lord growth/flat bonuses, defaults). Total: **194 tests**

### Fixed
- **Consumable equip bug**: Vulnerary, Elixir, and Master Seal could be "equipped" as weapons via the Equip menu, breaking combat. `showEquipMenu()` now filters out `type: 'Consumable'` items

### Changed
- **Per-node enemy level scaling**: Act 1 enemies now scale by node map row instead of using the full pool range `[1,3]` for every battle
  - Row 0 (first fight): `[1,1]` — guaranteed level 1 enemies only
  - Row 1: `[1,2]` — mild ramp as players gain XP
  - Row 2+ (mid-act): `[2,3]` — full difficulty before boss
  - Boss node unchanged (uses fixed level from `bosses` data)
  - Other acts (act2, act3, finalBoss) unaffected — use pool default
  - `ACT_LEVEL_SCALING` constant in `NodeMapGenerator.js`, `levelRange` override in `MapGenerator.generateEnemies()`
  - `sim/fullrun.js` updated to use per-node `levelRange` from `battleParams`
- **Knight removed from Act 1 enemy pool**: `enemies.json` act1.base no longer includes Knight (10 DEF makes it nearly immune to L1 physical damage). Knight still appears as act1 boss (Iron Captain L3) — intended as a "use magic" skill check
- 7 new tests (per-node levelRange by row, levelRange override in MapGenerator). Total: **189 tests**

### Added
- **Balance Simulation Framework** — 4 Monte Carlo simulation scripts exercising pure engine code for systematic balance analysis
  - `sim/lib/SeededRNG.js`: Mulberry32 PRNG with `Math.random` override for reproducible runs
  - `sim/lib/SimUnitFactory.js`: Unit creation wrappers (lords, enemies, bosses, recruits) with game data pre-loaded from `data/`. Handles promoted enemy creation (base L10 → promote → level remaining)
  - `sim/lib/ExpectedValue.js`: Deterministic growth rate math — parses `growthRanges` midpoints, combines lord personal + class growths, projects expected stats at any level
  - `sim/lib/TableFormatter.js`: Console tables, CSV output, CLI arg parsing (`--trials`, `--seed`, `--csv`, etc.), percentile/mean/std helpers, automated balance recommendation printer
  - `sim/progression.js`: Progression curve calculator — expected stats at level checkpoints, XP accumulation model, Monte Carlo growth simulation (N=1000), player vs enemy power comparison
  - `sim/matchups.js`: Combat matchup simulator — full 10×10 class matrix, focus mode (`--focus CLASS`), scenario tests (Wrath+crit stacking, Brave+Astra, Knight viability curve, Myrmidon doubling)
  - `sim/economy.js`: Economy flow simulator — 3 spending strategies (save-for-seal, buy-weapons, balanced), meta-progression comparison (`--meta 0-3`), gold percentiles at act checkpoints
  - `sim/fullrun.js`: Full run Monte Carlo — abstract battle resolution (no grid), full act progression, XP/gold/recruit tracking, meta-level sweep, verbose single-run mode
  - npm scripts: `sim:progression`, `sim:matchups`, `sim:economy`, `sim:fullrun`
  - All scripts accept `--seed S` for reproducibility (Mulberry32), `--trials N`, `--csv` for data export
  - Automated balance recommendations with threshold-based flagging (imbalanced matchups, economy issues, lord fragility, meta trivializing)

### Fixed
- **HomeBaseScene**: Back to Title button no longer overlaps Capacity section — reduced row spacing and dynamic button positioning
- **BattleScene movement**: Action menu (Attack/Equip/Wait) now appears after moving a unit — replaced `this.tweens.chain()` with recursive `this.tweens.add()` for Phaser 3.90 compatibility. Fixed both player and enemy movement animations.
- **getCombatWeapons crash**: `getCombatWeapons()` now excludes `Consumable` items (Vulnerary/Elixir/Master Seal). Previously these passed through and crashed `parseRange()` since consumables have no `range` property — this was the root cause of the post-movement freeze.

### Added
- **Phase 8: Renown & Meta-Progression** — persistent between-run upgrade system
  - `data/metaUpgrades.json` (+ `public/data/`): 15 tiered upgrades in 4 categories — Recruit Stats (HP/STR/DEF/SPD/SKL/RES), Lord Bonuses (HP/STR/DEF), Economy (starting gold, battle gold, extra Vulnerary, loot quality), Capacity (deploy slots, roster cap)
  - `src/engine/MetaProgressionManager.js`: Pure class (no Phaser deps), localStorage persistence (`emblem_rogue_meta_save`). Tracks `totalRenown` and `purchasedUpgrades`. Methods: `addRenown()`, `purchaseUpgrade()`, `getActiveEffects()` (flat object of all active bonuses), `canAfford()`, `isMaxed()`, `reset()`. Named export `calculateRenown(actIndex, completedBattles, isVictory)` — acts×50 + battles×15 + victory bonus 200
  - `src/scenes/HomeBaseScene.js`: Upgrade shop UI — upgrades listed by category, color-coded (green=affordable, yellow=maxed, gray=too expensive), buy buttons deduct renown, plays `sfx_confirm` on purchase
  - **Renown earning**: RunCompleteScene calculates and awards renown on every run end (win or lose). Displays "Renown Earned: +X" and "Total Renown: Y"
  - **Meta effects wired throughout**: RunManager applies goldBonus/extraVulnerary/battleGoldMultiplier. BattleScene applies deployBonus/rosterCapBonus/lootWeaponWeightBonus/statBonuses. All effects serialized in run save
  - 24 new tests: `tests/MetaProgressionManager.test.js` (19 manager + 5 calculateRenown). Total: **182 tests**

### Changed
- **BootScene.js**: Creates `MetaProgressionManager` from `data.metaUpgrades` and stores on registry as `'meta'`
- **DataLoader.js**: `loadAll()` now fetches `metaUpgrades.json` (12 total files)
- **main.js**: Registers `HomeBaseScene` in Phaser scene array (Boot → Title → HomeBase | NodeMap → Battle → RunComplete)
- **TitleScene.js**: Added "Home Base" menu item between Continue and Settings
- **RunCompleteScene.js**: Calculates renown via `calculateRenown()`, adds to meta manager, displays renown stats on end screen
- **RunManager.js**: Constructor accepts optional `metaEffects` param. Starting gold includes `goldBonus`. `createInitialRoster()` gives Edric extra Vulnerary if `extraVulnerary` active. `completeBattle()` applies `battleGoldMultiplier`. `toJSON()`/`fromJSON()` serialize `metaEffects`
- **NodeMapScene.js**: Passes `meta.getActiveEffects()` when creating new RunManager
- **BattleScene.js**: Deploy limits boosted by `deployBonus`. ROSTER_CAP for Talk action boosted by `rosterCapBonus`. Loot generation passes `lootWeaponWeightBonus`. Recruit unit creation passes `statBonuses`
- **LootSystem.js**: `generateLootChoices()` accepts optional 6th param `lootWeaponWeightBonus` — adds to weapon category weight before random selection
- **UnitManager.js**: `createRecruitUnit()` accepts optional 4th param `statBonuses` — applied to stats after auto-leveling, syncs `currentHP` if HP boosted
- **constants.js**: Added `RENOWN_PER_ACT=50`, `RENOWN_PER_BATTLE=15`, `RENOWN_VICTORY_BONUS=200`
- **Scene flow**: Boot → Title → HomeBase | NodeMap ↔ Battle → RunComplete → Title

### Fixed
- **Early game balance**: Act 1 was nearly impossible for a level 1 starting party
  - Enemy level ranges tightened: act1 [1,5]→[1,3], act2 [4,10]→[3,8]. Eliminates level 5 enemies (who gained random combat skills) from act 1 and caps act 2 below promotion territory
  - `BOSS_STAT_BONUS` reduced 3→2. Act 1 Knight bosses no longer immune to physical damage (Edric chips for 1 with Steel Sword; Sera primary damage dealer at ~6/hit via magic)
  - Starting Vulneraries: Edric and Sera each begin with a Vulnerary (heal 10 HP, 3 uses) for early sustain without consuming Sera's combat action

### Added
- **Game Shell: Title Screen, Settings, Pause Menu, Run Save** — full game scaffolding around the core loop
  - `src/scenes/TitleScene.js`: SNES-style title screen with New Game / Continue / Settings menu. Plays exploration music. Continue only shown when `hasSavedRun()` returns true. Inline SettingsOverlay for volume control
  - `src/utils/SettingsManager.js`: Pure class (no Phaser deps) wrapping localStorage for user settings. Key `emblem_rogue_settings`. Defaults: musicVolume 0.5, sfxVolume 0.7. `get()`/`set()` with auto-persist, volume convenience accessors with 0-1 clamping. All localStorage in try/catch
  - `src/ui/SettingsOverlay.js`: Reusable volume control panel (depth 900). Two rows with `< 50% >` arrow controls (±10% per click). Reads/writes SettingsManager, applies live to AudioManager. SFX row plays `sfx_confirm` on adjustment for instant feedback
  - `src/ui/PauseOverlay.js`: In-game pause menu (depth 800) with Resume / Settings / Abandon Run. Settings opens SettingsOverlay on top (depth 900). Abandon Run shows confirmation sub-dialog (depth 850, "Abandon this run? Progress will be lost." → Yes/Cancel). Abandon callback only provided when `runManager` exists (standalone mode gets no abandon option)
  - **RunManager save/load**: `toJSON()` serializes full run state (version, status, actIndex, roster, nodeMap, currentNodeId, completedBattles, gold). `RunManager.fromJSON(saved, gameData)` restores from saved data. 4 exported functions: `saveRun()`, `loadRun()`, `hasSavedRun()`, `clearSavedRun()`. Key: `emblem_rogue_run_save`. All localStorage in try/catch
  - **Auto-save**: NodeMapScene calls `saveRun()` on every `create()` (every node map entry). RunCompleteScene calls `clearSavedRun()` on create (run over = no stale save)
  - 16 new tests: `tests/SettingsManager.test.js` (7 tests: defaults, load, save, clamp, error handling), `tests/RunManager.test.js` (+9 tests: toJSON/fromJSON round-trip, version field, gameData ref, saveRun/loadRun/hasSavedRun/clearSavedRun). Total: **158 tests**

### Changed
- **BootScene.js**: Creates `SettingsManager` on registry (`settings`), applies saved volumes to AudioManager on startup, routes to `TitleScene` instead of `NodeMapScene`
- **main.js**: Registers `TitleScene` in Phaser scene array (Boot → Title → NodeMap → Battle → RunComplete)
- **NodeMapScene.js**: Auto-saves run on `create()`. Gear icon (⚙) in top-left opens SettingsOverlay. ESC key handler: ignores if shop open, hides pause if visible, otherwise opens PauseOverlay with Resume/Settings/Abandon Run. Abandon Run clears save, fails run, stops music, goes to Title
- **BattleScene.js**: ESC handler rewritten — if pause visible → hide pause; if `PLAYER_IDLE` → `showPauseMenu()`; otherwise → existing `onRightClick()` cancel behavior. New `PAUSED` state added to input guard (blocks clicks). `showPauseMenu()` saves/restores `prePauseState`. Abandon Run only available when `runManager` exists
- **RunCompleteScene.js**: Calls `clearSavedRun()` in `create()`. Play Again button routes to `TitleScene` instead of `NodeMapScene`
- **Scene flow**: Boot → Title → NodeMap ↔ Battle → RunComplete → Title (was: Boot → NodeMap → ...)

### Added
- **Phase 7C: Deploy Selection + Permadeath Fix** — pre-battle unit picker when roster exceeds deploy limit
  - **Deploy selection screen**: When roster size exceeds act's `DEPLOY_LIMITS.max`, shows unit picker overlay before battle. Edric auto-selected and locked. Confirm button enforces min/max range. Units listed with name, level, class, HP
  - **DEPLOY_LIMITS**: Per-act min/max deploy counts — act1(3-4), act2(4-5), act3(5-6), postAct(4-6), finalBoss(4-6). Used by both deploy screen and MapGenerator spawn generation
  - **Dynamic spawn count**: `MapGenerator.generateBattle()` accepts `deployCount` param. Fallback chain: explicit deployCount → `DEPLOY_LIMITS[act].max` → 4
  - **Non-deployed unit preservation**: Units not selected for battle stored in `nonDeployedUnits[]`, merged back into roster on victory alongside surviving deployed units
  - 6 new tests: deployCount param, DEPLOY_LIMITS validation, ACT_SEQUENCE coverage. Total: **142 tests**

### Changed
- **BattleScene.js**: `create()` restructured into deploy check → `beginBattle(deployedRoster)`. New `showDeployScreen()` method. `DEPLOY_SELECTION` state blocks grid input. `onVictory()` merges surviving + non-deployed units before `completeBattle()`
- **MapGenerator.js**: Imports `DEPLOY_LIMITS`, destructures `deployCount` from params, dynamic `spawnCount` replaces hardcoded 4
- **constants.js**: `DEPLOY_LIMITS` completed — added `finalBoss` entry, added `min` to `postAct`

### Fixed
- **Permadeath scope**: Only Edric's death ends the run (was: any lord death). Sera, Kira, Voss can now fall in battle without triggering defeat. `checkBattleEnd()` checks `u.name === 'Edric'` instead of `u.isLord`. `isLord` flag still used for Talk and Seize actions

### Added
- **Node map icons v2** — 7 hand-picked icons processed from Winlu packs + game sprites (48x48, transparent bg)
  - `node_battle`: Plains tile + red fighter composite
  - `node_recruit`: Plains tile + green-tinted mercenary composite
  - `node_boss`: Castle (acts 1-3)
  - `node_boss_final`: Crystal castle (final boss act)
  - `node_rest`: Church (dark bg removed)
  - `node_shop`: Village houses
  - `node_elite`: Dark fortress (processed, not yet wired up — deferred for elite nodes)
  - `tools/process_node_icons_v2.js`: Processing script with dark bg removal (per-icon threshold), compositing, trim + resize
- **Act-specific boss icon**: Final boss act shows crystal castle icon instead of standard castle

### Changed
- **BootScene.js**: Node icon loader expanded from 4 to 6 icons (`boss_final`, `recruit` added)
- **NodeMapScene.js**: Boss nodes use `node_boss_final` sprite when `actId === 'finalBoss'`

### Added
- **Music & SFX Integration** — full audio system with 29 OGG files
  - `src/utils/AudioManager.js`: Lightweight Phaser sound wrapper — `playMusic()` (looping with fade-in/out, auto-stops previous), `stopMusic()`, `playSFX()` (one-shot), volume controls. Stored on Phaser registry (`this.registry.get('audio')`)
  - **11 music tracks** (OGG 128kbps stereo) in `assets/audio/music/`: exploration (node map), shop, rest, battle×2, boss×2, victory, defeat, run_win, loot. Source: `References/Music Fx Packs/`
  - **18 SFX** (OGG 96kbps mono) in `assets/audio/sfx/`: weapon-type (sword/lance/axe/bow), magic (fire/thunder/ice/light/dark), heal, combat (hit/crit/death), UI (cursor/confirm/cancel), levelup, gold
  - **Scene music flow**: NodeMap plays exploration → crossfades to shop/rest themes → restores on exit. Battle starts random battle/boss track → victory stinger on win → loot music → stops on transition. RunComplete plays run_win or defeat theme
  - **Combat SFX**: Weapon-type sound on strike (mapped by weapon.type + tome name), hit/crit impact on damage, heal chime, death sound on unit removal, level-up jingle
  - **UI SFX**: Confirm on action menu clicks and loot selection, cancel on right-click/ESC, gold on buy/sell/loot
  - `isBoss` flag passed from NodeMapScene to BattleScene for boss music selection

### Changed
- **main.js**: Added `audio: { disableWebAudio: false }` to Phaser config
- **BootScene.js**: Loads 29 audio assets (11 music + 18 SFX) in `preload()`. Creates AudioManager instance on registry in `create()`
- **NodeMapScene.js**: Exploration music on `create()`. Shop music on shop open, restore on leave. Rest music + heal SFX on rest. Gold SFX on buy/sell. Stops music before battle transition. Passes `isBoss` flag in battle scene data
- **BattleScene.js**: Random battle/boss music on `create()` based on `isBoss`. `getWeaponSFX()` helper maps weapon types to SFX keys (including tome sub-types). Weapon SFX + hit/crit in `animateStrike()`. Heal SFX in `animateHeal()`. Death SFX in `removeUnit()`. Level-up SFX in `awardXP()`. Victory/loot/defeat music transitions. Confirm/cancel SFX on UI actions. Gold SFX on loot/skip selection. Stops music in `transitionAfterBattle()`
- **RunCompleteScene.js**: Plays run_win or defeat music on `create()`. Stops music on "Play Again"

### Added
- **Phase 7B: Mid-Battle Recruitment System** — FE-style NPC recruitment during battles
  - `data/recruits.json`: Recruit pools by act — 6 named NPCs per act (act1 levels 1-3, act2 levels 5-8, act3 levels 10-14)
  - **RECRUIT nodes**: `NODE_TYPES.RECRUIT` guaranteed 1-2 per act on node map, teal `!` icon, routes to battle with NPC ally
  - **NPC spawning**: `MapGenerator.generateNPCSpawn()` places NPC in middle third of map, Manhattan distance >= 3 from all spawns. Returns `npcSpawn` in battleConfig
  - **`createRecruitUnit()`** in `UnitManager.js`: Creates `faction:'npc'` unit with level-scaled weapon tier (Iron/Steel/Silver)
  - **Talk action**: Lord adjacent to NPC → "Talk" in action menu → NPC converts to player faction with sprite/HP bar refresh
  - **Enemy NPC targeting**: AI attacks NPCs if in range (won't chase, but hits if adjacent) — creates tension to recruit quickly
  - **ROSTER_CAP=12**: Talk only available if roster below cap
  - 12 new tests: NodeMapGenerator (5), MapGenerator (4), UnitManager (3). Total: **136 tests**

### Changed
- **NodeMapGenerator.js**: Post-processes node map to guarantee 1-2 RECRUIT nodes per act. Converts BATTLE nodes (prefers BATTLE, falls back to SHOP) in middle rows. `buildBattleParams()` returns `{ act, objective: 'rout', isRecruitBattle: true }` for RECRUIT type
- **MapGenerator.js**: `generateBattle()` accepts `isRecruitBattle` param and `recruits` in deps. NPC spawn included in reachability targets. Returns `npcSpawn` (single object or null) in battleConfig
- **AIController.js**: `processEnemyPhase()` now takes 4 params `(enemyUnits, playerUnits, npcUnits, callbacks)`. NPCs included in attack targets and position map
- **TurnManager.js**: `init()` now takes 4 params `(playerUnits, enemyUnits, npcUnits, objective)`
- **BattleScene.js**: Tracks `npcUnits[]`, spawns NPC from battleConfig, Talk action + `executeTalk()` for faction conversion, `removeUnit` handles NPC faction, `buildSkillCtx` handles 3 factions (player/enemy/npc), green HP bars for NPCs
- **NodeMapScene.js**: RECRUIT node display — teal color (`0x44ccaa`), `!` icon, tooltip "Recruit — Battle with potential ally"
- **constants.js**: Added `NODE_TYPES.RECRUIT = 'recruit'`, `ROSTER_CAP = 12`
- **DataLoader.js**: `loadAll()` now fetches `recruits.json` (11 total files)

### Fixed
- **Loot screen crash on finalBoss**: `generateLootChoices` could return fewer than `LOOT_CHOICES` when item pools are empty (e.g. finalBoss with gold-only weights). Now fills remaining slots with gold rolls as fallback
- **Standalone mode soft-lock**: `onVictory()` and `onDefeat()` did nothing without a `runManager`, leaving the game stuck on "VICTORY!"/"DEFEAT" text. Now restarts the battle scene after 2s delay in standalone mode
- **Brittle lord selection by array index**: `lords[0]`/`lords[3]` in `RunManager.createInitialRoster()` and `BattleScene` standalone fallback silently broke if `lords.json` order changed. Now uses `lords.find(l => l.name === 'Edric')` / `lords.find(l => l.name === 'Sera')`
- **Shallow roster copy leaked shared refs**: `getRoster()` used spread (`{ ...u }`), so callers could mutate nested objects (inventory, skills, stats) and corrupt roster state. Now uses `JSON.parse(JSON.stringify(...))` for true deep copy

### Added
- **Phase 7A: Gold, Shops & Loot** — core roguelike reward loop: earn gold, choose loot, buy/sell at shops
  - `src/engine/LootSystem.js`: Pure functions — `calculateKillGold`, `calculateBattleGold`, `calculateSkipLootBonus`, `getSellPrice`, `generateLootChoices`, `generateShopInventory`. No Phaser deps
  - `data/consumables.json`: 3 consumable items — Vulnerary (heal 10, 3 uses, 300g), Elixir (heal full, 1 use, 1500g), Master Seal (promote, 1 use, 2500g)
  - `data/lootTables.json`: Per-act loot pools (act1–finalBoss) with weighted categories (weapon/consumable/rare/gold) and gold ranges
  - **Gold economy**: Starting gold 200, per-kill gold `30 + (level × 10)`, battle completion bonus 100, boss kill bonus 300, skip loot bonus +50% of battle gold
  - **Weapon prices**: `price` field added to all 32 weapons in `weapons.json` — Iron=500, Steel=1000, Silver=2000, Legend=0, Scrolls=2500, range 1-2 weapons +200, special effect +300, Staves 300/600/1200/0
  - **Post-battle loot screen**: Pick 1 of 3 random items (Slay the Spire style) or skip for bonus gold. Unit picker to assign item to roster unit. Card UI with type icons, stats, and prices
  - **Shop nodes**: `NODE_TYPES.SHOP` (25% of middle row nodes, row 1 excluded). Gold `$` icon on node map. Full shop overlay in NodeMapScene — buy items, sell inventory at 50% price, unit picker for purchases
  - **Item action in battle**: "Item" option in action menu when unit has consumables. Vulnerary/Elixir heal and consume turn. Master Seal triggers promotion. Uses tracked per item, removed when depleted
  - **Gold display**: Persistent gold counter in NodeMapScene header and loot screen summary
  - `tests/LootSystem.test.js`: 23 tests covering gold calc, loot generation, shop inventory, sell prices
  - Total: 124 tests (was 101)

### Changed
- **RunManager.js**: Added `gold` field (starts at `STARTING_GOLD=200`), `addGold()`/`spendGold()` methods. `completeBattle()` now accepts `goldEarned` param and adds battle completion gold via `calculateBattleGold()`
- **NodeMapGenerator.js**: Middle row node distribution updated — battle 55%, rest 20%, shop 25% (was battle 70%, rest 30%). Shop nodes get `null` battleParams like rest nodes
- **NodeMapScene.js**: Shop node rendering (gold color, $ icon), shop buy/sell overlay, gold display in header
- **BattleScene.js**: Tracks `goldEarned` from enemy kills. `onVictory()` now shows loot selection screen before transitioning. New methods: `showLootScreen()`, `showLootUnitPicker()`, `transitionAfterBattle()`, `showItemMenu()`, `useConsumable()`. Action menu includes "Item" for consumable use
- **DataLoader.js**: `loadAll()` now fetches `consumables.json` + `lootTables.json` (10 total files)
- **constants.js**: Added gold economy constants (STARTING_GOLD, GOLD_PER_KILL_BASE, etc.), SHOP_ITEM_COUNT, INVENTORY_MAX. NODE_TYPES now includes SHOP
- **NodeMapGenerator.test.js**: Updated to cover shop node type — "row 1 has only battle nodes", "rest and shop nodes have null battleParams"

### Changed
- **BootScene asset loading**: Preloads all 105 game assets — 32 character sprites, 25 enemy sprites (keyed as `enemy_{class}`), 25 portraits (keyed as `portrait_{name}`), 10 UI icons (keyed as `icon_{type}`), 3 node map icons (keyed as `node_{type}`), 10 terrain tiles. Previously only loaded `edric` + terrain
- **Sprite key resolution**: `BattleScene.addUnitGraphic()` now resolves sprites via `className` (snake_cased) instead of `unit.name`. Enemies get `enemy_` prefix for red-palette sprites. Lords try personal name first (Edric's unique sprite), fall back to class sprite. Multi-word classes ("Pegasus Knight" → `pegasus_knight`) now resolve correctly
- **Promotion sprite refresh**: Unit graphic updates to promoted class sprite after promotion (e.g. Myrmidon→Swordmaster swaps the sprite)
- **NodeMapScene icons**: Node map uses sprite icons (tents/village/cathedral) from Winlu tileset instead of unicode characters. Falls back to colored rectangles + unicode if textures missing

### Added
- **Enemy sprites**: Assassin + Swordmaster enemy sprites (25 total, up from 23). No enemy Dancer needed
- **Node map icons**: 3 icons cut from Winlu `Fantasy_World_Buildings.png` (48x48, transparent bg): `node_battle` (tents), `node_rest` (village houses), `node_boss` (cathedral spires). In `assets/sprites/nodes/` + `public/`
- **`tools/cut_node_icons.js`**: Extraction tool for cutting icons from Winlu tilesets
- **Phase 6: Node Map & Run Structure** — transforms single-battle game into multi-battle roguelike run
  - `src/engine/NodeMapGenerator.js`: Pure function `generateNodeMap(actId, actConfig)` → branching node graph per act. Row 0 = opening battle, last row = boss (seize), middle rows = 2-3 nodes of battle (70%) or rest (30%). Edges connect adjacent rows only, guarantees all nodes reachable and boss reachable from every path
  - `src/engine/RunManager.js`: Pure class holding run state — roster, node map, act progression, battle count. `startRun()` creates Edric + Sera, generates act1 map. `completeBattle()` serializes surviving units back to roster. `rest()` heals all to full HP. `advanceAct()` generates next act's node map. `serializeUnit()` strips Phaser fields (graphic/label/hpBar), resets hasMoved/hasActed
  - `src/scenes/NodeMapScene.js`: Visual branching map rendered bottom-to-top (start at bottom, boss at top). Colored nodes with icons (battle/rest/boss). Completed nodes dimmed, available nodes pulse. Click battle → BattleScene, click rest → heal all + refresh. Roster bar at bottom shows unit name/level/HP
  - `src/scenes/RunCompleteScene.js`: Victory ("RUN COMPLETE!") or defeat ("GAME OVER") screen with battles won, act reached, and "Play Again" button that starts a fresh run
  - `ACT_SEQUENCE`, `ACT_CONFIG`, `NODE_TYPES` constants in `constants.js`
  - Act progression: act1 (5 rows) → act2 (6 rows) → act3 (5 rows) → finalBoss (1 row, single boss node)
  - Unit persistence: HP, XP, levels, inventory, skills, proficiencies all carry between battles
  - Scene flow: BootScene → NodeMapScene → BattleScene → NodeMapScene → ... → RunCompleteScene
  - 39 new tests: `NodeMapGenerator.test.js` (16 tests), `RunManager.test.js` (23 tests). Total: 101 tests

### Changed
- **BootScene.js**: Now starts `NodeMapScene` instead of `BattleScene`
- **main.js**: Registers `NodeMapScene` and `RunCompleteScene` in Phaser scene array
- **BattleScene.js**: `init()` accepts `{ gameData, runManager, battleParams, roster, nodeId }`. Creates player units from roster when available (standalone lord creation as fallback). `onVictory()` serializes surviving units, transitions to NodeMap or RunComplete. `onDefeat()` signals run failure, transitions to RunComplete. Removed `restartBattle()` method and R/S keyboard shortcuts
- **constants.js**: Added `ACT_SEQUENCE`, `ACT_CONFIG`, `NODE_TYPES`

---

### Added
- **Phase 5: Procedural Map Generation** — replaces hardcoded 10x8 test map with randomized maps from zone-based templates
  - `src/engine/MapGenerator.js`: Pure function `generateBattle(params, deps)` → `battleConfig` with mapLayout, spawns, objective. No Phaser dependency
  - `data/mapTemplates.json`: 6 templates — 4 Rout (Open Field, River Crossing, Forest Ambush, Chokepoint) + 2 Seize (Castle Assault, Hilltop Fortress). Zone-based: each zone has weighted terrain probabilities, priority layering, and role tags (playerSpawn/enemySpawn)
  - `data/enemies.json`: Enemy pools per act (act1–finalBoss) with class lists, level ranges, boss definitions, and enemy count scaling by map tile count
  - **Seize objective**: Throne tile placed via template features. Boss spawns on throne. Kill boss → move Lord to throne → "Seize" action in menu → victory
  - **Rout objective**: Kill all enemies → victory (now explicitly objective-aware instead of implicit)
  - **Reachability guarantee**: BFS from player spawn; carves paths through impassable terrain (Water→Bridge, Wall→Plain) if any enemy or throne is unreachable
  - **Bridge enforcement**: River Crossing template guarantees `minBridges=2` with vertically-spaced placement
  - **Boss enemies**: `isBoss` flag, custom name from bosses data, +3 flat stat bonus (`BOSS_STAT_BONUS`)
  - **Objective display**: Top-right corner shows "Rout: Defeat all enemies" or "Seize: Capture the throne"
  - **Keyboard shortcuts**: R = restart with new Rout map, S = restart with new Seize map
  - **TERRAIN enum** and **BOSS_STAT_BONUS** constants in `constants.js`
- **Test suite** (vitest, 62 tests across 3 files)
  - `tests/MapGenerator.test.js` (24 tests): config validity, dimensions per act, terrain bounds, throne placement, spawn passability, no overlapping spawns, reachability (10 random iterations), enemy composition by act pool, all act/objective combos
  - `tests/Combat.test.js` (19 tests): grid distance, range parsing, weapon types, weapon triangle, damage formula, terrain defense, doubling, counter-attacks, effectiveness, forecast, combat resolution
  - `tests/UnitManager.test.js` (19 tests): proficiency parsing, growth rates, lord/enemy creation, promoted enemy pattern, level-up, XP, promotion, skill learning/caps, combat weapon filtering
  - `tests/testData.js`: Shared data loader reading from `data/` directory
  - `npm test` / `npm run test:watch` commands added to `package.json`

### Changed
- **DataLoader.js**: `loadAll()` now fetches `mapSizes.json`, `mapTemplates.json`, `enemies.json` (8 total files)
- **TurnManager.js**: `init()` accepts 3rd param `objective` ('rout'|'seize'). `_checkBattleEnd()` only triggers victory on rout when all enemies dead; seize victory handled by BattleScene action menu
- **BattleScene.js**: Replaced hardcoded MAP_LAYOUT/ENEMY_SPAWNS with `generateBattle()`. Dynamic grid dimensions, spawn positions, enemy composition. Promoted enemies created via base class + `promoteUnit()` (promoted classes lack baseStats/growthRanges). Boss stat bonus applied post-creation. Seize action added to action menu (Lord on throne + boss dead). `checkBattleEnd()` is objective-aware. `restartBattle()` accepts optional objective override
- **constants.js**: Added `TERRAIN` index enum, `BOSS_STAT_BONUS = 3`
- **package.json**: Added vitest devDependency, `test` and `test:watch` scripts

---

- **Imagen portrait pipeline**: Manifest-driven batch generation of character portraits and UI icons via Google Imagen API
  - `References/imagen-manifest.json`: Declares all assets with per-category style prefixes, target sizes, and bg removal settings
  - `tools/imagen-generate.js`: Reads manifest, generates 4 variants per asset with rate limiting, writes to `References/imagen-output/raw/`
  - `tools/imagen-process.js`: Reads `selections.json`, processes chosen variants (cover crop for portraits, white-bg removal for icons)
  - `tools/imagen-test.js`: Single-asset test generation for prompt iteration
  - `References/imagen-output/compare.html`: Side-by-side variant comparison UI with click-to-select, saves `selections.json`
- **25 character portraits** (128x128, cover crop) in `assets/portraits/` + `public/assets/portraits/`: 4 lords (Edric, Kira, Voss, Sera) + 21 generic class portraits (all 11 base + 10 promoted classes). Hidari/FE Echoes-inspired style with naturalistic lighting and asymmetric composition
- **10 UI weapon/item icons** (64x64, transparent bg) in `assets/sprites/ui/` + `public/assets/sprites/ui/`: Sword, Axe, Lance, Bow, Tome, Staff, Potion, Gold, Scroll, Light
- **Winlu asset pack catalog**: `References/Downloaded Packs/CATALOG.md` — maps RPG Maker MV/MZ tilesets to node map icons (battle/rest/boss/shop), interior scene backgrounds, and per-act biome theming

### Fixed
- **Combat range validation**: Units could attack with wrong weapon when target was in range of an inventory weapon but not the equipped weapon. New `ensureValidWeaponForRange()` auto-swaps to a valid weapon before forecast/combat (FE-style behavior)
- **Lord permadeath**: `checkBattleEnd()` now triggers defeat when Lord dies, even if other units survive — matches documented permadeath rule
- **Pathfinding occupancy**: `findPath()` A* now accepts `unitPositions`/`moverFaction` and routes around enemy-occupied tiles. Path preview and movement animation no longer clip through enemies. AI pathfinding updated to match
- **Non-Lord promotion weapons**: Promoted non-Lord units now receive Iron weapons for newly gained proficiency types (previously only Lords got promotion weapons)

### Changed
- **CLAUDE.md**: Removed 6 non-existent future files from project structure tree (MapGenerator.js, HUD.js, MenuSystem.js, NodeMapScene.js, HomeBaseScene.js, ShopScene.js). Added LevelUpPopup.js. Fixed ROADMAP.md path to repo root
- **Grid.js**: `findPath()` signature extended with optional `unitPositions` and `moverFaction` params (backward compatible)
- **AIController.js**: `_buildPath()` now passes unit positions to `findPath()` for occupancy-aware routing
- **BattleScene.js**: Stores `unitPositions` map during unit selection for reuse by path preview and movement

### Added
- **Weapon effectiveness multipliers**: `getEffectivenessMultiplier()` in `Combat.js` — Hammer deals 3x might vs Armored, Excalibur 3x vs Flying. Parses `"Effective vs Type (Nx)"` from weapon `special` field. Multiplier applied in `calculateAttack()` → flows through forecast and resolution automatically.
- **"EFFECTIVE!" in forecast**: Combat forecast panel shows `** EFFECTIVE! **` under weapon name when effectiveness applies (for both attacker and defender)
- **Skill acquisition via level-up**: Classes define `learnableSkills` in `classes.json` — units automatically learn skills when reaching the required level. 9 classes have learnable skills (Myrmidon→Vantage@8, Fighter→Wrath@8, Thief→Luna@8, Cavalier→Sol@10, Mercenary→Astra@10, Pegasus Knight→Sol@10, Hero→Sol@5, Warrior→Wrath@5, Sage→Luna@5)
- **`learnSkill()` and `checkLevelUpSkills()`** in `UnitManager.js`: Skill learning with `MAX_SKILLS=5` cap enforcement. Returns reason on failure (`already_known` / `at_cap`)
- **LevelUpPopup skill display**: 5th param `learnedSkills[]` — shows "NEW SKILL: Sol" lines in cyan below stat gains
- **Skill scrolls**: 5 consumable scroll items in `weapons.json` (Sol/Luna/Astra/Vantage/Wrath Scroll, type `"Scroll"`, each with `skillId` field). Usable from equip menu — consumed on use, teaches the skill
- **Scroll use in equip menu**: Scrolls shown with `+` prefix in cyan. Click to learn skill → scroll consumed → animated banner. Handles cap/duplicate gracefully with error banner
- **Enemy skill assignment**: `createEnemyUnit()` accepts optional `skillsData` param. Promoted enemies get class innate skills. Level 5+ enemies get 1 random combat skill from [sol, luna, vantage, wrath]
- **StatPanel skill cap**: Shows `Skills (2/5)` header above skill list
- **`MAX_SKILLS` constant**: Set to 5 in `constants.js`
- **`showSkillLearnedBanner()`** and **`showBriefBanner()`** in `BattleScene.js`: Reusable tween-animated center-screen text banners
- **Character sprites**: All 21 game classes + Edric + 2 alt variants (32 total) processed to 32x32 with transparent backgrounds in `assets/sprites/characters/`. Includes 11 base classes, 10 promoted classes, 8 lord-specific classes (Tactician/Grandmaster, Light Sage/Light Priestess, Ranger/Vanguard, Lord/Great Lord), Edric, and 2 female alt variants (Cleric/Bishop).
- **Enemy sprites**: 23 enemy sprites (red palette) processed to 32x32 in `assets/sprites/enemies/`. Covers 15 standard classes + warrior_alt + 4 monster types (Dragon, Wyvern Priest, Zombie, Zombie Brute) for bosses/special encounters.
- **Skill system** (`data/skills.json` + `src/engine/SkillSystem.js`): 12 skills across 5 trigger types (passive, passive-aura, on-combat-start, on-attack, on-turn-start)
  - **Lord personal skills**: Charisma (Edric: allies within 2 tiles +10 Hit/+5 Avoid), Foresight (Kira: +1 range on Tome/Light), Resolve (Voss: +4 STR/DEF below 50% HP), Renewal Aura (Sera: adjacent allies heal 5 HP/turn)
  - **Combat skills**: Sol (SKL% heal damage dealt), Luna (SKL% halve enemy DEF/RES), Astra (SKL/2% five strikes at half damage), Vantage (attack first when defending below 50%), Wrath (+30 Crit below 50%)
  - **Class innate skills**: Critical +15 (Swordmaster), Sure Shot (Sniper, ignores terrain avoid), Lethality (Assassin, LCK/4% instant kill)
- **Skill combat integration**: `resolveCombat` and `getCombatForecast` accept optional `skillCtx` for stat bonuses, Vantage phase reorder, per-strike Sol/Luna/Lethality/Astra
- **Skill animations**: Per-strike skill activations show as floating cyan text, Vantage/Astra show as center-screen banner
- **Forecast skill display**: Combat forecast panel shows activated skills for both combatants
- **Turn-start skill effects**: Renewal Aura heals adjacent allies at start of player phase with green heal animation
- **Foresight range bonus**: Kira's attack range extends by +1 on Tome/Light weapons via `getWeaponRangeBonus()`
- **Promotion UI**: "Promote" option in action menu when `canPromote()` (base tier, level >= 10). Shows promotion banner + stat gain popup, applies stat bonuses, updates class/proficiencies, adds class innate skills, grants Iron weapon for new proficiency
- **Unit skills array**: All units now carry `skills[]` (array of skill ID strings). Lords auto-get personal skill parsed from `personalSkill` field. Promoted classes gain innate skills via `getClassInnateSkills()`
- **StatPanel skills display**: Shows unit's skill list below inventory
- **LevelUpPopup promotion mode**: 4th arg `isPromotion` changes title to "PROMOTION!" in cyan
- **DataLoader skills**: `loadAll()` now fetches `data/skills.json` alongside other data files
- **Inventory system**: Units carry multiple weapons (`inventory[]` array, max 5). All unit creation functions (`createLordUnit`, `createUnit`, `createEnemyUnit`) initialize inventory from equipped weapon.
- **Weapon swapping**: Equip sub-menu in action menu lets players swap between inventory weapons mid-turn. `▶` marks the currently equipped weapon.
- **Staff healing**: Staff-wielding units can heal damaged allies. Green tile highlights show heal range. Heal amount parsed from weapon `special` field ("Heals 10 HP", "Heals to full"), clamped to missing HP.
- **Dynamic action menu**: Context-sensitive options — Attack/Heal/Equip/Promote/Wait based on unit state + context
- **Heal animation**: Green flash on target + floating green `+N` text
- **Auto-equip logic**: Clicking Attack with staff equipped auto-switches to first combat weapon; clicking Heal auto-equips staff
- **Inventory helpers** in `UnitManager.js`: `equipWeapon`, `addToInventory`, `removeFromInventory`, `hasStaff`, `getStaffWeapon`, `getCombatWeapons`
- **Heal functions** in `Combat.js`: `calculateHealAmount`, `resolveHeal` (pure, no mutation)
- **Green heal range** in `Grid.js`: `showHealRange()` using green highlights (0x33cc66), reuses attack highlight array
- **StatPanel inventory display**: Shows full inventory list with `▶` on equipped weapon
- **Test map update**: Edric (Iron Sword + Steel Sword) + Sera (Lightning + Heal staff) vs Fighter Lv1 + Myrmidon Lv1

### Changed
- **Combat.js**: `calculateAttack()` accepts optional 4th param `defender` for effectiveness multiplier. `calculateDamage()` threads defender through automatically. New export: `getEffectivenessMultiplier`.
- **UnitManager.js**: `createEnemyUnit()` accepts optional 5th param `skillsData` for enemy skill assignment. `canEquip()` rejects `type === 'Scroll'`. `getCombatWeapons()` filters out Scrolls alongside Staves. New exports: `learnSkill`, `checkLevelUpSkills`.
- **BattleScene.js**: `awardXP()` calls `checkLevelUpSkills()` after each level-up, passes learned skill names to `LevelUpPopup`. Enemy creation passes `skillsData`. Equip menu handles scroll items. Imports `getEffectivenessMultiplier`, `checkLevelUpSkills`, `learnSkill`, `removeFromInventory`, `MAX_SKILLS`.
- **classes.json**: 9 classes now have `learnableSkills` field (6 base + 3 promoted classes)
- **weapons.json**: 5 new Scroll-type items added (Sol/Luna/Astra/Vantage/Wrath Scroll)
- **LevelUpPopup.js**: Constructor accepts 5th param `learnedSkills` (string array). Panel height adjusts for skill lines.
- **StatPanel.js**: Skills section shows count/cap header (`Skills (2/5)`)
- **Phase 4 (Equipment & Skills) is now COMPLETE** — all planned features implemented
- **Combat.js**: `resolveCombat` and `getCombatForecast` accept optional `skillCtx` parameter (backward compatible — defaults to null). Sol heals tracked via `strikerHealTo` on strike events.
- **UnitManager.js**: `promoteUnit()` now accepts optional `skillsData` to add class innate skills on promotion. New exports: `canPromote`, `getClassInnateSkills`.
- **BattleScene.js**: Combat calls pass `buildSkillCtx()` for skill-aware combat. `findAttackTargets` accounts for Foresight range bonus. Turn-start processes Renewal Aura healing. Action menu includes Promote option.
- **Terrain tiles upgraded**: All 10 terrain tiles (plain, forest, mountain, fort, throne, wall, water, bridge, sand, village) replaced with hand-cut SNES Fire Emblem-style pixel art from reference tileset, replacing earlier AI-generated tiles
- **BattleScene state machine**: Added `SELECTING_HEAL_TARGET` and `HEAL_RESOLVING` states
- **`findAttackTargets`**: Now checks all combat weapons in inventory (not just equipped weapon), ignores staves
- **Right-click from equip sub-menu**: Returns to action menu instead of undoing move
- **Pixel art terrain tiles**: AI-generated 32x32 tiles for all 10 terrain types (plain, forest, mountain, fort, throne, wall, water, bridge, sand, village) via Gemini, replacing colored rectangles
- **Edric character sprite**: 32x32 pixel art lord sprite (ranger gear, blue cloak) with transparent background, replaces blue square placeholder
- **Sprite asset pipeline**: `tools/process_sprite.js` (resize + white-bg removal for characters), `tools/process_tiles.js` (batch resize terrain tiles)
- **BootScene preloading**: Terrain tile images and character sprites loaded via Phaser `preload()` step
- **Combat Engine** (`src/engine/Combat.js`): Pure-function combat calculation system, no Phaser dependencies
  - Weapon classification: physical (Sword/Lance/Axe/Bow), magical (Tome/Light), staff
  - Range parsing for all weapon formats ("1", "1-2", "2-3", "1-ALL")
  - Weapon triangle: Sword > Axe > Lance > Sword with Prof/Mast rank modifiers; Bow/Tome/Light/Staff neutral
  - Core stat calcs: attack, defense, avoid, hit rate, crit rate, raw damage — all per GDD formulas
  - Double attack check (SPD >= enemy SPD + 5), counter-attack range validation
  - `getCombatForecast()`: deterministic preview for UI — damage, hit%, crit%, attack count for both sides
  - `resolveCombat()`: RNG-based resolution returning event log for animation system
  - GBA FE attack order: attacker → defender counter → attacker follow-up → defender follow-up
  - Brave weapon support (×2 strikes per phase), early termination on 0 HP
  - Terrain DEF/avoid bonuses integrated into all calculations
  - Supports `currentHP` (for mid-battle state) with fallback to `stats.HP`
- **Grid Engine** (`src/engine/Grid.js`): 10x8 tiled map with colored-rectangle terrain rendering, centered on 640x480 canvas
- **Dijkstra movement range**: Flood-fill calculates all reachable tiles within unit's MOV, respecting per-moveType terrain costs
- **A* pathfinding**: Finds optimal path from unit to destination tile, terrain-cost-aware
- **Path preview**: Hover a reachable tile while unit is selected to see the planned route
- **Unit placement**: Lord (Edric) placed from `lords.json` data with sprite (fallback to blue square)
- **Click-to-select**: Click unit to show blue movement range overlay; click again to deselect
- **Animated movement**: Unit moves step-by-step along A* path using Phaser tween chain
- **Terrain info HUD**: Top-left tooltip shows terrain name, move cost, avoid/def bonuses on hover
- **DataLoader** (`src/engine/DataLoader.js`): Async loader for terrain/lords/classes JSON
- **BootScene** (`src/scenes/BootScene.js`): Loads game data then launches BattleScene
- **BattleScene** (`src/scenes/BattleScene.js`): Hardcoded test map with 7 terrain types (Plain, Forest, Mountain, Water, Wall, Sand, Fort, Bridge, Village)
- **Terrain colors** in `constants.js`: 10 placeholder colors for all terrain types
- **R key reset**: Press R after moving to restore unit for repeated testing
- Data JSON files copied to `public/data/` for Vite dev+prod serving

### Changed
- **Grid.js**: Renders terrain tile images instead of colored rectangles (graceful fallback to rectangles if textures missing)
- **BattleScene.js**: Unit rendered as sprite image with tint-based selection/dimming instead of rectangle stroke/fill
- **sharp** added as devDependency for image processing pipeline
