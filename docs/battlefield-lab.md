# Battlefield Lab — weathered playable study

## Open

Run `npm run dev`, then open:
`http://127.0.0.1:3000/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1&labMap=chokepoint`

Use `labMap=river_crossing` or `labMap=forest_ambush` for other generated encounters. Seeds 42, 137 and 908 are useful comparisons. Omit labMap for the original 24×8 test fixture. Normal builds keep the lab disabled.

## Presentation

- Full-height battlefield and a compact 190–220px side command pane.
- Native safe-area padding protects controls from the camera cutout and home indicator.
- Weathered grass/forest/mountain/shore/structure atlases, compact transparent fort, and connected code-drawn masonry and bridge decks.
- World cells remain 32px. Rendering uses 48px artwork; no terrain costs, passability, combat rules or spawns change.
- Existing class sprites remain; oversized sprites are capped to 1.15 tiles in the lab.
- Initial camera favors roughly 34 CSS pixels per tile. Overview fits the whole map; existing two-finger pan/pinch explores it.
- Viewport geometry remains stable through movement, menus and forecast dialogs.
- Roster and secondary commands remain under More. Nested equipment/action callbacks use the existing game logic.

## Architecture

WeatheredTerrain is a presentation-only renderer based on terrain names and four adjacent neighbors. BattlefieldLab loads its local atlases asynchronously, restores original tile textures and logical canvas dimensions on teardown, and ignores late image completion after destruction. Unsupported terrain retains the existing game artwork.

BattleScene generates the selected review template through generateBattle with the requested seed, only while the development lab is explicitly enabled. The original fixture remains available for deterministic combat regression tests.

Assets live in assets/terrain/weathered and sync to public/assets during the normal build. Atlas candidates and fort were produced with built-in image generation; wall/bridge connections use code-native drawing. These are review assets, not a final production art pack.

## Validation

Six Playwright checks passed after the side-pane change: movement/modal viewport stability; real touch movement, forecast cancellation, confirmed combat and next turn; 667×375 command bounds and square tiles; touch selection and unchanged terrain on each of three generated templates. Nine template/seed combinations passed MapGenerator validation and terrain-art coverage checks. Production build and focused lint passed after the side-pane pass. The final two-column action-menu change passed the two affected interaction/layout tests and the native Debug build. Native simulator selection and movement were visually verified with the full-height map and controls clear of the cutout.

## Native review

A separately identified simulator app (com.davechen.emblemrogue.lab) bundles the debug review locally, with no live server URL or Safari toolbar. Its review route is injected into the temporary bundle before startup. Normal Capacitor config and generated native public files are restored after packaging. This is a simulator-only development artifact, not a TestFlight release; it has separate local storage from the main app.

## Remaining review

Physical-device comfort/performance and a complete end-to-end encounter need hands-on review. Some generated maps contain isolated bridge cells or enclosed wall formations; these should be reviewed as generator choices, not silently edited by the renderer. More bank-corner art, class-specific sprite refreshes, and matching roster/inventory/shop screens remain future work. Legacy scenes outside the battle presentation still assume a 640×480 canvas.

## Deployment camera and Recenter (2026-09-16)

The lab opens on the living allied deployment bounds with two tiles of surrounding space. It targets 34 CSS pixels per tile, relaxing to 30 to include a compact party. If the party cannot fit at that readable scale, it starts on the first living ally. Overview still fits the full map.

The persistent Recenter control returns to the selected living unit at tactical zoom, or recomposes the living allied party when nothing is selected. It does not select units, move them, or commit actions. Camera controls share one row with Back and Menu; the command rail has a 222px minimum width to retain 44px targets without consuming another row of vertical space.

Viewport resizing preserves world center and apparent tile size, subject to map bounds and zoom limits. An existing overview remains an overview. Modal transitions at the same viewport dimensions leave the camera untouched. These changes remain inside the development battlefield lab.
