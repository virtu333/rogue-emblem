# Act 4 Boss Map Follow-up Spec

Status: Planned (post-hybrid follow-up)
Owner: gameplay roadmap stream
Last updated: 2026-02-14

## 1. Scope

This spec defines a focused follow-up for Act 4 boss encounters:
- use the Emperor-specific enemy sprite asset,
- increase enemy pressure in the player-side approach area on the Act 4 boss template,
- reduce late-game map height by 1 row first (with a 2-row fallback) to improve HUD readability,
- keep mobile planning aligned with the large-map readability fix.

This is intentionally small and does not change objective rules, reinforcement legality, or boss stats.

## 2. Investigation Summary

### 2.1 Emperor asset is present but not used in runtime sprite routing

- `assets/sprites/enemies/emperor.png` and `public/assets/sprites/enemies/emperor.png` exist.
- Runtime enemy sprite selection uses `enemy_{className}`:
  - `BattleScene.getSpriteKey()` maps enemy `General` to `enemy_general`.
- Boot preload currently loads a fixed enemy sprite list that does not include `emperor`.

Result: The Emperor currently renders as generic General art.

### 2.2 Player-side enemy pressure is low by template shape

- Boss-only hybrid templates keep `enemySpawn` weighted to the right-side region.
- Scripted waves for `act4_boss_intent_bastion` are also concentrated near the arena side.

Result: pressure mostly arrives from the boss half of the map, with weaker player-area contest.

### 2.3 Large-map HUD overlap/readability risk is real

- Grid render origin is fully camera-centered.
- Act 4/Final map sizes include up to `18x14` and `20x14`, which consume most vertical space at `TILE_SIZE=32`.
- Bottom command row (`[D] Danger`, `[O] Roster`, `[E] End Turn`) is screen-anchored, so map terrain can visually sit behind command text.

Result: command text can be visually crowded by map content on large maps.

## 3. Requirements

### 3.1 Emperor visual identity (Act 4 boss)

- Load `enemy_emperor` in boot asset preload.
- In battle rendering, when an enemy unit is both:
  - `isBoss === true`, and
  - `name === "The Emperor"`,
  use sprite key `enemy_emperor`.
- Fallback behavior remains unchanged (`enemy_general`) if `enemy_emperor` is unavailable.

Acceptance:
- In an Act 4 boss encounter, The Emperor uses `enemy_emperor` art.
- Non-Emperor General enemies continue using `enemy_general`.

### 3.2 Player-area pressure (Act 4 boss template)

- Update `act4_boss_intent_bastion` spawn intent so enemy presence is not exclusively arena-side.
- Keep boss-only gating and scripted-wave contract unchanged.
- Preserve baseline scripted-wave intent rule already adopted:
  - per scripted wave, baseline expected spawns >= 1 after due overrides.

Content target:
- At least one due scripted wave includes a spawn coordinate in the player-side half (`col < floor(cols / 2)`).
- Initial non-boss placement for this template may include player-side candidates (via `enemySpawn` region tuning), without forcing guaranteed spawn on blocked/impassable tiles.

Acceptance:
- Harness baseline check confirms each scripted wave still has >=1 legal expected spawn.
- Encounter logs show at least one reinforcement spawn opportunity in the player-side half in baseline conditions.

### 3.3 Vertical map-size reduction (primary readability fix)

- Reduce large late-game map heights by 1 row (bottom trim via row-count reduction):
  - `Act 4 (Large)`: `18x14 -> 18x13`
  - `Post-Act`: `18x14 -> 18x13`
  - `Final Boss`: `20x14 -> 20x13`
- If readability remains unacceptable after smoke verification, apply fallback 2-row trim:
  - `Act 4 (Large)`: `18x14 -> 18x12`
  - `Post-Act`: `18x14 -> 18x12`
  - `Final Boss`: `20x14 -> 20x12`
- Keep row-trim scope limited to map-size data plus tests; do not add camera or tile-size changes in this slice.
- Keep existing objective, reinforcement legality, and hybrid override ordering unchanged.

Acceptance:
- `data/mapSizes.json` no longer exposes `18x14`/`20x14` once this slice lands.
- In act4/final-boss battles, bottom command labels remain readable in baseline play without relying on new HUD overlays.
- No regression to command click/tap behavior, turn flow, or scripted-wave determinism.

### 3.4 Large-map HUD fallback hardening (only if needed)

- If row reduction alone is insufficient, add a dedicated bottom HUD backdrop behind command rows.
- Keep bindings and interaction model unchanged.
- No camera-pan or map-scaling redesign in this spec.

Acceptance:
- Command rows are readable on every active late-game size variant after the chosen trim level.

## 4. Non-goals

- No boss stat/AI/skill rebalance.
- No new map generation contract fields.
- No new reinforcement scheduling rules.
- No full HUD architecture rewrite.
- No camera/zoom system redesign.

## 5. Affected Files (Expected)

- `src/scenes/BootScene.js`
- `src/scenes/BattleScene.js`
- `data/mapSizes.json`
- `data/mapTemplates.json`
- `public/data/mapTemplates.json`
- `tests/MapGenerator.test.js`
- `tests/harness/HeadlessBattle.test.js`
- `tests/harness/Determinism.test.js`
- `tests/Act4ProgressionGuards.test.js`
- `tests/TutorialBattle.test.js` (only if shared HUD layout assertions are impacted)
- `docs/mobile-controls-spec.md`
- `docs/mobile/agent-b-status.md`

## 6. Test Gate

- Visual/scene:
  - Emperor boss uses `enemy_emperor`.
  - Reduced-height late-game maps keep command row readable and interactable.
- Data/harness:
  - Act 4 boss template retains scripted-only reinforcement validity.
  - Baseline expected spawns remain >=1 for every scripted wave.
  - Determinism scenarios for boss templates still pass for same seed.
  - Act 4 map-size assertions updated to new expected set.

## 7. Rollout

1. Late-game map-size trim patch (`14 -> 13` first) + map-size test updates.
2. Emperor sprite routing patch (asset + key selection).
3. Act 4 boss template pressure tuning patch (data mirror + targeted tests).
4. Optional HUD backdrop fallback patch (only if readability remains below bar).

Each patch should be independently revertible.
