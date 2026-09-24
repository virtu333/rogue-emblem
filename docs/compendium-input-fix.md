# Compendium input isolation — TestFlight build 9

## Confirmed issue

On a 667px landscape viewport, tapping the right edge of a lord entry in the Compendium also activated a covered Title control. The lord selection handler itself only selects and renders details; it does not navigate. The reproduced hidden action began a title transition (one reproduction opened Tutorial), consistent with the reported unexpected Continue screen.

Menu roots stopped pointer events but not legacy mouse/touch events. Phaser listens for those events at window level, so a press on a DOM menu could reach canvas hit zones beneath it.

## Changes

- Centralized the menu event boundary in `DOM_INPUT_EVENTS`, including legacy touch/mouse events. Applied it to MenuSurface, roster, rewards, Home Base/upgrades, route, pause and forecast boundaries.
- Stop propagation in the bubble phase, preserving normal DOM control activation and native scrolling.
- Added a Title pointer guard while a title overlay is open or a scene transition is in progress.
- Added headed browser regression cases for every lord at 667px and 844px, with both touch and mouse input. They assert zero Phaser pointer-down events beneath the menu, correct details, no transition, working search, and normal Continue behavior after closing.
- Updated two older browser checks to avoid opening Pause while dismissing introductory dialogue and to exercise the native Church instead of removed canvas controls.

## Verification

- 106 focused unit tests passed (Compendium, gamepad, Title flow and mobile controls).
- All 18 selected headed browser cases passed across the initial run and focused reruns after updating stale test fixtures. Includes four new input-isolation cases, battle HUD/forecast, desktop roster, run setup/reference menus, native Church navigation, and the full mobile run/reward/shop/resume loop.
- Production build, theme check and diff whitespace check passed. Targeted lint: zero errors; 11 existing source warnings.
- Physical iOS device verification remains a build 9 playtest priority.

## Release status

Distributed in TestFlight 0.1.0 (9) to Public Playtest on September 20, 2026. App Store Connect confirms Testing. See `docs/testflight-beta.md`.
