# Worn weapons (a forge below zero)

Status: system and repair shipped; **no source yet**. Nothing in loot, shops or enemies
generates a worn weapon. The Event nodes will call `applyWear`.

A worn weapon carries **wear steps**, each the reverse of one forge step of a stat. A Village
forge repairs them. Engine: `src/engine/WeaponWear.js` (pure). Constants:
`src/utils/constants.js`, beside the forge's (`WEAR_MAX_STEPS`, `WEAR_PRICE_PENALTY_PER_STEP`,
`REPAIR_COST_RATIO`).

## The steps

| Wear | Stat | Effect | Reverses |
|---|---|---|---|
| Dulled | `might` | -1 Might | Forge +1 Might |
| Bent | `hit` | -5 Hit | Forge +5 Hit |
| Notched | `crit` | -5 Crit | Forge +5 Crit |
| Rusted | `weight` | +1 Weight | Forge -1 Weight |

A step's size is the negation of `FORGE_BONUSES[stat]`: never a second table. A weapon takes at
most `WEAR_MAX_STEPS` (3) steps; a stat may wear more than once.

Wear is **instance-only state** in its own field, like `_imbueId`: `weapon._wear = [{ stat,
delta, priceLoss }, ...]`, oldest first. Canonical weapons.json never gains wear fields. Each
step records what it really did (`delta`: the stat's change; `priceLoss`: the gold it took), so
a repair restores the weapon **exactly**, including a weight-0 weapon (rusted to 1, repaired
to 0) and a price that floors to nothing. A step with no `delta` (hand-built data) falls back to
the forge-sized step.

Might, Hit and Crit are not floored: a Notched 0-crit weapon has -5 Crit (combat adds SKL / 2
and clamps the total). Weight keeps the forge's floor of 0.

## Forge and wear never mix

- `_forgeLevel`, `_forgeBonuses` and `_forgeHistory` are never touched by wear, and a forge's
  cap, history and deforge refunds work as before.
- `canForge` is **false for a worn weapon** (`forgeStatBlock`: "Repair this weapon before
  forging it."): repair first. The shop's Forge tab lists worn weapons for repair.
- `applyWear` refuses a forged weapon (`wearBlock`). The same item types forge, imbue and wear
  (not Staff, Scroll, Consumable, Accessory, Whetstone; `tests/WeaponWear.test.js` holds the
  three lists together).
- **Imbues are allowed** on a worn weapon: `applyImbue` recomposes the name with the `-N`.
- The deforge blessings never go below an unforged weapon and do not touch wear
  (`deforgeWeapon` refuses a worn weapon).

## Name and price

- Name: `"<base> -N"` (ASCII hyphen, N = wear steps), mirroring forged `"<base> +N"`. `_baseName`
  is kept the way forging keeps it, and removed when the last step is repaired. With an imbue:
  `"Vampiric Iron Sword -2"`. `composeWeaponName` (utils/itemNames.js) is the one composer.
- Price: 15% of the pre-wear price per step, floored, at least 0 (500 G: 425, 350, 275). A
  repair gives back what the step took.

## Names are identity

Every lookup that maps a weapon to something reads the **undecorated** name through
`src/utils/itemNames.js` (`ITEM_NAME_SUFFIX_RE` = `\s[+-]\d+$`, `stripItemNameSuffix`,
`weaponCatalogNames`), so `-N` is handled wherever `+N` is:

- weapon-art gates (`WeaponArtSystem.catalogNameTokens`), the art lists and tooltips
  (`WeaponArtVisibility`, `UnitDetailOverlay`)
- icon ids (`itemIconIds.baseItemName`) and the icon mark (`.ia-wear`)
- combat fx families (`art/combatFx/fxFamilies.js`: `byName` now reads the catalog name, which a
  forged legendary such as "Firstwind +1" used to miss)
- save migrations (`ItemNameMigration`, `WeaponCatalogMigration`): old saves rename and refresh a
  worn item, and a worn Breachbolt still takes the catalog shot counts
- keyword tags, base lines, signature weapons and per-battle uses read fields, not names, and
  needed no change (`tests/WeaponWearNames.test.js` pins each).

A catalog name must never end in ` -N`/` +N` (the test fails if one does).

## Repair at a Village forge

The shop's Forge tab (`ShopMenu`) lists worn weapons; a worn weapon shows **Repair** in place of
the forge stat options. The Ruins has no forge, so no repair there.

- Each repair removes the **most recent** wear step.
- Cost `round(FORGE_COSTS[stat][0] * FORGE_TIER_COST_MULTIPLIER[tier] * REPAIR_COST_RATIO)` for
  that step's stat (a tier the table omits pays x1), e.g. Steel Sword: Dulled 200, Bent 125; Iron:
  Dulled 120. The shop's forge discount (blessings, ambush village) applies like it does to a forge
  (`repairPrice`, at least 1 G).
- A repair consumes **one of the shop's forge uses** (`SHOP_FORGE_LIMITS`, the same counter
  forging uses, `scene.shopForgesUsed`).
- Logic: `WeaponWear.repairCost / repairPrice / repairWeapon`; commands `ShopCommands.shopRepairBlock /
  repairShopWeapon` (gold, forge limit, stale weapon, ownership); `ShopMenu` is a thin renderer: the
  card names the wear ("Worn 2/3 · Dulled -1 Might · Bent -5 Hit"), the button reads
  `Repair · 125 G`, disabled with the reason when gold is short or the limit is spent, and a confirm
  states the stat restored and the combat numbers before and after.

## Display

Wherever a forged weapon shows its forge info a worn one shows its steps by name: the shop card
and row, the mobile roster card (`Worn 2/3: Dulled (-1 Might), Bent (-5 Hit)`), the roster and
unit-detail tooltips, the icon mark (`-N`), the "-N" name suffix in the roster, unit detail and trade
panes (warning colour, worn stats coloured), the convoy row and the forecast name, and the loot
screen's imbue picker (a worn weapon lists its steps in place of `[forge/15]`).

## Saves

`_wear` is plain data on the item, so it rides `RunManager.toJSON/fromJSON`, cloud sync, the convoy,
trades, unit transfer, the battle checkpoint and its rewind timeline like any instance field.

## Tests

`tests/WeaponWear.test.js` (engine), `tests/WeaponWearShop.test.js` (repair command),
`tests/WeaponWearShopMenu.test.js` (the real menu), `tests/WeaponWearNames.test.js` (name lookups,
migration, saves, convoy, trade).
