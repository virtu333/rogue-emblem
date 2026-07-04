# Spec: Legendary Accessories (EXP Share, Mercury Sandals, +2)

**Design log entry:** `docs/design-log.md` (2026-07-04)
**Branch:** `claude/rogue-emblem-early-game-5djnaz-legendary-accessories`
**Size:** Medium

## Intent

Rare, build-around accessories that make roster play attractive without nerfing the lord. Flagship
is **Mentor's Band (EXP Share)**: the strong unit gives up their accessory slot so adjacent weaker
allies siphon XP from the holder's combats — juggernaut turns become roster development, at a real
cost (the juggernaut loses a combat accessory).

## Current state (verified)

- Accessories: `data/accessories.json` (30 entries) + `schemas/accessories.schema.json`. `effects`
  is strictly the 9 stat keys (`additionalProperties:false`); **`combatEffects` is free-form** —
  all new behavior keys go there, no schema change.
- Equip/unequip: `UnitManager.equipAccessory` (:1367) / `unequipAccessory` (:1403) →
  `applyAccessoryStats` (:1345) applies only `effects`; `combatEffects` are read live in combat.
- Condition vocabulary: `SkillSystem.isAccessoryConditionMet` (:128-174). **`adjacent_ally` (:133)
  is wired but unused by any accessory today** — free to use. Traits (PR #53) share this same gate.
- XP funnel: every grant flows through `BattleScene.awardScaledXP` (:8459; multiplier chain
  :8470-8473); combat entry is `BattleScene.awardXP` (:8425), which knows attacker, opponent,
  kill flag, and respects `opponent._noXP` (:8426).
- **Parity constraint:** the headless harness reimplements the XP path
  (`tests/harness/HeadlessBattle.js:2233, 2553`); `tests/BattleSceneCombatParity.test.js` /
  `tests/HarnessPhaseParity.test.js` require BattleScene and harness to agree — EXP Share must be
  mirrored in the harness.
- No accessory rarity tier exists; gating is per-act presence in `lootTables.json` `accessories`
  arrays (the lowest-friction mechanism — use it).
- Movement: nothing today changes a unit's effective `moveType`; `Grid.getMoveCost` returns
  `Infinity` on `"--"` regardless of costModifier, so terrain-ignoring requires a real moveType
  change, not a cost reduction.

## New accessories (4)

All gated to act3+act4 `accessories` loot pools (plus boss-weighted rolls), high prices; also
purchasable in act4 shops via the normal accessory shop pool if applicable.

### 1. Mentor's Band — EXP Share (combatEffects: `xpShare: 0.5`, price ~4500)

- When the **holder** is awarded combat XP in `awardXP`, each **adjacent** ally whose effective
  level (`getXpEffectiveLevel`) is **lower than the holder's** receives
  `calculateCombatXP(ally, opponent, opponentDied) * 0.5`, routed through `awardScaledXP` so all
  normal multipliers apply. Floor 1 XP. Holder's own XP unchanged.
- Computing from the *ally's* level is the point: an overleveled holder earns ~1 XP themselves,
  but the trainee's formula yields real XP — the band converts dead XP into roster growth.
- Respect `opponent._noXP`; no share on heal/dance XP (combat only, v1); no chaining (allies of
  allies), no double-grant if two bands are adjacent to the same fight (each band shares only from
  its own holder's combats).
- Mirror the logic at the harness XP sites; extend the parity tests' expectations.
- Level-up UI: reuse the existing queued level-up flow that multi-XP events already use (dance/
  heal precedents) — shares are awarded sequentially after the combat resolution.

### 2. Mercury Sandals — infantry flight (combatEffects: `moveTypeOverride: "Flying"`, price ~5000)

- On equip: store `unit._baseMoveType`, set `unit.moveType = 'Flying'`. On unequip: restore.
  Implement inside `equipAccessory`/`unequipAccessory` next to `applyAccessoryStats`.
- `normalizeUnitClassState` (UnitManager.js:932) re-syncs moveType from class on
  promotion/reclass — it must re-apply the override afterward when the accessory is equipped.
- **Deliberate tradeoff:** holder becomes a flier for combat too — bows/wind become effective
  against them (`Combat.js:261` keys off `moveType === 'Flying'`). State this in the item lore;
  it's the balancing cost of terrain-ignoring mobility.
- Serialization: moveType and `_baseMoveType` are plain fields on the unit; verify a save/load +
  unequip round-trip restores the base type (add a test).

### 3. Phalanx Band (combatEffects: `{defBonus: 2, resBonus: 2, hitBonus: 10, condition: "adjacent_ally"}`, price ~3500)

- Zero new plumbing — uses the existing accessory combat-mod block (`SkillSystem.js:410-421`)
  and the dormant `adjacent_ally` condition. Rewards formation play directly.

### 4. Pursuit Ring (combatEffects: `doubleThresholdReduction: 2`, price ~4000)

- Existing key (`Combat.js:810-811`); holder doubles at SPD+3 instead of SPD+5. A carry item that
  is *fair* because it competes with the other legendaries for the same slot.

## UI / text

- Labels for new combatEffects keys in `src/utils/accessoryText.js` (coverage enforced by
  `tests/accessoryTextCoverage.test.js`); Compendium renders conditions automatically.
- No new rarity UI; the price + act gating carries the "legendary" feel. Optional: gold-tinted
  name in loot cards if a cheap hook exists; do not build a rarity system.

## Tests

- Update `tests/Accessories.test.js` exact-count assertion (30 → 34).
- New: EXP Share unit tests (adjacency, lower-level filter, ally-formula XP, `_noXP`, floor,
  no-chaining) + harness mirror + parity suites stay green.
- Mercury Sandals: equip/unequip/moveType restore, promotion re-sync, flier-weakness in combat,
  save/load round-trip.
- Phalanx/Pursuit: combat-mod assertions via `resolveCombat` (pattern: `tests/Combat.test.js`).
- Schema validation (`tests/SchemaValidation.test.js`) and content-contract validator
  registration for new combatEffects keys if required (`src/data/validators/contentContractValidator.js`).
- Sync `public/data/accessories.json` + `lootTables.json` (`npm run sync-data`); run full gates
  (`npm test`, `check:data-parity`, `check:reference`, `sim:fullrun:harness:pr`).

## Out of scope

- A rarity/tier system for accessories; support/bond mechanics; baseline mentor XP (deferred —
  design log); changes to XP diminishing-return curves.
