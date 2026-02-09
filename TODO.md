# Asset Pipeline TODO

## Source Material

Four Gemini-generated sprite sheets were split into individual assets via `tools/split_sprites.py` (FFT-based grid detection + connected-component detection). Raw extractions live in `References/split/` and need cleanup, labeling, processing, and integration before they're game-ready.

**Original sheets** (in `References/`):
| Sheet | Size | Content |
|-------|------|---------|
| `Gemini_Generated_Image_a9ab7fa9ab7fa9ab.png` | 8.5 MB | Player unit sprites (blue palette) |
| `Gemini_Generated_Image_x3r77ax3r77ax3r7.png` | 9.1 MB | Enemy unit sprites (red palette) |
| `Gemini_Generated_Image_x34pmvx34pmvx34p.png` | 9.2 MB | Terrain tilesets |
| `Gemini_Generated_Image_cwuf7acwuf7acwuf.png` | 7.5 MB | UI icons |

**Extracted assets** (in `References/split/`):
| Directory | Files | Dimensions | Extraction Mode | Content |
|-----------|-------|-----------|-----------------|---------|
| `player_units/` | 128 PNGs + manifest | ~180x193px each | 16x8 grid | SNES-style character sprites, blue palette. Variety: swordsmen, mages, fighters, cavalry, archers, clerics, rangers |
| `enemy_units/` | 128 PNGs + manifest | ~180x192px each | 16x8 grid | Red-palette variants of similar class types |
| `terrain/` | 5 PNGs + manifest | 130px–1445px (variable) | auto-detect | Grassland tileset (castle, forest, mountain, water, bridge visible), plus smaller terrain sections |
| `ui_icons/` | 56 PNGs | 30px–200px (variable) | auto-detect | Framed weapon icons, selection cursors, stat icons, bars |

**Current game assets:** 32 player character sprites (Edric + all 21 classes + 8 lord classes + 2 alt variants), 23 enemy sprites (15 classes + warrior_alt + 4 monsters + 2 flying), 10 terrain tiles in `assets/`.

**Manual reference cuts** (in `References/DaveManual/`):
| File | Content | Status |
|------|---------|--------|
| `grass.png` | Green grass texture | → `plain` tile ✅ |
| `forest.png` | Dense tree canopy | → `forest` tile ✅ |
| `mountain.png` | Rocky peak on grass | → `mountain` tile ✅ |
| `water.png` | Blue water texture | → `water` tile ✅ |
| `bridge.png` | Wooden bridge over water | → `bridge` tile ✅ |
| `castle.png` | Castle front view | → `fort` tile ✅ |
| `castlefloor.png` | Stone brick floor | → `wall` tile ✅ |
| `throne.png` | Red throne on stone | → `throne` tile ✅ |
| `village.png` | House with red roof | → `village` tile ✅ |
| `desert.png` | Yellow sand texture | → `sand` tile ✅ |
| `tilesetFE.png` | Large FE-style tileset (unsliced) | Reference — needs grid slicing |
| `cave floor.png` | Dark cave ground | Spare tile |
| `cavewall.png` | Cave wall with stalactites | Spare tile |
| `cavecorner.png` | Cave edge transition | Spare tile |
| `mountaincorner.png` | Mountain edge transition | Spare tile |
| `water1.png`, `water2.png` | Water edge transitions | Spare tiles |

---

## Priority 1: Clean Up Extracted Sprites

