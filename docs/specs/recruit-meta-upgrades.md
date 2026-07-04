# Spec: Recruit-Focused Meta Upgrades + Lord Upgrade Cost Rebalance

**Design log entry:** `docs/design-log.md` (2026-07-04)
**Branch:** `claude/rogue-emblem-early-game-5djnaz-recruit-meta`
**Size:** Medium (mostly data + small engine hooks + UI description branches)

## Intent

Tilt long-term meta-progression investment toward roster width instead of lord power:

1. Add new recruit-focused upgrades, flagship: **recruits join with a forged weapon** (very expensive).
2. Make lord base-stat and growth upgrades **more expensive than the recruit equivalents** so the
   cheap early meta purchases naturally build the roster, not the juggernaut.

Valor (lord categories) and supply (recruit categories) earn at identical rates
(`constants.js:237-242`), so cost numbers are directly comparable across categories.

## Current state (verified)

- `data/metaUpgrades.json`; schema `schemas/metaUpgrades.schema.json` (upgrade-level
  `additionalProperties: false`; effect objects are open — new effect keys are schema-legal).
  `public/data/metaUpgrades.json` must stay byte-identical (`tests/MetaUpgradesDataParity.test.js`;
  `npm run sync-data`).
- `costs[]` is indexed by current level; `effects[]` is cumulative per tier.
- Effect flattening: `MetaProgressionManager.getActiveEffects()` (src/engine/MetaProgressionManager.js:608-769).
  **New effect keys must be (a) initialized at :609-644 and (b) folded in the loop :646-752**, or they're silently dropped.
- Recruit weapon-on-join precedent: `grantLethalArmoryWeapon` + `masterOfArms`, applied at three spawn sites:
  1. `src/scenes/BattleScene.js:1433-1447` (map NPC recruits — canonical site)
  2. `src/engine/BossRecruitSystem.js:555-558, 584-587`
  3. `src/engine/RunManager.js:2368-2375` (`_createExtraStartingUnit` / Vanguard Cadre)
- Forging precedent to copy: `RunManager.createInitialRoster()` (src/engine/RunManager.js:2398-2416)
  applies `startingWeaponForge` to lords' weapons — shuffles `['might','crit','hit','weight']` and calls
  `ForgeSystem.applyForge(weapon, stat)` N times. Recruit weapons are fresh `structuredClone`s
  (`UnitManager.createRecruitUnit`, src/engine/UnitManager.js:541-566), so in-place `applyForge` is safe.
- HomeBase UI: any new effect key needs branches in `_formatEffectValue`
  (src/scenes/HomeBaseScene.js:888-935) AND `_getActionDesc` (:978-1019), or it renders `?`.
  `tests/HomeBaseSceneDescriptions.test.js` catches misses.

## Changes

### 1. New upgrades (all in `capacity` category → supply currency)

| id | name | maxLevel | costs | effect key | requires |
|---|---|---|---|---|---|
| `recruit_weapon_forge` | Quartermaster's Craft | 2 | 800, 1400 | `recruitWeaponForge: 1 / 2` | `lethal_armory` L1 + milestone `beatAct1` |
| `recruit_accessory` | Outfitted Recruits | 1 | 650 | `recruitStartingAccessory: 1` | milestone `beatAct1` |
| `recruit_xp` | Training Doctrine | 2 | 350, 700 | `recruitXpBonus: 0.10 / 0.20` | — |

Semantics:

- **`recruitWeaponForge` (flagship):** every recruit's join weapon (including Lethal Armory
  replacements and the Longbow secondary for archers) receives N forges via `applyForge` with the
  shuffled-stat pattern from `createInitialRoster`. Implement as a helper
  (e.g. `applyRecruitWeaponForge(unit, forgeCount)` near `grantLethalArmoryWeapon`) invoked at all
  three spawn sites after the existing lethal-armory/master-of-arms block. Colosseum mercs
  (ColosseumEngine.js:326/346) are *excluded* — they are purchased, not recruited; note this in the
  upgrade description ("Recruits who join your army…").
- **`recruitStartingAccessory`:** recruit joins with a random tier-1 *stat* accessory (reuse the
  pool logic behind the lord `startingAccessoryTier` effect at tier 1) placed in inventory, not
  auto-equipped.
- **`recruitXpBonus`:** +10%/+20% combat XP for non-lord units. Apply as a multiplier at the XP
  award site (where `calculateCombatXP` results are granted — coordinate with wherever latePressure
  multipliers already apply; keep it a pure multiplier, floor 1 XP). If the award-site plumbing
  turns out to be entangled with BattleScene, it is acceptable to scope this upgrade out of the PR
  and leave the other two — note the cut in the PR description.

### 2. Lord cost rebalance (`lord_bonuses`, data-only)

Target: lord growth/flat upgrades ≈ **1.5× the recruit equivalents** at matching tiers. Recruit
costs unchanged. Proposed (round to 25s):

- Lord growths (all six): `50,75,125,175,250` → `75,110,190,265,375`
  (HP variant `50,53,70,88,140` → `75,80,105,130,210`)
- Lord flats: `125,300,575` → `190,450,875` (scale each stat's existing curve by ~1.5, round to 25;
  keep relative ordering between stats, e.g. SPD stays priciest)
- Do **not** touch vision/legendary_heir/commander upgrades — they are identity purchases, not the
  stat-check treadmill.

Also update the archived-proposal-style guard test: `tests/MetaUpgradesBalancePatch.test.js`
hard-codes exact costs (cases array :8-49) — update every re-priced id there deliberately (this
test exists to force exactly this kind of conscious change).

### 3. UI

- Branches for the three new effect keys in `_formatEffectValue` + `_getActionDesc`.
- No new category, no schema change, no CATEGORIES change.

## Tests

- Extend `tests/MetaProgressionManager.test.js`: new effect keys surface in `getActiveEffects`.
- New tests modeled on `tests/BattleSceneLethalArmory.test.js` for forged-weapon-on-join at the
  BattleScene recruit site; plus BossRecruitSystem + `_createExtraStartingUnit` coverage.
- Update `tests/MetaUpgradesBalancePatch.test.js` for the rebalance.
- Keep `data/` and `public/data/` in sync (`npm run sync-data`); parity test enforces.
- Run `npm test`, `npm run check:data-parity`, `npm run check:reference`,
  `npm run sim:fullrun:harness:pr`. If `sim/lib/economyMeta.js` models upgrade costs, refresh it.

## Out of scope

- New meta categories; support/bond systems; changes to currency earn rates; colosseum merc pricing.
