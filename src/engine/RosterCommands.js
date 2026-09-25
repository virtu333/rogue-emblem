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
  getCombatWeapons,
  normalizeEquippedFirst,
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
// Shared with previews: return catalog entries only, without creating UIDs or
// consuming RNG. Preserve the existing lord-specific starter-weapon rule.
export function getClassChangeWeaponGrants(unit, oldTypes, gameData, promotion = false) {
  const lordWeapons =
    promotion && gameData.lords.find((l) => l.name === unit.name)?.promotionWeapons;
  let types;
  if (lordWeapons) {
    const type = lordWeapons.match(/(\w+)/)?.[1];
    const labels = {
      Swords: 'Sword',
      Lances: 'Lance',
      Axes: 'Axe',
      Bows: 'Bow',
      Tomes: 'Tome',
      Staves: 'Staff',
      Light: 'Light',
    };
    types = [labels[type] || type];
  } else types = unit.proficiencies.filter((p) => !oldTypes.has(p.type)).map((p) => p.type);
  const names = new Set(unit.inventory.map((w) => w.name));
  return types
    .map((type) => gameData.weapons.find((w) => w.type === type && w.tier === 'Iron'))
    .filter((w) => {
      if (!w || names.has(w.name)) return false;
      names.add(w.name);
      return true;
    });
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

  for (const newWeapon of getClassChangeWeaponGrants(unit, oldTypes, gameData, true)) {
    if (!addToInventory(unit, newWeapon))
      notices.push(`Bag full: ${newWeapon.name} could not be granted.`);
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

  const result = reclassUnit(unit, newClassData, oldClassData, gameData.classes, gameData.skills);

  for (const newWeapon of getClassChangeWeaponGrants(unit, oldTypes, gameData)) {
    if (!addToInventory(unit, newWeapon))
      notices.push(`Bag full: ${newWeapon.name} could not be granted.`);
  }

  // A new proficiency's starter weapon is granted after reclass invalidates
  // the old equipment. Preserve valid equipment; repair only an empty slot.
  if (!unit.weapon) unit.weapon = getCombatWeapons(unit)[0] || null;
  normalizeEquippedFirst(unit);
  if (!unit.weapon)
    notices.push('No combat weapon equipped. Equip a compatible weapon before battle.');

  // Consume seal
  sealItem.uses = (sealItem.uses ?? 1) - 1;
  if (sealItem.uses <= 0) removeFromConsumables(unit, sealItem);

  return { ok: true, notices, droppedSkills: result?.droppedSkills || [] };
}
