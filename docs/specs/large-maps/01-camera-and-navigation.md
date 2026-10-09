# Large maps 01: camera and navigation

Status: proposal, revision 2 (2026-10-09). Takes in the cross-review of the spec set.
Specs only: no game code or data changes yet.
Branch `claude/large-maps-specs`. Shared names, pillars and size bands are in
[`README.md`](README.md); this spec follows them.

This spec does three things:
- It gives every device one battle camera.
- It moves that camera for the player when something they can see happens out of view.
- It adds the navigation a 24x16 board needs, and hardens the rendering that grows with
  the board.

Today's maps must look and play exactly as now unless the player zooms.

## 1. Where we are

Line numbers are from 2026-10-09 and drift. "BS" is `src/scenes/BattleScene.js`.

### 1.1 The camera

| Fact | Where |
|---|---|
| The camera exists only when `mobileCameraEnabled`, which defaults to `isMobile` (coarse pointer or a mobile user agent) | `runtimeFlags.js:28-37`, `:73-77`; BS:1463-1470 |
| Without the flag `_setupBattleCameraSystem` returns early: no `_battleCamera`, no UI camera, and `_pinToScreen` does nothing, not even `setScrollFactor(0)` | BS:3630-3638, BS:3793-3802 |
| Desktop is a fixed 640x480 canvas, `Scale.FIT` to the window; the grid is centred on the main camera once, at construction | `main.js:501-521`, `Grid.js:532-535` |
| `BattleCameraController` is touch only (one-finger pan past 10 CSS px, pinch, pinch-out resets). It clamps the *open* view (less docked insets, today only the prologue coach) and offers `ensureWorldVisible` | `BattleCameraController.js:157-301`; BS:3650 |
| The phone layout (`BattlefieldLab`, every mobile runtime) uses a landscape canvas 480 tall and a portrait canvas 640 wide. Zoom runs from `max(0.5k, fit)` to `max(3k, 2.5 fit)`, and a battle opens on the whole board | `BattlefieldLab.js:32-46`, `:70-76`, `:150-156` |
| Recenter frames the selected unit or the army at 34 CSS px a tile (30 if that fits the party). Portrait hides it | `BattlefieldLab.js:186-208`, `deploymentCamera.js:2-24`, `portraitBattle.css:373-381`, `portrait-battle.spec.js:125-126` |
| A device-resolution backing store exists only as a dev switch | `BattlefieldLab.js:14-25` |
| Only these move the camera: the gamepad cursor (`selectUnit` snaps it to the unit, BS:4742), Formation, the unit locator and the history viewer. That cursor pans through `ensureWorldVisible` with a 1.5-tile margin | `GridCursorController.js:4`, `:93-95`; `FormationController.js:783`; `UnitLocator.js:46-51`; `BattleHistoryRenderer.js:148-173` |
| Nothing moves the camera in the enemy phase, and a hidden enemy still tweens | BS:10535-10578, BS:10701 |

The evaluation (README §1) measured the Overview of a 20x13 board at 24.3 CSS px a tile on
an 844x390 phone and 23.3 upright. Scaled from those figures, 24x16 is about 20 and 19.
Readable is 30.

### 1.2 Input already bound in a battle

**Keys** (BS:1401-1413):
- T pin threat, N next ready unit, V details, E end turn, Esc cancel, R rewind/loot
  roster, O roster, D Danger, W Canto wait, backtick the dev overlay (BS:1443).
- Left/Right cycle the forecast weapon. They only act in `SHOWING_FORECAST`
  (`AttackFlowController.js:563-567`).
- Up/Down/Enter drive the unit menu, target selection, the forecast
  (`AttackFlowController.js:600-622`) and the area-centre picker
  (`AreaTargetingController.js:360`).
- The timeline's map mode pans its own view 32 px per arrow press
  (`BattleTimelineView.js:186-191`).
- Free letters: A B C F G H I J K L M P S U X Y Z, plus digits, `+ = -` and Home.
- The arrows are free in `PLAYER_IDLE`, `UNIT_SELECTED`, `CANTO_MOVING`, `ENEMY_PHASE`
  and Formation.

**Pointer:** a mouse click acts on release, a right click on press
(`InputController.js:286`, `:290-361`); touch taps have a 12 px threshold (BS:1840); the
wheel scrolls the equip menu (BS:6955-6963) and a picker (BS:11490).

**Gamepad** (`GamepadReader.js:15-30`): R2, Select, L3, R3 and the right stick are unused.

**Hold to fast-forward** is only on the phone rail (`MobileBattleHUD.js:261`), read by
`battleSpeed()` (`combatTiming.js:44-50`).

