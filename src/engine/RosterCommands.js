// Shared class-change commands. All mutations are synchronous: input cannot
// interleave weapon grants and seal consumption. Revalidate ownership at apply.
import {
  canPromote,
  canReclass,
  resolvePromotionTargets,
  getReclassTargets,
  promoteUnit,
  reclassUnit,
  addToInventory,
  removeFromConsumables,
} from './UnitManager.js';

export function rosterClassChangeBlock(run, unit, item, gameData) {
  if (!run?.roster?.includes(unit)) return 'Unit is no longer in the roster.';
  if (!unit.consumables?.includes(item) || !((item.uses ?? 1) > 0))
    return 'Seal is no longer available.';
  if (item.effect === 'promote') {
    if (!canPromote(unit)) return 'Requires a base class at level 10 or higher.';
    return resolvePromotionTargets(unit, gameData.classes, gameData.lords)?.length
      ? ''
      : 'No available promotion class.';
  }
  if (item.effect === 'reclass')
    return canReclass(unit) && getReclassTargets(unit, gameData.classes, item.subEffect).length
      ? ''
      : 'No valid reclass targets.';
  return 'This item cannot change class.';
}
export function applyRosterClassChange(run, unit, item, target, gameData) {
  const reason = rosterClassChangeBlock(run, unit, item, gameData);
  if (reason) return { ok: false, reason };
  const targets =
    item.effect === 'promote'
      ? resolvePromotionTargets(unit, gameData.classes, gameData.lords)
      : getReclassTargets(unit, gameData.classes, item.subEffect);
  const canonical = targets.find((c) => c.name === target?.name);
  if (!canonical) return { ok: false, reason: 'Class is no longer available.' };
  return item.effect === 'promote'
    ? promote(unit, item, canonical, gameData)
    : reclass(unit, item, canonical, gameData);
}
function promote(unit, item, promotedClassData, gameData) {
  const notices = [];
  const lordData = gameData.lords.find((l) => l.name === unit.name);
  let promotionBonuses;
  if (lordData) {
    promotionBonuses = lordData.promotionBonuses;
  } else {
    promotionBonuses = promotedClassData.promotionBonuses;
  }

  if (!promotionBonuses) return { ok: false, reason: 'Promotion data missing.' };

  // Track old types for new weapon grant
  const oldTypes = new Set(unit.proficiencies.map((p) => p.type));

  const promotionResult = promoteUnit(unit, promotedClassData, promotionBonuses, gameData.skills);

  // Grant Iron weapons for new proficiency types
  const lordPromoWeapons = lordData?.promotionWeapons;
  if (lordPromoWeapons) {
    const newType = lordPromoWeapons.match(/(\w+)/)?.[1];
    const typeMap = {
      Swords: 'Sword',
      Lances: 'Lance',
      Axes: 'Axe',
      Bows: 'Bow',
      Tomes: 'Tome',
      Staves: 'Staff',
      Light: 'Light',
    };
    const wpnType = typeMap[newType] || newType;
    const newWeapon = gameData.weapons.find((w) => w.type === wpnType && w.tier === 'Iron');
    if (newWeapon && !unit.inventory.some((w) => w.name === newWeapon.name)) {
      if (!addToInventory(unit, newWeapon))
        notices.push(`Bag full: ${newWeapon.name} could not be granted.`);
    }
  } else {
    for (const prof of unit.proficiencies) {
      if (oldTypes.has(prof.type)) continue;
      const newWeapon = gameData.weapons.find((w) => w.type === prof.type && w.tier === 'Iron');
      if (newWeapon && !unit.inventory.some((w) => w.name === newWeapon.name)) {
        if (!addToInventory(unit, newWeapon))
          notices.push(`Bag full: ${newWeapon.name} could not be granted.`);
      }
    }
  }

  // Consume the Master Seal
  item.uses = (item.uses ?? 1) - 1;
  if (item.uses <= 0) {
    removeFromConsumables(unit, item);
  }

  return { ok: true, notices, droppedSkills: promotionResult?.droppedSkills || [] };
}
function reclass(unit, sealItem, newClassData, gameData) {
  const notices = [];
  const oldClassData = gameData.classes.find((c) => c.name === unit.className);
  if (!oldClassData) return { ok: false, reason: 'Reclass data missing.' };
  // Track old proficiency types to detect new ones
  const oldTypes = new Set(unit.proficiencies.map((p) => p.type));

  reclassUnit(unit, newClassData, oldClassData, gameData.classes, gameData.skills);

  // Grant Iron weapons for newly gained proficiency types
  for (const prof of unit.proficiencies) {
    if (oldTypes.has(prof.type)) continue;
    const newWeapon = gameData.weapons.find((w) => w.type === prof.type && w.tier === 'Iron');
    if (newWeapon && !unit.inventory.some((w) => w.name === newWeapon.name)) {
      if (!addToInventory(unit, newWeapon))
        notices.push(`Bag full: ${newWeapon.name} could not be granted.`);
    }
  }

  // Consume seal
  sealItem.uses = (sealItem.uses ?? 1) - 1;
  if (sealItem.uses <= 0) removeFromConsumables(unit, sealItem);

  return { ok: true, notices, droppedSkills: [] };
}
