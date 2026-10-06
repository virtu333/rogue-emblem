# Spec: Utility Abilities (limited-use battle actions)

**Design log entry:** `docs/design-log.md` (2026-07-04)
**Branch:** `claude/rogue-emblem-early-game-5djnaz-utility-abilities`
**Size:** Large (new action-menu surface; heavy reuse of existing primitives)

## Intent

Rare, utility-driven activatable abilities that appear as a battle action alongside
Fight/Item/Weapon Art/Wait: Blink (self-teleport), Rally Cry (timed party buff), Healing Circle
(AOE heal), Ensnare (AOE root). Weapon-art-adjacent but non-combat; limited-use per battle. They
give secondary units high-leverage turns (the dancer/thief design space) and reward roster depth.

## Current state (verified)

- **The `"action"` skill trigger is inert metadata** — SkillSystem never dispatches it; Shove/Pull/
  Dance are hardcoded by ID in `BattleScene.showActionMenu` (:5572-5829, options :5593-5680,
  click chain :5725-5810). New abilities must be wired there (this PR adds a small registry
  instead of four more hardcoded branches).
- Action-skill flow template (Shove): `startShoveTargetSelection` (:5152) → battleState
  `SELECTING_SHOVE_TARGET` → `InputController.handleClick` switch (:301-344) →
  `handleShoveTargetClick` (:5185) → `executeShove` (:4769) → `finishUnitAction` (:4538).
- **New battleStates must be registered in:** the InputController switch, ESC/cancel recovery
  lists (`BattleScene.js:3521-3528, 3707-3713, 3742-3749`), and
  `VisionRewindController.js:341`.
- Limited-use precedent: weapon-art `perMapLimit`/`perTurnLimit` counters on
  `unit._battleWeaponArtUsage` (`WeaponArtSystem.js:475-482, 533-606`).
- Timed buffs: `unit._battleTimedWeaponArtBuffs` entries `{key, stats, expiryPhase, expiryTurn}`
  written by `_applyTier5TimedBuffEntry` (:7944), recomputed/expired at :7973/:8095, with
  combat-preview save/restore at :7124-7179. Rally reuses this container (shared expiry sweep).
- Teleport passability: `AffixSystem.getWarpCandidates` (:235-256) + `BattleScene.executeWarp`
  (:8323) — diamond of passable, unoccupied tiles.
- AOE collection: radius-filter pattern of `_collectTier5SplashTargets` (:7875-7899);
  status via `StatusConditionSystem.applyCondition(target, 'root', durationPhases + 1)`
  (the `+1` matters — recovery decrements at phase start; root is defined in
  `constants.js:262-268`, may act but not move).
- Scroll teach flow (out of battle) already complete: `weapons.json` `type:"Scroll"` + `skillId` →
  `RosterOverlay._teachScroll` (:1844-1863) → `learnSkill`. Scrolls are excluded from in-battle
  menus. **Zero new teach plumbing needed.**

## Design

### Abilities (4, as skills with structured data)

New skills in `data/skills.json`, `trigger: "action"`, each with a new structured field
`actionAbility` (register in the skills schema/content-contract validator):

| skill id | name | actionAbility |
|---|---|---|
| `blink` | Blink | `{ kind: "teleport_self", range: 4, perMapLimit: 1 }` |
| `rally_cry_skill` | Rally Cry | `{ kind: "ally_buff", radius: 2, stats: { STR: 2, SPD: 2 }, durationPhases: 2, perMapLimit: 1 }` |
| `healing_circle` | Healing Circle | `{ kind: "aoe_heal", radius: 2, amount: 15, includeSelf: true, perMapLimit: 1 }` |
| `ensnare` | Ensnare | `{ kind: "aoe_root", radius: 2, durationPhases: 1, perMapLimit: 1 }` |

Design constraints that keep UI cost low:

- **Only Blink needs targeting** (pick a highlighted tile). Rally/Heal/Ensnare are **self-centered**
  with a confirm prompt showing affected units — no pick-a-center UI exists today and we don't
  build one in v1.
- All are `perMapLimit: 1` (once per battle), tracked in a `unit._battleAbilityUsage` counter
  mirroring `_battleWeaponArtUsage` (cleared where that one is cleared; survives suspend/resume
  the same way).
- Using an ability consumes the action (`finishUnitAction`); Canto applies as for other actions.
  No XP for v1 (avoid making abilities an XP faucet; dance XP precedent deliberately not copied).
- Ensnare respects `statusImmunity`; root duration uses the `+1` phase convention.
- Naming: `rally_cry` blessing already exists in `data/blessings.json:146` — the skill id must not
  collide (`rally_cry_skill`, display name "Rally Cry" is fine).

### Engine: `src/engine/ActionAbilitySystem.js` (new, pure)

- `getActionAbilities(unit, skillsData)` — unit's action-trigger skills with `actionAbility` data.
- `canUseAbility(unit, ability)` — usage counter, silence check (silence blocks these — they're
  shouts/spells; document it), root does NOT block (root allows acting).
