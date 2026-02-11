# Wave 0: Balance & Progression Fixes — Implementation Summary

## Overview

Wave 0 implements 5 high-priority balance fixes to improve game feel:

1. **Act 3 Promoted Recruits** — Late-game recruits arrive combat-ready
2. **Enemy Skill Scaling by Act** — Predictable difficulty curve (0%/10%/20%/30%)
3. **STR-Based Weight Mechanic** — Heavy weapons viable on high-STR units
4. **CHURCH Node Type** — Replaces REST with multi-service healing node
5. **Church Services** — Heal (free), Revive (1000g), Promote (3000g)

## Changes Summary

### Data Files (1 file)
- **`data/recruits.json`** — Act 3 pool changed to promoted classes:
  - Mercenary → Hero
  - Pegasus Knight → Falcon Knight
  - Mage → Sage
  - Thief → Assassin
  - Archer → Sniper
  - Cleric → Bishop

### Source Files (7 files)

**`src/utils/constants.js`**
- Removed `REST` from NODE_TYPES, added `CHURCH`
- Updated NODE_GOLD_MULTIPLIER (rest→church)

**`src/engine/NodeMapGenerator.js`**
- Updated `pickNodeType()`: 60% battle, 20% shop, 20% church (was 55/20/25)
- Updated `buildBattleParams()` to handle CHURCH nodes

**`src/engine/UnitManager.js`**
- Added `act` parameter to `createEnemyUnit()` (default 'act1')
- Implemented act-scaled skill assignment:
  - act1: 0% chance for combat skills
  - act2: 10% chance
  - act3: 20% chance
  - finalBoss: 30% chance

**`src/engine/Combat.js`**
- Added `calculateEffectiveWeight(weapon, unit)` helper
- Updated `canDouble()` to accept weapon parameters and apply weight penalty
- Updated `getCombatForecast()` doubling logic with weight calculations
- Updated `resolveCombat()` doubling logic with weight calculations
- Weight formula: `effectiveWeight = max(0, weapon.weight - floor(STR / 5))`

**`src/engine/RunManager.js`**
- Added `fallenUnits` array to run state
- Added `reviveFallenUnit(unitName, cost)` method
- Updated `completeBattle()` to track fallen units
- Updated `toJSON()` and `fromJSON()` for fallenUnits serialization
- Imported ROSTER_CAP for revival roster cap check

**`src/scenes/BattleScene.js`**
- Updated `createEnemyUnitFromClass()` calls to pass `this.battleParams.act` parameter (2 call sites)

**`src/scenes/NodeMapScene.js`**
- Replaced COLOR_REST with COLOR_CHURCH (light gray)
- Updated NODE_ICONS: removed REST (♥), added CHURCH (✝)
- Updated NODE_COLORS mapping
- Updated tooltip text: "Church — Heal, revive fallen, promote"
- Replaced `handleRest()` with `handleChurch()`
- Implemented full church overlay with 3 services:
  - **Heal All Units** — Free healing for entire roster
  - **Revive Fallen Unit** — 1000g per unit, restores at 1 HP
  - **Promote Unit** — 3000g per unit, instant promotion without Master Seal
- Added helper methods: `showChurchOverlay()`, `showChurchMessage()`, `refreshChurchOverlay()`, `closeChurchOverlay()`
- Imported `canPromote` and `promoteUnit` from UnitManager

### Test Files (4 files, +19 tests)

**`tests/Combat.test.js`** (+8 tests)
- calculateEffectiveWeight: null weapon, STR reduction, floor at 0
- canDouble: weight penalty, high STR negation
- getCombatForecast: weight impact on doubling
- resolveCombat: weight penalties to both combatants
- Skill SPD bonus stacking with weight

**`tests/UnitManager.test.js`** (+4 tests)
- Enemy skill scaling: act1 (0%), act2 (10%), act3 (20%), finalBoss (30%)
- Updated existing skill test to use act parameter

