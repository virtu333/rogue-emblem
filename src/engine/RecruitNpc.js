// Recruit NPCs: the green units a lord can Talk into the army.
//
// scene.npcUnits also holds the merchant caravan (CaravanSystem.createCaravanUnit,
// `isCaravan`): an NPC the enemies hunt and the army protects, never a recruit. It
// has no class data or growths and must stay an NPC for the caravan shop to open.
// Everything that reads "an NPC on the map" as "the recruit" (Talk, the RECRUIT
// banner, the objective line, the recruit field note, the first-turn lessons) asks
// these instead of the list's length. Enemies still attack every NPC (AIController).
//
// Every living NPC, recruit or caravan, is an ally to the army's staves (Fire
// Emblem lets staves mend green units): isNpcAlly / staffAllyCandidates below.
//
// Pure: no Phaser, no RNG.

/** A living NPC a lord can recruit with Talk (not the caravan, not mid-removal). */
export function isRecruitNpc(unit) {
  return Boolean(unit && !unit.isCaravan && !unit._removing && unit.currentHP > 0);
}

/** The first recruitable NPC in a list, or null. */
export function findRecruitNpc(units) {
  return (Array.isArray(units) ? units : []).find(isRecruitNpc) || null;
}

/** True while a recruitable NPC is on the field. */
export function hasRecruitNpc(units) {
  return findRecruitNpc(units) !== null;
}

/**
 * A living green unit the army's staves treat as an ally: a recruit NPC or the
 * merchant caravan. Never an enemy, never a unit mid-removal (Talked, escaped).
 */
export function isNpcAlly(unit) {
  return Boolean(unit && unit.faction === 'npc' && !unit._removing && unit.currentHP > 0);
}

/**
 * Who a player's heal or cure staff (and Healing Circle) may mend: the army first,
 * then the living NPC allies, so NPC rows follow the army's in target lists.
 * Relocation staves stay army-only (StaffRelocation.findRelocateTargets).
 */
export function staffAllyCandidates(playerUnits, npcUnits) {
  const army = Array.isArray(playerUnits) ? playerUnits : [];
  const npcs = (Array.isArray(npcUnits) ? npcUnits : []).filter(isNpcAlly);
  return [...army, ...npcs];
}