### 1.3 Placed in screen space from a world point, once

The action menu (BS:6012-6027), the inspection tooltip (`UnitInspectionPanel.js:39-50`),
the forecast panel (`ForecastOverlay.js:163-164`), bubbles (`BattleBeatsController.js:194-236`),
guidance notes (`GuidanceController.js:388-399`), the coach (`PrologueCoach.js:293-295`),
the EXP gauge (`XpGaugeController.js:307-315`), Formation (`FormationPanel.js:127`) and
map-framed bands (`ceremonyDom.js:132-152`).

Pinned UI is laid out from the main camera's size: 192 reads of
`cameras.main.width/height` in 25 battle UI files. Some canvas overlays hard-code 640x480
(`LootScreenController.js:106`, `UnitDetailOverlay.js:61`, `PauseOverlay.js:128`,
BS:5420). `CombatFxController.zoomPunch` (desktop only) resets the zoom to exactly 1
(`:636-650`), and `AtmosphereController` keeps its own desktop UI camera until a pinned
one exists (`:174-205`).

### 1.4 Rendering that grows with the board

- **Terrain:**
  - One Image per tile, framed from one painted canvas: 48 px a cell on phones.
  - Desktop also resamples to 32 px, "one texel per world pixel" for "a fixed 1:1 desktop
    camera" (`BattlefieldArt.js:166-172`, `:255-282`).
- **Fog:**
  - One Rectangle per tile.
  - Every tile is re-shaded on each update, each through a `safeBattlePresentation`
    closure (`Grid.js:917-925`, `fogState.js:7-28`).
- **Danger:**
  - Five instances: BS:2030, `InputController.js:1020`, `:1059`,
    `PinnedThreatController.js:9`, `PrologueController.js:1746`.
  - Each has two board-sized render textures, created on first show and only cleared on
    hide (`DangerZoneOverlay.js:101-131`, `:217-224`).
  - Hatching is 1-world-px lines in NEAREST textures, which alias below scale 1.
- **Pin sweep:** any add or remove makes the next frame walk the whole top-level display
  list, about 750 objects at 20x13 (BS:3606-3618, `:3757-3791`).

### 1.5 Found while reading (not confirmed in a browser)

1. **Desktop drift after [N].**
   - `locateUnit` centres the main camera on a unit within 12% of the view's edge, with
     no controller to clamp (`UnitLocator.js:29-50`).
   - Desktop HUD plates are not pinned.
   - On an 18x13 board, [N] on a column-0 unit should shift the whole battle, plates
     included, about 270 px, and leave it there.
   - `ux-rail-and-info.spec.js:154` checks the selection but not the view.
2. **Fog leak.** The enemy heal banner names its target with no visibility check
   (BS:10447-10456).

## 2. Design

### 2.1 One camera on every device

- `BattleCameraController` is built in every battle.
  - The flag becomes `battleCameraEnabled` (default true).
  - An explicit `mobileCameraEnabled: false` startup override still turns it off.
  - `isMobileInput` keeps choosing the HUD.
  - The pinning, `isCameraGestureAllowed` and `resetBattleCameraView` check the
    controller, not the flag.
  - Touch gestures stay in the controller, so a touch laptop gets pinch and pan, and the
    canvas gets `touch-action: none` everywhere.
- **Mouse, keyboard and gamepad** go through a new `ui/DesktopCameraInput.js`
  (`create`/`destroy`). It calls the controller, which stays the one owner of scroll, zoom,
  clamping and insets.
- **The pure module.** `src/utils/battleCameraFraming.js` (no Phaser) absorbs
  `deploymentFrame` and the lab's zoom-limit and Recenter arithmetic. It adds:
  - `homeView`, `fitZoom` and `zoomAt`;
  - `frameRect(rect, view, { insets, margin })`, which returns null when the rect is
    already comfortably visible;
  - the enemy-beat planner (§2.7);
  - the pointer layout (§2.8).
- **Insets become a list:**
  - the coach;
  - the desktop forecast panel;
  - the upright forecast sheet;
  - the desktop HUD plates, above home zoom only (§2.3).
- **Pinning audit.** Desktop has never had the UI camera.
  - `_isAutoPinCandidate` (BS:3733-3755) will start sorting its overlays: depth 500 and
    up is screen UI, and 100–200 only on the named list.
  - A unit test lists every object a desktop battle creates at depth ≥
    `UI_DEPTHS.SCREEN_UI`. Each must be pinned, `_forceWorldCamera`, or on a short
    allowlist of world-anchored ones: condition badges at 200 (BS:10656), and terrain
    damage floats at 320 (BS:10211, :10244).
