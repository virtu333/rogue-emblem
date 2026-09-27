// A hand-written stand-in for engine/ItemTrade.js, for the trade menu's model and
// renderer tests. Its rules are a small subset of the real ones, written out here so
// each test's expectation can be read off them.

export const CONVOY = { kind: 'convoy' };
export const unitHolder = (unit) => ({ kind: 'unit', unit });
const CAPS = { inventory: 5, consumables: 3, accessory: 1 };

let nextUid = 1;
export const weapon = (name, extra = {}) => ({
  name,
  type: 'Sword',
  might: 5,
  uid: nextUid++,
  ...extra,
});
export const supply = (name) => ({ name, type: 'Consumable', uses: 3, uid: nextUid++ });
export const ring = (name) => ({ name, type: 'Accessory', effects: {}, uid: nextUid++ });

export function unit(
  name,
  { inventory = [], consumables = [], accessory = null, cannotEquip = [] } = {},
) {
  return { name, inventory, consumables, accessory, weapon: inventory[0] || null, cannotEquip };
}

/**
 * Rules (a subset of ItemTrade's, enough to drive every row state):
 * convoy / accessory refused in battle; same holder; different bags; give into a
 * full bag; `unit.keepLast` refuses giving away the last weapon; warnings for
 * `cannotEquip` names and for a unit left with no weapon.
 */
export function fakeEngine({
  convoy = { weapons: [], consumables: [] },
  convoyCaps = { weapons: 6, consumables: 4 },
} = {}) {
  const calls = [];
  const convoyBag = (bag) => (bag === 'inventory' ? convoy.weapons : convoy.consumables);
  const items = (holder, bag) => {
    if (holder.kind === 'convoy') return bag === 'accessory' ? [] : convoyBag(bag);
    if (bag === 'accessory') return holder.unit.accessory ? [holder.unit.accessory] : [];
    return holder.unit[bag];
  };
  const capacity = (holder, bag) => {
    if (holder.kind === 'convoy')
      return bag === 'accessory' ? 0 : convoyCaps[bag === 'inventory' ? 'weapons' : 'consumables'];
    return CAPS[bag];
  };
  return {
    calls,
    bagItems: (ctx, holder, bag) =>
      // The convoy hands out clones, like RunManager.getConvoyItems.
      holder.kind === 'convoy' ? items(holder, bag).map((i) => ({ ...i })) : items(holder, bag),
    bagCapacity: (ctx, holder, bag) => capacity(holder, bag),
    planTrade(ctx, from, to) {
      calls.push({ ctx, from, to });
      if (
        ctx.context === 'battle' &&
        (from.holder.kind === 'convoy' || to.holder.kind === 'convoy')
      )
        return { ok: false, reason: 'The convoy is available between battles.' };
      if (from.holder === to.holder) return { ok: false, reason: 'Choose another unit.' };
      if (from.bag !== to.bag)
        return { ok: false, reason: 'Items trade only within the same bag.' };
      if (!to.item && items(to.holder, to.bag).length >= capacity(to.holder, to.bag))
        return { ok: false, reason: to.holder.kind === 'convoy' ? 'Convoy is full.' : 'Bag full.' };
      const giver = from.holder.unit;
      if (giver?.keepLast && !to.item && giver.inventory.length === 1)
        return { ok: false, reason: 'Keep at least one combat weapon.' };
      const warnings = [];
      const receiver = to.holder.unit;
      if (receiver?.cannotEquip.includes(from.item.name))
        warnings.push({ code: 'cannot_equip', unit: receiver, item: from.item });
      if (from.bag === 'inventory' && giver && !to.item && giver.inventory.length === 1)
        warnings.push({ code: 'leaves_unarmed', unit: giver });
      return { ok: true, kind: to.item ? 'swap' : 'give', warnings, detail: from.item.name };
    },
  };
}
