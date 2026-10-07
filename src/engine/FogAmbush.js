// Fog ambush: in fog of war the player plans moves around the units they can see
// (PlayerKnowledge.js). A hidden unit never shapes the blue range or the path
// preview; a move whose path runs into one stops on the last tile before it where
// the unit may stand, and the unit is revealed (an enemy there is an ambush).
//
// Execution meets the REAL board, so the ice rules (IceMovement.js) hold against it too:
//   - a hidden unit on a tile the slide would slide ONTO (a slid tile) holds the slide, as
//     `slideAcrossIce` holds it for any occupant: the unit stops on the last free tile
//     before it, even a unit with Pass (Pass walks through a foe, never slides through one);
//   - a hidden unit on the ice ENTRY tile starts no slide, as `computeEffectivePath` and the
//     movement range treat an occupied entry (a normal step): a unit with Pass walks through
//     it and the slide starts on the next ice tile instead, so the later tiles are priced
//     from there (`reshapeSegments`).
// Either way the cut ends the move where it falls. An ambush is never a re-plan: the plan
// was drawn from what the player knew, the board has just shown it was wrong, and the
// player decides again (Canto, or the next unit) from the revealed board, as for any other
// ambush. A seen occupant is different only in that the range already knew it.

import { isFreeSlideIndex } from './IceMovement.js';

const slideLength = (seg) => seg?.slidePath?.length || 0;

/** The segment whose slid tile (not its entry) is this path index, if any. */
function slidSegmentAt(segments, index) {
  return segments.find((s) => index > s.startIndex && index < s.startIndex + slideLength(s));
}

/** The segment that starts a slide that moves on (more than the entry) at this path index. */
function entrySegmentAt(segments, index) {
  return segments.find((s) => s.startIndex === index && slideLength(s) > 1);
}

/**
 * The slide segments after a unit walks through a hidden occupant on a slide's entry tile:
 * the occupied entry is a normal step and the slide starts on the next tile (the rest of the
 * old slide), or not at all when nothing is left to slide over.
 */
function reshapeSegments(segments, seg) {
  const rest = { startIndex: seg.startIndex + 1, slidePath: seg.slidePath.slice(1) };
  return segments.flatMap((s) => (s !== seg ? [s] : slideLength(rest) > 1 ? [rest] : []));
}

/**
 * Walk a planned path against the real board. `slideSegments` are the slides the plan
 * made (computeEffectivePath); `segments` in the result are the slides the real walk makes.
 */
function scanPath(path, { hiddenAt, blockedAt, passes = () => false, slideSegments = [] }) {
  const steps = Array.isArray(path) ? path : [];
  let segments = slideSegments.slice();
  let reshapedBy = null;
  for (let i = 1; i < steps.length; i++) {
    const ambusher = hiddenAt(steps[i].col, steps[i].row);
    if (!ambusher) continue;
    if (i < steps.length - 1 && passes(ambusher) && !slidSegmentAt(segments, i)) {
      const seg = entrySegmentAt(segments, i);
      if (seg) {
        segments = reshapeSegments(segments, seg);
        reshapedBy = reshapedBy || ambusher;
      }
      continue;
    }
    let stop = i - 1;
    while (stop > 0 && blockedAt(steps[stop].col, steps[stop].row)) stop--;
    return { path: steps.slice(0, stop + 1), ambusher, stopIndex: stop, segments, reshapedBy };
  }
  return { path: steps, ambusher: null, stopIndex: steps.length - 1, segments, reshapedBy };
}

/**
 * Where a planned path really ends.
 * @param {{col:number,row:number}[]} path - start tile first
 * @param {{ hiddenAt: (col:number,row:number) => object|null,
 *           blockedAt: (col:number,row:number) => boolean,
 *           passes?: (hidden: object) => boolean,
 *           slideSegments?: {startIndex:number, slidePath:object[]}[] }} probes
 *   hiddenAt: the hidden unit standing on a tile, if any.
 *   blockedAt: a tile the unit may pass but not stop on (another unit stands there).
 *   passes: the mover has Pass and walks through this hidden unit as through a seen one
 *     (PassMovement.passesHiddenUnit), so it stops the walk only on the path's LAST tile,
 *     where the unit would have to stand, or where it would hold an ice slide.
 *   slideSegments: the slides the path was planned with (computeEffectivePath). Without
 *     them every tile is a walked tile.
 * @returns {{ path: {col:number,row:number}[], ambusher: object|null, stopIndex: number }}
 *   the path cut to its real end (unchanged, with ambusher null, when nothing hides on it)
 */
export function ambushStop(path, probes) {
  const { path: cutPath, ambusher, stopIndex } = scanPath(path, probes);
  return { path: cutPath, ambusher, stopIndex };
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

/**
 * A player's planned move, cut and priced against the real board: `ambushStop` plus the
 * movement it really spends. The scene's one entry (walk and Canto).
 * @param {{col:number,row:number}[]} path - the planned effective path
 * @param {{startIndex:number, slidePath:object[]}[]} slideSegments - its slides
 * @param {number} plannedCost - what the plan costs (the cost of an uncut, unreshaped move)
 * @param {object} probes - as `ambushStop`, plus
 *   costAt: (col,row) => a tile's move cost for this mover,
 *   allowance?: the movement the mover has to spend. Walking through a hidden unit on an
 *     ice entry can cost more than planned (the tile that was a free slide is now a step),
 *     and the range, seeing that unit, would not have offered the tile: a move that no
 *     longer pays stops where it can, and the unit it could not afford to pass is revealed.
 * @returns {{ path: object[], cost: number, ambusher: object|null, stopIndex: number,
 *   slideSegments: object[] }} slideSegments: the slides the executed path makes.
 */
export function fogMoveCut(path, slideSegments, plannedCost, probes) {
  const { costAt, allowance, ...cutProbes } = probes;
  const cut = scanPath(path, { ...cutProbes, slideSegments: slideSegments || [] });
  if (!cut.ambusher && !cut.reshapedBy) {
    const { path: whole, stopIndex } = cut;
    return {
      path: whole,
      cost: plannedCost,
      ambusher: null,
      stopIndex,
      slideSegments: slideSegments || [],
    };
  }
  let { stopIndex, ambusher } = cut;
  const priced = (index) => pathCostTo(path, cut.segments, index, costAt);
  if (Number.isFinite(allowance) && priced(stopIndex) > allowance) {
    while (stopIndex > 0 && (priced(stopIndex) > allowance || probes.blockedAt(path[stopIndex].col, path[stopIndex].row))) stopIndex--; // prettier-ignore
    ambusher = ambusher || cut.reshapedBy;
  }
  return {
    path: path.slice(0, stopIndex + 1),
    cost: priced(stopIndex),
    ambusher,
    stopIndex,
    slideSegments: cut.segments,
  };
}
