// WeaponWear.js — Pure functions for worn weapons: a forge below zero.
// No Phaser deps. Spec: docs/specs/worn-weapons.md.
//
// A wear step is the reverse of one forge step of its stat, sized from FORGE_BONUSES
// (never hardcoded here): Dulled -1 Mt, Bent -5 Hit, Notched -5 Crit, Rusted +1 Weight.
// Wear is instance-only state in its own field, `weapon._wear = [{ stat, delta,
// priceLoss }, ...]` (oldest first), and never touches `_forgeLevel`, `_forgeBonuses`
// or `_forgeHistory`: a weapon is never worn and forged at once (a worn weapon cannot be
// forged, a forged one is not worn; repair first). Each step records what it actually
// did to the stat and to the price, so a repair restores both exactly, whatever the
// weapon's numbers were. Imbues coexist with wear (ImbueSystem recomposes the name).
//
// The display name mirrors forging: "<base> -N" (ASCII hyphen), `_baseName` kept the way
// forging keeps it. Every name-keyed lookup reads the base through utils/itemNames.js.

import {
  FORGE_BONUSES,
  FORGE_COSTS,
  FORGE_TIER_COST_MULTIPLIER,
  WEAR_MAX_STEPS,
  WEAR_PRICE_PENALTY_PER_STEP,
  REPAIR_COST_RATIO,
} from '../utils/constants.js';
import { composeWeaponName } from '../utils/itemNames.js';

// Item types that cannot wear (the same types that cannot be forged or imbued;
// tests/WeaponWear.test.js holds the two lists to each other).
const EXCLUDED_TYPES = new Set(['Staff', 'Scroll', 'Consumable', 'Accessory', 'Whetstone']);

/** The four stats a step can wear, in the forge's order. */
export const WEAR_STATS = Object.freeze(['might', 'hit', 'crit', 'weight']);

/** What each worn stat is called. */
export const WEAR_LABELS = Object.freeze({
  might: 'Dulled',
  hit: 'Bent',
  crit: 'Notched',
  weight: 'Rusted',
});

const STAT_NOUNS = Object.freeze({ might: 'Might', hit: 'Hit', crit: 'Crit', weight: 'Weight' });

/** One step's change to its stat: the negation of one forge step. */
export function wearDelta(stat) {
  return Object.hasOwn(FORGE_BONUSES, stat) ? -FORGE_BONUSES[stat] : 0;
}

function steps(weapon) {
  return Array.isArray(weapon?._wear)
    ? weapon._wear.filter((step) => step && Object.hasOwn(FORGE_BONUSES, step.stat))
    : [];
}

/** How many wear steps the weapon carries. */
export function wearCount(weapon) {
  return steps(weapon).length;
}

/** True if the weapon carries any wear. */
export function isWorn(weapon) {
  return wearCount(weapon) > 0;
}

// A stat is floored where the forge floors it: weight never goes below 0.
function setStat(weapon, stat, value) {
  weapon[stat] = stat === 'weight' ? Math.max(0, value) : value;
}

/**
 * Why a wear step cannot be applied to this stat of this weapon, or '' when it can.
 * Wear is for the weapons forging works on (same types), never a forged one, and
 * stops at WEAR_MAX_STEPS.
 */
export function wearBlock(weapon, stat) {
  if (!Object.hasOwn(FORGE_BONUSES, stat)) return 'Invalid wear stat.';
  if (!weapon || EXCLUDED_TYPES.has(weapon.type)) return 'This weapon cannot wear.';
  if ((weapon._forgeLevel || 0) > 0) return 'A forged weapon does not wear.';
  if (wearCount(weapon) >= WEAR_MAX_STEPS) return 'This weapon is as worn as it gets.';
  if (!Number.isFinite(weapon[stat])) return 'This weapon has no such stat.';
  return '';
}

/** True if one more step of `stat` can be applied. */
export function canWear(weapon, stat) {
  return !wearBlock(weapon, stat);
}

/** The stats a source of wear may still pick for this weapon (empty: it cannot wear). */
export function wearableStats(weapon) {
  return WEAR_STATS.filter((stat) => canWear(weapon, stat));
}

/**
 * The price after `count` steps: 15% of the pre-wear price per step, floored, at least 0.
 * Integer arithmetic (basis points) so a price never lands a gold short of the floor.
 */
function priceAfterSteps(basePrice, count) {
  const keep = Math.max(0, Math.round((1 - WEAR_PRICE_PENALTY_PER_STEP * count) * 10000));
  return Math.max(0, Math.floor((basePrice * keep) / 10000));
}

/**
 * Apply one wear step to a weapon, mutating it in place: the stat moves by the reverse of
 * a forge step, the name gains "-N" and the price drops. Never touches forge fields.
 * @param {object} weapon
 * @param {'might'|'hit'|'crit'|'weight'} stat
 * @returns {{ success: boolean, reason?: string, stat?: string, delta?: number }}
 */
