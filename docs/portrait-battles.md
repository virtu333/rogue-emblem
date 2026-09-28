# Portrait mode

**Status:** shipped. On by default on phones, in the browser tab, the installed web app and the iPhone app. The iPad app stays in landscape.
**Dates:** 2026-09-25 (battles), 2026-09-26 (whole-run plan), 2026-09-27 (every screen upright, on by default).

## For players

- **Turning it on.** On a touch phone (the screen's short side under 600 CSS px), portrait mode is on unless the player turns it off. A phone held upright plays upright; a phone held sideways plays the landscape game. Every screen follows the phone.
- **Turning it off.** Menu → Settings → **Portrait mode** switches it off or on again on this device. `?portrait=0` in the URL turns it off; `?portrait=1` turns it on. The choice is device-local (`emblem_rogue_portrait_battles`: `on`, `off`, or unset = the device default) and is never cloud-synced.
- **With portrait mode off,** a phone held upright shows the rotate prompt. The prompt has **Play upright**, which turns portrait mode on, since Settings is out of reach behind it. Where the browser can lock orientation (not iOS Safari), it also has **Use landscape**.
- **Tablets.** Portrait mode is off by default on tablets (the upright layouts are built for 375–430 px phones). A tablet browser can still choose Play upright. The iPad app allows landscape only (`UISupportedInterfaceOrientations~ipad`, `UIRequiresFullScreen`), so there the setting is not offered and a stored "on" is ignored.
- **In a battle,** turning the phone re-opens the board in the other orientation at the next moment the player is free to act (their turn, nothing selected, no finger on the board).

## Battles

- **The board turns a quarter.** The player's deployment side is drawn at the bottom and the advance runs upward. Every template deploys players on one horizontal side, so the short side of each map (8–13 tiles) spans the phone's width at ~30–35 CSS px per tile.
- **Orientation is chosen when the battle begins.** The deploy menu is a full-screen DOM menu with no board behind it. Deploy starts the battle in the phone's current orientation, so there is no re-open after deployment. Formation's board follows that orientation.
- **The rail.** The map fills the top; the command rail is a fixed-height band at the bottom: status and objective, then commands, then the dock along the bottom edge.
  - The dock holds End turn (idle), Danger and the tools: Overview, Back (the widest cell) and Menu. The whole board fits upright, so Recenter is landscape-only. In a unit's menu Wait is pinned at the start and Danger narrows to a tool cell.
  - While a unit acts (selected, moving, in its menu, choosing a target, in the forecast), the turn/objective row gives its height to the commands, so a unit's commands and Equip rows fit without scrolling. It returns at idle.
  - Submenus and target lists (Equip, Item, staff, attack and heal targets) are one full-width row each with their two-line briefs. A unit's own commands fill their rows (`commandSpans`): three across, two splitting a row, four as two pairs. A greyed command with a reason ("Unarmed: no weapon to attack with") takes one short row, name and reason on one line, after the usable ones.
  - Side objectives read under the objective, e.g. "Village intact · Caravan 8/26 HP". The caravan's HP shows only while its tile is in sight.
  - The rail never changes height, so the map never resizes under a finger.
- **Forecast** is a bottom sheet. The two sides stack, one row of numbers each, with Cancel / Confirm under the thumb above the home bar. Tutorial lessons keep the sides side by side so their notes can point at the numbers.
- **Formation.** The heading reads FORMATION without the turn counters, and Auto-place is compact, so the first bench row shows whole at 375x667. Turning the phone mid-placement keeps the board as it is until turn 1, then re-opens it in the new orientation with every unit on its chosen tile.
- **Through the end of the battle.** The upright classes stay until the scene is destroyed, so rewards, level-ups, deeds, boss recruit, lord arrival and "View map" stay upright. History, timeline and rewind previews are drawn on the turned board.
- **Rotation never re-lays out a live battle.** At the player's next clean idle boundary the controller saves the battle as it stands (same RNG position, no reseed) and re-opens it through the Resume battle path in the other orientation. A refresh restores exactly the same thing. While a switch waits (a unit mid-action, the enemy phase, Formation), the layout already follows the phone and a note says what the board waits for ("…when your turn begins", "…when this action is done", "…when the battle begins"). The note stays for the whole wait. A finger held on the board through the turn does not hold the switch back: the turn already dropped that press, and iOS may never send its release.
- **When the board keeps its orientation.** The switch re-opens only from a save that reached storage. If the write fails (storage full, private mode), the battle stays playable in its current orientation and a note says to turn the phone again; the next request (turning the phone again, or the Settings toggle) retries. A battle with no run save to re-open from (tutorial, slotless `?devScene=` routes) locks at once without trying a save, as does one that began under the legacy `legacy-v1` rewind policy; a note says so. The layout still follows the phone. The note sits over the map, below the tutorial guide when it would cover it.
- **Turning sideways is taught once.** The first phone battle teaches pinch and pan (naming Overview upright). A later battle played upright says once that the phone can turn sideways for the wide layout (hint `battle_turn_sideways`, respects the Hints setting).
- **Input across a layout change.** A press that began before the board's geometry changed (a resize, a turn, the browser bars sliding) never completes as a tap, long press or camera gesture. A touch release with no recorded press never acts on the board. Tile size on screen is kept across a resize (CSS px per canvas px, not the CSS height).

Rules are untouched: the rotation is Grid presentation only. Movement, combat, AI, saves, seeds and checkpoints stay in game coordinates.

## Architecture

| Piece | Role |
| --- | --- |
| `src/utils/portraitBattle.js` | The preference (on / off / unset and the device default), `?portrait=`, `isLandscapeLockedShell` (the iPad app only), the Settings gate, the `portrait-ui` class (`installPortraitUi`) and the switch gate |
| `src/utils/boardOrientation.js` | Pure quarter-turn transform (`toDisplay`, `fromDisplay`, arrow-key mapping), footprints and history frames on the turned board |
| `src/engine/Grid.js` | Optional `presentation` argument; `gridToPixel` / `pixelToGrid` go through the transform |
| `src/ui/BattlefieldArt.js` | Paints terrain from the rotated layout, so shores, walls and bridges join their drawn neighbours and trees stay upright |
| `src/ui/BattlefieldLab.js` | Portrait canvas: 640 logical px wide, tall; pinned Phaser UI keeps its 640×480 layout in a centred band; `resizedZoom` keeps tile size across resizes |
| `src/ui/PortraitBattleController.js` | Chooses the presentation at `beginBattle`, owns the battle `<html>` classes, follows the phone and preference, and performs the checkpoint re-open at a safe point |
| `src/ui/InputController.js` | `invalidatePointerGestures` on a geometry change; a touch release with no press never clicks |
| `src/ui/portraitBattle.css` | The upright rail, dock, forecast sheet and battle fixes |
| `src/ui/portraitMode.css` | Shared menu-kit rules upright |

**The contract.** `installPortraitUi()` (called once in main.js) keeps the class `portrait-ui` on `<html>` while portrait mode is active: on (by choice or by default), not the iPad app, a coarse pointer, and held upright. It re-checks on resize, orientation change and preference change, and dispatches `emblem-rogue:portrait-ui` on `window` when it flips. Every upright layout keys off that class **and** sits inside `@media (orientation: portrait)` (`tests/PortraitCssGating.test.js` scans every stylesheet), so the class is inert on a landscape page. Battle-only rules may key on `portrait-battle` / `portrait-battle-capable`. While the class is set the rotate prompt never shows. JS that must agree with the CSS gate uses `portraitListLayout()` or `uprightPage()` (ceremonies).

**Native and installed shells.** `ios/App/App/Info.plist` allows portrait on iPhone and landscape only on iPad; `public/manifest.webmanifest` asks for `"orientation": "any"`. `tests/GameIdentity.test.js` holds the manifest and both plist lists together.

## Every screen upright

Outside battles every screen is a DOM surface over the hidden canvas; the upright work is responsive CSS plus a few layout changes. Each screen's upright rules live with the screen.

| Area | Upright layout | Where |
|---|---|---|
| Auth, boot, title | Title: one column, lockup top-left, key art as a band sized by `TitleScreen.uprightArtScale` (the sun whole, clear of the lockup), full-width run buttons, guides 2×2, Settings and account at the bottom. The band re-measures whenever the screen's size settles (a ResizeObserver), not only on `resize`: iOS can announce a turn before its layout settles. Auth: a 320 px art band between lockup and form | title.css, TitleScreen.js, index.html |
| Save slots | Compact cards fit 375×667 with the notch; more slots scroll with an edge fade (`scrollEdgeCue.js`) | slotPicker.css |
| Home base, upgrades | Compact detail (three rows show at 375×667); "Needs …" marks an upgrade that waits on another (all layouts) | mobileUpgrade.css, MobileUpgradeMenu.js |
| Card screens | Difficulty, blessings, rewards, boss recruit, lord arrival, mercenaries: full-width rows in one list, soft edges where the list continues, the chosen card kept in view | choice.css, choiceCards.js |
| Route map (Loom) | Runs bottom to top over a bottom sheet (card, Travel, then Menu/Roster in both visual and focus order); the in-battle campaign map too | loomModel.js, RouteGraph.js, loomThreads.js, loom.css |
| Reference menus | Compendium / Help / How to Play: list then full-width entry with Back; categories and filters are one sideways strip each; a one-page Help category opens directly | ReferenceMenu.js, cohesion.css |
| Roster sheet | Unit strip over a full-width detail; two stat pairs per row | mobileRoster.css |
| Trade | The two holders stack, full width, each scrolling on its own (even split; unused room goes to the other). Up/Down cross between holders where they meet; Left/Right switch holders. Turning the phone keeps the held item and focus | trade.css, TradeMenu.js |
| Services | Shop stacks stock over detail; Ruins: Rest and Scavenge as full-width cards with what each gives and costs; church, arena and colosseum in one column | shopMenu.css, ChurchMenu.js |
| Ceremonies | Boss, recruit and deed cards stand the bust over a full-width band; the promotion rite takes the whole screen (figure over words); the level-up card puts the portrait in its header corner; "a · b · c" lines wrap between parts (`partedLine`) | ceremony.css, growth.css, deeds.css, ceremonyDom.js, GrowthCeremonyController.js |
| Dialogue, run end | The face floats beside the first lines; Skip and Continue share the bottom row. Run result: one full-width list | cohesion.css, runFlow.css |
| Settings, pause, records | Settings fills the screen; pause and records unchanged | cohesion.css, SettingsMenu.js |

## Limits

- Switching orientation mid-battle restarts the battle music track.
- A tablet that chooses Play upright gets the phone layouts, stretched.
- Browser emulation cannot prove real Safari pointer detection, touch, safe areas or OS rotation; the TestFlight device checklist covers those.

## Tests

- Unit: `tests/BoardOrientation.test.js` (transform, adjacency, arrows, hit-testing, footprints), `tests/PortraitBattle.test.js` (preference, default, link, shells, Settings gate, canvas sizing, the switch gate), `tests/BattlefieldLabResize.test.js`, `tests/InputGeometryInvalidation.test.js`, `tests/InputReleaseWithoutPress.test.js`, `tests/PortraitCssGating.test.js`, `tests/TitleUpright.test.js`, `tests/CeremonyUpright.test.js`, `tests/PortraitListLayout.test.js`, `tests/MobileCommandSpans.test.js`, `tests/MobileBattleHint.test.js`.
- Browser (`portrait` lane in `tests/e2e/lanes.json`, helpers in `tests/e2e/portraitHelpers.js`: phone contexts on the real default path, safe-area emulation, no sideways scroll, 44 px uncovered controls, single-line labels, clipped text): `portrait-battle`, `portrait-rail`, `loom-portrait`, `portrait-cards`, `portrait-lists`, `portrait-screens`, `portrait-trade`, `portrait-services`, `portrait-ceremonies`, `portrait-journey`, `portrait-rotation`.
  - **Presentation invariance:** a saved battle resumed twice, one run turning the phone upright and back, both then play the same enemy phases; the full domain state and the RNG must match after every phase.
  - Every upright spec also checks that landscape phones (568×320, 667×375, 844×390) and desktops (640×480, 1280×800) are unchanged.
