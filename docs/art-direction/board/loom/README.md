# The Loom: node-map redesign mockup

`index.html` is the board: every state in device frames. `screen.html` is one screen. It
takes `?state=start|choice|mid|future|cut`, `&frame=desktop`, `&safe=1` (iPhone landscape
insets) and `&motion=0`. Serve it from the repo root, for example
`npx vite --port 3103` → `/docs/art-direction/board/loom/`. It also opens straight from disk,
because the scripts are classic, not ES modules.

| File | What |
|---|---|
| `current_phone.png` | Today's node map at 844×390 (`?qaStep=4&mobilePreview=1`) |
| `loom_phone.png` | 844×390, first choice after the opening battle |
| `loom_phone_small.png` | 667×375, same state |
| `loom_phone_selected.png` | 844×390 mid-act: woven path, frayed branches, elite selected with its inspect card |
| `loom_desktop.png` | 640×480 @2x desktop framing, a future node inspected with the vision path |
| `gen/generate-graph.mjs` | Writes `graph-data.js` from the real generator |

## Design rationale

- **The map is Sera's loom.** The five generator lanes are drawn as faint dashed warp threads. The routes run across them as weft. The top edge works as a beam with row numerals (I–VIII), so progress through the act can be read at a glance. Past rows are ember, the next row is gold and later rows fade.
- **Gold means the player's path, and nothing else.** A walked route is a plied gold rope with no glow, and each cleared node gets a gold knot. Threads within reach glow, and glints travel toward each choice. The selected thread gets a pale core. The pane uses gold only for Travel and gold count.
- **Futures stay inspectable but quiet.** Reachable futures are a single thin grey thread. Two rows past the party, those threads and medals fade under an 8×8 Bayer dither, which is an SNES-style fade rather than a blur. Medals never drop below about 45% opacity and stay tappable.
- **A choice leaves roads behind.** A thread the party can no longer reach frays: it shortens into dashes and breaks, and its medal turns grey. The inspect card says "A frayed thread · out of reach" rather than leaving the player to guess why Travel is locked.
- **Vision.** When a future node is inspected, every route from the party to that node is traced in gold dashes. This answers "how do I get there?", which the current map cannot.
- **The Lieutenant fractures.** Elite battles show a hairline crimson crack on the medal rim, and their within-reach thread breaks into a crimson kink just before the medal. The Hollow Sun's corona carries two crimson cracks. Blood is used for nothing else, so elites stand out without skull or spike decoration.
- **The Hollow Sun closes the act.** The boss medal is a black disc with a gold corona and thin rays, drawn on the canvas behind the approved castle icon. At act start it is the one light at the dark end of the loom.
- **Ink carries the frame.** The ground is a hue-shifted ink with 1px vellum and star grain, plus a faint ember pool of light where the party stands. Surfaces are near-flat ink with 1px ink rims. Only the Travel button has a strong gradient.
- **Type.** Cinzel 700 is used once, for the act title. Press Start 2P at 8px (10px on Travel) is used for short labels: node kinds under choices, row numerals and buttons. Body text is the system sans at 11–13px, as `ui-cohesion-plan.md` sets out.
- **Mobile structure is unchanged.** The loom scrolls on its own and is anchored on the choices. The right pane has Menu/Roster, the inspect card, Travel and the lord chips, and all targets are at least 44px (node hit areas are 48px). The 667 layout keeps the side pane at 184px instead of the current bottom bar. Narrow looms (667 wide, notch insets, 640 desktop) switch to 36px medals through a container query.

## What maps to real data

- **Real graph data.** Nodes, lanes, rows, edges, types, elite flags, objectives, `levelRange`, fog, village/caravan flags and template ids come straight from `generateNodeMap('act1', ACT_CONFIG.act1, mapTemplates, {halfFogChance: true, colosseumConfig})`. The call is the one RunManager makes on Normal, with `Math.random` seeded (Mulberry32, seed 6). Re-run it with `node gen/generate-graph.mjs <seed> <actId>`.
- **Real place names and flavour.** Place names and lore come from `mapTemplates.json` (for example "Pursuit Road" or "Hilltop Fortress"). Flavour lines come from `dialogue.json` `nodeFlavor` and `shopFlavor`. Objective copy is from `helpContent.js`. Service copy and labels are from `NodeMapMenu.js` and `RouteGraph.js`.
- **Real node states.** Available nodes follow `RunManager.getAvailableNodes()`: the start node, or the edges of the completed current node. Future and cut states come from a forward breadth-first search from those nodes. The mid-act path follows real edges, and the generator throws if an edge does not exist.
- **Real art.** Node icons are `weathered-nodes.png` through the exact `NODE_ART_RECTS` and `nodeFrame()` rules: elite is frame 7 and the final boss is frame 8. The board ships a 1/3-scale copy to stay light. Portraits are the rebuilt `lord_edric` and `lord_sera`. The elite loot tag reads "Pick 2 of 4" from `ELITE_LOOT_CHOICES` and `ELITE_MAX_PICKS`.
- **Mock values.** Gold, current HP, and the display title "The Border Quarries" are mock values. The title uses the lore-guide canon for act 1; `regions.json` says "Border Marches". A real title would need an `actTitle` field, or the renderer could use `regionName()`.

## Integration notes

- **`RouteGraph.js`**
  - Keep the DOM buttons: they already provide focus, `aria-pressed` and 44px hit targets. Replace the SVG `<line>`s with a canvas under the buttons, drawn by a new pure module (for example `src/ui/loomThreads.js`). Its input would be `{nodes, positions, completedIds, currentId, availableIds, selectedId}`, and it would export `edgeKind()`, `samplePath()` and the four styles. `loom.js` has these as standalone functions.
  - Add state classes `is-current`, `is-live`, `is-future`, `is-cut` and `is-elite` next to the existing `is-completed`, `is-available` and `is-future`. Pass `completedIds` and `currentId` in: the graph does not have them today.
  - Horizontal positions become `padL + row*dx` with `dx >= medal + 26`. This replaces the fixed 64px spacing, whose 44px medals leave threads only about 20px long.
- **`NodeMapMenu.js`**
  - Header: split the `h2` into a Cinzel title plus an 8px pixel subline (region · row).
  - Side pane: order it Menu/Roster, inspect card, Travel, then the lord chips. Keep the 180–204px column at every width; drop the `@media (max-width: 700px)` bottom-bar layout.
  - Rename "Advance" to "Travel". Keep the existing return-to-rewards and re-enter-shop labels.
  - Inspect card: `templateId` → template name and lore, `levelRange`, `fogEnabled`, `hasVillage`/`hasCaravan`, `isElite` → loot tag, and `nodeFlavor`. Pick the flavour line deterministically per node id so it does not change on every render.
- **`NodeMapScene`.** No flow changes: selection and `onNodeClick` stay as they are. The Phaser `CampaignMapMenu` read-only view can reuse the same canvas module.
- **Performance.** Draw the static weave once per layout and selection change. Only the glints and the vision dash offset need `requestAnimationFrame`, and they should stop when `NodeMapMenu` is hidden. Under `prefers-reduced-motion` the fx layer is drawn once with a static glint. The dither and grain are built at 1 CSS px on small canvases and scaled up.
- **CSS tokens.** The ramps here are the art-direction palette, not the current teal/sand `re-kit`. The node map would need its own darker token scope, which is open question 2 in `ui-cohesion-plan.md`.
