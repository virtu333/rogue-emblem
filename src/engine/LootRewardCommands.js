import { rosterAccessoryAction } from './RosterInventory.js';
import { addToInventory, addToConsumables, canEquip, applyStatBoost } from './UnitManager.js';
import { canForge, canForgeStat, forgeStatBlock, applyForge } from './ForgeSystem.js';
import {
  canImbue,
  isImbueStone,
  resolveStoneImbue,
  getImbueList,
  applyImbue,
} from './ImbueSystem.js';
import { INVENTORY_MAX, CONSUMABLE_MAX } from '../utils/constants.js';

export const REWARD_FORGE_STATS = [
  { key: 'might', label: '+1 Might' },
  { key: 'crit', label: '+5 Crit' },
  { key: 'hit', label: '+5 Hit' },
  { key: 'weight', label: '-1 Weight' },
];
export function rewardWeaponEligible(item, weapon) {
  return isImbueStone(item)
    ? canImbue(weapon)
    : item.forgeStat === 'choice'
      ? canForge(weapon)
      : canForgeStat(weapon, item.forgeStat);
}
export function rewardTargetBlock(run, item, target) {
  if (target === 'convoy') return run.canAddToConvoy?.(item) ? '' : 'Convoy full';
  if (!run.roster?.includes(target)) return 'Unit is no longer in the roster.';
  if (item.type === 'Consumable' && item.effect === 'statBoost') return '';
  const consumable = item.type === 'Consumable';
  const count = (consumable ? target.consumables : target.inventory)?.length || 0;
  if (count >= (consumable ? CONSUMABLE_MAX : INVENTORY_MAX)) return 'Bag full';
  // Loot recipients retain the existing equip eligibility rule. Roster trading
  // separately allows carrying an unusable weapon.
  return !consumable && !canEquip(target, item)
    ? `Needs ${item.type} proficiency${item.rankRequired ? ` (${item.rankRequired})` : ''}`
    : '';
}
export function applyRewardTarget(run, item, target) {
  const reason = rewardTargetBlock(run, item, target);
  if (reason) return { ok: false, reason };
  if (target === 'convoy') return { ok: !!run.addToConvoy(item), reason: 'Convoy full' };
  if (item.type === 'Consumable' && item.effect === 'statBoost') {
    applyStatBoost(target, item);
    return { ok: true };
  }
  const ok =
    item.type === 'Consumable'
      ? addToConsumables(target, { ...item })
      : addToInventory(target, { ...item });
  return { ok: !!ok, reason: ok ? '' : 'Bag full' };
}
export function applyRewardForge(run, gameData, item, unit, weapon, selection) {
  if (!run.roster?.includes(unit) || !unit.inventory?.includes(weapon))
    return { ok: false, reason: 'Weapon is no longer carried by this unit.' };
  if (!rewardWeaponEligible(item, weapon))
    return {
      ok: false,
      reason:
        !isImbueStone(item) && item.forgeStat !== 'choice'
          ? forgeStatBlock(weapon, item.forgeStat)
          : 'This weapon can no longer receive this upgrade.',
    };
  let result;
  if (isImbueStone(item)) {
    const imbue =
      item.imbueId === 'choice'
        ? getImbueList(gameData.imbues).find((entry) => entry.id === selection)
        : resolveStoneImbue(item, gameData.imbues);
    result = applyImbue(weapon, imbue);
  } else {
    const stat = item.forgeStat === 'choice' ? selection : item.forgeStat;
    const reason = forgeStatBlock(weapon, stat);
    if (reason) return { ok: false, reason };
    result = applyForge(weapon, stat);
  }
  return { ok: result.success, reason: result.success ? '' : 'Upgrade unavailable.' };
}

export function bundleTargetBlock(run, item, target, quantity = 1) {
  if (quantity === 1) return rewardTargetBlock(run, item, target);
  if (
    item.type !== 'Consumable' ||
    item.effect === 'statBoost' ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 3
  )
    return 'Invalid bundle.';
  if (target !== 'convoy' && !run.roster.includes(target))
    return 'Unit is no longer in the roster.';
  const room =
    target === 'convoy' ? 0 : Math.max(0, CONSUMABLE_MAX - (target.consumables?.length || 0));
  const spill = Math.max(0, quantity - room);
  const convoyRoom = run.getConvoyCapacities().consumables - run.getConvoyCounts().consumables;
  return spill > convoyRoom
    ? 'Not enough space for the entire bundle. Make room in the roster or convoy.'
    : '';
}
export function applyRewardBundle(run, item, target, quantity = 1) {
  if (quantity === 1) return applyRewardTarget(run, item, target);
  const reason = bundleTargetBlock(run, item, target, quantity);
  if (reason) return { ok: false, reason };
  for (let i = 0; i < quantity; i++) {
    const copy = { ...item };
    delete copy.uid;
    if (target !== 'convoy' && (target.consumables?.length || 0) < CONSUMABLE_MAX)
      addToConsumables(target, copy);
    else run.addToConvoy(copy);
  }
  return { ok: true };
}

// Claim and equip in the same reward transaction; replaced gear returns to the pool.
export function applyAccessoryReward(run, item, target) {
  if (target !== 'pool' && !run.roster?.includes(target))
    return { ok: false, reason: 'Unit is no longer in the roster.' };
  const copy = structuredClone(item);
  (run.accessories ||= []).push(copy);
  if (target !== 'pool') rosterAccessoryAction(run, target, copy);
  return { ok: true };
}