- [ ] Remove empty/fragment files from `References/split/ui_icons/` (small <30px noise sprites)
- [ ] Check last enemy sprite (#127) for near-empty/fragment
- [ ] Visually review player and enemy sprites for duplicates or bad extractions
- [ ] Delete or flag any unusable sprites

## Priority 2: Label Character Sprites by Class

The 128 player sprites span the 21 classes in `data/classes.json` (11 base + 10 promoted). Multiple sprites per class give visual variety for recruitable units.

**Labeled and processed** (in `assets/sprites/characters/` and `assets/sprites/enemies/`):

| Player Class | File | Tier | Enemy? |
|-------------|------|------|--------|
| Myrmidon | `myrmidon.png` | base | ✅ |
| Knight | `knight.png` | base | ✅ |
| Fighter | `fighter.png` | base | ✅ |
| Cavalier | `cavalier.png` | base | ✅ |
| Archer | `archer.png` | base | ✅ |
| Mage | `mage.png` | base | ✅ |
| Cleric | `cleric.png` (female default, `_alt` = male) | base | ✅ |
| Thief | `thief.png` | base | ✅ |
| Pegasus Knight | `pegasus_knight.png` | base | ✅ |
| Mercenary | `mercenary.png` | base | ✅ |
| Dancer | `dancer.png` | base | |
| Swordmaster | `swordmaster.png` | promoted | |
| General | `general.png` | promoted | ✅ |
| Warrior | `warrior.png` (+`warrior_alt` enemy) | promoted | ✅ |
| Paladin | `paladin.png` | promoted | ✅ |
| Sniper | `sniper.png` | promoted | ✅ |
| Sage | `sage.png` | promoted | ✅ |
| Bishop | `bishop.png` (female default, `_alt` = male) | promoted | ✅ |
| Assassin | `assassin.png` | promoted | |
| Falcon Knight | `falcon_knight.png` | promoted | ✅ |
| Hero | `hero.png` | promoted | ✅ |

| Lord Class | File | Lord | Tier |
|-----------|------|------|------|
| Tactician | `tactician.png` | Edric | base |
| Grandmaster | `grandmaster.png` | Edric | promoted |
| Light Sage | `light_sage.png` | Kira | base |
| Light Priestess | `light_priestess.png` | Kira | promoted |
| Ranger | `ranger.png` | Voss | base |
| Vanguard | `vanguard.png` | Voss | promoted |
| Lord | `lord.png` | Sera | base |
| Great Lord | `great_lord.png` | Sera | promoted |

| Enemy-Only | File | Notes |
|-----------|------|-------|
| Dragon | `dragon.png` | Boss/special encounter |
| Wyvern Priest | `wyvern_priest.png` | Boss/special encounter |
| Zombie | `zombie.png` | Monster enemy |
| Zombie Brute | `zombie_brute.png` | Monster enemy |

**✅ All 21 game classes now have player sprites. All 11 base + 10 promoted covered.**

**Still TODO:**
- [x] Enemy: Assassin, Swordmaster added (no enemy Dancer needed)
- [ ] Create `data/sprite_map.json` linking class names to sprite files
- [ ] Note: `pegasus_knight` and `falcon_knight` player sprites have minor white-wing clipping from bg removal (tolerance 40). Usable but could be re-processed with lower tolerance if needed.

**Observed layout pattern** (player_units, reading left-to-right, top-to-bottom):
- Row 0 (000–015): Sword-wielding classes — swordsmen, mercenaries, lords
- Row 1 (016–031): Shield/armor/tome classes — knights, mages, tacticians
- Row 2 (032–047): Light armor — fighters, monks, brawlers
- Row 3 (048–063): Mounted units — cavalry, paladins
- Row 4–5 (064–095): Green-palette ranged — archers, rangers (possible duplicates across rows)
- Row 6 (096–111): Neutral-palette — clerics, healers, priests
- Row 7 (112–127): Dark/green-palette — thieves, assassins, promoted variants

## Priority 3: Process Sprites to Game-Ready 32x32

- [x] Run extracted character sprites through `tools/process_sprite.js` (resize + bg removal)
- [x] Output processed player sprites to `assets/sprites/characters/`
- [x] Output processed enemy sprites to `assets/sprites/enemies/`
- [x] Verify transparency is clean at 32x32 scale
- [ ] Process additional sprites as labeling continues

## Priority 4: Expand Terrain Tile Library

All 10 base terrain tiles are now hand-cut from the SNES FE reference tileset. Additional reference material available for expansion.

- [x] Replace all 10 terrain tiles with reference tileset cuts (plain, forest, mountain, fort, throne, wall, water, bridge, sand, village)
- [ ] Slice `References/DaveManual/tilesetFE.png` — large FE-style tileset with castle interiors, desert buildings, stone paths, additional grass/forest variants
- [ ] Evaluate spare tiles (cave floor/wall/corner, mountain corner, water edges) for future biomes
- [ ] Add transition/edge tiles for terrain borders (water edges, mountain edges, cave corners)
- [ ] Consider additional biome-specific tilesets (cave, castle interior, desert) for map variety

## Priority 5: Organize UI Icons

**Imagen-generated icons** (in `assets/sprites/ui/` + `public/assets/sprites/ui/`):
- [x] 10 weapon/item icons generated, processed, and deployed (64x64, transparent bg): sword, axe, lance, bow, tome, staff, potion, gold, scroll, light
- [x] Wire icons into BootScene asset loading (keyed as `icon_{type}`)
- [ ] Generate additional icons as needed (ring/accessory, key items)

**Extracted Gemini icons** (in `References/split/ui_icons/`):
- [ ] Categorize the 56 extracted icons:
  - Framed weapon/item icons (~200px, e.g. sword, staff, tome) — for inventory/shop UI
  - Selection cursors (red ring, crosshair) — for tile selection
  - Stat icons (~150px) — for stat panel
  - Bars (~228x87) — for HP/XP display
  - Small indicators (<50px) — for status effects, movement arrows
- [ ] Resize appropriately per use case (HUD elements vs. menu icons)

## Priority 5.5: Character Portraits

**Imagen-generated portraits** (in `assets/portraits/` + `public/assets/portraits/`):
- [x] 4 lord portraits generated, processed, and deployed (128x128): Edric, Kira, Voss, Sera
- [x] 21 generic class portraits generated, processed, and deployed (128x128): all 11 base + 10 promoted classes
- [x] All 25 portraits copied to game dirs (`assets/portraits/` + `public/assets/portraits/`)
- [x] Wire portraits into BootScene asset loading (keyed as `portrait_{name}`)
- [ ] Generate enemy/boss portraits (if needed for boss encounter dialogue)

**Pipeline**: `imagen-manifest.json` → `imagen-generate.js` (4 variants each) → `compare.html` (pick best) → `imagen-process.js` (resize/crop)

## Priority 6: Integrate into BootScene Asset Loading

- [x] Update `src/scenes/BootScene.js` to load 32 character sprites (keyed by filename)
- [x] Update `src/scenes/BootScene.js` to load 23 enemy sprites (keyed as `enemy_{class}`)
- [x] Update `src/scenes/BootScene.js` to load 25 portraits (keyed as `portrait_{name}`)
- [x] Update `src/scenes/BootScene.js` to load 10 UI icons (keyed as `icon_{type}`)
- [x] Fix sprite key resolution: `getSpriteKey(unit)` uses `className` → snake_case, `enemy_` prefix for enemies, lord name override
- [x] Promotion sprite refresh: unit graphic updates after class change
- [ ] Consider switching to a Phaser sprite atlas for performance (single texture + JSON atlas)

## Priority 7: Winlu Asset Integration (Node Map)

Downloaded Winlu Fantasy Tileset pack in `References/Downloaded Packs/`. Full catalog: `CATALOG.md`.
Hand-picked sources in `References/node_icon_dave/` (organized by node type).

- [x] Cut node map icons from `Fantasy_World_Buildings.png`: village (rest), cathedral (boss) → `assets/sprites/nodes/` (48x48, transparent)
- [x] Wire node icons into BootScene (keyed as `node_{type}`) + NodeMapScene sprite rendering with fallback
- [x] **Node icons v2** — 7 icons processed via `tools/process_node_icons_v2.js`:
  - battle (plains + red fighter composite), recruit (plains + green mercenary composite)
  - boss (castle), boss_final (crystal castle), rest (church), shop (village)
  - elite (dark fortress — processed, not wired up yet)
- [x] Act-specific boss icon: finalBoss act uses crystal castle instead of standard castle
- [ ] Wire up elite node icon when NODE_TYPES.ELITE is added
- [ ] Create node map background using overworld terrain tiles (per-act biome theming)
- [ ] Build shop interior scene using `Fantasy_Inside_Shops.png`
- [ ] Evaluate 48x48→32x32 conversion for combat grid tiles (lower priority — current FE tiles are cohesive)

---

## Tools Reference

| Tool | Language | Purpose |
|------|----------|---------|
| `tools/split_sprites.py` | Python (PIL, numpy, scipy) | FFT grid detection + connected-component extraction from sprite sheets |
| `tools/process_sprite.js` | Node.js (sharp) | Resize to 32x32 + strip white/near-white background (tolerance 40) |
| `tools/process_tiles.js` | Node.js (sharp) | Batch resize terrain tiles to 32x32, copy to `public/` |
| `tools/imagen-generate.js` | Node.js (Imagen API) | Batch generate 4 variants per asset from `imagen-manifest.json` |
| `tools/imagen-process.js` | Node.js (sharp) | Process selected variants: cover crop (portraits) or bg removal (icons) |
| `tools/imagen-test.js` | Node.js (Imagen API) | Single-asset test generation for prompt iteration |
| `tools/process_node_icons_v2.js` | Node.js (sharp) | Process node map icons: dark bg removal (per-icon threshold), compositing (plains + character), trim + resize to 48x48 |
