# Rebuild progress · themed asset and biome pass

## Review entry points

- Playable map selector: http://127.0.0.1:3000/lab.html
- New artwork and small-size node comparisons: http://127.0.0.1:3012/nodes/
- Approved stronger silhouettes / teal Edric: http://127.0.0.1:3012/sprites/

## Added in this pass

- Two themed static unit concepts: a logging-camp fighter and a field cleric, using original sprites plus actual class lore as references.
- Six-cell hazard atlas: Ice, Lava Crack, Swamp, Bog, Acidic Swamp and Acidic Bog.
- Tundra and volcanic-highlands terrain atlas variants. Water remains water; separate ice and lava-crack tiles retain distinct mechanical meanings.
- Weathered renderer now covers all 19 source terrain types. This means presentation coverage, not that every biome-specific structure or transition is final.
- Ten existing generated battle layouts selectable by seed, with valid template/act combinations across five biome categories. All layouts and combat still come from the existing engine.
- Matching worn window frames for combat forecasts and roster overlays in the battle lab.
- Compact ice-rule copy and tighter short-phone spacing. Terrain details replace the idle readiness line when a tile is focused; touch targets remain at least 44px.

## Validation

- 30 generation checks: 10 templates × seeds 42, 137 and 908; no invalid configs, incorrect selected templates or missing terrain renderer types.
- 11 terrain/catalog unit tests passed, including correct 3×2 atlas cells, full terrain coverage, permitted acts and biome selection.
- 16 browser tests passed on the first integration: movement, attack cancellation, combat, next turn, selection, Inspect, pause, stable viewport and 10 map templates.
- Four affected biome checks passed after biome art integration.
- A new ice-sidebar test exposed an 11.5px overflow. After correction, both 844×390 and 667×375 checks passed; combat and existing small-phone checks also passed (4 final checks).
- Production build passed before the final biome/spacing changes. The final native review web bundle and Xcode simulator build both passed; installed the separate com.davechen.emblemrogue.lab app. The packaging script restored the original native public bundle and configuration.

## Next sequence

1. Normalize selected sprite concepts into exact-size frames with consistent foot anchors, then test readability over structures and foliage. Do not replace every unit with the new knight design.
2. Prototype the required animation frames for a small complete party/enemy set, then integrate behind the lab flag. Remaining classes, hero identities, promotions and enemy variants remain in the full manifest.
3. Refine terrain joins and regional structures. Current hazards repeat visibly; water multi-bank corners still use provisional layered banks. Castle structures, sand and villages still need more biome-specific coverage.
4. Carry the same visual language into campaign nodes, shops, item flows, Settings/Help and remaining canvas dialogs. Node art is still a review sheet, not integrated campaign-map assets.
5. Validate a full encounter and an offline save/resume cycle on a physical iPhone before release packaging.

## Limits

This is a playable development-lab milestone, not a completed game rebuild or TestFlight release. New character drafts remain review assets, without animation or production sprite replacement. Later-act lab maps keep normal later-act enemies while the smoke fixture has starter units, so those layouts are for presentation and interaction checks rather than balanced campaign play. Original save data and gameplay rules are preserved.
