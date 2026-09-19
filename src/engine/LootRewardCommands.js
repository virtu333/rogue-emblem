import { addToInventory, addToConsumables, canEquip, applyStatBoost } from './UnitManager.js';
import { canForge, canForgeStat, applyForge } from './ForgeSystem.js';
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
    ? `Needs ${item.rankRequired || 'proficiency'}`
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
    return { ok: false, reason: 'This weapon can no longer receive this upgrade.' };
  let result;
  if (isImbueStone(item)) {
    const imbue =
      item.imbueId === 'choice'
        ? getImbueList(gameData.imbues).find((entry) => entry.id === selection)
        : resolveStoneImbue(item, gameData.imbues);
    result = applyImbue(weapon, imbue);
  } else {
    const stat = item.forgeStat === 'choice' ? selection : item.forgeStat;
    if (!REWARD_FORGE_STATS.some((entry) => entry.key === stat) || !canForgeStat(weapon, stat))
      return { ok: false, reason: 'This forge stat is at its limit.' };
    result = applyForge(weapon, stat);
  }
  return { ok: result.success, reason: result.success ? '' : 'Upgrade unavailable.' };
}