- `getBlinkTiles(unit, range, grid, getUnitAt)` — reuse `getWarpCandidates` logic but return the
  full passable-unoccupied diamond (not max-distance-only).
- `collectAffected(unit, ability, units)` — radius filter for rally/heal/ensnare targets.
- `markUsed(unit, abilityId)`.

### BattleScene glue (extract, don't inline — controller pattern)

- New `src/ui/AbilityController.js` (`create(scene)`/`destroy()`): builds the "Ability" submenu
  (pattern: `WeaponArtController.showWeaponArtPicker` reusing `scene.actionMenu`), one row per
  usable ability with a used/available indicator.
- `showActionMenu` gains a single `Ability` entry when `getActionAbilities(...)` is non-empty and
  any are usable (one menu branch, not four).
- One new battleState `SELECTING_ABILITY_TILE` (Blink) registered in InputController switch +
  cancel/ESC lists + VisionRewind list. Tile preview via `grid.showAttackRange`.
- Effects: Blink → `executeWarp`-style relocation (fade, `updateUnitPosition`); Rally →
  `_applyTier5TimedBuffEntry` entries (source-tagged `abilityId`) + buff FX
  (`CombatFxController.playBuff`, dance precedent :5110-5150); Heal → clamp `currentHP` like
  `useConsumable`, heal floats; Ensnare → `applyCondition` per enemy + status pips refresh.

### Acquisition

- Four new scrolls in `weapons.json` (`type:"Scroll"`, `skillId`, price ~2500 like skill scrolls)
  taught out of battle via the existing RosterOverlay flow. Added to `lootTables.json`
  `skillScroll` pools act2+ (Blink act3+ — strongest). Skills occupy normal skill slots — the
  opportunity cost is real (an ability competes with Sol/Vantage/etc.).
- Optional meta hook explicitly out of scope (a future `starting_skills` unlock can come later).

## Tests

- `tests/ActionAbilitySystem.test.js` (pure): availability, silence/root gating, per-map limit,
  blink tile legality (bounds/occupancy/impassable), radius collection.
- Menu integration: `setupActionMenuHarness` pattern from `tests/BattleWeaponArts.test.js`
  (stub `_makeMenuTextButton`, assert "Ability" appears/disappears by usability).
- Effects: rally buff entry + expiry sweep; heal clamp; root applied with `+1` duration and
  statusImmunity respected; blink relocation updates col/row.
- Suspend/resume: usage counters + timed buffs survive checkpoint restore.
- Data: schema/content-contract registration for `actionAbility`; scrolls resolve in loot; data
  parity (`npm run sync-data`). Full gates: `npm test`, `check:data-parity`, `check:reference`,
  `sim:fullrun:harness:pr`.

## Out of scope

- Enemy/AI use of abilities; pick-a-center AOE targeting; multi-use or cooldown models; ability
  XP; accessory-granted abilities (skills+scrolls only in v1); new meta upgrades.

## Addendum: Smite and Transfuse (adjacent-target abilities)

Two more registry skills with no `perMapLimit` (usable every turn, `usableWhileSilenced`):

| skill id | actionAbility |
|---|---|
| `smite` | `{ kind: "push_enemy", distance: 2, usableWhileSilenced: true }` |
| `transfuse` | `{ kind: "transfer_hp", amount: 10, usableWhileSilenced: true }` |

- Rules are pure, in `ActionAbilitySystem.js`: `findSmiteTargets` / `settleSmite`,
  `findTransfuseTargets` / `transfuseAmount` / `settleTransfuse`. The finders take what the player
  may know (`ctx`: seen foes, a `getUnitAt` that counts a fogged tile as taken, the affix data).
- **Smite** pushes an adjacent foe `distance` tiles straight away. The first tile must be in
  bounds, passable for the foe's own move type and unoccupied, otherwise the foe is not a target;
  a blocked second tile moves it one tile. A foe the push puts on Ice slides on (the forced-slide
  rule below); lava and acid do nothing at once (the ground works on it at the end of its phase, as
  after any move). Never targets bosses, the Entity, Anchored foes (`isDisplacementImmune`) or
  rooted foes (the weapon-art push rule). `settleMoves` marks a holder disturbed, so the pack wakes.
- **Transfuse** gives `min(amount, giver HP - 1, ally missing HP)`: the ally is healed through
  `UnitHealth.healUnit`, then the giver pays exactly that through `damageUnit(..., { floor: 1 })`.
  A Wounded ally is not a target (no HP could land). No XP, no deeds.
