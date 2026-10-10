import { getFootprint, isEntity } from './EntitySystem.js';
import { getConditions, parseStaffRange } from './StatusConditionSystem.js';
import { ACID_DAMAGE_PERCENT, STATUS_CONDITIONS } from '../utils/constants.js';
import { ACID_DAMAGE_TURNS } from './TerrainHazards.js';
import { isRecruitNpc } from './RecruitNpc.js';
import { goldPouchValue } from './GoldPouch.js';

// All inspection entry points use the same information boundary as map graphics.
// A recruit waiting on the map is always in view: the army knows who it came for
// (its banner already stood above the fog; now the recruit does too). Under Seer's Eye
// (an earned blessing: `grid.foesShown`, markFoesShown) the fog never hides a foe either:
// every enemy is drawn, inspectable and known to the previews (PlayerKnowledge), while the
// terrain stays fogged and the enemy AI's view never changes.
//
// ONE RULE for "does the player see this unit": `isUnitSeenAt` (a unit's body at a tile, for a
// walk, a path or a saved fog) and `canInspectUnit` (where it stands, plus the waiting recruit).
// Every presentation and preview reader goes through them, never a tile's sight alone and never
// `grid.foesShown` by hand (tests/SeersEyeReaders.test.js holds src/ui and src/scenes to it), so
// Seer's Eye cannot be honoured by one reader and forgotten by the next.

/**
 * Does the fog show this tile of `unit`'s body? Always without fog, for the player's own and,
 * under Seer's Eye, for a foe; else the tile's own sight (a grid with no sight rule hides nothing).
 */
export function isUnitTileSeen(grid, unit, col, row) {
  if (!grid?.fogEnabled || unit?.faction === 'player') return true;
  if (unit?.faction === 'enemy' && grid.foesShown === true) return true;
  return typeof grid.isVisible !== 'function' || Boolean(grid.isVisible(col, row));
}

/**
 * Would the player see `unit` standing at (col, row) (default: where it stands)? Any tile of its
 * body seen (an Entity's 3×3 footprint, anchored there), by isUnitTileSeen.
 */
export function isUnitSeenAt(grid, unit, col = unit?.col, row = unit?.row) {
  if (!unit) return false;
  const body = isEntity(unit) ? getFootprint({ ...unit, col, row }) : [{ col, row }];
  return body.some((t) => isUnitTileSeen(grid, unit, t.col, t.row));
}

/** Can the player inspect `unit` (and does every preview know it)? isUnitSeenAt, or a waiting recruit. */
export function canInspectUnit(grid, unit) {
  if (!unit) return false;
  if (unit.faction === 'npc' && grid?.fogEnabled && isRecruitNpc(unit)) return true;
  return isUnitSeenAt(grid, unit);
}

/**
 * True when this map's fog hides foes: fog on, and no Seer's Eye. (The fog's teaching hint reads
 * it: under the Eye the fog hides only the land.)
 */
export function fogHidesFoes(grid) {
  return Boolean(grid?.fogEnabled) && grid.foesShown !== true;
}

/**
 * A saved fog (a battle snapshot's `{ visible }`, or null for none) as a grid the rule above
 * reads: what the player saw at that moment. Seer's Eye is the live grid's (it holds for the whole
 * battle).
 */
export function savedFogView(fog, grid = null) {
  const visible = new Set(Array.isArray(fog?.visible) ? fog.visible : []);
  return {
    fogEnabled: Boolean(fog),
    foesShown: grid?.foesShown === true,
    isVisible: (col, row) => visible.has(`${col},${row}`),
  };
}
/**
 * Seer's Eye on a battle's grid: `battleParams.foesShown` (RunManager.getBattleParams, saved with
 * the battle) sets `grid.foesShown`, which isUnitTileSeen reads. BattleScene and the headless
 * harness both call this right after building the grid, a fresh start and a resume alike.
 */
export function markFoesShown(grid, battleParams) {
  if (!grid) return false;
  grid.foesShown = battleParams?.foesShown === true;
  return grid.foesShown;
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
