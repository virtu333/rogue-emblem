# Emblem Rogue

A Fire Emblem x roguelike tactical RPG built with Phaser + Vite.
Netlify web app: https://emblem-rogue.netlify.app/

## Project status

Core gameplay, run progression, and simulation/harness testing are active.

## More info

- GitHub: https://github.com/virtu333/rogue-emblem
- Title screen includes a `MORE INFO` link to this repository.

## Data viewer

- Open `data-viewer.html` for a full balance/data reference page.
- In local dev, run `npm run dev` and visit `/data-viewer.html`.
- Reference content is generated from a shared source:
  - `data/mechanicsReference.json`
  - build script: `npm run build:reference`

## Local development

1. Install dependencies:

```bash
npm install
```

Node requirement: `>=20.19` (see `package.json` engines).

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

Recommended pre-PR gates:

```bash
npm run check:reference
npm run check:data-parity
npm run sim:fullrun:harness:pr
```

Harness/sim entry points are available in `package.json` scripts.
See `docs/testing_matrix.md` for recommended lanes and commands.

## Data workflow

- `data/*.json` is the source of truth.
- `public/data/*.json` is a generated mirror for runtime loading.
- After editing data files, run:

```bash
npm run sync-data
```

- CI parity gate:

```bash
npm run check:data-parity
```

- Enemy-only intent (not in standard loot pools): `Venin Bow`, `Sunder Sword`, `Sunder Lance`, `Sunder Axe`, `Sunder Bow`.

## Asset policy

- Runtime assets are currently tracked in this repository.
- Keep `assets/` and `public/assets/` in sync when updating media files.