- Targets are picked in `SELECTING_ABILITY_TILE` (Blink's state, so no new state in any list) on
  the target unit's tile; `ui/AbilityTargetingController.js` owns the step and the action.
- History beats `smote` / `transfused` give the rewind rows "Before X's smite on Y" /
  "Before X's transfuse on Y" (`RewindDestinations.js`).
- Scrolls: `Smite Scroll`, `Transfuse Scroll` sit in the act 3 and act 4 `skillScroll` pools,
  where Shove and Pull do. Enemies never get either (no `classInnate`, not in the enemy skill pool).
- Swap stays an innate command for every unit (`findSwapTargets`), not a skill.

## Addendum: forced moves slide on Ice (owner decision 2026-10-06)

Until now a unit moved by Shove or Smite (or a weapon-art push) landed on its tile and stopped:
`IceMovement` priced only walking. One rule now covers every forced displacement.

**The rule.** A unit that another unit's action puts on an Ice tile slides on in the direction it
was pushed, exactly as it would have if it had walked there, minus the movement cost (a forced
slide has no budget): it stops on the last Ice tile when the next tile is off the map, holds a
unit or is ground its move type cannot stand on, and otherwise ends on the first tile that is not
Ice, whatever that tile is (lava and acid included: it stands there as if it had walked, and the
ground works on it at the end of its phase; nothing happens at once, as for a walk). Fliers do not
slide. Only the push direction, never diagonal. Implemented once: `IceMovement.slideAcrossIce` is
the slide itself (walking's `resolveIceSlide` and `traceForcedSlide` both call it, so what ends a
slide is decided in one place), `IceMovement.traceForcedSlide(unit, from, direction, grid,
occupantAt)` is the forced entry, and `ForcedMovement.traceForcedMove(unit, dc, dr, distance, grid,
occupantAt, slideOccupantAt)` composes a push with it.

**A push and its slide.** A push moves up to `distance` tiles, stopping before the edge, ground the
unit cannot stand on or a unit. Whenever it puts the unit on Ice (the first tile or the second of a
Smite, the one tile of a Shove) the slide runs from there to its end. A slid tile counts as a tile of
the push, so Ice never makes a push shorter (a push with distance left when the slide leaves the Ice
goes on from the landing). `stoppedShort` (something held the unit before the push's distance was
spent) is what a Battering Ram calls a collision: a slide held after the distance was spent is
terrain doing its work, not a crash.

**Which moves use it.**

| move | forced? | slides |
|---|---|---|
| Shove (the ally) | yes | yes (`ForcedMovement.findShoveTargets` / `settleShove`) |
| Smite (the foe) | yes | yes (`findSmiteTargets` / `settleSmite`) |
| Weapon-art `push` and `ram` (the target) | yes | yes (`WeaponArtPostCombat.resolvePostCombatMove`, `PostCombatEffects` yields the tiles as `slides` on the `moved` beat) |
| Pull (the pulled ally) | yes | never leaves its tile: it lands on the puller's old tile and the puller, who stepped back, holds the next one (`tests/ForcedSlide.test.js`, `tests/ForcedSlideBattle.test.js`) |
| Pull (the puller's step back), art `advance` / `retreat` / `through` / `swap`, the Swap command | no: the unit moves itself | no: unchanged |
| Blink, Warp, Rescue | teleports | no |

The line is "displaced by someone else's action". A unit moving itself by an ability is still
walking-by-other-means, which keeps Pull's exchange and the art's own steps exactly as they were; if
the owner wants them to slide too, they are one call each (`traceForcedSlide`). Enemies never Shove
or Smite (no `classInnate`, not in their skill pool); an enemy's weapon-art push goes through the same
`resolvePostCombatMove`, so the rule holds for it without more code.

**What the player may know.** A push's tiles are chosen as before (a fogged tile counts as taken, so a
hidden unit never decides which option exists). The slide is the consequence of that choice and is
traced over different boards for the two uses (`ui/forcedMoveProbes.js`):

- the preview (`landing` in the target list: `destCol` / `destRow`, `steps`, `slid`, `path`) reads
  the units the player knows (`PlayerKnowledge.occupied`), so a hidden unit never shortens the slide
  shown and the fog itself is not a body;
- execution reads the real board for the slide, so a unit the fog hides stops it exactly as one stops
  a walk (`FogAmbush`). The push's own tiles are the same in both. Shove reports it as a walk does: a
  hidden foe is an "Ambush!" (history beat `was ambushed by` for the ally, hint on the foe), a hidden
  neutral a "Blocked" hint; Smite shows nothing (nobody on the player's side bumped into it).

The art ram's forecast (`AreaPreview.previewAreaArt`) is the same: it passes the terrain and the
known units, so its landing shows the slide and a fogged unit never shortens it, while the real ram
(`PostCombatEffects` over the real board) stops where the real board stops it. The slide's landing is
data on the target entries (`destCol` / `destRow`, `path`); the board shows no landing marker today
(Shove and Smite highlight the target tile only), for ice or not.

`tests/ForcedSlideBattle.test.js` and `tests/AreaPreview.test.js` pair worlds that differ only by a
hidden unit and require the same preview and a different outcome.

**Presentation.** `settleMoves` carries `path` on the move's fact; `presentSettledMoves` tweens a move
that has one tile by tile (slide tiles at walking's 60 ms), the same lifecycle and cleanup as any move.
The final tile is the only state: rewind, suspend and resume read `unit.col/row`
(`tests/RewindForcedSlide.test.js`), the hold-pack mark is unchanged (`settleMoves` marks `moved`).
Whether or not the slide is drawn, the board is identical (`tests/ForcedSlideBattle.test.js`).

