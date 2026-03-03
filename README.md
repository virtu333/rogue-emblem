# Emblem Rogue

A browser-based tactical RPG combining Fire Emblem grid combat with roguelike run structure. SNES-inspired pixel art, all game data driven by JSON.

**Play now:** https://emblem-rogue.netlify.app/

## Project Status

Feature-complete through 4 acts with full run loop, meta-progression, and 3 difficulty modes. 3,400+ tests across 170+ files. Active development continues on content expansion and balance tuning.

**Highlights:**
- 52 classes (21 base + 30 promoted + 1 boss-tier), 113 weapons, 52 skills, 75 weapon arts
- 29 accessories, 23 blessings, 12 enemy affixes, 15 terrain types, 16 map templates
- Normal / Hard / Lunatic difficulty modes
- Supabase auth with cloud saves (3 slots) + offline localStorage fallback
- Node-map run structure with branching paths, shops, churches, recruit events, colosseum arena
- Procedural map generation with 4 biomes (grassland, tundra, volcanic, castle)

## Tech Stack

| Layer | Tech |
|-------|------|
| Engine | Phaser.js 3 (HTML5 Canvas) |
| Language | JavaScript (ES modules) |
| Data | JSON files (`data/`) |
| Build | Vite |
| Tests | Vitest + Playwright (e2e) |
| Hosting | Netlify (auto-deploy on push to `main`) |
| Auth / DB | Supabase (Auth + Postgres with RLS) |

## Links

- GitHub: https://github.com/virtu333/rogue-emblem
- Design doc: `docs/emblem_rogue_gdd.docx`
- Roadmap: `ROADMAP.md`
- Architecture guide: `CLAUDE.md`

## Local Development

**Requirements:** Node >= 20.19

```bash
npm install           # install dependencies
npm run sync-data     # copy data/*.json → public/data/
npm run sync-assets   # copy assets/ → public/assets/
npm run dev           # start Vite dev server
```

Game assets must be present in `assets/` before syncing. The build script (`npm run build`) runs sync automatically.

## Build and Test

```bash
npm run build         # reference content + data/asset sync + Vite build
npm test              # run all Vitest tests
npm run test:unit     # unit tests only (excludes harness/sim/agents)
npm run test:e2e      # Playwright end-to-end tests
```

**Pre-PR gates:**

```bash
npm run check:reference        # verify reference content is up to date
npm run check:data-parity      # ensure data/ and public/data/ match
npm run sim:fullrun:harness:pr  # deterministic full-run simulation suite
```

See `docs/testing_matrix.md` for the full test lane matrix and `package.json` for all available scripts.

## Balance Simulations

```bash
npm run sim:progression   # level/stat progression curves
npm run sim:matchups      # unit vs unit combat outcomes
npm run sim:economy       # gold/loot economy analysis
npm run sim:fullrun       # full 4-act run simulation
npm run sim:colosseum     # colosseum mercenary balance
```

All sim scripts accept `--seed S`, `--trials N`, and `--csv` flags.

## Data Workflow

- `data/*.json` is the **source of truth** (23 files covering classes, weapons, skills, enemies, terrain, etc.)
- `public/data/*.json` is the generated runtime mirror
- After editing any data file: `npm run sync-data`
- CI enforces parity: `npm run check:data-parity`

## Data Viewer

Open `data-viewer.html` in local dev (`npm run dev` → `/data-viewer.html`) for a full balance/data reference page. Content generated from `data/mechanicsReference.json` via `npm run build:reference`.

## Asset Policy

- `assets/` is the canonical source of truth for game assets (sprites, portraits, audio)
- `public/assets/` is synced for runtime — keep them in sync via `npm run sync-assets`
- AI art generation: Google Imagen 4 API pipeline in `tools/imagen-pipeline/`
