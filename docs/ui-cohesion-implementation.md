# UI cohesion implementation — September 18, 2026

Companion to `ui-cohesion-plan.md` and its v2 mockups. The original proposal and mockups remain intact.

## Implemented

- One JSON palette feeds generated CSS tokens and Phaser's `uiStyles` exports. `npm run check:ui-theme` catches drift; dev/build generate tokens. Darker v2 surfaces, quiet structural borders, sand text, filled gold primary actions, shared bevel/focus styles, and 44px minimum touch controls.
- Removed superseded duplicate declarations from mobile styles. Existing semantic status/faction colors remain meaningful. Pixel text is used for short labels; prose uses readable system/Arial text. Canvas menu text uses the shared 2x resolution helper.
- Home Base uses the existing DOM loadout and upgrade flow on desktop and mobile. The Phaser implementation remains a fallback for environments without the DOM host; deletion is intentionally separate from this migration.
- Compendium, Help, How to Play, Settings, difficulty, and blessing selection use shared DOM components, scrollable content, focus ownership, and scene teardown. Compendium has a tappable search field. Search is scoped to the current category. Blessing tiers retain four colors through a left stripe plus a Roman-numeral label.
- Node travel and the read-only in-battle Campaign Map use the approved weathered node art and shared graph renderer. Travel selects a node then explicitly advances; future nodes remain inspectable. Graphs scroll independently from the fixed actions/party pane. Existing generated graph data and encounter entry rules are unchanged.
- Approved node sheet reused without resampling its source pixels. Explicit atlas rectangles prevent neighboring icons bleeding into frames. Both Phaser and DOM use those source boundaries.
- Dialogue resolves rebuilt lord/boss portraits, including promoted lord portraits when the active unit supports one; legacy portraits remain the fallback. Touch dialogue provides readable copy and explicit Continue/Skip controls.
- Boot, Title, Slot Picker, Run Complete, and legacy canvas menus share the neutral palette and text resolution. Run Complete now has an explicit background. Church rows use touch-sized targets and deferred activation to prevent swipe purchases.

## Input and lifecycle fixes

- Mobile Home Base requires a valid DOM host before construction.
- Rewards preserve focus across selection rerenders and own the overlay stack, preventing Escape from opening hidden settings behind them.
- Home Base cancel respects `allowExit` and returns a boolean.
- Mobile actions respect the top overlay in Battle, Node Map, and Home Base.
- Rail visibility changes refresh Phaser's scale immediately.
- Rapid Home Base / run-setup navigation retries a temporary scene-start lock, preserving the existing transition guard instead of requiring a second tap.
- Shared menus clean up input scopes, overlay tokens, DOM nodes, and shutdown listeners.

## Verification

- Full non-harness unit suite: 5,098 tests passed (268 files).
- Following the final navigation fix, focused scene-router/run-setup/mobile tests: 85 passed, including a new cooldown retry regression.
- Ten browser checks passed: 640/667/844 landscape layouts, unlocked/locked loadout choices, skill limits and persistence, full touch run loop, reward Escape isolation, shop purchase/equipment, next battle, local resume, rebuilt dialogue portrait loading, route selection, Compendium search/empty results, Settings, read-only Campaign Map, and desktop keyboard/navigation round-trip.
- Production bundle smoke passed with external HTTP(S) requests blocked: new game, story, route entry, and rebuilt battle art without development flags; no cloud client or external requests.
- Production build, palette parity, Capacitor iOS sync, and unsigned Xcode simulator build passed. ESLint reports no errors; existing warnings remain.

## Scope and next review

This applies the common presentation and touch foundation without changing game balance, unlock costs, or save formats. Some legacy canvas layouts (advanced roster, loot submenus, shop/church/colosseum, title and slot picker) remain canvas-based. Their typography and palette were aligned; a complete DOM replacement and newly painted title background are not included. The alarm token is reserved, rather than adding unverified lethal-forecast logic.

Review on a physical phone should cover the software keyboard, safe areas, long reference descriptions, and canvas service menus. The new web bundle is synced into Xcode; no new TestFlight build was uploaded in this pass.

## Checkpoint review follow-up

See `ui-cohesion-review-response.md` for validated findings and corrections after `8ad908d`. In particular, CSS now has one eager entry, run setup supports initial Confirm and keyboard/controller navigation, available route choices are centered on entry, desktop hints are visible, and canvas Home Base/node UI is gated behind the DOM path. CI now exercises the DOM menus and production stylesheet. No new TestFlight upload is part of this review-fix pass.

Follow-up verification: 5,099 unit tests passed; the combined browser pass had 13 passing checks, followed by 8 passing final layout/run-loop checks. The production offline test also passes its new 667px typography and primary-button contrast assertions. The built page contains one game stylesheet. ESLint has zero errors (existing warnings remain).

### Follow-up regression review

Restored node-map mobile setup before the DOM return and the forecast panel/portrait
CSS. Added phone service geometry/rail assertions and battle HUD coverage to CI;
fixed modifier shortcuts, initial menu focus, and Church gamepad activation after
manual scrolling. See [review response](ui-cohesion-review-response.md) for details.
Validation: 5,100 unit tests, 13 mobile browser checks, and the production offline
check passed. Production bundle rebuilt and synced to iOS; not uploaded.
