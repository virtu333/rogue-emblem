# Spec: Village & Bandit Secondary Objectives

**Design log entry:** `docs/design-log.md` (2026-07-04)
**Branch:** `claude/rogue-emblem-early-game-5djnaz-villages`
**Size:** Large (new engine system + new AI mode + controller; strong prior art)

## Intent

Classic FE optional side objective: a village appears on some battle maps; a small bandit squad
spawns and beelines for it. A player unit reaching the village first earns a reward (gold + item —
*never* XP; secondary objectives pay in a different currency than kills). Bandits reaching it first
raze it. Ignoring it costs nothing beyond the missed reward. This is the "distance-gate + turn-gate"
anti-juggernaut lever: one unit cannot hold the front line and win the race.

## Prior art to mirror (verified)

The Merchant Caravan (PR #54) is the architectural template — copy its shape:

- **Pure engine + Phaser shim split:** `src/engine/CaravanSystem.js` + `src/ui/CaravanController.js`.
- **Deterministic node-gen roll** (suspend/revert-safe): `NodeMapGenerator.js:396` sets
  `params.hasCaravan` on BATTLE nodes; comment block :387-395 explains why it must be rolled there.
- **Tile resolution + guaranteed reachability:** `MapGenerator.js:263-266` resolves the spawn tile,
  :290 adds it to `reachTargets` for `ensureReachability`, :344 emits onto battle config.
- **Tuning constants** in `src/utils/constants.js:377-382`.
- Objective text: `BattleScene.updateObjectiveText()` (:9863); win/loss untouched
  (`checkBattleEnd` :9819 — villages never affect victory).
- First-time hint via `showMinorHint`; banners via `scene.showBriefBanner`.

## What must be built new (no prior art — verified gaps)

1. **The `Village` terrain tile (index 9, `data/terrain.json:110-121`) exists but is inert** — its
   `special: "Can be visited for items/events"` is implemented nowhere. This PR implements it.
2. **Tile-seeking AI:** every existing AI movement path targets *units* (`AIController.js`; the
   caravan beeline is faked by a +40 attack-score on `isCaravan` at :848-869). Bandits need a real
   `aiMode: 'seek_tile'` with a target coordinate.
3. **"Unit reaches tile" trigger:** seize (action-menu button) and escape
   (`EscapeObjectiveController.isOnEscapeTile` :52) are bespoke; build the village visit check
   following the escape controller's occupancy-check pattern.

## Design

### Spawn & placement

- New module `src/engine/VillageSystem.js` (pure) + `src/ui/VillageController.js` (Phaser shim,
  `create()`/`destroy()` per the extraction pattern — never inline in BattleScene).
- Roll at node generation (`NodeMapGenerator`, next to the caravan roll): `params.hasVillage`.
  Constants: `VILLAGE_SPAWN_CHANCE = 0.25`, eligible acts `act1-act4`, objectives `rout`/`seize`
  only (never escape/boss/recruit/ambush/tutorial/colosseum), and **mutually exclusive with
  `hasCaravan`** — max one micro-objective per map (design-log decision).
- `MapGenerator`: pick the village tile in the map's neutral band — middle third of columns, biased
  away from the main player↔enemy axis (top or bottom quarter of rows), on an open
  Infantry-passable tile; write terrain index 9; add to `reachTargets`.
- **Race calibration:** spawn 2 bandits (act-appropriate axe class from the act's enemy pool, e.g.
  Fighter/Brigand-alike) at the enemy-side edge nearest the village, on turn 1 via the existing
  scripted-wave path (`ReinforcementScheduler` `scriptedWaves` propagates `aiMode` — :436), with
  spawn distance chosen so `banditDistance ≈ playerSpawnDistance + 3` (a dedicated player unit wins
  the race; the deathball does not). Verify with the pure helper, not eyeballs: a
  `VillageSystem.calibrateBanditSpawn(...)` function computes path distances via Grid and shifts
  the bandit spawn along the edge until the inequality holds (or gives the player the benefit when
  the map can't satisfy it).

### Bandit behavior (`aiMode: 'seek_tile'`)

- New mode in `AIController`: unit carries `aiTargetTile: {col, row}`. Each turn: path-aware move
  toward the target (reuse `_findPathAwareChaseTile` internals with a tile goal instead of a unit).
  - If a player/NPC unit occupies the village tile, attack it if in range (they're blocking).
  - Otherwise bandits do not chase player units; they may attack a target adjacent after their
    move toward the tile (opportunistic, no deviation).
- A bandit that **ends its move on the intact village tile razes it**: tile converts to Plain
  (index via `TERRAIN` constants — never reorder terrain.json), "Village razed!" banner, bandits'
  `aiMode` clears to default chase (they join the battle).
- Bandits are ordinary enemies otherwise: they count toward rout, give normal XP with a modest
  wave-style `xpMultiplier` (0.85, matching scripted-wave precedent) since they walk away from the
  player initially.
- After the village resolves (visited or razed), any surviving `seek_tile` bandits revert to chase.

### Visiting

- A player unit that **ends its action on the intact village tile** visits it (checked from the
  same post-action hook the escape controller uses; no new action-menu entry — that surface is
  owned by the utility-abilities PR and we avoid the conflict).
- Reward, granted immediately:
  - Gold: act-scaled, using `turnBonus.json` `baseBonusGold` as the reference scale
    (~act1 150 / act2 300 / act3 500 / act4 700), added to `scene.goldEarned` (the escape
    evac-gold precedent, `EscapeObjectiveController.js:102-104`) with a gold float + banner.
  - Item: one roll from the act's consumable/statBooster loot pool via `LootSystem` helpers,
    delivered to the convoy (avoids inventory-full edge cases), named in the banner.
- Visited village converts to Plain (visited state must not re-trigger), sparkle/indicator removed.
- Objective subtext appended while intact: "Village: visit before bandits!" (pattern:
  `updateObjectiveText` NPC recruit suffix :9886-9888).

### Persistence / suspend-resume

- Village state (intact/visited/razed, tile coords, bandit unit flags) must survive the battle
  suspend checkpoint (`BattleSuspendController`) exactly as the caravan does
  (`retintIfPresent` / skip-respawn-on-resume pattern, `CaravanController.js:18,39`).
- Node-gen roll baked into `battleParams` keeps Continue-from-Map revert sanctioned.

## Tests

- `tests/VillageSystem.test.js` (pure): roll gating (act/objective/exclusivity with caravan),
  tile placement bounds, race calibration inequality, raze/visit state transitions.
- `tests/AIController.test.js` + `tests/AIControllerRealGrid.test.js`: `seek_tile` pathing,
  blocking-unit attack, revert-to-chase after resolution.
- `tests/VillageController.test.js` (mock Phaser, per `CaravanController.test.js`): spawn from
  config, resume skip, visit reward grant, raze banner.
- Headless scenario: new fixture in `tests/fixtures/battles/` + harness coverage
  (`tests/harness/HeadlessBattle.js`) — player wins race / bandits win race.
- MapGenerator: village tile reachability + neutral-band placement.
- Gates: `npm test`, `npm run check:data-parity` (terrain untouched but constants/data may sync),
  `npm run check:reference`, `npm run sim:fullrun:harness:pr`.

## Out of scope

- Rescue-recruit villages (deferred — design log), hold-point objectives, chest/thief mechanics,
  an action-menu "Visit" command, more than one village per map, escape-map villages.
