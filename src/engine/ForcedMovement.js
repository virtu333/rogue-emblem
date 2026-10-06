// ForcedMovement — a unit moved by another unit's action (no Phaser, no RNG, no
// mutation except settleShove through ActionMovement.settleMoves).
//
// Every forced displacement is the same two-part move: a push of up to `distance`
// tiles in one direction (the push stops before the map's edge, ground the unit cannot
// stand on, or a unit), then, whenever the push puts the unit on Ice, the unit's slide
// (IceMovement.traceForcedSlide: walking's slide without its movement cost). Shove,
// Smite and the weapon-art push and ram all trace through traceForcedMove, so a slide
// ends the same way for each and the same way as a walk's.
//
// A slid tile counts as a tile of the push: ice never makes a push shorter, and a push
// with distance left when the slide leaves the Ice goes on from where the unit landed.
//
// What the player may know. A push's tiles are chosen from the board as the player
// knows it (`occupantAt`: a fogged tile counts as taken, BattleInformation
// .seenTileOccupant), so a hidden unit never decides which option exists. The slide is
// ground-and-bodies physics that follows from it: a preview traces it over the units
// the player knows (`slideOccupantAt`), and execution over the real board, so a hidden
// unit stops a slide the preview showed running on, as one stops a walk (FogAmbush.js).
//
// Not forced: a unit moving itself by an ability (Pull's puller stepping back, a weapon
// art's advance, retreat, through or swap, the Swap command) or a teleport (Blink, Warp)
// is not displaced by anyone and does not slide. Pull's ally is moved by the puller, but
// lands beside the puller, who then holds the next tile, so its slide is over before it
// starts (docs/specs/utility-abilities.md).
import { traceForcedSlide } from './IceMovement.js';
import { settleMoves } from './ActionMovement.js';

/** Shove moves its ally one tile. */
export const SHOVE_DISTANCE = 1;

