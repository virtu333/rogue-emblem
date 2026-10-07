// Steal — a Thief takes the item an adjacent foe carries (docs/specs/phase3.md 3G).
// Pure: no Phaser, no scene, never `Math.random`.
//
// The rules, in the order they are checked:
//   1. The foe carries something (`carriedItem`, set by EnemySpawnGear from `spawn.carries`).
//      It is the only thing Steal ever takes: never an equipped weapon, never the foe's other
//      gear. One Steal per carrier, because there is one item.
//   2. Speed: the thief's attack speed (Combat.calculateEffectiveSpeed, the equipped weapon's
//      weight counted) must be at least the foe's. Equal is allowed; one slower is "Too slow".
//   3. Room, checked before anything moves: the thief's own bag first, then the convoy. With
//      neither, Steal is refused ("Bag and convoy full") and nothing changes.
//
// THE TRANSFER IS ONE ATOMIC OPERATION. `settleSteal` plans first, then moves the SAME item
// (its uid, uses, forge and wear fields) out of the carrier into exactly one destination,
// and only then clears the carrier. A refused Steal touches nothing. The caller runs it
// inside `settleAndPresent`, so the checkpoint that follows holds both sides at once:
// the carrier (unit state) and the convoy (`runBattleState`) come back together on a
// rewind, a resume or a Continue from Map, and the item can neither exist twice nor vanish.
// The convoy copy keeps the uid the item was made with, as a village visit's reward does
// (VillageController): `RunManager.removeFromConvoyByUid` can take exactly this item out.
import { calculateEffectiveSpeed } from './Combat.js';
import { CONSUMABLE_MAX, INVENTORY_MAX } from '../utils/constants.js';
import { ensureItemUid } from '../utils/itemUid.js';

export const STEAL_ABILITY_KIND = 'steal_item';

/** Why a Steal is refused (the row's note names it). */
export const STEAL_REASONS = Object.freeze({
  noItem: 'no_item',
  tooSlow: 'too_slow',
  full: 'full',
});

const isItem = (item) =>
  Boolean(item) &&
  typeof item === 'object' &&
  !Array.isArray(item) &&
  typeof item.name === 'string';

/** The item a unit carries for a Thief to steal, or null. */
export function carriedItemOf(unit) {
  return isItem(unit?.carriedItem) ? unit.carriedItem : null;
}

/** Attack speed as Steal reads it: SPD less the equipped weapon's effective weight. */
export function stealSpeed(unit) {
  return calculateEffectiveSpeed(unit, unit?.weapon ?? null);
}

/** True when the thief is at least as fast as the foe (the FE rule: equal is allowed). */
export function isFastEnoughToSteal(thief, carrier) {
  return stealSpeed(thief) >= stealSpeed(carrier);
}

/** Does the thief's own bag have a free slot for this item (its kind's bag)? */
export function bagHasRoom(unit, item) {
  if (!unit || !isItem(item)) return false;
  if (item.type === 'Consumable') return (unit.consumables || []).length < CONSUMABLE_MAX;
  if (item.type === 'Scroll') return false;
  return (unit.inventory || []).length < INVENTORY_MAX;
}

/**
 * Where the item would go: the thief's bag if it fits, else the convoy if it does, else
 * null. `canAddToConvoy` is the run's capacity probe (RunManager.canAddToConvoy); without
 * one there is no convoy.
 * @returns {'bag'|'convoy'|null}
 */
export function stealDestination(thief, item, { canAddToConvoy = null } = {}) {
  if (!isItem(item)) return null;
  if (bagHasRoom(thief, item)) return 'bag';
  if (typeof canAddToConvoy === 'function' && canAddToConvoy(item)) return 'convoy';
  return null;
}

/**
 * Why `thief` cannot steal from `carrier` right now, or null when it can. Speed is the first
 * word (a foe too quick to rob is "Too slow" however full the bag), then room.
 * @returns {'no_item'|'too_slow'|'full'|null}
 */
export function stealBlockReason(thief, carrier, ctx = {}) {
  const item = carriedItemOf(carrier);
  if (!item) return STEAL_REASONS.noItem;
  if (!isFastEnoughToSteal(thief, carrier)) return STEAL_REASONS.tooSlow;
  if (!stealDestination(thief, item, ctx)) return STEAL_REASONS.full;
  return null;
}

/** The row's word for a refusal ("Too slow", "Bag and convoy full"), or '' for none. */
export function stealReasonLabel(reason) {
  if (reason === STEAL_REASONS.tooSlow) return 'Too slow';
  if (reason === STEAL_REASONS.full) return 'Bag and convoy full';
  return '';
}

/**
 * Take the carrier's item, atomically. Checks room first; with none (or a missing item, or a
 * thief too slow) it returns null and changes nothing. Otherwise the same item instance goes
 * into one destination (the thief's bag, or the convoy under its own uid) and only then is
 * the carrier cleared.
 * @param {object} thief
 * @param {object} carrier
 * @param {{ run?: { canAddToConvoy: Function, addToConvoy: Function }|null }} [world]
 * @returns {{ thief: object, carrier: object, item: object, destination: 'bag'|'convoy',
 *   uid: string }|null}
 */
export function settleSteal(thief, carrier, { run = null } = {}) {
  const item = carriedItemOf(carrier);
  if (!item) return null;
  const canAddToConvoy = run?.canAddToConvoy ? (candidate) => run.canAddToConvoy(candidate) : null;
  if (stealBlockReason(thief, carrier, { canAddToConvoy })) return null;
  const destination = stealDestination(thief, item, { canAddToConvoy });
  // The uid is assigned before the item can reach the convoy, so the convoy's copy shares it
  // (a rewind that removes the copy removes exactly this item).
  ensureItemUid(item);
  if (destination === 'bag') {
    const bag = item.type === 'Consumable' ? (thief.consumables ||= []) : (thief.inventory ||= []);
    bag.push(item);
  } else if (!run.addToConvoy(item)) {
    // The probe said there was room and the add disagreed: nothing has moved.
    return null;
  }
  delete carrier.carriedItem;
  return { thief, carrier, item, destination, uid: item.uid };
}