- **Visual delta to check.** The pinned camera replaces the atmosphere's desktop UI camera,
  as it already does on phones (`AtmosphereController.js:191-196`). Unpinned world objects
  at depth 100–499 then take the atmosphere grade. The art lane checks it.
- **Zoom punch** stays desktop-only. It pulses relative to the resting zoom and restores
  that zoom. It is skipped during a gesture or pan.

### 2.2 The desktop canvas

| | A: 640x480 logical, camera inside it | B: widescreen, 480 tall | C: device resolution (k > 1) |
|---|---|---|---|
| Overlay changes | none | the hard-coded 640x480 overlays need a centred band, and the HUD must read it | every pinned-UI read of the main camera's size (192 reads) moves to a logical `uiViewport()` |
| 24x16 whole-board zoom | 0.79 | 0.875 at 16:9 | as A or B, sampled at about 2x |
| Effort | small | medium | large |

**Recommendation: A now, B after an overlay audit, C only if the owner pays for
`uiViewport()`.**
- A's cost is sampling below zoom 1: a 32 px sprite at 25 canvas px drops about one row
  in five.
- Size is not the problem. At FIT 1.67 (a 1280x800 window), a 24x16 board at fit is
  still 42 CSS px a tile, and tactical zoom is pixel-exact.
- **Terrain on desktop:** the tiles draw from the 32 px resample below zoom 1.25 and from
  the 48 px source above it. Both canvases already exist on desktop
  (`BattlefieldArt.js:255-282`). One `setTexture` per tile on crossing; no new memory.

### 2.3 Views

- **Home view.**
  - A board that fits at zoom 1 (width ≤ 640 and height ≤ 480 world px: every
    `mapSizes.json` entry up to 20x13) opens at zoom 1, centred. That is today's picture.
  - Pan does nothing there (`_clampAxis` centres it), and auto-framing finds nothing
    off-screen.
  - The plates join the insets only above home zoom.
- **Overview** is the whole board, with half-tile margins:
  - desktop `minZoom = min(1, fit)`;
  - phones as today.
- **The opening view** is Overview (home on desktop) on every device; this is README
  question 5 (§6).
  - At 24x16, desktop fit is 42–57 CSS px a tile on common windows.
  - On phones the first selection, Recenter or jump goes to tactical zoom.
- **Tactical zoom:**
  - desktop 1;
  - phones 34 CSS px a tile.
- **Maximum zoom:** desktop 2.5; phones unchanged.
- **Recenter:** desktop C and the hint line; phones the existing tool.
- **Overview toggle** (desktop Z, gamepad Select): the first press saves the view and goes
  to Overview; the second restores it.
- **Desktop setting "Map camera: Auto | Fixed".** Fixed pins the zoom to home and turns off
  auto-framing. A board that does not fit ignores it.

### 2.4 Desktop input

- **Wheel** zooms at the cursor.
  - ×1.15 a notch. A fractional `deltaY` (a trackpad pinch arrives as `ctrlKey` wheel)
    zooms continuously by `exp(-deltaY × 0.01)`.
  - The world point under the cursor stays put.
  - It is ignored while the equip menu or picker is open, over a pinned interactive
    object, or when `isCameraGestureAllowed()` is false.
- **Drag pan.**
  - **Middle button:** always pans.
  - **Left button:** pans when the press began on the board.
    - The threshold is 6 CSS px, converted with the touch pan's canvas ratio
      (`BattleCameraController.js:263-266`).
    - Past it, the release is consumed and `onClick` does not run. Below it, the click is
      unchanged.
  - Hover info and the path preview pause while dragging.
  - **Right button:** never pans. It acts on press.
- **Edge pan:** not built. The HUD plates sit at the canvas corners
  (`DesktopBattleHud.js:9-15`). Open question 7.
- **Keyboard:**
  - Arrows pan a tile a press and 8 tiles a second held, only where they are free (§1.2)
    and never after `preventDefault`.
  - `+`/`=` and `-` zoom around the centre.
  - Z Overview toggle, C Recenter; the jump keys are in §2.8.
- **Gamepad:**
  - The right stick pans at up to 10 tiles a second; the reader gains a continuous
    `input:camera` action `{ x, y }`.
  - Select toggles Overview, R3 recenters, L3 and R2 are jumps.
- `DESKTOP_HINT_SEGMENTS` and the Help controls page gain "wheel: zoom · drag: pan · [Z]
  overview · [C] center". `fitHintSegments` drops what does not fit.

### 2.5 Screen-anchored UI

