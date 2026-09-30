# Playtest fixes — 2026-09-30

Five notes from Dave's and AP's playtests: three about Canto, one about the village shop,
and one about lava. Each was checked against the code before any change.

Verdicts: **BUG** · **GAP** (design gap) · **OK** (works as designed, but reads badly)

| # | Note | Verdict | Finding | Fix |
|---|---|---|---|---|
| 1 | "Canto movement is unrestricted by terrain movement" | **OK (feedback)** + latent inconsistency | `startCantoMove` runs the same terrain-aware Dijkstra (`Grid.getMovementRange`) as a normal move, with the unit's `moveType` and Pathfinder modifier. Its budget is `MOV − _movementSpent`, and `_movementSpent` is the path's terrain cost (`computeEffectivePath`). Known enemies block the range, and the game has no ZOC. Three things make it look unrestricted. Fliers pay 1 on every terrain. A unit that acted without moving gets its whole MOV. And Canto drew no path preview, so costs were never shown. The one inconsistency: Canto read `stats.MOV` while `selectUnit` reads `unit.mov`. | Canto's budget now reads `unit.mov ?? stats.MOV`, the same value the move range uses. Hovering a Canto tile draws the walk preview (#3), so terrain cost is visible. A real-Grid test pins that Canto respects terrain. |
| 2 | Canto needs a final Wait to confirm | **GAP** | Tapping a Canto tile moved the unit and ended its turn at once (`completeBattleAction`). A mis-tap cost a rewind. | New state `CANTO_CONFIRM` (see below). |
| 3 | Threat arrows don't show during Canto | **BUG** | `ThreatSightController.focus()` ran only in `UNIT_SELECTED`/`UNIT_ACTION_MENU` and returned null for units with `hasActed`. Canto sets both `CANTO_MOVING` and `hasActed`. The path preview was also gated to `UNIT_SELECTED`. | Threat Sight is active in `CANTO_MOVING` (hovered Canto tile, read from `cantoRange`) and in `CANTO_CONFIRM` (the unit's tile). In those two states `hasActed` does not block it. `updatePathPreview` draws the Canto walk. |
| 4 | "Maxing out forges at a village turned off buying" | **OK (feedback)** | No code ties the forge count to buying. `shopBuyBlock` checks only stock, price and gold. The 1000 G forge left 1161 G, which was below every price in stock: Act 3 prices are ×1.3, the Elixir sits at 1950 and the Act 3 pool has no Vulnerary. The greyed Buy kept its ember fill at 45% opacity, so it still looked live. | Rows priced out of reach show the price in the warn colour (`is-short`). The disabled Buy loses the ember fill (`shop-buy--short`). The reason reads "Not enough gold: N G short.", and a stock that is entirely out of reach says "Nothing here is within X G. Sell, restock or leave." |
| 5 | Lava shouldn't affect fliers | **GAP** | Lava burned every unit (`processTerrainDamage`). Fliers were already immune to acid and ice. | `lavaBurnsUnit(unit)` in `TerrainHazards.js` (false for `moveType: 'Flying'`), used by `BattleScene.processTerrainDamage` and the `HeadlessBattle` mirror. The Lava Crack rule text adds "Flying units are immune". The AI has no lava avoidance, so nothing changes there. |

## Canto confirm (`CANTO_CONFIRM`)

After a Canto move the unit stands on its new tile, but nothing is settled yet: no fog lifts,
no village is visited, nothing is saved, no history beat is written and `turnManager.unitActed`
is not called. The scene holds `_cantoPending = { unit, origin, remaining, range, path }` and
opens a one-row menu with **Wait**. It is built from `menuRow` and registered with
`_registerActionMenu(rows, { state: CANTO_CONFIRM_STATE })`, so the desktop canvas, the phone
rail (Wait pinned to the dock), the keyboard and the gamepad all use the same row.

- **Wait** (the menu row, `W`, the phone's Menu, or a tap on the unit's own tile) calls
  `confirmCantoMove()`. It records the path and then runs `completeBattleAction`, which lifts
  the fog, handles the village, saves and ends the unit's turn.
- **Back** (ESC, the rail's Back, right-click) calls `undoCantoMove()`. The unit returns to the
  tile where the Canto began and `startCantoMove` re-opens the choice with the same remaining
  budget. Back again (`CANTO_MOVING`) still skips the Canto and ends the turn there, as before.
- **A tap on another Canto tile** during the confirm is Back followed by a move there. The new
  move also waits for Wait.
- **End Turn** during the confirm settles the move where the unit stands.
- **Fog ambush:** a Canto move that a hidden unit stopped has shown something, so it is locked
  in and completes at once, as before.
- A refresh during the confirm resumes from the last suspend checkpoint, which was taken before
  the Canto move. The unit is then back before its Canto.

`isUnitMenuState(state)` (`battleMenuModel.js`) is true for `UNIT_ACTION_MENU` and
`CANTO_CONFIRM`. The rail's menu rendering, the dock pin, keyboard and pad menu navigation all
read it. States that end an interaction (cancel, End Turn, camera gestures, the mobile context)
list `CANTO_CONFIRM` next to `CANTO_MOVING`.
