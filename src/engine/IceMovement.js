// Ice slides are priced (pure, no Phaser). Stepping onto Ice costs the tile, and the
// unit slides on in the direction it entered until it reaches a tile that is not Ice
// (resolveIceSlide in Grid.js). The first ICE_FREE_SLIDE_TILES tiles slid past the
// entry are free; each tile after that costs its move cost, and a slide whose next tile
// the unit can no longer pay for stops there, on the ice, and ends the move.
//
// Until 2026-10-06 every slide was free whatever its length, so a unit chained slides
// across a tundra map in one move (Infantry MOV 5 reached ~17 tiles on Glacier Run).
// The movement range (Grid.computeMovementRange), the committed path
// (computeEffectivePath) and the fog ambush's cost (FogAmbush.pathCostTo) all price a
// slide here, so the blue range, the preview, the move and Canto's remaining
// movement agree.

/** Tiles slid past the entry tile that cost nothing. */
export const ICE_FREE_SLIDE_TILES = 1;

/** True when the tile at this index of a slide path is free (the entry tile is paid as a step). */
export function isFreeSlideIndex(index) {
  return index >= 1 && index <= ICE_FREE_SLIDE_TILES;
}

/**
 * Where a slide stops when its tiles are paid for out of a movement allowance.
 * @param {{col:number,row:number}[]} slidePath - entry tile first, landing last (resolveIceSlide)
 * @param {number} entryCost - movement spent once the unit stands on the entry tile
 * @param {number} mov - the move's allowance
 * @param {(tile:{col:number,row:number}) => number} stepCost - a tile's move cost
 * @returns {{stopIndex:number, cost:number, complete:boolean}} the last slide index reached,
 *   the movement spent there, and whether the slide ran to its natural end (a slide cut
 *   short by the allowance ends the move).
 */
export function iceSlideStop(slidePath, entryCost, mov, stepCost) {
  const tiles = Array.isArray(slidePath) ? slidePath : [];
  let cost = entryCost;
  let stopIndex = 0;
  for (let i = 1; i < tiles.length; i++) {
    const step = isFreeSlideIndex(i) ? 0 : stepCost(tiles[i]);
    if (!Number.isFinite(step) || cost + step > mov) break;
    cost += step;
    stopIndex = i;
  }
  return { stopIndex, cost, complete: stopIndex >= tiles.length - 1 };
}