Menus and panels are screen UI: they stay where they opened.

What points at a tile follows it:
- notes and tips;
- bubbles;
- the EXP gauge;
- the tooltip;
- Formation;
- pointers.

They re-place themselves on a new scene event, `battle-camera-changed`. It is fired from
the controller's `onViewChanged`, which today only syncs the phone's reset button. Each one
already computes its point through `_worldToScreen`, so each change is a re-call.
Map-framed bands keep the frame they opened with.

**A pointer press settles the camera.**
- `pointerdown` jumps any running automatic pan to its end before the press is recorded,
  and no automatic pan starts while a pointer is down.
- A tap therefore resolves on the geometry the player saw. This is the camera's
  counterpart of `invalidatePointerGestures` (`InputController.js:246-256`).

### 2.6 Player-phase framing

This is part of "Camera follow" (§3). It does nothing at Overview and never changes zoom.

- **Select:**
  - Let R be the drawn move tiles plus the attack tiles (player-knowledge positions, as
    today).
  - If R's bounding box fits the open view, make the minimal pan that holds it, with half
    a tile to spare.
  - Otherwise keep the unit two tiles inside.
- **Forecast:** its panel or sheet is an inset, and both combatants are brought into the
  open view above it. Closing does not pan back.
- **Targets:** cycling brings the target into view. The gamepad already does this
  (`AttackFlowController.js:133`); mouse and keyboard get the same call.
- **Guidance:** a note with a tile anchor brings the anchor into view before measuring it.
  `guide_objective_changed` therefore shows the throne (`GuidanceController.js:304-314`).
- **Timing:** pans last 160 ms (a cut under Reduced motion). They go through
  `_awaitSceneTween` with a timeout, as enemy steps do (BS:10560-10570).

### 2.7 Enemy-phase camera

`ui/EnemyCameraController.js` is driven from the `startEnemyPhase` callbacks
(BS:10418-10505). The planner is pure.

A beat's subject is only what the player sees at that moment ("known" means
`PlayerKnowledge.isKnown`, via `battleKnowledge.js:9-15`):

| Beat | Subject |
|---|---|
| move | path tiles where `grid.isVisible` |
| attack, status staff, heal, wall break | actor if known, target if known (the tile, for a wall) |
| arrivals | arrivals whose graphic is visible (`ReinforcementPresenter.js:47-50`) |
| holders woke | woken units passing `canInspectUnit` (BS:10429) |
| Entity rally line | the speaker |

**Rules:**

1. **Fog.**
   - No subject means no move. The plan reads only seen tiles and known units, so worlds
     that differ by a hidden unit plan alike.
   - A hidden archer hitting a seen ally frames the ally, never the midpoint.
