# Spec: Weapon Imbues (rare weapon blessings)

**Design log entry:** `docs/design-log.md` (2026-07-04)
**Branch:** `claude/rogue-emblem-early-game-5djnaz-imbues`
**Size:** Medium

## Intent

Rare loot that permanently attaches one special effect to a chosen weapon (lifesteal, anti-armor,
on-hit status, etc.). Deepens the forge/loot decision layer: a whetstone-like drop where the choice
of *which* weapon to bless matters, and imbued weapons become run-defining keepsakes.

## Current state (verified — the seams already exist)

- **Application/persistence model = forge:** `ForgeSystem.applyForge` mutates instance fields
  (`_forgeLevel`, `_forgeBonuses`, `_forgeHistory`, `_baseName`) on weapons that are always
  `structuredClone`d off `weapons.json`. Saves store weapons **by value** with no
  rehydrate-from-canonical merge (`RunManager.serializeUnit` :226-262, load :3530-3855 relinks by
  `uid`), so **any plain-data instance field persists automatically**.
- **Effect evaluation model = structured combatMods:** `Combat.normalizeCombatMods` (:161-192) /
  `mergeCombatMods` (:194-233); weapon-art mods merge at `Combat.js:1181-1182`. Supported keys
  include `drainPercent` (lifesteal plumbing already threaded through `computeStrike`,
  :977/:1091-1103), `effectiveness: {moveTypes, multiplier}` (anti-armor), `critBonus`, `hitBonus`,
  `atkBonus`, etc.
- **Post-combat status precedent:** poison applies at `Combat.js:1773-1803`
  (`parsePoisonDamage` → `poisonEffects` in the `resolveCombat` return); statuses via
  `StatusConditionSystem.applyCondition` (root/sleep/silence/acid defined in
  `constants.js:262-268`).
- **Whetstone delivery flow:** loot category `forge` → `LootFlowController.showForgeWeaponPicker`
  (:181) → pick weapon → apply → whetstone consumed, never enters inventory. `whetstones.json` is
  unschema'd (low-friction precedent).
- `weapons.schema.json` has `additionalProperties:false` — canonical `weapons.json` must NOT gain
  imbue fields; imbues are instance-only + a separate catalog file.
- Two data trees (`data/` + `public/data/`) must stay in sync.

## Design

### Catalog: `data/imbues.json` (new, with `schemas/imbues.schema.json`)

Six imbues, v1. Each: `{ id, name, adjective, description, lore, weight, effect }` where `effect`
is either a `combatMods` object (attacker-side, merged like weapon-art mods) or a post-combat op:

| id | adjective | effect |
|---|---|---|
| `vampiric` | Vampiric | `combatMods: { drainPercent: 0.3 }` — heal 30% of damage dealt per strike |
| `armorbane` | Sundering | `combatMods: { effectiveness: { moveTypes: ["Armored"], multiplier: 2 } }` |
| `keen` | Keen | `combatMods: { critBonus: 10, hitBonus: 5 }` |
| `venom` | Venomous | post-combat: poison 5 (reuse the `poisonEffects` path) |
| `binding` | Binding | post-combat: 30% chance to inflict `root` (1 phase) on the defender, via `applyCondition`; respects `statusImmunity` |
| `warded` | Warded | `combatMods: { defBonus: 2, resBonus: 2 }` (defensive imbue — also applies when defending; note: defender-side merge needed, mirror attacker path) |

Constraints: **one imbue per weapon** (v1); excluded types match forge exclusions (Staff, Scroll,
Consumable, Accessory, Whetstone).

### Instance representation & engine

- New pure module `src/engine/ImbueSystem.js`: `canImbue(weapon)`, `applyImbue(weapon, imbueDef)`
  (sets `weapon._imbueId`, prepends adjective to display name composing with forge's `_baseName`
  rename so "Vampiric Iron Sword +2" works in both orders of application), `getImbueCombatMods(weapon, imbuesData)`,
  `getImbueDisplayInfo(weapon, imbuesData)`.
- Combat wiring: merge `getImbueCombatMods(attackerWeapon)` into the attacker mods exactly where
  weapon-art mods merge (`Combat.js:1181`), and the defender-side equivalent for `warded`.
  Post-combat ops (`venom`, `binding`) emit into the existing `poisonEffects` / a new
  `imbueStatusEffects` array in the `resolveCombat` return, applied by the caller alongside
  :1773-1803 effects. **Keep resolution pure** — calculate in Combat.js, render in BattleScene.
- Forecast parity: imbue mods must appear in combat forecasts and in the headless harness
  (`tests/harness/HeadlessBattle.js`) — the parity suites will catch drift.

### Delivery

- New whetstone-like items ("Imbuing Stone" per imbue, plus a "Prismatic Stone" = player's choice
  of imbue) resolved from `imbues.json`. Reuse the existing **`forge` loot category** (no
  lootTables schema change): add stone names to act2+ `forge` arrays with low weight — rare by
  design, roughly half as common as Silver Whetstone.
- Loot flow: extend `LootFlowController` — picking an imbue stone opens the weapon picker
  (filtered by `canImbue`), then applies and consumes, mirroring
  `showForgeWeaponPicker`/`showForgeStatPickerLoot`.
- Not sold in shops v1 (loot-only preserves the "blessing" feel).

### UI

- Weapon inspect/tooltip: show imbue name + description (extend wherever forge display info
  renders, via `getImbueDisplayInfo`). Loot card tooltip for stones (pattern:
  `ShopController.js:1557-1563` whetstone tooltip).
- Reference viewer / compendium entry for imbues if the data-viewer enumerates item types.

## Tests

- `tests/ImbueSystem.test.js` (pattern: `tests/ForgeSystem.test.js` `makeWeapon` factory):
  apply/exclusions/one-per-weapon/name composition with forge.
- Combat: drainPercent heal, effectiveness multiplier, post-combat poison/root emission +
  statusImmunity gate (drive `resolveCombat`, pattern `tests/Combat.test.js`).
- Serialization round-trip: `_imbueId` survives `toJSON` → `fromJSON` → `relinkWeapon`.
- Loot: stones resolve from the `forge` category (`tests/LootSystem.test.js`,
  `tests/LootFlowController.test.js` patterns).
- Register any new content in `src/data/validators/contentContractValidator.js` +
  `tests/data/contentContract.test.js` as required; schema validation for `imbues.json`.
- Sync `public/data/` (`npm run sync-data`); run `npm test`, `check:data-parity`,
  `check:reference`, `sim:fullrun:harness:pr`.

## Out of scope

- Multiple imbues per weapon; imbue removal/transfer; shop-purchasable imbues; enemy imbued
  weapons; imbues on staves.
