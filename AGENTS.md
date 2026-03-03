## Project Snapshot
Emblem Rogue is a browser tactical RPG that combines Fire Emblem style grid combat with a roguelike run loop. The codebase is JavaScript ES modules on Phaser 3 with JSON-driven game data.

## Agent Priorities
1. Optimize for correctness and behavioral safety over speed.
2. Keep patches narrow and aligned with existing architecture.
3. Prefer deterministic logic and explicit state transitions.
4. Do not refactor unrelated systems unless explicitly requested.

## Stack and Runtime
- Engine: Phaser 3 (HTML5 Canvas)
- Build/dev: Vite
- Language: JavaScript ES modules (Node 20.19+)
- Auth/cloud: Supabase Auth + Postgres with user-scoped RLS
- Persistence: localStorage save slots with cloud sync fallback

## Repository Map
- `src/scenes/`: Phaser scene orchestration and lifecycle
- `src/engine/`: core gameplay systems and most combat/economy logic
- `src/ui/`: overlays/controllers for menus and HUD flows
- `src/utils/`: shared helpers, constants, routing, depth/priorities
- `data/`: source-of-truth game data JSON
- `public/data/`: runtime copy generated from `data/`
- `tests/`: Vitest suites, harness tests, and e2e tests
- `tools/`: build/data sync/content pipeline scripts

## Data Workflow Rules
- Treat `data/*.json` as source of truth.
- After changing data, run `npm run sync-data`.
- Build also syncs data/assets: `npm run build`.
- For schema/content safety on data edits, run `npm run validate:data` and `npm run check:data-parity`.

## Architecture Guardrails
- Keep gameplay rules in `src/engine/` when possible; avoid embedding rule logic in scene UI code.
- `src/scenes/BattleScene.js` is a hot spot. Prefer extracting controllers/modules over adding multi-step inline flows.
- For overlays and menu stacks, use `src/utils/uiDepths.js` and `src/utils/escPriority.js` instead of ad hoc values.
- For scene transitions, preserve existing guards/locks and cleanup patterns.

## UI Quality Baseline
- Validate long text cases (unit/class/skill/item names) for overflow.
- Verify empty, single-item, and overflow states for scrollable lists.
- Verify behavior at the base 640x480 design resolution.
- Ensure close/ESC handling is deterministic and leak-free.

## Testing Guidance
- Start targeted: run only suites that cover the touched area.
- Expand to broader checks after targeted tests pass.
- Common commands:
  - `npm test -- tests/<file>.test.js`
  - `npm run test:unit`
  - `npm run test:harness`
  - `npm run test:e2e:smoke`

## Art Pipeline Quick Notes
- Generate candidates: `npm run imagen:generate` (or `npm run imagen:generate:dry`)
- Process outputs: `npm run imagen:process`
- Pipeline files live in `tools/imagen-pipeline/`
- Requires `GOOGLE_API_KEY` in `.env`

## Canonical References
- Game design: `docs/gdd/GDD_OVERVIEW.md`
- Difficulty/system details: `docs/specs/difficulty_spec.md`
- Mobile/input constraints: `docs/mobile-controls-spec.md`
- Test strategy and thresholds: `docs/testing_matrix.md`, `docs/harness-thresholds.md`

## Maintenance Rule
Keep this file operational and stable. Avoid volatile counts and deep design dumps here; store detailed evolving specs under `docs/`.

