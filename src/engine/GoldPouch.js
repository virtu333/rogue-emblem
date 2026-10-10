// GoldPouch — the consumable a foe carries and a Thief can steal (docs/specs/phase3.md 3G).
//
// consumables.json holds one "Gold Pouch" (effect `gold`, `value` the gold it is worth). The
// carry pool (lootTables.json carryPool) names the value per act (300 / 500 / 800), and the
// item made for a carrier takes it: `value` is what Use gives and the sale price is exactly
// that, so a pouch is never worth more sold than spent (price = value / SHOP_SELL_RATIO).
// Items are stored whole in saves, so the figure is fixed when the item is made and nothing
// re-reads the pool for an item that exists.
//
// Pure: no Phaser, no randomness, never mutates a catalog entry.
import { SHOP_SELL_RATIO } from '../utils/constants.js';

export const GOLD_POUCH_NAME = 'Gold Pouch';
export const GOLD_EFFECT = 'gold';

/** True for a Gold Pouch (any consumable whose effect is `gold`). */
export function isGoldPouch(item) {
  return item?.type === 'Consumable' && item.effect === GOLD_EFFECT;
}

/** The gold a pouch gives when used (0 for anything else or a bad value). */
export function goldPouchValue(item) {
  if (!isGoldPouch(item)) return 0;
  const value = Math.trunc(Number(item.value));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The price at which selling the pouch pays exactly `value` gold. */
export function goldPouchPriceFor(value) {
  const gold = Math.max(0, Math.trunc(Number(value) || 0));
  return Math.ceil(gold / SHOP_SELL_RATIO);
}

/**
 * A pouch worth `value` gold, as a fresh copy of the catalog template: use gives the value,
 * the sale price pays it. The template itself is never changed.
 */
export function makeGoldPouch(template, value) {
  const item = structuredClone(template);
  const gold = Math.max(0, Math.trunc(Number(value) || 0));
  if (gold > 0) {
    item.value = gold;
    item.price = goldPouchPriceFor(gold);
  }
  return item;
}
