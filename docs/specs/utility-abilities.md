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
