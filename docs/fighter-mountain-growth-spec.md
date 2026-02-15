# Fighter Mountain Mobility + Player-Only Growth Buff

## Summary

- Add a Fighter terrain perk: mountain movement cost is reduced by 1 (minimum 1).
- Add a player-only Fighter growth buff: +5 to STR, DEF, and SPD growth rates.
- Enemy Fighter growths remain unchanged.

## Scope

- In scope:
  - Movement/pathing cost behavior for Fighters on Mountain tiles.
  - Player-only growth-rate adjustment for Fighter class units.
  - Save/load migration so existing player Fighters receive the growth buff once.
  - Test coverage for movement behavior, growth application, and migration safety.
- Out of scope:
  - Non-Fighter classes (including Warrior) unless explicitly expanded later.
  - Flat stat buffs (this is growth-rate only).

## Rules

### 1) Mountain movement perk

- If a unit is class `Fighter` and enters a `Mountain` tile:
  - Effective movement cost is `baseMountainCost - 1`.
  - Clamp to minimum `1`.
- Applies to all factions for movement behavior (class trait).

### 2) Growth buff

- Apply only to player-owned Fighter units:
  - `growths.STR += 5`
  - `growths.DEF += 5`
  - `growths.SPD += 5`
- Do not apply to enemy Fighter units.
- Apply exactly once per unit (idempotent guard required).

## Technical Plan

### A) Class-aware movement cost

- File: `src/engine/Grid.js`
- Extend movement-cost resolution to accept unit context.
- Use unit context in:
  - `getMovementRange(...)`
  - `findPath(...)`
- Mountain adjustment check:
  - terrain name is `Mountain`
  - unit class is `Fighter`

### B) Call-site threading for movement/pathing

- File: `src/scenes/BattleScene.js`
  - Pass the acting/selected unit into movement and pathing calls.
  - Ensure `calculatePathMovementCost(...)` uses class-aware cost.
  - Ensure terrain hover tooltip displays effective move cost for hovered unit.
- File: `src/engine/AIController.js`
  - Pass the enemy unit to movement/pathing calls so enemy Fighter AI respects mountain cost.
- File: `tests/harness/HeadlessGrid.js`
  - Mirror class-aware movement-cost behavior to keep harness parity.

### C) Player-only Fighter growth buff hook

- File: `src/engine/UnitManager.js`
  - Add helper for one-time player-Fighter growth buff application.
  - Use an internal marker flag to prevent duplicate application.
- Apply in player-side creation and conversion paths:
  - Lord/recruit paths that can yield player Fighters.
  - NPC -> player recruit conversion flow in `src/scenes/BattleScene.js`.
- Save migration:
  - File: `src/engine/RunManager.js` in `fromJSON(...)`
  - Apply buff once to existing player roster Fighters.

## Test Plan

- `tests/UnitManager.test.js`
  - Player Fighter receives +5 STR/DEF/SPD growth.
  - Enemy Fighter does not.
  - Idempotency: second application does not stack.
- Movement/pathing tests
  - Verify Fighter mountain effective cost is reduced by 1.
  - Verify non-Fighter Infantry remains unchanged.
  - Verify range/path endpoints reflect reduced cost.
- Parity tests
  - Update `tests/harness/GridParity.test.js` expectations if needed.
  - Ensure `HeadlessGrid` and `Grid` stay behaviorally aligned.
- Run/save migration tests
  - Existing saved player Fighter gets buff once on load.
  - Re-loading does not add another +5.

## Acceptance Criteria

- Fighter movement over Mountain is functionally improved by one movement-cost step.
- Player Fighters have +5 growth on STR/DEF/SPD.
- Enemy Fighters retain baseline growths.
- Existing saves safely migrate without double-buffing.
- Relevant tests pass.

