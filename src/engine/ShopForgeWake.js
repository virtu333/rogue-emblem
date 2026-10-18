// ShopForgeWake.js - a shop's smith wakes an NG+ kept weapon's sleeping forges early
// (docs/specs/ng-plus.md §13.1). The act start still wakes them on its own (KeptForges.js); a
// shop lets the player pay to have the next ones sooner.
//
// Each shop wakes at most the act's awake limit (difficulty.json `ngPlus.keptForgeAwake`: Act I
// 2, II 4, III 6, IV 8) across the army, apart from its forge uses. One wake is the earliest
// sleeping forge, at the price forging that stat would cost the weapon as it stands awake (the
// shop's discount applies; Smith's Mark's credit is for forges and repairs, not wakes). The
// weapon's price is left as it was: a sleeping forge was always counted in it. A forge woken
// early is one the act start no longer has to wake.
//
// Pure: mutates only the run's gold and the weapon it is handed. No Math.random.
import { FORGE_COSTS, FORGE_STAT_CAP, FORGE_TIER_COST_MULTIPLIER } from '../utils/constants.js';
import { getStatForgeCount } from './ForgeSystem.js';
import {
  dormantForgeCount,
  hasDormantForges,
  keptForgeAwakeLimit,
  keptForgeBase,
  wakeForges,
} from './KeptForges.js';
import { keptForgeAwakeTable } from './NgPlusEcho.js';
import { forgeBlockReason } from './SmithsExile.js';
import { shopOwnedItems } from './ShopCommands.js';

const STAT_LABELS = { might: '+1 Might', hit: '+5 Hit', crit: '+5 Crit', weight: '−1 Weight' };

/** How many sleeping forges one shop wakes in an act (Infinity for an act the table leaves out). */
export function shopWakeLimit(run, act = run?.currentAct) {
  return keptForgeAwakeLimit(act, keptForgeAwakeTable(run?.gameData));
}

/** The sleeping forge a wake would bring back next: `{ stat, label }`, or null. */
export function nextDormantForge(weapon) {
  const step = hasDormantForges(weapon) ? weapon._dormantForges[0] : null;
  return step && STAT_LABELS[step.stat] ? { stat: step.stat, label: STAT_LABELS[step.stat] } : null;
}

/** What waking the next sleeping forge costs (-1 when there is none to wake). */
export function wakePrice(weapon, discountRatio = 0) {
  const next = nextDormantForge(weapon);
  if (!next) return -1;
  const costs = FORGE_COSTS[next.stat];
  const index = Math.min(getStatForgeCount(weapon, next.stat), FORGE_STAT_CAP - 1);
  const tier = FORGE_TIER_COST_MULTIPLIER[weapon.tier] ?? 1;
  const base = Math.round((costs[index] * tier) / 10) * 10;
  return discountRatio !== 0 ? Math.max(1, Math.floor(base * (1 - discountRatio))) : base;
}

/**
 * Why the shop cannot wake this weapon's next forge now, or '' when it can.
 * `expectedDormant` (the count the player reviewed) refuses a weapon that changed since.
 */
export function shopWakeBlock(
  run,
  weapon,
  { wakesUsed = 0, wakeLimit = 0, discount = 0, expectedDormant } = {},
) {
  if (!shopOwnedItems(run).some((row) => row.item === weapon))
    return 'This weapon is no longer available.';
  if (expectedDormant != null && dormantForgeCount(weapon) !== expectedDormant)
    return 'Weapon changed. Review it again.';
  if (!nextDormantForge(weapon)) return 'No forges are sleeping on this weapon.';
  const exiled = forgeBlockReason(run);
  if (exiled) return exiled;
  if (wakesUsed >= wakeLimit) return 'No wakes remain at this shop.';
  return run.gold < wakePrice(weapon, discount) ? 'Not enough gold.' : '';
}

/** Wake the weapon's next sleeping forge for gold, or change nothing. */
export function wakeShopWeapon(run, weapon, options = {}) {
  const reason = shopWakeBlock(run, weapon, options);
  if (reason) return { ok: false, reason };
  const next = nextDormantForge(weapon);
  const cost = wakePrice(weapon, options.discount);
  const awake = keptForgeBase(weapon) - dormantForgeCount(weapon);
  if (wakeForges(weapon, awake + 1) !== 1)
    return { ok: false, reason: 'This wake is unavailable.' };
  run.spendGold(cost);
  return { ok: true, cost, message: `Woke ${next.label} on ${weapon.name} for ${cost}G.` };
}