const CARDINALS = Object.freeze([
  { dc: 0, dr: -1 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
]);

const inBounds = (grid, col, row) => col >= 0 && col < grid.cols && row >= 0 && row < grid.rows;

/**
 * Where a forced move of `unit` ends: up to `distance` tiles along (dc, dr), then the
 * slide of any Ice the push put it on (one rule, IceMovement.traceForcedSlide).
 *
 * @param {object} unit - at the tile the push starts from; needs col, row, moveType
 * @param {number} dc @param {number} dr - the direction, one axis
 * @param {number} distance - tiles of push
 * @param {{cols:number,rows:number,getMoveCost:Function,getTerrainAt?:Function}} grid
 * @param {(col:number,row:number)=>any} occupantAt - truthy for a tile the push cannot enter
 * @param {(col:number,row:number)=>any} [slideOccupantAt] - the same for a slide's tiles
 *   (default: occupantAt)
 * @returns {{col:number,row:number,steps:number,path:{col:number,row:number,slide?:true}[],
 *   slid:boolean,stop:null|'edge'|'terrain'|'unit',blocker:any,stoppedShort:boolean}}
 *   `steps` is every tile moved, slid ones included; `path` runs from the unit's tile to
 *   the landing (tiles of a slide carry `slide: true`); `stop` is what held the unit and
 *   `blocker` the unit that did; `stoppedShort` is true when something held it before the
 *   push's distance was spent (a ram's collision). Nothing moves: `steps` 0 is no move.
 */
export function traceForcedMove(
  unit,
  dc,
  dr,
  distance,
  grid,
  occupantAt = () => null,
  slideOccupantAt = occupantAt,
) {
  const force = Math.max(0, Math.trunc(Number(distance) || 0));
  let col = unit.col;
  let row = unit.row;
  let steps = 0;
  let slid = false;
  let stop = null;
  let blocker = null;
  const path = [{ col, row }];
  while (steps < force) {
    const nextCol = col + dc;
    const nextRow = row + dr;
    if (!inBounds(grid, nextCol, nextRow)) {
      stop = 'edge';
      break;
    }
    if (grid.getMoveCost(nextCol, nextRow, unit.moveType) === Infinity) {
      stop = 'terrain';
      break;
    }
    const occupant = occupantAt(nextCol, nextRow);
    if (occupant) {
      stop = 'unit';
      blocker = occupant;
      break;
    }
    col = nextCol;
    row = nextRow;
    steps++;
    path.push({ col, row });
    const slide = traceForcedSlide(unit, { col, row }, { dc, dr }, grid, slideOccupantAt);
    if (slide.slid) {
      slid = true;
      path[path.length - 1].slide = true;
      for (const tile of slide.path.slice(1))
        path.push({ col: tile.col, row: tile.row, slide: true });
      steps += slide.path.length - 1;
      col = slide.col;
      row = slide.row;
    }
    // Held on the ice: the slide ran into the edge, a unit or ground it cannot stand on.
    if (slide.stop && slide.stop !== 'off_ice') {
      stop = slide.stop;
      blocker = slide.blocker;
      break;
    }
  }
  return {
    col,
    row,
    steps,
    path,
    slid,
    stop,
    blocker,
    stoppedShort: stop !== null && steps < force,
  };
}

const liveUnit = (unit) => Boolean(unit) && unit.currentHP > 0 && !unit._removing;

/**
 * Allies `unit` can Shove: one per side, adjacent, with the tile beyond free for the
 * ally's move type (a fogged tile counts as taken, so a hidden foe never shows by an
 * option's absence). Where the ally ends is the push plus any slide, over the board as
 * the player knows it.
 * @param {object} ctx { grid, allies, getUnitAt, slideUnitAt? } getUnitAt is the seen-tile
 *   probe (BattleInformation.seenTileOccupant); slideUnitAt reads known units only.
 * @returns {Array<{ ally: object, destCol: number, destRow: number, dc: number, dr: number,
 *   steps: number, slid: boolean, path: object[] }>}
 */
export function findShoveTargets(unit, ctx = {}) {
  const { grid, allies, getUnitAt, slideUnitAt } = ctx;
  if (!liveUnit(unit) || !grid || !Array.isArray(allies)) return [];
  const targets = [];
  for (const { dc, dr } of CARDINALS) {
    const ally = allies.find(
      (u) => u !== unit && liveUnit(u) && u.col === unit.col + dc && u.row === unit.row + dr,
    );
    if (!ally) continue;
    const landing = traceForcedMove(ally, dc, dr, SHOVE_DISTANCE, grid, getUnitAt, slideUnitAt);
    if (landing.steps <= 0) continue;
    targets.push({
      ally,
      destCol: landing.col,
      destRow: landing.row,
      dc,
      dr,
      steps: landing.steps,
      slid: landing.slid,
      path: landing.path,
    });
  }
  return targets;
}

/**
 * The Shove, settled. With `world` ({ grid, getUnitAt, slideUnitAt }: the same probes
 * over the real board) the slide is traced where it really goes, so a unit the fog hid
 * stops it; without, the offered landing stands.
 * @returns {{ moves: object[], slid: boolean, blocker: object|null }} blocker is the unit
 *   that held the ally on the ice (null when nothing did)
 */
export function settleShove(target, world = null) {
  let landing = { col: target.destCol, row: target.destRow, path: target.path, slid: target.slid };
  let blocker = null;
  if (world) {
    // The offered landing lies on the push line, so it names the direction too.
    landing = traceForcedMove(
      target.ally,
      target.dc ?? Math.sign(target.destCol - target.ally.col),
      target.dr ?? Math.sign(target.destRow - target.ally.row),
      SHOVE_DISTANCE,
      world.grid,
      world.getUnitAt,
      world.slideUnitAt,
    );
    blocker = landing.blocker;
  }
  const move = { unit: target.ally, to: { col: landing.col, row: landing.row } };
  if (landing.slid) move.path = landing.path;
  return { moves: settleMoves([move]), slid: Boolean(landing.slid), blocker };
}