**`tests/NodeMapGenerator.test.js`** (+2 tests)
- CHURCH node distribution (~20% of middle rows)
- buildBattleParams returns null for CHURCH
- Updated existing test: rest→church filter

**`tests/RunManager.test.js`** (+5 tests)
- fallenUnits tracking in completeBattle
- reviveFallenUnit: restoration at 1 HP, gold deduction
- Roster full / insufficient gold failure cases
- Serialization roundtrip

## Test Results

**Before:** 511 tests passing (509 existing + 2 modified)
**After:** 530 tests passing (511 + 19 new)

All existing tests pass without modification (except 2 updated for new parameters).

## Key Formulas

### Weight Mechanic
```javascript
effectiveWeight = max(0, weapon.weight - floor(STR / 5))
effectiveSpeed = baseSpeed - effectiveWeight
canDouble = effectiveSpeed >= opponentEffectiveSpeed + 5
```

**Examples:**
- STR 5, Brave Axe (11 wt) → effective weight 9 → -9 SPD
- STR 20, Brave Axe (11 wt) → effective weight 7 → -7 SPD
- STR 25, Iron Sword (3 wt) → effective weight 0 → no penalty

### Enemy Skill Assignment
```javascript
SKILL_CHANCE_BY_ACT = {
  act1: 0.0,
  act2: 0.10,
  act3: 0.20,
  finalBoss: 0.30,
}
```

Only level 5+ enemies roll for skills. Promoted enemies always get class innate skills regardless of act.

### Church Services
- **Heal All:** Free, heals entire roster to full HP
- **Revive:** 1000g per unit, restores fallen unit to roster at 1 HP
- **Promote:** 3000g per unit, instant promotion (500g more expensive than Master Seal shop price of 2500g)

## Node Distribution Changes

**Before:**
- BATTLE: 55%
- REST: 20%
- SHOP: 25%

**After:**
- BATTLE: 60%
- CHURCH: 20%
- SHOP: 20%

RECRUIT nodes remain as post-processing (1-2 per act, converts existing BATTLE/SHOP nodes).

## Balance Impact

### Improved Late-Game Recruitment
Act 3 recruits now arrive as promoted classes, making them immediately viable alongside the player's promoted units. Fixes the problem where recruits were 10+ levels behind and required extensive investment.

### Fairer Early-Game Difficulty
Act 1 enemies no longer have Vantage/Wrath on first battle. Skill frequency gradually increases:
- Act 1: 0% (only class innate skills)
- Act 2: ~10% of level 5+ enemies have combat skills
- Act 3: ~20%
- Final Boss: ~30%

### Heavy Weapon Build Diversity
High-STR units can now wield heavy weapons without crippling SPD penalties:
- 20 STR unit with Brave Axe: -7 SPD (was -11)
- 25 STR unit with Brave Axe: -7 SPD (was -11)
- Forge weight reduction now has mechanical benefit

### Strategic Gold Sink
Church services provide comeback mechanics and convenience at a premium:
- Revive costs less than recruit loot skip (~1250g average) but unit starts at 1 HP (risky)
- Church promotion costs 20% more than Master Seal (3000g vs 2500g) for convenience
- Adds meaningful decisions: save gold for church vs shop/forge

### More Meaningful Node Map Decisions
CHURCH nodes replace passive REST nodes with active choices:
- Free heal always available (baseline benefit)
- Optional revival and promotion services create tension
- 20% church frequency ensures accessibility without trivializing permadeath

## Files Modified

**Data:** 1 file
**Source:** 7 files
**Tests:** 4 files

**Total:** 12 files modified, ~540 lines added, ~90 lines removed

## Migration Notes

- Old saves with `totalRenown` will work (upgraded to dual currency on load)
- Old saves without `fallenUnits` field will default to empty array
- REST nodes in old saves are treated as CHURCH nodes (functionally identical + new services)
- Weight mechanic applies retroactively to all weapons (pure combat calculation)
