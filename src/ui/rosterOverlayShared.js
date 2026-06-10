// Shared layout constants/helpers for RosterOverlay and its extracted
// trade controller. Lives outside RosterOverlay.js to avoid a module cycle.

import { INVENTORY_MAX, CONSUMABLE_MAX } from '../utils/constants.js';

export const DEPTH_PICKER = 750;
export const DETAIL_X = 190;
export const DETAIL_WIDTH = 430;

export function truncateUnitNameForCapacityLabel(name, maxChars = 14) {
  const safeName = String(name || '');
  if (!Number.isInteger(maxChars) || maxChars < 4 || safeName.length <= maxChars) return safeName;
  return `${safeName.slice(0, maxChars - 3)}...`;
}

export function formatUnitCapacityLabel(unit, maxNameChars = null) {
  const inventoryCount = (unit?.inventory || []).length;
  const consumableCount = (unit?.consumables || []).length;
  const name =
    maxNameChars == null
      ? String(unit?.name || '')
      : truncateUnitNameForCapacityLabel(unit?.name, maxNameChars);
  return `${name} (Inventory ${inventoryCount}/${INVENTORY_MAX} | Consumables ${consumableCount}/${CONSUMABLE_MAX})`;
}
