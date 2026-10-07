import { getFootprint, isEntity } from './EntitySystem.js';
import { getConditions, parseStaffRange } from './StatusConditionSystem.js';
import { ACID_DAMAGE_PERCENT, STATUS_CONDITIONS } from '../utils/constants.js';
import { ACID_DAMAGE_TURNS } from './TerrainHazards.js';
import { isRecruitNpc } from './RecruitNpc.js';
import { goldPouchValue } from './GoldPouch.js';

// All inspection entry points use the same information boundary as map graphics.
// A recruit waiting on the map is always in view: the army knows who it came for
// (its banner already stood above the fog; now the recruit does too).
export function canInspectUnit(grid, unit) {
  if (!unit) return false;
  if (unit.faction === 'player' || !grid?.fogEnabled) return true;
  if (unit.faction === 'npc' && isRecruitNpc(unit)) return true;
  return (isEntity(unit) ? getFootprint(unit) : [unit]).some((t) => grid.isVisible(t.col, t.row));
}
/**
 * `getUnitAt` for choosing a destination tile (Blink, Warp/Rescue): a tile the fog
 * hides counts as taken. Offering unseen tiles "if free" would give a hidden unit
 * away by its tile's absence from the list.
 */
export function seenTileOccupant(grid, getUnitAt) {
  return (col, row) => (grid?.fogEnabled && !grid.isVisible(col, row)) || getUnitAt(col, row);
}
// Acid's words, shared by the unit's status line and the ground that applies it:
// the tick is TerrainHazards.computeAcidDamage and never leaves a unit below 1 HP.
const ACID_TICK = `loses ${Math.round(ACID_DAMAGE_PERCENT * 100)}% of max HP at turn start`;
const ACID_FLOOR = 'Never below 1 HP.';
const STATUS_TEXT = {
  sleep: ['Asleep', 'Cannot act. Wakes when damaged.'],
  silence: ['Silenced', 'Cannot use magic, weapon arts or staves.'],
  root: ['Rooted', 'Cannot move; can still act.'],
  wounded: ['Wounded', 'Recovers no HP except from a staff.'],
  acid: ['Acid', `${ACID_TICK[0].toUpperCase()}${ACID_TICK.slice(1)}. ${ACID_FLOOR}`],
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * A terrain's rule lines, for the tile info and "Terrain details": the status
 * its ground applies (terrain.json `hazardStatus`), in that status's own words
 * so the two cannot drift, then the terrain's `special` note.
 */
export function terrainRuleLines(terrain) {
  const lines = [];
  if (terrain?.hazardStatus === 'acid') {
    const name = STATUS_TEXT.acid[0];
    // BattleScene.processTerrainDamage: applied at the end of the unit's phase, never to fliers.
    lines.push(
      `Ending a turn here causes ${name}. Flying units are immune.`,
      `${name}: ${ACID_TICK}, for ${plural(ACID_DAMAGE_TURNS, 'turn')}. ${ACID_FLOOR}`,
    );
  }
  const special = typeof terrain?.special === 'string' ? terrain.special.trim() : '';
  if (special) lines.push(special);
  return lines;
}
export function statusDescriptions(unit) {
  return getConditions(unit).map((c) => {
    const [name, effect] = STATUS_TEXT[c.id] || [c.id, ''];
    const early = (c.recoveryChance ?? STATUS_CONDITIONS[c.id]?.recoveryChance ?? 0) > 0;
    const duration = Math.max(0, Number(c.turnsRemaining) || 0);
    return `${name} · ${early ? 'up to ' : ''}${duration} turn${duration === 1 ? '' : 's'}. ${effect}${early ? ' May recover at turn start.' : ''}`;
  });
}
export function statusStaffInfo(unit) {
  const staff = unit?.statusStaff;
  if (!staff || !(staff.uses > 0)) return null;
  const uses = Math.max(0, staff.uses - (staff._usesSpent || 0));
  return {
    staff,
    uses,
    ...parseStaffRange(staff.range),
    text: `${staff.name} · Range ${staff.range} · ${uses}/${staff.uses} uses`,
  };
}
export function statusStaffThreat(unit) {
  const info = statusStaffInfo(unit);
  if (!info?.uses) return null;
  // Recovery runs before the next enemy phase. Keep possible recoveries in the
  // preview; deterministic silence/sleep that survives that phase blocks it.
  const blocked = getConditions(unit).some(
    (c) =>
      ['sleep', 'silence'].includes(c.id) &&
      c.turnsRemaining > 1 &&
      (c.recoveryChance ?? STATUS_CONDITIONS[c.id]?.recoveryChance ?? 0) === 0,
  );
  return blocked ? null : info;
}

/**
 * What a foe carries for a Thief to steal (docs/specs/phase3.md 3G): the item and its
 * line ("Carrying: Vulnerary", "Carrying: Gold Pouch (500 G)"), or null. Callers show it
 * only for a unit the player may inspect (`carrierPipShown` is the one rule for the map).
 */
export function carriedItemInfo(unit) {
  const item = unit?.carriedItem;
  if (!item || typeof item.name !== 'string' || unit.faction === 'player') return null;
  const gold = goldPouchValue(item);
  return { item, text: `Carrying: ${item.name}${gold > 0 ? ` (${gold} G)` : ''}` };
}

/** Does the map draw the sack pip over this unit? Only while the unit itself is in view. */
export function carrierPipShown(grid, unit) {
  return Boolean(carriedItemInfo(unit)) && unit.currentHP > 0 && canInspectUnit(grid, unit);
}
