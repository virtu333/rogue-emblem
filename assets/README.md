# assets/

The game's art and audio. This folder is the source: `npm run sync-assets` (and every
`npm run build`) copies it, all but this README, to `public/assets/`, which is what the
game serves, so edit here, never in `public/assets/`.

Several generations of art sit side by side. The live art is in subfolders; the loose
files at the top of `portraits/` and the `characters/` and `enemies/` sprite folders are
the older classic set, kept only as fallbacks and for dev comparison.

## What the game shows

| Folder | What it is | Loaded by |
| --- | --- | --- |
| `portraits/pc98/` | Every portrait: `atlas/` (packed main faces), `baked/` (single faces), the size folders `32`–`192` (variant faces, loaded on demand), `plates/` | `src/ui/portraitArt.js`, `BootScene` |
| `sprites/traced/` | Every unit on the map (classes, lords, bosses, NPCs), packed into two atlas pages | `src/ui/TracedSprites.js` |
| `sprites/nodes/` | Route-map node art (`weathered-nodes.png`, `event-nodes.png`) | `BootScene`, `src/ui/NodeArt.js` |
| `sprites/fx/` | Combat effects atlas | `BootScene` |
| `terrain/weathered/` | Battle map terrain | `src/ui/BattlefieldArt.js` |
| `ui/` | Item icons (`items/`), event and ceremony paintings (`moments/`) | `src/ui/itemIcons.js`, `src/ui/itemMoments.js` |
| `audio/` | Music, ceremony stingers, SFX (built by `tools/music/`) | `AudioManager` |

## Older art, still wired in

| Folder | Status |
| --- | --- |
| `portraits/*.png` (loose `boss_`, `enemy_`, `generic_`, `lord_` files) | Classic portraits. Every one has a pc98 version; used only if that is missing, or in dev with `?portraitArt=classic`. |
| `sprites/characters/`, `sprites/enemies/` | Classic unit sprites: the last fallback for a unit with no traced sprite, or dev `?spriteArt=classic`. |
| `sprites/tilesets/` | Classic terrain tiles: dev `?terrainArt=classic`. |
| `sprites/nodes/node_*.png` | Classic route-map node icons. |
| `portraits/rebuilt/`, `sprites/rebuilt/` | The generation before pc98 and traced. A few screens still read the rebuilt portraits when a pc98 face is missing; dev `?spriteArt=rebuilt` shows the rebuilt sprites. |

Removing the older sets means changing the loaders and fallbacks above first; they are
not dead files.

Source sheets and raw generated art live in `References/` (not in the repo); the art
direction is `docs/art-direction/`.
