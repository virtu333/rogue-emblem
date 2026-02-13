# Weapon Arts Expansion Status

## Phase 1

Status: READY

Date: 2026-02-13

### Scope Completed

- Added 17 new weapon arts (10 -> 27 total) across Sword/Lance/Axe/Bow/Tome/Light coverage.
- Added Tome/Light-compatible magic arts via `allowedTypes` while keeping existing core weapon types unchanged.
- Added `combatMods.statScaling` support end-to-end:
  - `WeaponArtSystem.getWeaponArtCombatMods`
  - `Combat.normalizeCombatMods`
  - `Combat.mergeCombatMods`
  - `Combat.getCombatForecast`
  - `Combat.resolveCombat`
- Implemented weapon-art follow-up suppression for normal SPD-based doubling only (brave/skill effects remain combinable).
- Updated compatibility checks in battle and overlays to respect `allowedTypes`.
- Updated meta innate art pooling (loot and run-start pool building) to map `allowedTypes` entries correctly.

### Tests Run

- PASS: `npx vitest run tests/WeaponArtSystem.test.js tests/Combat.test.js`
  - Executed in this environment as:
  - `npx vitest run tests/WeaponArtSystem.test.js tests/Combat.test.js --configLoader runner --pool=threads`
  - Reason: sandbox blocks process forking (`spawn EPERM`), so thread pool + config-runner mode is required.
- PASS: `npm run test:unit`
  - Executed in this environment as:
  - `npm run test:unit -- --configLoader runner --pool=threads`
  - Result: 61 files / 1079 tests passed.

### Known Risks

- Weapon-art active detection uses explicit `weaponArt: true` (from weapon-art mods) with `activated.id === 'weapon_art'` fallback; custom/nonstandard mod producers must keep one of these markers.
- This environment required non-default Vitest execution mode due process spawn restrictions; CI/local developer runs should still validate with standard commands in unrestricted shells.
- Art scroll production/pipeline remains deferred; existing scroll icon asset path is reserved for future scroll content:
  - `assets/sprites/ui/icon_scroll.png`

### Next Phase Entry Criteria

- Phase 1 scope remains green under required unit gates.
- No unresolved P0/P1 regressions from Phase 1 combat or weapon-art compatibility changes.
- Phase 2 implementation may begin for:
  - effectiveness modifiers
  - counter suppression flags
  - range bonus/override mechanics
  - associated BattleScene targeting/range refresh behavior
