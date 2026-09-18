# UI cohesion checkpoint review response

Base reviewed: `8ad908d`. Follow-up: September 18, 2026.

## Plan and disposition

1. Validate input regressions in the actual DOM path; restore intended keyboard/controller behavior without forwarding keys into covered Phaser scenes.
2. Make development and production use one ordered stylesheet; check built-bundle typography and primary-action contrast.
3. Correct route framing and padded text tables; restore onboarding and remove unnecessary hidden canvas rendering.
4. Check remaining modal/service/asset-loading issues, then run unit, browser, and production checks and add those checks to CI.

## Confirmed and corrected

| Finding | Correction |
| --- | --- |
| Run setup initially focuses Back | Initial focus is Confirm; keyboard Enter and gamepad A advance. Directional input selects options, and locked choices remain inspectable with Confirm disabled. |
| Desktop shortcuts were swallowed | MenuSurface owns keys explicitly. Run setup supports arrows and M; references support arrows, `/` search, controller shoulder tabs, and highlighted search matches. Keys still do not reach covered scenes. |
| Production CSS ordering and responsive token resets | All game CSS enters through `styles.css` in `main.js`, once. No scene JS or component CSS imports the theme again. The production build has one stylesheet link. |
| Pause primary action contrast | Removed the competing battlefield background override and gave primary buttons container-specific rules. Production test measures contrast after lazy-loading the battle/menu screens. |
| New node map instances open at the beginning | Initial scroll centers the selected available route; subsequent selection preserves the user's scroll. |
| Proportional-font columns | Padded roster/unit statistics and loot/Colosseum table rows use monospace; prose stays proportional. |
| Home Base desktop hints lost | The DOM Home Base displays the two existing hints in a dismissible inline panel, using the same per-slot HintManager identifiers. |
| Hidden duplicate Home Base / node-map canvas rendering | DOM routes return before building the canvas UI. Service “View Map” uses the shared read-only Campaign Map and restores the service on close. Headless/non-DOM fallback remains. |
| Settings scrim is not an input target | A real full-screen modal shield absorbs outside pointer events and focuses the dialog, so Escape continues to close it. |
| Church feedback overlaps service buttons | Touch layout has named service/footer/message positions. Messages occupy a separate bottom strip. A viewport mask clips partial scrolling rows instead of popping them; partial buttons cannot activate outside the list. |
| Atlas blocks reduced preload | Weathered atlas joins deferred assets when reduced preload is enabled; warmup now supports atlas records. Existing fallback remains. |
| CI misses DOM / production checks | CI runs cohesion, review-regression, loadout, and run-loop browser specs, then the production offline/style check. Palette parity runs before build. Unit exclude globs are quoted so shells cannot expand them into positional tests. |
| Repeated CSS definitions | Consolidated the reported primary/forecast/portrait/detail declarations while retaining compact media overrides. The final cohesion rules now have a deterministic entry order. |
| Slot empty/filled distinction | Empty slots use the quiet border, occupied slots the strong border. |
| Difficulty pair summary missing | Commander and partner are visible again, including the default pair when upgrades are disabled. |
| Covered rails remain keyboard-accessible in other sheets | Roster, Pause, forecast, and compact modal shield also hide covered rails. |
| Proposal status stale | Proposal now links to implemented scope and this review response. |

## Findings requiring context

- Rewards' canvas hint and rails are hidden while the DOM rewards sheet is open: the hint is in `lootGroup` (hidden by MobileRewards), and `.mu-screen` hides rails. Added explicit browser assertions for the Menu/Roster rails. The non-dismissible reward choice intentionally consumes Cancel until a reward is selected; allowing fallback would reopen the original hidden-settings bug.
- `routeMobileAction` returning true under any modal denotes consumed input, not successful dismissal. An overlay without a cancellation callback must still block the underlying scene. This behavior is retained.
- Compatibility aliases (`--re-gold`, `--re-blue`, etc.) point to one palette; they do not create a second palette. Retained for legacy surfaces. The alarm token remains reserved rather than inventing combat-danger semantics during a UI fix.
- 44/46/48/56/64px targets are all at least the intended minimum; uniform physical dimensions are not required for different controls.
- Phaser remains a useful fallback for tests and environments without a DOM host. It is now gated rather than constructed behind DOM screens.

## Validation

- Full unit suite: 5,099 passed across 268 files.
- Initial combined browser validation: 13 passed, including the complete touch run loop and the new review regressions.
- Final layout/run-loop pass: 8 passed. Production offline/style test: passed, including responsive typography and primary-button contrast after scene loading.
- No balance, unlock cost, map generation, or save-schema changes.

## Follow-up review: mobile services and forecast layout

### Validation and implementation plan

Both reported regressions were real. Restore shared mobile setup before the DOM
route early return, restore the forecast's structural CSS, then address the small
input findings and verify the affected touch flows. No gameplay or save changes.

### Changes

- **Node map:** mobile detection, guarded handler registration, and the `nodemap`
  rail context now execute before either renderer. The canvas-only roster button
  remains in the canvas path. Repeated redraws retain one handler per action and
  existing shutdown cleanup. Tests assert phone mode, Church row height, visible
  Back/Roster rails, rail Back navigation, and actual 140px-wide touch Shop tabs.
- **Forecast:** restored the flex panel, bounded width/height, padding, background,
  border, 48px pixelated portraits, and phase accent/divider. Browser checks open a
  real forecast and inspect computed styles; a long-name/warnings case verifies
  scrollable content and visible confirmation at 667×375.
- **Setup shortcuts:** Command/Ctrl/Alt combinations no longer toggle army
  upgrades. Plain M continues to work.
- **Initial focus:** Reference opens on its first category; Settings opens on the
  first volume control. Close remains reachable through Tab or Escape.
- **Church gamepad:** navigation already scrolls logical rows fully into view.
  Confirmation now repeats that visibility step after manual scrolling and will
  not emit activation for an input-disabled row. A regression test covers both.
- **CI:** the battle HUD spec now runs with the cohesion suite. Its older layout
  assumptions were updated to the current utility Back button, dynamic canvas
  dimensions, 13px primary command labels, and retained-but-inactive HUD behind
  roster sheets. All touch controls must still be at least 44px tall.
- **Lint hygiene:** exclude the generated Capacitor `ios/App/App/public` bundle,
  just as `dist` is excluded; source files continue to be linted.

### Follow-up verification

- Targeted unit checks: 92 passed. Full unit suite: 5,100 passed / 268 files.
- Theme parity and production build passed; regenerated bundle synced to iOS.
- Forecast screenshots inspected at normal and small phone widths.
- Final mobile browser suite: 13 passed, including HUD/forecast, review regressions,
  and the complete touch run loop. Production offline/style test: 1 passed.
- ESLint: zero errors (existing warnings remain); `git diff --check` passed.
- Changes remain local and uncommitted; no new TestFlight upload.
