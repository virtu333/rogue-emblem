import { seenTileOccupant } from '../engine/BattleInformation.js';
import { playerKnowledgeOf } from './battleKnowledge.js';

/**
 * The two boards a forced move (Shove, Smite: engine/ForcedMovement.js) reads, as the
 * probes its tracer takes.
 *
 * `preview` is the board as the player knows it, for the options and the landing they
 * show: a push's tiles are chosen with a fogged tile counted as taken (a hidden unit
 * never decides which option exists), and a slide is traced over the units the player
 * knows, so a hidden unit never shortens the slide shown (PlayerKnowledge.js).
 *
 * `world` is the board as it is, for the action itself: the push's tiles are chosen
 * exactly as in the preview (so what the player was offered is what happens), and the
 * slide runs over every unit, so a unit the fog hid stops it, as one stops a walk
 * (FogAmbush.js).
 *
 * @returns {{ preview: object, world: object }} each { grid, getUnitAt, slideUnitAt }
 */
export function forcedMoveProbes(scene) {
  const real = (col, row) => scene.getUnitAt(col, row);
  const seen = seenTileOccupant(scene.grid, real);
  const knownTiles = playerKnowledgeOf(scene).occupied();
  return {
    preview: {
      grid: scene.grid,
      getUnitAt: seen,
      slideUnitAt: (col, row) => knownTiles.has(`${col},${row}`),
    },
    world: { grid: scene.grid, getUnitAt: seen, slideUnitAt: real },
  };
}
