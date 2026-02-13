# Weapon Arts Instance-Bound Refactor Plan

## Scope
Align weapon arts to instance-bound behavior across runtime, UI, and progression.

## Status (Feb 2026)
- Implemented on `main`.
- Legacy `weapon_art_infusion` references are migration-only compatibility; active progression uses `iron_arms`, `steel_arms`, and `art_adept`.

## Confirmed Decisions
- `Arcane Etching` (`weapon_art_infusion`) is removed from purchasable UI.
- Add meta upgrades: `iron_arms`, `steel_arms`, `art_adept`.
- Meta effects apply at run start and also affect shop/loot weapon art spawning.
- Keep Edric starting with both Iron + Steel swords for now.
- Overlay weapon-art display starts compact.
- Weapon rows render gray whenever currently unusable.

## Implementation Steps

### 1. Meta Upgrade Data + Migration
- Replace `weapon_art_infusion` in `data/metaUpgrades.json` and `public/data/metaUpgrades.json` with:
  - `iron_arms`
  - `steel_arms` (requires `iron_arms`)
  - `art_adept`
- Update Home Base meta description logic to remove "unlocks N weapon arts" text.
- Add save compatibility mapping so legacy `weapon_art_infusion` ownership migrates cleanly to new equivalents.

### 2. Canonical Runtime Model (Instance-Bound)
- Keep legacy unlock fields only for compatibility.
- Ensure runtime availability checks use weapon instance bindings only (`weaponArtIds` + legendary binding by weapon token).
- Remove unlock-set gating from player/enemy availability paths.

### 3. Run-Start Weapon Art Assignment
- In run initialization, assign random type-appropriate arts to starting Iron/Steel weapons based on purchased meta upgrades.
- Apply `art_adept` as one additional random art to one eligible starting weapon.
- Preserve slot cap (3), insertion order, duplicate prevention, and source tagging (`meta_innate`).

### 4. Shop + Loot Spawn Integration
- Update loot/shop generation to use new meta upgrade flags/effects instead of legacy unlock IDs.
- Continue tier/type filtering; keep deterministic/fail-closed behavior for invalid configs.
- Ensure spawned meta-bound arts are attached to weapon instances with source metadata.

### 5. Overlay UX: Show Arts Across Inventory
- Roster overlay: replace equipped-only weapon-art section with compact grouped display across all inventory weapons.
- Battle unit detail overlay: same compact grouped display across all inventory weapons.
- Keep hover/long-press tooltip behavior on each weapon row; include Special + bound arts + source.

### 6. Usability State Rendering
- Gray any weapon row that is currently unusable (no proficiency, rank too low, or other equip-invalid state).
- Keep forge/tier styling, but ensure unusable state has clear priority and remains readable.

### 7. Dev Presets + QA Paths
- Add dev preset with promoted Swordmaster (Mast rank) for Soulreaver and Mast-art QA.
- Keep existing weapon-art and battle smoke presets; expand as needed for future Mast weapon types.

### 8. Tests + Verification
- Update/add tests for:
  - meta upgrade schema + migration from legacy `weapon_art_infusion`
  - run-start assignment for `iron_arms` / `steel_arms` / `art_adept`
  - loot/shop spawn behavior with new meta flags
  - overlay compact grouped rendering across inventory weapons
  - gray unusable weapon row behavior
- Run targeted suites, then full unit suite.

## Acceptance Criteria
- Home Base no longer shows `Arcane Etching` or "unlocks N weapon arts" copy.
- Weapon arts are available only when bound to the relevant weapon instance.
- Starting loadout + shop/loot correctly reflect `iron_arms`, `steel_arms`, `art_adept`.
- Overlays clearly show weapon-art bindings for all inventory weapons (compact format).
- Unusable weapon rows are consistently gray.
- Legacy saves continue loading without data loss.
