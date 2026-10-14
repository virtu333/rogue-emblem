// SmithsExile.js - Smith's Exile (an act boss's trade card, docs/specs/blessings-v3.md §6.8,
// engine/TradeBoons.js `weapons_arrive_forged` and `forging_forbidden`): every weapon the army finds
// or buys arrives forged (+1 Might a step, free: its price and sale value stay the catalog's), and
// no forge is made anywhere. Pure: no Phaser, no DOM, never `Math.random`.
//
// Where a weapon arrives (each calls `forgeOnArrival` / `arrivalCopy`):
//   - battle loot: PendingBattleRewards.rollBattleRewardChoices forges the weapon cards it draws
//     (the first offer and every reroll alike; the draw records the steps, so a reroll forges as
//     the first offer did), so the card shows the weapon as it will arrive;
//   - a shop's purchase: ShopCommands.purchaseShopItem;
//   - an event's (or a contract's) item: EventEffects.applyItem.
// A recruit's kit, a start gift and a weapon that came before the card arrive as they always did,
// and a worn weapon arrives worn (a worn weapon takes no forge).
//
// Where forging is refused (`forgeBlockReason`): a shop's forge (ShopCommands.shopForgeBlock;
// repairing a worn weapon is a mend, not a forge, and stays open), a whetstone from loot
// (LootRewardCommands.applyRewardForge, the desktop loot flow; its card is marked), an event's
// `forge` step (EventEffects.planForge) and its `forgeableWeapon` choice filter (EventSystem).

import { applyForge, canForge } from './ForgeSystem.js';
import { forgingForbiddenOf, weaponArrivalForgeOf } from './TradeBoons.js';

/** What the player is told when a forge is refused. */
export const FORGE_FORBIDDEN_REASON = "Smith's Exile: no forging";
/** The mark on a whetstone the army cannot use (a loot card, an item's details). */
export const FORGE_FORBIDDEN_TAG = "Can't be used: Smith's Exile";

/** Why no forge may be made now, or '' when it may. */
export function forgeBlockReason(run) {
  return forgingForbiddenOf(run) ? FORGE_FORBIDDEN_REASON : '';
}

/** True for a whetstone that forges (an Imbuing Stone imbues, and is no forge). */
export function isForgingWhetstone(item) {
  return (
    item?.type === 'Whetstone' &&
    typeof item.forgeStat === 'string' &&
    !(typeof item.imbueId === 'string' && item.imbueId.length > 0)
  );
}

/** The tag a whetstone shows while forging is refused, or ''. */
export function whetstoneTag(run, item) {
  return forgingForbiddenOf(run) && isForgingWhetstone(item) ? FORGE_FORBIDDEN_TAG : '';
}

/**
 * Forge `item` in place as it arrives: `steps` free Might forges (default: the run's), as many as
 * it can take. Not a weapon, worn, or at its limit: unchanged. Returns `item`.
 */
export function forgeOnArrival(item, steps) {
  const count = Math.max(0, Math.trunc(Number(steps) || 0));
  for (let i = 0; i < count; i++) {
    if (!canForge(item)) break;
    if (!applyForge(item, 'might', 0, { free: true }).success) break;
  }
  return item;
}

/** The forge steps a weapon arrives with in `run` (0 without Smith's Exile). */
export function arrivalForgeSteps(run) {
  return weaponArrivalForgeOf(run);
}

/**
 * The instance of `item` that arrives in `run`: a forged copy when the card forges it, else
 * `item` itself (never touched).
 */
export function arrivalCopy(run, item) {
  const steps = arrivalForgeSteps(run);
  if (steps <= 0 || !canForge(item)) return item;
  return forgeOnArrival(structuredClone(item), steps);
}