export function applyWear(weapon, stat) {
  const reason = wearBlock(weapon, stat);
  if (reason) return { success: false, reason };

  if (!weapon._baseName) weapon._baseName = weapon.name;
  const worn = steps(weapon);
  weapon._wear = worn;

  const before = weapon[stat];
  setStat(weapon, stat, before + wearDelta(stat));
  const delta = weapon[stat] - before;

  const price = Number(weapon.price) || 0;
  const basePrice = price + worn.reduce((sum, step) => sum + (Number(step.priceLoss) || 0), 0);
  const nextPrice = priceAfterSteps(basePrice, worn.length + 1);
  const priceLoss = Math.max(0, price - nextPrice);
  weapon.price = price - priceLoss;

  worn.push({ stat, delta, priceLoss });
  weapon.name = composeWeaponName(weapon._baseName, { wearSteps: worn.length });
  return { success: true, stat, delta };
}

/** The stat of the most recent step (the one a repair removes), or null. */
export function nextRepairStat(weapon) {
  return steps(weapon).at(-1)?.stat ?? null;
}

/**
 * The gold to repair the weapon's most recent step: the stat's first forge price at the
 * weapon's tier, times REPAIR_COST_RATIO, rounded. -1 when nothing is worn.
 */
export function repairCost(weapon) {
  const stat = nextRepairStat(weapon);
  const base = stat ? FORGE_COSTS[stat]?.[0] : undefined;
  if (!Number.isFinite(base)) return -1;
  const tier = FORGE_TIER_COST_MULTIPLIER[weapon.tier] ?? 1;
  return Math.round(base * tier * REPAIR_COST_RATIO);
}

/** What a shop charges for one repair: the cost less the shop's forge discount, at least 1. */
export function repairPrice(weapon, discountRatio = 0) {
  const base = repairCost(weapon);
  if (base < 0) return -1;
  return discountRatio !== 0 ? Math.max(1, Math.floor(base * (1 - discountRatio))) : base;
}

/**
 * Remove the weapon's most recent wear step, mutating it in place: the stat and the price
 * return to what the step took, and the name drops to "-(N-1)" (or to the base name at 0).
 * Pure about gold: the caller charges `cost`.
 * @param {object} weapon
 * @param {number} [discountRatio=0] - the shop's forge discount (0-1)
 * @param {{ free?: boolean }} [options] - `free`: a repair that costs nothing (Smith's Mark)
 * @returns {{ success: boolean, cost?: number, stat?: string }}
 */
export function repairWeapon(weapon, discountRatio = 0, { free = false } = {}) {
  if (!isWorn(weapon)) return { success: false };
  const listed = repairPrice(weapon, discountRatio);
  if (listed < 0) return { success: false };
  const cost = free ? 0 : listed;

  const worn = steps(weapon);
  const step = worn.pop();
  const delta = Number.isFinite(step.delta) ? step.delta : wearDelta(step.stat);
  setStat(weapon, step.stat, weapon[step.stat] - delta);
  weapon.price = (Number(weapon.price) || 0) + Math.max(0, Number(step.priceLoss) || 0);

  if (worn.length > 0) {
    weapon._wear = worn;
    weapon.name = composeWeaponName(weapon._baseName || weapon.name, { wearSteps: worn.length });
  } else {
    weapon.name = weapon._baseName || weapon.name;
    delete weapon._wear;
    delete weapon._baseName;
  }
  return { success: true, cost, stat: step.stat };
}

/**
 * One line naming the wear, for cards and tooltips: "Worn 2/3: Dulled (−1 Might),
 * Bent (−5 Hit)". '' when nothing is worn.
 */
export function wearLine(weapon) {
  const info = wearDisplay(weapon);
  if (info.count <= 0) return '';
  const parts = info.steps.map((step) => `${step.label} (${step.effect})`);
  return `Worn ${info.count}/${info.max}: ${parts.join(', ')}`;
}

/** The signed change a stat has taken from wear (0 when unworn). */
export function wearStatDelta(weapon, stat) {
  return steps(weapon)
    .filter((step) => step.stat === stat)
    .reduce((sum, step) => sum + (Number.isFinite(step.delta) ? step.delta : wearDelta(step.stat)), 0); // prettier-ignore
}

const signed = (n) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/**
 * Display info for a worn weapon: one entry per step, oldest first, named for what the
 * wear did ("Dulled", "Bent", "Notched", "Rusted") with its effect ("−1 Might").
 * @param {object} weapon
 * @returns {{ count: number, max: number, steps: Array<{ stat: string, label: string, effect: string, restore: string }>, labels: string[], text: string, deltas: object }}
 */
export function wearDisplay(weapon) {
  const list = steps(weapon).map((step) => {
    const amount = wearDelta(step.stat);
    return {
      stat: step.stat,
      label: WEAR_LABELS[step.stat],
      effect: `${signed(amount)} ${STAT_NOUNS[step.stat]}`,
      // What mending this step gives back: the opposite change.
      restore: `${signed(-amount)} ${STAT_NOUNS[step.stat]}`,
    };
  });
  return {
    count: list.length,
    max: WEAR_MAX_STEPS,
    steps: list,
    labels: list.map((step) => step.label),
    text: list.map((step) => step.label).join(' · '),
    deltas: Object.fromEntries(WEAR_STATS.map((stat) => [stat, wearStatDelta(weapon, stat)])),
  };
}
