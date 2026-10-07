// Fog ambush: in fog of war the player plans moves around the units they can see
// (PlayerKnowledge.js). A hidden unit never shapes the blue range or the path
// preview; a move whose path runs into one stops on the last tile before it where
// the unit may stand, and the unit is revealed (an enemy there is an ambush).

import { isFreeSlideIndex } from './IceMovement.js';

/**
 * Where a planned path really ends.
 * @param {{col:number,row:number}[]} path - start tile first
 * @param {{ hiddenAt: (col:number,row:number) => object|null,
 *           blockedAt: (col:number,row:number) => boolean,
 *           passes?: (hidden: object) => boolean }} probes
 *   hiddenAt: the hidden unit standing on a tile, if any.
 *   blockedAt: a tile the unit may pass but not stop on (another unit stands there).
 *   passes: the mover has Pass and walks through this hidden unit as through a seen one
 *     (PassMovement.passesHiddenUnit), so it stops the walk only on the path's LAST tile,
 *     where the unit would have to stand.
 * @returns {{ path: {col:number,row:number}[], ambusher: object|null, stopIndex: number }}
 *   the path cut to its real end (unchanged, with ambusher null, when nothing hides on it)
 */
export function ambushStop(path, { hiddenAt, blockedAt, passes = () => false }) {
  const steps = Array.isArray(path) ? path : [];
  for (let i = 1; i < steps.length; i++) {
    const ambusher = hiddenAt(steps[i].col, steps[i].row);
    if (!ambusher) continue;
    if (i < steps.length - 1 && passes(ambusher)) continue;
    let stop = i - 1;
    while (stop > 0 && blockedAt(steps[stop].col, steps[stop].row)) stop--;
    return { path: steps.slice(0, stop + 1), ambusher, stopIndex: stop };
  }
  return { path: steps, ambusher: null, stopIndex: steps.length - 1 };
}

/**
 * Movement spent reaching `stopIndex` of an effective path: each walked step pays its
 * tile's cost; within an ice slide the entry tile is paid, the first tiles slid past it
 * are free and the rest are paid (IceMovement.js, as computeEffectivePath).
 */
export function pathCostTo(path, slideSegments, stopIndex, costAt) {
  let total = 0;
  for (let i = 1; i <= stopIndex && i < path.length; i++) {
    const seg = (slideSegments || []).find(
      (s) => i >= s.startIndex && i < s.startIndex + (s.slidePath?.length || 0),
    );
    if (seg && isFreeSlideIndex(i - seg.startIndex)) continue;
    const cost = costAt(path[i].col, path[i].row);
    total += Number.isFinite(cost) ? cost : 1;
  }
  return total;
}
