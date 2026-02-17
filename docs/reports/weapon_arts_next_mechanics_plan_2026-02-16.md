# Weapon Arts Next Mechanics Plan (2026-02-16)

## Current Snapshot

- `data/weaponArts.json` defines **75** arts, with **15** arts still carrying `_deferredMechanic` placeholders.
- `docs/weapon-arts-expansion-status.md` current snapshot: **75 total / 60 implemented / 15 deferred**.
- Tier 4 (`multiHit`, `drainPercent`) is now implemented in combat resolution + forecast and covered by dedicated tests.
- `src/engine/Combat.js` already supports post-combat result payloads (`poisonEffects`, `debuffEvents`, `divineChargeHeals`) and is the right extension point for multi-hit/drain semantics.
- `src/scenes/BattleScene.js` applies combat results in two duplicated paths:
  - `executeCombat` (`src/scenes/BattleScene.js:6006`)
  - `executeEnemyCombat` (`src/scenes/BattleScene.js:6898`)
- The harness has the same duplication:
  - `_executeCombat` (`tests/harness/HeadlessBattle.js:933`)
  - `_executeEnemyCombat` (`tests/harness/HeadlessBattle.js:1215`)

## Deferred Mechanics Inventory

Based on `_deferredMechanic` tags in `data/weaponArts.json`:

- Tier 2 (`postCombatMove`, `afterCombatDebuff`, `afterCombatDamage`, `pierceThrough`):
  - all arts: 5
  - standard arts: 0
  - legendary arts: 5
- Tier 3 (`inflictStatus`):
  - all arts: 3
  - standard arts: 3
  - legendary arts: 0
- Tier 4 (`multiHit`, `drainPercent`):
  - all arts: 0
  - standard arts: 0
  - legendary arts: 0
- Tier 5 (`aoeSplash`, `allyBuff`):
  - all arts: 4
  - standard arts: 0
  - legendary arts: 4

Deferred but outside the requested tiers:

- `special(2x on hit/5 self-dmg on miss)` (`bow_all_or_nothing`)
- `ignoreWeaponTriangle, killBuff` (`legend_annihilate`)
- `ignoreRES, effective vs dark` (`legend_divine_flare`)

## Core Architecture Direction

### 1) Stop using freeform `_deferredMechanic` strings as execution source

Add structured effect data for runtime use and keep `_deferredMechanic` as optional annotation only.

Proposed art schema (incremental and backward compatible):

```json
{
  "effects": {
    "multiHit": { "count": 3, "damageMultiplier": 0.5 },
    "drainPercent": 0.3,
    "afterCombat": [
      { "type": "move", "mode": "retreat", "distance": 1 },
      { "type": "debuff", "target": "defender", "stat": "SPD", "amount": -4, "duration": 1 },
      { "type": "damage", "target": "defender", "amount": 5, "nonLethal": true },
      { "type": "status", "target": "defender", "status": "root", "duration": 1 }
    ],
    "aoeSplash": { "pattern": "adjacent", "damageMultiplier": 0.5 },
    "allyBuff": { "range": 2, "duration": 1, "stats": { "STR": 3, "CRIT": 10 } }
  }
}
```

### 2) Keep combat math pure, move board-state effects to post-combat application

- `Combat.resolveCombat` should own strike count/damage/heal semantics.
- Board interactions (tile movement, AoE target collection, ally buff application, status assignment) stay scene/harness side.
- Return semantic post-combat payloads from combat resolution where helpful.

### 3) Unify duplicated post-combat application paths

Create a shared post-combat application unit used by both player and enemy combat calls in `BattleScene`, and mirror the same helper in `HeadlessBattle` (or share one pure engine helper with adapters).

## Tier-by-Tier Implementation Plan

## Tier 2: Post-Combat Effects (first)

### Scope

- `postCombatMove`
- `afterCombatDebuff`
- `afterCombatDamage`
- Tier 2 implementation target is the **11 standard arts** carrying these mechanics.
- Legendary arts that also depend on later-tier mechanics are deferred to a follow-up pass.

### Tier 2 decisions locked (spec sync)

- Remove placeholder Tier 2 stat-bonus `combatMods` now for the 11 in-scope arts. Do not keep temporary combat buffs once real Tier 2 effects ship.
- Canonical post-combat order (scene + headless must match exactly):
  1. Sync HP from `resolveCombat`.
  2. Apply on-attack affixes (both sides).
  3. Apply existing combat result post-effects (`poisonEffects`, `debuffEvents`, `divineChargeHeals`).
  4. Apply Tier 2 weapon-art post-effects in order: `afterCombatDamage` -> `afterCombatDebuff` -> `postCombatMove`.
  5. Award XP.
  6. Remove dead units.
- `postCombatMove` requires at least one landed strike by the art user in that combat.
- For `swap` / `push` / `through`, defender must still be alive and occupying the expected tile at resolution time; otherwise skip the movement effect.

### Engine changes

- Extend `getWeaponArtCombatMods` (`src/engine/WeaponArtSystem.js:254`) to expose structured effect payloads from art data.
- Add normalized effect parsing utilities (new file recommended, e.g. `src/engine/WeaponArtEffectParser.js`).

### Scene/harness changes

