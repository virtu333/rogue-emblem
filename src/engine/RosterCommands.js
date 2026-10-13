import { specialCharacterRefusalText } from './SpecialCharacterDialogue.js';
// Shared class-change commands. All mutations are synchronous: input cannot
// interleave weapon grants and seal consumption. Revalidate ownership at apply.
import {
  canPromote,
  canReclass,
  canApplyReclass,
  resolvePromotionTargets,
  getReclassTargets,
  promoteUnit,
  reclassUnit,
  addToInventory,
  equipIfUnarmed,
  getCombatWeapons,
  normalizeEquippedFirst,
} from './UnitManager.js';
import { applyPromotionOath, oathBenchedNote } from './DeedSystem.js';
import { consumableSource, spendConsumableUse } from './RosterInventory.js';
import { classChangeItemBlock } from './TwistedBoons.js';
import { stripItemNameSuffix } from '../utils/itemNames.js';
import { INVENTORY_MAX } from '../utils/constants.js';

export function rosterClassChangeBlock(run, unit, item, gameData) {
  if (!run?.roster?.includes(unit)) return 'Unit is no longer in the roster.';
  // A seal works from the unit's bag or straight from the convoy.
  if (!consumableSource(run, unit, item) || !((item.uses ?? 1) > 0))
    return 'Seal is no longer available.';
  // Kingmaker's Oath: no Master Seal in this run (a reclass seal still works). The run's ban is
  // read first: it holds for every unit, whoever this one is.
  const banned = classChangeItemBlock(run, item);
  if (banned) return banned;
  const refusal = specialCharacterRefusalText(gameData, unit, item.effect);
  if (refusal) return refusal;
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
    ? promote(run, unit, item, canonical, gameData)
    : reclass(run, unit, item, canonical, gameData);
}
// Shared with previews: return catalog entries only, without creating UIDs or
// consuming RNG. One rule for promotion, reclass and a lord's promotion alike: the
// Iron weapon of each weapon type the class change newly opens, never one for a type
// already wielded (a lord's `promotionWeapons` also lists types the class already had).
export function getClassChangeWeaponGrants(unit, oldTypes, gameData) {
  const types = unit.proficiencies.filter((p) => !oldTypes.has(p.type)).map((p) => p.type);
  const names = new Set(unit.inventory.map((w) => stripItemNameSuffix(w.name)));
  return [...new Set(types)]
    .map((type) => gameData.weapons.find((w) => w.type === type && w.tier === 'Iron'))
    .filter((w) => {
      if (!w || names.has(w.name)) return false;
      names.add(w.name);
      return true;
    });
}
/**
 * Where each class-change grant would land, without changing anything: the bag while it has
 * room, then the run's convoy while it has room, else nowhere. The previews read this, so they
 * name the same place `grantClassChangeWeapons` puts the weapon.
 * @returns {{ bag: object[], convoy: object[], lost: object[] }}
 */
export function planClassChangeWeaponGrants(run, unit, weapons, bagMax = INVENTORY_MAX) {
  let bagRoom = Math.max(0, bagMax - (unit?.inventory?.length || 0));
  let convoyRoom = 0;
  if (typeof run?.getConvoyCapacities === 'function' && typeof run?.getConvoyCounts === 'function')
    convoyRoom = Math.max(0, run.getConvoyCapacities().weapons - run.getConvoyCounts().weapons);
  const plan = { bag: [], convoy: [], lost: [] };
  for (const weapon of weapons || []) {
    if (bagRoom > 0) {
      bagRoom--;
      plan.bag.push(weapon);
    } else if (convoyRoom > 0) {
      convoyRoom--;
      plan.convoy.push(weapon);
    } else plan.lost.push(weapon);
  }
  return plan;
}
/**
 * Hand over a class change's starter weapons: into the bag (a unit left unarmed takes it up),
 * else into the convoy, as any other grant a full bag cannot take. Only a full convoy too loses
 * one, and the caller says so. `equip: false` leaves equipping to the caller (a Seal's command).
 * @returns {{ granted: string[], convoyed: string[], lost: string[] }}
 */
export function grantClassChangeWeapons(run, unit, weapons, { equip = true } = {}) {
  const out = { granted: [], convoyed: [], lost: [] };
  for (const weapon of weapons || []) {
    if (addToInventory(unit, weapon)) {
      if (equip) equipIfUnarmed(unit, unit.inventory.at(-1));
      out.granted.push(weapon.name);
    } else if (typeof run?.addToConvoy === 'function' && run.addToConvoy(weapon)) {
      out.convoyed.push(weapon.name);
    } else out.lost.push(weapon.name);
  }
  return out;
}
/** The player-facing notes for a grant that missed the bag (none when all fit). */
export function classChangeGrantNotices({ convoyed = [], lost = [] } = {}) {
  const notices = [];
  if (convoyed.length) notices.push(`Bag full: ${convoyed.join(', ')} sent to the convoy.`);
  if (lost.length) notices.push(`Bag and convoy full: ${lost.join(', ')} could not be granted.`);
  return notices;
}
function promote(run, unit, item, promotedClassData, gameData) {
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
  // A deed's Oath: sworn on player promotions only (never silent engine ones).
  const oath = applyPromotionOath(unit, gameData);
  const droppedSkills = [...(promotionResult?.droppedSkills || [])];
  if (oath?.learned) notices.push(`${oath.name}: learned ${oath.skillName}.`);
  if (oath?.benched) notices.push(oathBenchedNote(unit, oath));

  const grants = grantClassChangeWeapons(
    run,
    unit,
    getClassChangeWeaponGrants(unit, oldTypes, gameData),
    { equip: false },
  );
  notices.push(...classChangeGrantNotices(grants));

  // Consume the Master Seal
  spendConsumableUse(run, unit, item);

  return { ok: true, notices, droppedSkills, oath };
}
function reclass(run, unit, sealItem, newClassData, gameData) {
  if (!canReclass(unit)) return { ok: false, reason: 'This unit cannot reclass.' };
  const notices = [];
  const oldClassData = gameData.classes.find((c) => c.name === unit.className);
  if (!canApplyReclass(unit, newClassData, oldClassData, gameData.classes))
    return { ok: false, reason: 'Reclass data missing or invalid.' };
  // Track old proficiency types to detect new ones
  const oldTypes = new Set(unit.proficiencies.map((p) => p.type));

  const result = reclassUnit(
    unit,
    newClassData,
    oldClassData,
    gameData.classes,
    gameData.skills,
    gameData.traits || null,
  );

  if (result === null) return { ok: false, reason: 'Reclass is unavailable.' };

  const grants = grantClassChangeWeapons(
    run,
    unit,
    getClassChangeWeaponGrants(unit, oldTypes, gameData),
    { equip: false },
  );
  notices.push(...classChangeGrantNotices(grants));

  // A new proficiency's starter weapon is granted after reclass invalidates
  // the old equipment. Preserve valid equipment; repair only an empty slot.
  if (!unit.weapon) unit.weapon = getCombatWeapons(unit)[0] || null;
  normalizeEquippedFirst(unit);
  if (!unit.weapon)
    notices.push('No combat weapon equipped. Equip a compatible weapon before battle.');

  // Consume seal
  spendConsumableUse(run, unit, sealItem);

  return { ok: true, notices, droppedSkills: result?.droppedSkills || [] };
}
