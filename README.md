# Emblem Rogue

A Fire Emblem x roguelike tactical RPG built with Phaser + Vite.

## Project status

Core gameplay, run progression, and simulation/harness testing are active.

## Local development

1. Install dependencies:

```bash
npm install
```

2. Ensure required game assets are present locally:
- `assets/`
- `public/assets/`

3. Sync JSON data files to runtime public data:

```bash
npm run sync-data
```

4. Sync media assets to runtime public assets:

```bash
npm run sync-assets
```

5. Start dev server:

```bash
npm run dev
```

## Build and test

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Harness/sim entry points are available in `package.json` scripts.
See `docs/testing_matrix.md` for recommended lanes and commands.

## Asset policy

- Runtime assets are currently tracked in this repository.
- Keep `assets/` and `public/assets/` in sync when updating media files.