- Add shared helper (BattleScene + Headless) to apply post-combat art effects after result HP sync and before unit cleanup.
- Reuse existing `applyBattleDebuff` (`src/scenes/BattleScene.js:6705`, `tests/harness/HeadlessBattle.js:1284`) for debuff effects.
- Add movement resolver for move effects using existing grid occupancy/path checks (`getMoveCost`, `getUnitAt`, `updateUnitPosition`).
- Lock hit-ownership checks to a stable combat identity (unit reference/side token), not `attacker.name`.
- Headless parity scope includes player-side weapon-art selection support now, but only as a deterministic explicit input for test scenarios (no new UI flow or AI scoring work).

### Refactor included in Tier 2 (recommended)

- Extract duplicated logic from:
  - `executeCombat` (`src/scenes/BattleScene.js:6006`)
  - `executeEnemyCombat` (`src/scenes/BattleScene.js:6898`)
- New scene-local helpers (minimum):
  - `_resolveCombatResult(attacker, defender, context)`
  - `_applyResolvedCombatPostEffects(attacker, defender, result, context)`

This is the lowest-risk way to add hook points without immediately splitting large files into many modules.

## Tier 3: Status Effects

### Scope

- `inflictStatus`: Root, Silence

### Data/runtime model

- Add battle-scoped unit field:
  - `unit.statusEffects = [{ id, duration, source, appliedTurn, appliedPhase }]`
- Keep it out of run persistence by stripping in `serializeUnit` (`src/engine/RunManager.js:90`) similar to `_battleDeltas`.

### Rules integration

- Root:
  - Unit cannot move (movement range reduced to current tile only).
  - Canto blocked while rooted.
- Silence:
  - No Tome/Light/Staff actions.
  - No skill procs/modifiers for silenced unit.

### Integration points

- Action/menu gating in `showActionMenu` (`src/scenes/BattleScene.js:4217`).
- Movement gating in `selectUnit`/movement range (`src/scenes/BattleScene.js:3005`).
- Skill suppression in `buildSkillCtx` (`src/scenes/BattleScene.js:5224`).
- Turn-phase status ticking in `onPhaseChange` (`src/scenes/BattleScene.js:6481`).

## Tier 4: Multi-Hit and Drain

### Scope

- `multiHit`
- `drainPercent`

### Engine changes

- In `resolveCombat` (`src/engine/Combat.js:862`), add art-driven strike profile support:
  - per-phase strike count override
  - per-strike damage multiplier
- Implement drain as a percent of actual damage dealt per hit (reusing existing hit animation heal behavior).
- Ensure interaction order is explicit with Astra/Adept/Brave/Cancel to avoid regressions.

### Guardrail

- Maintain deterministic forecast parity by mirroring all strike profile logic in `getCombatForecast`.

## Tier 5: AoE and Ally Buffs

### Scope

- `aoeSplash`
- `allyBuff`

### Scene/harness changes

- After primary target resolution, query nearby units via `gridDistance` and faction filters.
- Apply splash damage and buff deltas through centralized post-combat helper.
- Reuse `_battleDeltas` lifecycle for temporary ally buffs so cleanup stays consistent with existing battle-scoped stat changes.

### UI

- Add preview text in forecast/action panels for AoE/buff effects (minimum textual disclosure before animation work).

## BattleScene Size and Refactor Plan

`BattleScene` is currently oversized and high-churn; adding these mechanics directly into existing methods will increase regression risk.

Recommended refactor sequence:

1. **Phase A (low risk, immediate)**
   - Deduplicate `executeCombat` and `executeEnemyCombat` into shared private helpers.
   - Deduplicate corresponding HeadlessBattle paths.
2. **Phase B (mechanic-ready extraction)**
   - Extract weapon-art runtime effect parsing/normalization out of `BattleScene`.
   - Extract post-combat effect application into dedicated helper module.
3. **Phase C (optional broader split)**
   - Split menu/selection/UI helpers from combat pipeline (`showActionMenu`, picker methods, forecast rendering).

This gives a clean place to hook Tier 2-5 effects while reducing future scene bloat.

## Test Plan (Required Gates)

- `tests/Combat.test.js`
  - multiHit count/damage profile
  - drainPercent healing math
  - forecast/resolve parity for new mechanics
- `tests/BattleWeaponArts.test.js`
  - post-combat move/debuff/damage application
  - status infliction and turn expiry
  - AoE and ally buff application
- `tests/harness/HeadlessBattle.test.js`
  - parity checks for post-combat effect application
- Add a dedicated deferred-mechanics suite (new)
  - validates each structured effect type maps to expected behavior

## Recommended Execution Order

1. Tier 2 + combat-path dedupe refactor
2. Tier 3 status framework
3. Tier 4 multiHit/drain
4. Tier 5 AoE/ally buffs
5. Follow-up pass for remaining deferred non-tier mechanics (`All or Nothing`, `Annihilate`, `Divine Flare`)

## Open Decisions To Lock Before Build

- Exact status duration semantics (expire at start vs end of affected side phase).
- Whether after-combat fixed damage can kill or is non-lethal (Poison-style floor to 1).
- Multi-hit stacking precedence with Astra/Brave and whether they are additive or mutually exclusive per art.
