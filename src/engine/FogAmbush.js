// Fog ambush: in fog of war the player plans moves around the enemies they can see.
// A hidden enemy never shapes the blue range; a move whose path runs into one stops
// on the last tile before it where the unit may stand, and the enemy is revealed.

/**
 * Where a planned path really ends.
 * @param {{col:number,row:number}[]} path - start tile first
 * @param {{ hiddenAt: (col:number,row:number) => object|null,
 *           blockedAt: (col:number,row:number) => boolean }} probes
 *   hiddenAt: the hidden enemy standing on a tile, if any.
 *   blockedAt: a tile the unit may pass but not stop on (another unit stands there).
 * @returns {{ path: {col:number,row:number}[], ambusher: object|null, stopIndex: number }}
 *   the path cut to its real end (unchanged, with ambusher null, when nothing hides on it)
 */
export function ambushStop(path, { hiddenAt, blockedAt }) {
  const steps = Array.isArray(path) ? path : [];
  for (let i = 1; i < steps.length; i++) {
    const ambusher = hiddenAt(steps[i].col, steps[i].row);
    if (!ambusher) continue;
    let stop = i - 1;
    while (stop > 0 && blockedAt(steps[stop].col, steps[stop].row)) stop--;
    return { path: steps.slice(0, stop + 1), ambusher, stopIndex: stop };
  }
  return { path: steps, ambusher: null, stopIndex: steps.length - 1 };
}

/**
 * Movement spent reaching `stopIndex` of an effective path: each walked step pays its
 * tile's cost; within an ice slide only the entry tile is paid (computeEffectivePath).
 */
export function pathCostTo(path, slideSegments, stopIndex, costAt) {
  let total = 0;
  for (let i = 1; i <= stopIndex && i < path.length; i++) {
    const seg = (slideSegments || []).find(
      (s) => i >= s.startIndex && i < s.startIndex + (s.slidePath?.length || 0),
    );
    if (seg && i !== seg.startIndex) continue;
    const cost = costAt(path[i].col, path[i].row);
    total += Number.isFinite(cost) ? cost : 1;
  }
  return total;
}
