# Portrait battles (beta prototype)

**Status:** Prototype, opt-in, phones only. Battles only; the route map and every other screen stay landscape.
**Date:** 2026-09-25

## Try it on a phone

1. Open the game in the phone's browser (Safari or Chrome, not the installed app; see Limits) with `?portrait=1` added to the URL, e.g. `https://<site>/?portrait=1`. The choice is remembered on that device; `?portrait=0` turns it off. Once opted in, a phone browser tab also shows **Menu → Settings → Portrait battles (beta)** to switch it off; the toggle is not offered to anyone who has not opted in by link, since only battles turn upright so far (the rest of the run still asks for landscape).
2. Play normally in landscape. Once a battle begins, turn the phone upright.
3. The board re-opens upright at the next moment you are free to act (your turn, nothing selected). Turn it back to landscape the same way.
4. Deployment, rewards and the route map still ask for landscape.

## What changes

- **The board turns a quarter.** The player's deployment side is drawn at the bottom and the advance runs upward. Every template deploys players on one horizontal side, so the short side of each map (8–13 tiles) spans the phone's width. Most maps show whole at ~30–35 CSS px per tile, about the same as landscape, because the landscape layout loses width to the 4:3 canvas and the side rail.
- **Layout:** the map fills the top; the command rail is a fixed-height band at the bottom (status and objective, then commands, then Danger, Overview, Recenter, Back and Menu along the bottom edge). In a unit's action menu Wait is pinned at the start of that edge (as on the landscape rail) and Danger narrows to a tool-sized cell, so the edge holds six whole labels. The rail never changes height, so the map never resizes under a finger.
- **Forecast** is a bottom sheet: Cancel / Confirm sit under the thumb, and the top of the map (where targets usually are) stays visible. The weapon ◀ ▶ stepper puts the weapon name on its own line.
- **Rotation mid-battle** never re-lays out a live battle. At the player's next clean idle boundary the controller saves the battle as it stands (same RNG position, no reseed) and re-opens it through the existing Resume battle path in the other orientation. A refresh restores exactly the same thing. While a switch waits (a unit mid-action, enemy phase), the layout already follows the phone and a short note says the board will turn.
- **When the board keeps its orientation instead.** The switch re-opens only from a save that reached storage (`captureCheckpoint` returns true); it never trusts the in-memory checkpoint alone, which `captureCheckpoint` updates before writing. If the write fails (storage full, private mode), or the battle has no run save to re-open from (tutorial, `?devScene=` routes without a slot), or the battle began under the legacy `legacy-v1` rewind policy (which reseeds by save count, so an extra save would change later outcomes), the board stays as it is for the rest of that battle and a note says so. The layout still follows the phone.

Rules are untouched: the rotation is Grid presentation only. Movement, combat, AI, saves, seeds and checkpoints stay in game coordinates.

## Architecture

| Piece | Role |
| --- | --- |
| `src/utils/boardOrientation.js` | Pure quarter-turn transform (`toDisplay`, `fromDisplay`, arrow-key mapping) and the display-indexed terrain layout |
| `src/engine/Grid.js` | Optional `presentation` argument; `gridToPixel` / `pixelToGrid` go through the transform; `mapPixelWidth/Height` |
| `src/ui/BattlefieldArt.js` | Paints terrain art from the rotated layout, so shores, walls and bridges join their drawn neighbours and trees stay upright |
| `src/ui/BattlefieldLab.js` | Portrait canvas: 640 logical px wide, tall; pinned Phaser UI keeps its 640×480 layout in a centred band of the UI camera |
| `src/ui/PortraitBattleController.js` | Decides the presentation at `beginBattle`, owns the `<html>` classes, follows the phone and preference, and performs the checkpoint re-open at a safe point |
| `src/utils/portraitBattle.js` | Device-local preference (`emblem_rogue_portrait_battles`, never cloud-synced), `?portrait=` link, switch gating |
| `src/ui/portraitBattle.css` | Upright rail, forecast sheet and small portrait fixes, applied only inside `@media (orientation: portrait)` while `portrait-battle-capable` is set |

Other presentation sites made rotation-aware: danger-zone outline, light layer, grid cursor arrows, and the side canvas menus open towards.

## Limits of the prototype

- **Installed app / TestFlight:** the PWA manifest and the iOS `Info.plist` still lock landscape, so test in a browser tab. There (`isLandscapeLockedShell`: native Capacitor, or an installed display mode — `standalone`, `fullscreen`, `minimal-ui`) the Settings toggle is hidden and a stored opt-in is ignored without being cleared (the installed web app shares storage with the browser tab that set it): the board never turns and the rotate prompt keeps its plain copy. Unlocking them is a release step.
- **Tutorial battles** and slotless dev routes have no run save to re-open from: the board keeps the orientation it started in (the layout still follows the phone).
- **Battle history / timeline replays** draw the board unrotated.
- **Tutorial copy** that names screen directions was written for landscape.
- Switching orientation restarts the battle music track.
- Only the battle is upright. Full-run portrait (route map, menus) is the next stage; see the review in this session.

## Tests

- `tests/BoardOrientation.test.js`: transform round trips, adjacency, arrow mapping, tap hit-testing on every tile of a rotated grid, and movement ranges unchanged.
- `tests/PortraitBattle.test.js`: preference and link, canvas sizing, UI band, the switch gate (safe point, overlays, tutorial lock, failed capture, preference off, battle end), and landscape-locked shells (iOS app, installed web app: no toggle, a stored opt-in ignored but kept).
- `tests/e2e/portrait-battle.spec.js` (runs in CI via `npm run test:ux-contracts`):
  - real touch select and move on the turned board, commands in view;
  - rotation round trip with identical units and RNG, and the switch's save written to the slot;
  - a deferred switch, and the rotate prompt without the opt-in;
  - a stored opt-in in a browser tab, the installed web app and the iOS app (stubbed display mode / Capacitor bridge): only the tab turns the board and offers the Settings toggle;
  - the bottom edge at 375×667, 390×844 and 430×932: Wait, Danger and the four tools on one row, each on screen, uncovered, at least 44 px, with no label broken mid-word (idle, a six-command menu, Danger shown and pinned, and after a real tap on Wait);
  - **presentation invariance:** one saved battle is resumed twice through Title → Save Slots → Resume Battle; one run turns the phone upright and back, both then play the same enemy phases (with real attacks). The full domain state (`captureBattleState`: units, equipment, conditions, fog, RNG, convoy, gold) and Vision charges must match after every phase. A switch that consumes one gameplay random draw fails this test and the round trip.