2. **Skip.** Nothing moves when the subject is inside the open view less 12% a side
   (`UnitLocator`'s margin). At Overview nothing ever moves.
3. **Never zoom.**
4. **Target.**
   - Centre the subject's bounding box if it fits.
   - Otherwise make a minimal pan to the action's target, or the move's last seen tile.
5. **Moves.**
   - The pan starts in the synchronous `onDecision`, and `animateEnemyMove` awaits it
     before the first step.
   - A seen path that does not fit is followed: each seen step that leaves the comfortable
     box tweens the scroll by its delta over the step's own duration.
   - Hidden steps never move the camera.
6. **Combat, staves and heals:** framing finishes before `_runCombatResolution` or the
   banner.
7. **Arrivals.**
   - If no seen arrival is comfortably visible, pan to the fitting box that holds the most
     seen arrivals. A tie goes to the box nearest the commander.
   - The rest get pointers (§2.8).
8. **Speed.**
   - Duration is `waitDuration(scene, 'camera_follow_pan', 220)`, with the label added to
     `COMBAT_WAITS` (`combatTiming.js:4-41`). It scales with Normal/Fast/Instant and hold
     exactly as move steps do; Instant is a cut.
   - Reduced motion is always a cut.
9. **The player takes over.** Any camera input or jump during the phase ends following for
   that phase and cancels the return. `isCameraGestureAllowed` already allows
   `ENEMY_PHASE`.
10. **Return.**
    - The view saved at phase start is restored after the last action and the
      reinforcements, before the player phase begins. That happens only if the follow
      camera moved it and the player did not take over.
    - Turn-start banners and notes therefore measure the restored view.
    - A resumed phase has no saved view.
11. **Presentation only.**
    - No state changes, no `Math.random` (the reason camera shake is banned,
      `CombatFxController.js:654-659`), and failures go through `safeBattlePresentation`.
    - A superseded phase (BS:10388-10394) stops the pan where it is and skips the return.
    - The camera waits while a tile-anchored note or bubble is open.
12. **Off.** "Camera follow: Off" disables this. Jumps still pan.

**Spec 02.**
- Pans are added only for seen, off-screen actions: about 0.22 s each at Normal.
- The fixed 300 ms between enemies (`AIController.js:126-129`) and hidden tweens are 02's
  Phase 0 work. The planner reads only the decision, so it works with today's delay or 02's.
  If 02 moves the decision ahead of the pause, the pan overlaps it.
- A desktop hold key is 02's to add. `battleSpeed()` makes the camera honour it.

### 2.8 Navigation

**Objective markers.**
- `ui/ObjectiveMarkerController.js` draws every anchor from one pure list,
  `objectiveMarkers(battleConfig, state)` → `{ id, kind, tiles, label, primary }`.
- Legacy configs supply:
  - `thronePos` (today the 8 px "SEIZE" text at depth 5, BS:1771-1782);
  - `escapeTiles` (`EscapeObjectiveController.js:26-49`);
  - the village;
  - the recruit beacon.
- 03 adds its objectives' resolved anchors. 03 owns which objectives exist; this spec owns
  how they are marked and pointed to.
- Markers sit at `OBJECTIVE_TILE`/`OBJECTIVE_LABEL` depth over fog. Below zoom 1 labels
  scale by `1/zoom` to stay 12 CSS px.

**Off-screen pointers** (`ui/OffscreenPointerController.js`, laid out by
`offscreenPointers(items, view, { max: 4 })`).
- **What gets a pointer**, by priority:
  1. the primary objective (the throne, the exit cluster nearest the army, 03's primary
     anchors);
  2. the commander (`findCommander`, `engine/Commander.js:73`), promoted to first at half
     HP or less;
  3. known bosses;
  4. the last enemy phase's seen arrivals, until that player phase ends;
  5. the active bonus objective;
  6. a recruit NPC.

  Unknown units never get one.
- **How many:** at most 4 pointers are on screen at once (`max: 4` in the layout call). This
  is the one statement of the cap; spec 03 cites it. Pointers within 28 CSS px on one edge merge, show a count, and
  target the higher priority.
- **Look:**
  - a 20 px chevron disc 6 px inside the open view's edge, on the ray from the view centre;
  - colour by kind: objective accent, commander info, boss and arrivals bad, bonus good,
    NPC green;
  - a glyph;
  - hover or long press shows "Throne · 9 tiles".
- **Placement:** 44 CSS px touch target, pinned at depth 120.
- **When hidden:** at Overview, in the forecast, behind modal overlays and at
  `BATTLE_END`.
- **Tap:** pans to centre the target at the current zoom (220 ms, a cut under Reduced
  motion). It never selects.
- Pointers recompute on `battle-camera-changed` and after each action.

**Jumps.**
- **Desktop:** N next ready unit (as now) and Shift+N previous; L the commander; B a known
  boss (nothing when none is in sight); G cycles the objectives.
  - Shift+N applies only in the player phase. Shift held alone is fast-forward, and only in
    `ENEMY_PHASE` (02 §2.5), so the two never collide.
- **Gamepad:** L1/R1 as now; L3 the commander; R2 the objectives.
- **Phones:**
  - pointers;
  - 03's strip rows (tap to pan);
  - Recenter;
  - a **Next unit** cell beside Danger in the idle dock when two or more units are ready.
    It uses the end-turn prompt's `nextReadyUnit` walk (`MobileBattleHUD.js:1215-1238`).
- **Clamping:** `locateUnit` and `focusTile` clamp through the controller and judge comfort
  against the open view. That fixes §1.5.1.

**Show exits** (`EscapeObjectiveController.js:52-55`) frames the exits at the largest zoom,
up to the current one, that fits them. It falls back to Overview (today's behaviour)
below the readable zoom.

### 2.9 Overview, not a minimap

Recommendation (README question 6): no minimap now.
- Overview is already a map, at 19–20 CSS px a tile on phones at 24x16.
- A corner minimap there would be 3–5 CSS px a tile, unreadable for fog, faction and the
  view rectangle, and would cost a rail cell or cover the board.
- Pointers, jumps and 03's strip carry the rest.
- Revisit after the Phase 4 playtests. If it is built: a DOM canvas in the rail
  (terrain classes, known units, view rectangle), about two days.

### 2.10 Portrait

- **Recenter returns when needed.**
  - The lab sets `bl-needs-recenter` on the wrapper when the Overview tile is under
    30 CSS px (`deploymentFrame`'s readable figure).
  - The hiding rule (`portraitBattle.css:379-381`) and its columns apply only without it.
  - On a 390 px phone that is a short side above about 12 tiles: today's 13-row boards
    sit near the line (about 28 CSS px), and every set piece is over it.
- **Large upright boards.** The presentation transform (`boardOrientation.js`,
  `rotationForPlayerSide`) is unchanged.
  - A 24x16 board stands 16 cells wide and 24 tall, so panning is mostly vertical.
  - Tactical zoom shows about 11 by 16 cells.
- Markers, pointers and framing work from `gridToPixel` in screen space, so rotation needs
  nothing. The upright sheet and coach are insets.
- An orientation re-open (`portrait-battles.md`) starts on the opening view. Views are never
  saved.

### 2.11 Low-zoom readability

- **Desktop** (§2.2): today's boards never go below zoom 1. A 24x16 Overview samples at
  0.79, or 0.875 with B.
- **Phones: device resolution** is the real fix, and it costs fill rate.
  - An 844x390 @3x phone at k = 2.44 draws 5.9 times the pixels, into a 2110x1170 canvas
    (9.9 MB).
  - Capped at k = 2 it is 1730x960 (6.6 MB).
  - Recommendation: a startup flag, on by default only for boards whose fit is below 1/k.
    Only after enemy-phase frame time p95 is 20 ms or less at 24x16 on the throttled
    iPhone 13 profile.
- **Minimum zoom:** phones keep `max(0.5k, fit)`, and within the bands fit binds (0.875 at
  24x16 landscape). Desktop is `min(1, fit)`.
- **Danger hatching.**
  - With effective scale s = zoom × k below 0.8: 2-world-px lines, spacing ×1.75, edges
    ×1.5. Today's values otherwise.
  - Re-bake on crossing, 150 ms after a gesture ends (1–4 ms, README §1).
  - The `tiles` descriptors do not change.

### 2.12 Rendering hardening and budgets

1. **Fog texture.**
   - A `cols × rows` canvas texture, one texel per drawn cell, shown as one NEAREST Image
     scaled by `TILE_SIZE` at depth 3.
   - `paintFogOverlays` writes the same alphas (0, 0.3, 0.7) and refreshes once.
   - Grid-like objects that carry per-tile rectangles keep them, because checkpoint and
     rewind restores call it (`fogState.js:1-3`, `:40-46`).
2. **Danger textures.**
   - Focus overlays (idle, planning, prologue reach) size their pair to the bounding box of
     what they draw, and grow only when needed. One reach at MOV 5 + 2 is about 15x15
     tiles: 488x488, 0.95 MB a texture.
   - Global and pinned stay board-sized; they show together, so they cannot share.
   - The focus overlays share one pair only if PR 6's test proves they are never visible
     together.
3. **Pin sweep.**
   - `ADDED_TO_SCENE` queues the object, and `prerender` classifies the queue once depths
     are final.
   - `_pinToScreen` classifies directly, and removal drops the object.
   - The full sweep stays for UI-camera creation and as the test oracle.
4. **No culling.** With the fog texture a 24x16 battle is about 650–700 objects, and
   same-texture tiles batch. PR 6 adds a frame-time probe; culling is revisited only above
   20 ms p95.

Texture bytes = width × height × 4:

| Item | 18x13 | 24x16 today | 24x16 after |
|---|---|---|---|
| Terrain, phone (48 px a cell) | 2.16 MB | 3.54 MB | same |
| Terrain, desktop (source + resample) | 3.12 MB | 5.11 MB | same |
| Danger, up to 10 textures alive | 9.9 MB (584x424 each) | 16.1 MB (776x520 each) | 3.2 global + 3.2 pinned + about 1.9 per focus overlay shown |
| Fog | 234 Rectangles | 384 Rectangles | 1 Image, 1.5 KB |

PR 6 adds a "Battle board at 24x16" section to `docs/mobile-memory-budget.md`, measured
with its probe.

## 3. Settings and persistence

- **`cameraFollow: 'auto' | 'off'`** (default `auto`; Settings → Battle "Camera follow").
  - It covers §2.6 and §2.7.
  - It is normalized in `SettingsManager.js:19-50` and syncs through `user_settings`.
- **`mapCamera: 'auto' | 'fixed'`** (desktop row only).
  - It is stored as `auto` so a sync never forces Fixed on another device, as `atmosphere`
    does (`SettingsManager.js:44-47`).
- **Camera state is presentation.** Scroll, zoom and the saved views never enter the
  checkpoint, the rewind snapshot or a save, and no engine module may read them (§4). A
  resume opens on the opening view.

## 4. Tests

**Unit:**
- **`BattleCameraFraming.test.js`.** Values are derived by hand:
  - home is zoom 1, centred, for every `mapSizes.json` entry (checked against
    width ≤ 640, height ≤ 480);
  - 24x16 fit is 0.79;
  - `zoomAt` keeps the cursor's world point;
  - `frameRect` is null when the rect is comfortably visible;
  - insets shift the open view;
  - `deploymentCamera.test.js` moves here.
- **`DesktopCameraInput.test.js`:**
  - a 5 px left drag clicks;
  - a 7 px drag pans and does not click;
  - a middle drag pans;
  - a right click inspects on press;
  - the wheel scrolls the open equip menu;
  - Left in the forecast cycles the weapon;
  - arrows pan in `PLAYER_IDLE`.
- **`EnemyCameraPlan.test.js`:**
  - paired worlds differing by a hidden unit plan alike for a move, an attack, a heal and
    arrivals;
  - a hidden attacker frames the target only;
  - an all-hidden beat, a visible subject and Overview give no plan.
- **`CameraPresentationInvariance.test.js`** (as `HealthPresentationInvariance.test.js`):
  - one scripted enemy phase with follow on, off and with no camera leaves identical domain
    state and the same `Math.random` cursor;
  - a spy proves the camera draws no `Math.random`.
- **`OffscreenPointers.test.js`:** the cap and priority, merging, the commander promotion,
  no unknown units, nothing at Overview.
- **`FogTexture.test.js`:** pins today's per-tile alphas first (rotated boards and contacts
  included), then requires the texture to match.
- **`DangerBands.test.js`:** the box covers every tile, a band change re-bakes, and `tiles`
  is unchanged.
- **`PinSweepIncremental.test.js`:** the incremental result equals the full sweep over a
  scripted add/remove/`setDepth` sequence.
- **`DesktopPinAudit.test.js`** (§2.1).
- **`UnitLocatorClamp.test.js`:** without a controller the camera is untouched. It fails
  before the fix.
- **`CameraStateBoundary.test.js`:** no `src/engine` file reads `_battleCamera` or
  `cameras`.

**Browser:**
- **Tile points.** 47 files in `tests/e2e` turn tiles into screen points with
  `gridToPixel`/`_worldToScreen`. Only `prologueDriver.js:113-128`,
  `portraitHelpers.js:340-344` and `portrait-prologue.spec.js` bring the tile on screen
  first.
  - The other 44 specs pass only while the camera stays at the opening view, where
    auto-framing finds nothing to move. Specs that zoom (`deployment-camera`,
    `battlefield-lab`, Recenter flows) are exposed today.
  - PR 2 adds `tests/e2e/boardPoints.js`: `tilePoint(page, col, row)` (`ensureWorldVisible`
    on the open view, then world to CSS) and `clickTile` / `tapTile`.
  - `prologueDriver` and `portraitHelpers` call it, and the 44 specs migrate.
  - A Vitest scan (`E2eBoardPoints.test.js`) fails any `*.spec.js` that calls
    `_worldToScreen` or `worldToScreen` itself.
- **Dev route.** `labSize=24x16` beside `labMap` (DEV only, BS:1521-1540) hands
  `generateBattle` a one-entry `mapSizes` for the act. `pickMapSize`'s single draw
  (`MapGenerator.js:608-622`) is kept, so the seed's map differs only in size.
- **New specs**, each in a `tests/e2e/lanes.json` lane, with `npm run check:e2e-lanes`
  green:
  - **`desktop-camera.spec.js`** (battle-input, 1280x800):
    - 18x13 opens at zoom 1, scroll 0, plates unmoved;
    - 24x16 opens whole;
    - the wheel keeps the cursor's tile;
    - a small drag still selects;
    - plates stay put while panning;
    - [N] on a column-0 unit keeps the plates;
    - Z and C round trip.
  - **`enemy-camera.spec.js`** (presentation):
    - a hidden mover leaves the scroll unchanged;
    - a seen off-screen attacker comes into view;
    - Off never moves the camera;
    - the next player phase opens on the saved view;
    - Instant cuts.
  - **`offscreen-pointers.spec.js`** (battle-input): the throne and the commander off-screen
    give two pointers, a tap brings the throne into view, and Overview shows none.
  - **`portrait-large-board.spec.js`** (portrait): 24x16 upright shows Recenter, a real tap
    after a pan selects the tapped tile, and landscape and desktop are unchanged.
  - `portrait-battle.spec.js:125-126` stays as it is: its board's Overview is over 30 CSS px.
- Waits are on state (a settled flag on the controller), never on time.

## 5. PRs

| # | PR | Effort |
|---|---|---|
| 1 | `battleCameraFraming.js` extracted, no behaviour change; the `locateUnit` clamp fix with its failing-first test | 1 day |
| 2 | `boardPoints.js`, the 44-spec migration, the scan, `labSize` | 1.5 days |
| 3 | Desktop camera core: the controller and UI camera everywhere, home and Overview, Fixed, pin audit, zoom punch, terrain band swap | 2.5 days |
| 4 | Desktop input: wheel, drags, keys, right stick, Select and R3, hint line and Help | 2 days |
| 5 | `battle-camera-changed`, re-anchoring, the insets list, settle-on-press, player-phase framing, `cameraFollow` | 2 days |
| 6 | Fog texture, danger boxes and bands, incremental sweep, frame probe, memory doc | 2 days |
| 7 | Enemy-phase camera with return and the invariance test; after 02's delay PR if ready (it works either way) | 2.5 days |
| 8 | Markers, pointers, jumps, the phone Next cell, Show exits framing; 03's objectives once they exist | 2.5 days |
| 9 | Portrait Recenter and large upright boards | 1 day |
| 10 | Later, after measurement or decision: phone device resolution; desktop widescreen (B) | 2–4 days each |

PRs 1 and 2 come first, because every later PR moves the camera. PR 6 is independent after 1.

**Sequencing for the set pieces.**
- The first two set pieces (The Mill Ford, Two Towers, both 20x12) fit the desktop at zoom 1
  (640x480 / 32 px = 20x15). They need only PR 1 (the [N] / `UnitLocator` clamp) and, on
  phones, PR 8 (the off-screen pointers).
- The desktop camera (PRs 3-5), enemy-phase follow (PR 7) and pointers (PR 8) are required
  before Long Road to the Keep (22x14) and The Emperor's Parade (24x14).

**Deferrable for the first shipment.** None of these blocks a set piece, and each may be
dropped or postponed:
- widescreen rendering (B, §2.2) and device-resolution rendering (C, §2.2, §2.11): PR 10;
- the desktop "Map camera: Fixed" setting (§2.3, §3) and its row in PR 3;
- the minimap debate (§2.9, open question 2): no minimap is built.

## 6. Open questions for the owner

1. **Desktop opening view** (README question 5). Recommended: the whole board. It is
   today's view for every current map, readable at 24x16 on desktop, and the phone rule.
   The alternative is tactical zoom on the army.
2. **Minimap** (README question 6). Recommended: none until after the Phase 4 playtests.
3. **Widescreen desktop (B)**: is it worth the overlay audit?
4. **Device resolution:** fund `uiViewport()` for desktop (C)? Turn the phone path on for
   large boards after the frame-time pass?
5. **Settings:** one "Camera follow" switch, or separate ones for the enemy phase and
   selection framing?
6. **Commander pointer:** always when off-screen, or only when hurt?
7. **Edge pan:** skip (recommended), or offer it off by default?
8. **Left-drag pan:** keep it (with 6 px), or middle-drag only?
9. **After the enemy phase:** return to the player's view (recommended), or stay on the last
   event?

## 7. Notes for the README

All items below were adopted in README revision 2 and are resolved.

- **Resolved:** §6 questions 5 and 6 now carry 01's recommendations (the whole board; no
  minimap until the first set pieces are playtested).
- **Resolved:** the anchors field is `battleConfig.anchors`, `{ <name>: { tiles } }`. 01
  reads it for markers and pointers.
- **Resolved:** Phase 0 gets the desktop [N] drift (§1.5.1) and the heal banner that names
  hidden enemies (§1.5.2).
- **Resolved:** the "20x15" wording. It is the 640x480 canvas at zoom 1 with no margin.
  Today's 20x13 already has the desktop plates over its corners.
- **Resolved:** Phase 1 does not wait for Phase 0. The enemy-phase camera works without
  Phase 0's delay change (§2.7); only the wall-time saving combines.

## Revision 2 changelog (2026-10-09)

- §2.8: Shift+N (previous unit) is player-phase only; Shift held alone is 02's fast-forward
  in `ENEMY_PHASE`.
- §2.8: the cap of 4 off-screen pointers is stated in one place (spec 03 cites it).
- §5: added the sequencing note (Mill Ford and Two Towers need only PR 1, plus PR 8 on
  phones; Long Road and the Parade need PRs 3-5, 7 and 8) and the deferrable list (widescreen,
  device resolution, Fixed, minimap).
- §7: the README items revision 2 adopted are marked resolved.
