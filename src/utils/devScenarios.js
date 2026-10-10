// Dev review scenarios (dev server and Netlify deploy previews only, via devStartup's
// `battleParams.devScenario`). Applied once the army stands on its tiles, before turn 1.
import { showMinorHint } from '../ui/HintDisplay.js';
import { TILE_SIZE } from './constants.js';
import { UI_HEX } from './uiStyles.js';
import { setUnitHP } from '../engine/UnitHealth.js';

/**
 * fog_ambush: hide one enemy on the farthest fogged tile a player unit can reach this
 * turn (Edric first, then the rest of the army) and mark that tile. Moving the unit
 * onto the mark runs into the enemy: the ambush stop. Returns the placement, or null
 * when no unit can reach the fog (the battle plays as generated).
 */
export function placeFogAmbush(scene) {
  const grid = scene.grid;
  if (!grid?.fogEnabled) return null;
  const enemies = (scene.enemyUnits || []).filter((u) => u && !u.isBoss && u.currentHP > 0);
  if (!enemies.length) return null;
  const units = [...(scene.playerUnits || [])].sort(
    (a, b) => (b?.name === 'Edric') - (a?.name === 'Edric'),
  );
  const occupied = (col, row) =>
    [...scene.playerUnits, ...scene.enemyUnits, ...(scene.npcUnits || [])].some(
      (u) => u && u.currentHP > 0 && u.col === col && u.row === row,
    );
  for (const unit of units) {
    const range = grid.getMovementRange(
      unit.col,
      unit.row,
      Number(unit.mov ?? unit.stats?.MOV) || 0,
      unit.moveType || 'Infantry',
      scene.buildUnitPositionMap?.() || null,
      'player',
      scene._getCostModifier?.(unit) || 0,
    );
    let best = null;
    for (const [key, entry] of range || []) {
      if (entry?.stoppable === false) continue;
      const [col, row] = key.split(',').map(Number);
      if (grid.isVisible(col, row) || occupied(col, row)) continue;
      if (!best || entry.cost > best.cost) best = { col, row, cost: entry.cost };
    }
    if (!best) continue;
    // The enemy farthest from the army takes the spot (the fight nearby stays as is).
    const far = (u) => Math.abs(u.col - unit.col) + Math.abs(u.row - unit.row);
    const enemy = [...enemies].sort((a, b) => far(b) - far(a))[0];
    enemy.col = best.col;
    enemy.row = best.row;
    scene.updateUnitPosition?.(enemy);
    grid.updateFogOfWar(scene.playerUnits);
    scene.updateEnemyVisibility?.();
    scene.dangerZoneStale = true;
    const marker = markTile(scene, best);
    return { unit, enemy, spot: { col: best.col, row: best.row }, marker };
  }
  return null;
}

/** A gold outline on the tile to move onto (review only). */
function markTile(scene, { col, row }) {
  const pos = scene.grid?.gridToPixel?.(col, row);
  if (!pos || typeof scene.add?.rectangle !== 'function') return null;
  const marker = scene.add.rectangle(pos.x, pos.y, TILE_SIZE - 4, TILE_SIZE - 4);
  marker.setStrokeStyle?.(3, UI_HEX.accent);
  marker.setDepth?.(60);
  return marker;
}

/**
 * zombie_remains: the Rout comes down to one weak Zombie on an open tile beside Edric
 * (every other enemy and all reinforcements are gone). Attack it and it leaves remains
 * ("3"); end turns and the count falls; Smash them to win. Returns the placement, or
 * null when Edric has no open neighbour.
 */
export function placeZombieRemains(scene) {
  const grid = scene.grid;
  const edric = (scene.playerUnits || []).find((u) => u?.name === 'Edric');
  if (!grid || !edric || typeof scene.addEnemyFromSpawn !== 'function') return null;
  const occupied = (col, row) =>
    [...scene.playerUnits, ...scene.enemyUnits, ...(scene.npcUnits || [])].some(
      (u) => u && u.currentHP > 0 && u.col === col && u.row === row,
    );
  const tiles = [
    [1, 0],
    [-1, 0],
    [0, -1],
    [0, 1],
  ]
    .map(([dc, dr]) => ({ col: edric.col + dc, row: edric.row + dr }))
    .filter(({ col, row }) => {
      if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
      const cost = grid.getTerrainAt(col, row)?.moveCost?.Infantry;
      return cost !== '--' && cost != null && !occupied(col, row);
    });
  // Open ground first: no avoid bonus, so Edric's blow lands.
  const avoid = ({ col, row }) => Number(grid.getTerrainAt(col, row)?.avoidBonus) || 0;
  const tile = tiles.sort((a, b) => avoid(a) - avoid(b))[0];
  if (!tile) return null;
  // Splice in place: the turn manager holds this array.
  for (const enemy of scene.enemyUnits.splice(0)) scene.removeUnitGraphic?.(enemy);
  if (scene.battleConfig) scene.battleConfig.reinforcements = null;
  const zombie = scene.addEnemyFromSpawn({ className: 'Zombie', level: 1, ...tile });
  if (!zombie) return null;
  Object.assign(zombie.stats, { SPD: 0, LCK: 0, DEF: 0 });
  zombie.skills = [];
  setUnitHP(zombie, 1);
  scene.updateHPBar?.(zombie);
  if (grid.fogEnabled) {
    grid.updateFogOfWar(scene.playerUnits);
    scene.updateEnemyVisibility?.();
  }
  scene.dangerZoneStale = true;
  scene.updateObjectiveText?.();
  return { unit: edric, zombie, spot: { ...tile } };
}

/**
 * short_par: the battle's turn par is `battleParams.devPar` turns (like a par bump from
 * reinforcements, it is a field the checkpoint and a Vision rewind keep), so a contract's
 * "Under par" is broken after a few real turns. Returns the par, or null.
 */
export function setShortPar(scene) {
  const par = Math.trunc(Number(scene?.battleParams?.devPar));
  if (!(par > 0) || !scene.turnBonusConfig) return null;
  scene.turnPar = par;
  scene.renderTurnCounter?.();
  return par;
}

export function applyDevScenario(scene) {
  const scenario = scene?.battleParams?.devScenario;
  if (scenario === 'short_par') {
    const par = setShortPar(scene);
    scene._devScenarioResult = par;
    return par;
  }
  if (scenario === 'zombie_remains') {
    const placed = placeZombieRemains(scene);
    scene._devScenarioResult = placed;
    showMinorHint(
      scene,
      placed
        ? 'Review: fell the Zombie with Edric, end turns to watch the count, then Smash the bones.'
        : 'Review: no open tile beside Edric here; try another seed.',
    );
    return placed;
  }
  if (scenario !== 'fog_ambush') return null;
  const placed = placeFogAmbush(scene);
  scene._devScenarioResult = placed; // what was set up, for review tests
  showMinorHint(
    scene,
    placed
      ? `Review: move ${placed.unit.name} onto the gold-marked tile. An enemy hides there.`
      : 'Review: no open line for the ambush here; try another seed.',
  );
  return placed;
}
