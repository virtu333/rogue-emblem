# Asset Pipeline TODO

## Source Material

| Sheet | Content |
|-------|---------|
| Player sprites | 128 PNGs (~180x193px), blue palette, 16x8 grid |
| Enemy sprites | 128 PNGs (~180x192px), red palette, 16x8 grid |
| Terrain | 5 PNGs (variable size), grassland tileset |
| UI icons | 56 PNGs (variable size), framed weapon icons, cursors, stat icons |

**Manual reference cuts** in `References/DaveManual/`: 10 terrain tiles (all deployed ✅), spare cave/water/mountain edge tiles, unsliced `tilesetFE.png`.

## Completed (Summary)
- **Sprites**: All 21 classes + 8 lord classes labeled and processed. 32 player + 23 enemy sprites at 32x32
- **Portraits**: 4 lord + 21 generic class portraits at 128x128 via Imagen pipeline
- **UI Icons**: 10 weapon/item icons generated and deployed (64x64, transparent bg)
- **BootScene**: All sprites, enemies, portraits, icons loaded. Promotion sprite refresh working
- **Node Icons v2**: 7 icons (battle, recruit, boss, boss_final, rest, shop, elite) at 48x48

## Remaining Tasks

### Priority 1: Clean Up Extracted Sprites
- [ ] Remove empty/fragment files from `References/split/ui_icons/`
- [ ] Check last enemy sprite (#127) for near-empty/fragment
- [ ] Visually review player and enemy sprites for duplicates or bad extractions

### Priority 2: Sprite Metadata
- [ ] Create `data/sprite_map.json` linking class names to sprite files
- [ ] Note: `pegasus_knight` and `falcon_knight` have minor white-wing clipping from bg removal

### Priority 4: Expand Terrain Tile Library
- [ ] Slice `References/DaveManual/tilesetFE.png` for castle interiors, desert buildings, paths
- [ ] Evaluate spare tiles (cave, mountain corner, water edges) for future biomes
- [ ] Add transition/edge tiles for terrain borders
- [ ] Consider biome-specific tilesets (cave, castle interior, desert)

### Priority 5: Additional Icons & Portraits
- [x] Generate additional icons (ring/accessory, key items) — 27 icons via Imagen pipeline
- [ ] Categorize 56 extracted Gemini icons (weapon, cursor, stat, bar, indicator)
- [x] Generate enemy/boss portraits for boss encounter dialogue — 7 boss portraits via Imagen pipeline

### Priority 6: Performance
- [ ] Consider switching to Phaser sprite atlas (single texture + JSON atlas)

### Priority 7: Winlu Asset Integration
- [ ] Wire up elite node icon when NODE_TYPES.ELITE is added
- [ ] Create node map background using overworld terrain tiles (per-act biome theming)
- [ ] Build shop interior scene using `Fantasy_Inside_Shops.png`
- [ ] Evaluate 48x48→32x32 conversion for combat grid tiles

## Tools Reference

| Tool | Purpose |
|------|---------|
| `tools/split_sprites.py` | FFT grid detection + extraction from sprite sheets |
| `tools/process_sprite.js` | Resize to 32x32 + white bg removal |
| `tools/process_tiles.js` | Batch resize terrain tiles to 32x32 |
| `tools/process_node_icons_v2.js` | Node map icon processing (bg removal, compositing, resize) |
| `tools/imagen-generate.js` | Batch portrait/icon generation via Imagen API |
| `tools/imagen-process.js` | Process selected variants (crop/resize/bg removal) |
