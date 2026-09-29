// PlayerKnowledge — the board as the player knows it (no Phaser deps, no mutation).
//
// Two views of one battle exist. The world (every unit) belongs to execution and
// the enemy AI. Everything shown to the player before they commit (blue ranges,
// path and slide previews, the Danger overlay, pinned and inspected reach, Threat
// Sight) reads this view instead, so a unit the fog hides can never shape it.
//
// A unit is known when it is the player's own, when the fog shows it
// (canInspectUnit: any tile of an Entity's footprint), or when a marker reveals it
// through the fog (the recruit's beacon, passed in as `revealed`).

import { canInspectUnit } from './BattleInformation.js';
import { getFootprint, isEntity } from './EntitySystem.js';

const tileKey = (col, row) => `${col},${row}`;
const isLive = (u) => Boolean(u) && !u._removing && u.currentHP > 0;
const tilesOf = (u) => (isEntity(u) ? getFootprint(u) : [u]);

/**
 * @param {{ grid: object, units: object[], revealed?: object[] }} world
 *   grid: fogEnabled + isVisible; units: every unit on the board (any faction);
 *   revealed: units a marker shows through the fog.
 */
export function createPlayerKnowledge({ grid, units = [], revealed = [] }) {
  const shown = new Set((revealed || []).filter(Boolean));
  const isKnown = (unit) => shown.has(unit) || canInspectUnit(grid, unit);
  const live = (units || []).filter(isLive);
  const known = live.filter(isKnown);

  return {
    isKnown,
    /** Live units the player knows of. */
    units: known,
    /** Map "col,row" -> { faction } of every known unit (Grid.getMovementRange). */
    positions() {
      const map = new Map();
      for (const u of known) {
        for (const t of tilesOf(u)) map.set(tileKey(t.col, t.row), { faction: u.faction });
      }
      return map;
    },
    /** Set of "col,row" tiles a known unit other than `exclude` stands on. */
    occupied(exclude = null) {
      const set = new Set();
      for (const u of known) {
        if (u === exclude) continue;
        for (const t of tilesOf(u)) set.add(tileKey(t.col, t.row));
      }
      return set;
    },
  };
}
