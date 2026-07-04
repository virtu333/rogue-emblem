// StaffRelocation — pure helpers for Warp/Rescue staff targeting.
// Ally-relocation is staff-exclusive by design ruling (docs/design-log.md,
// 2026-07-04) and player-only: enemies never relocate player units.
//
// Range semantics per staff kind (see data/mechanicsReference.json):
// - Rescue: `range` (+ MAG `rangeBonuses`) is the ally-TARGETING range; the
//   destination is a free tile adjacent to the caster.
// - Warp: the ally target is always adjacent (distance 1); `range`
//   (+ `rangeBonuses`) is the DESTINATION radius around the caster.
// Both reuse getEffectiveStaffRange unmodified for the MAG scaling.
// Destination legality is always judged by the moved ALLY's moveType.

import { getEffectiveStaffRange, gridDistance } from './Combat.js';

/** The relocate kind of a staff: 'rescue' | 'warp' | null. */
export function getRelocateKind(staff) {
  if (!staff || staff.type !== 'Staff') return null;
  return staff.relocate === 'rescue' || staff.relocate === 'warp' ? staff.relocate : null;
}

/** True when the weapon is a Warp/Rescue staff. */
export function isRelocateStaff(staff) {
  return getRelocateKind(staff) !== null;
}

/**
 * Full passable-unoccupied diamond around (centerCol, centerRow) within
 * Manhattan distance [minDistance..radius] for the given moveType.
 * Unlike AffixSystem.getWarpCandidates (max-distance ring only), this returns
 * EVERY legal tile — player-chosen destinations need the full diamond.
 *
 * @param {object} grid - { cols, rows, getMoveCost(col,row,moveType) }
 * @param {Function} getUnitAt - (col, row) => occupant or null
 * @param {number} centerCol
 * @param {number} centerRow
 * @param {number} radius - max Manhattan distance (inclusive)
 * @param {string} moveType - the moved ALLY's moveType (e.g. 'Infantry')
 * @param {object} [opts] - { minDistance = 1 }
 * @returns {Array<{col:number,row:number}>}
 */
export function getRelocationTiles(
  grid,
  getUnitAt,
  centerCol,
  centerRow,
  radius,
  moveType,
  { minDistance = 1 } = {},
) {
  const tiles = [];
  if (!grid || !Number.isFinite(radius) || radius < minDistance) return tiles;
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const dist = Math.abs(dr) + Math.abs(dc);
      if (dist < minDistance || dist > radius) continue;
      const col = centerCol + dc;
      const row = centerRow + dr;
      if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue;
      if (getUnitAt(col, row)) continue;
      if (grid.getMoveCost(col, row, moveType) === Infinity) continue;
      tiles.push({ col, row });
    }
  }
  return tiles;
}

/**
 * Legal destination tiles for relocating `ally` with `staff` cast by `caster`.
 * Rescue: free tiles adjacent to the caster. Warp: full passable-unoccupied
 * diamond of the staff's effective radius around the caster. Occupied tiles
 * (including the ally's own tile) are never returned.
 */
export function getRelocationDestinations(staff, caster, ally, grid, getUnitAt) {
  const kind = getRelocateKind(staff);
  if (!kind) return [];
  const radius = kind === 'rescue' ? 1 : getEffectiveStaffRange(staff, caster).max;
  return getRelocationTiles(grid, getUnitAt, caster.col, caster.row, radius, ally.moveType);
}

/**
 * Phase-1 ally targets for a relocate staff.
 * Rescue: living allies within the staff's effective targeting range,
 * excluding already-adjacent allies (relocation would be a no-op).
 * Warp: living adjacent allies.
 * Both: never the caster, and only allies with at least one legal destination.
 * NPC (green) units are excluded by construction — pass player units only.
 */
export function findRelocateTargets(staff, caster, playerUnits, grid, getUnitAt) {
  const kind = getRelocateKind(staff);
  if (!kind) return [];
  const range = getEffectiveStaffRange(staff, caster);
  const targets = [];
  for (const ally of playerUnits || []) {
    if (ally === caster) continue; // never self
    if (ally.currentHP <= 0 || ally._removing) continue;
    const dist = gridDistance(caster.col, caster.row, ally.col, ally.row);
    if (kind === 'rescue') {
      if (dist <= 1) continue; // already adjacent — pulling is a no-op
      if (dist < range.min || dist > range.max) continue;
    } else if (dist !== 1) {
      continue; // warp sends an ADJACENT ally
    }
    if (getRelocationDestinations(staff, caster, ally, grid, getUnitAt).length === 0) continue;
    targets.push(ally);
  }
  return targets;
}
