// AIController - Enemy AI with boss throne clamping and guard behavior
// Processes enemies sequentially: move toward nearest player, attack if in range.
// Boss enemies on seize maps stay within 1 tile of throne.
// Guard enemies wait until a player enters trigger range, then permanently switch to chase.

import {
  gridDistance,
  isInRange,
} from './Combat.js';

const DEBUG_AI = false;
const TERRAIN_FORT = 3;
const TERRAIN_THRONE = 4;

export class AIController {
  constructor(grid, gameData, options = {}) {
    this.grid = grid;
    this.gameData = gameData;
    this.objective = options.objective || 'rout';
    this.thronePos = options.thronePos || null;
    this.aggressiveMode = false;
  }

  setAggressiveMode(enabled) {
    this.aggressiveMode = Boolean(enabled);
  }

  /**
   * Process all enemy units one at a time.
   * @param {Array} enemyUnits
   * @param {Array} playerUnits
   * @param {Object} callbacks - { onMoveUnit(enemy, path), onAttack(enemy, target), onUnitDone(enemy), onDecision(enemy, decision) }
   * @returns {Promise<void>}
   */
  async processEnemyPhase(enemyUnits, playerUnits, npcUnits, callbacks) {
    // Copy array since units might die during processing
    const enemies = [...enemyUnits];

    for (const enemy of enemies) {
      // Skip if already dead (removed during a previous enemy's combat)
      if (!enemyUnits.includes(enemy)) continue;
      if (playerUnits.length === 0) break;

      await this._processOneEnemy(enemy, enemyUnits, playerUnits, npcUnits || [], callbacks);

      // Small delay between enemies for visual clarity
      await this._delay(300);
    }
  }

  async _processOneEnemy(enemy, allEnemies, playerUnits, npcUnits, callbacks) {
    const decision = this._decideAction(enemy, allEnemies, playerUnits, npcUnits);
    enemy._lastAiDecision = decision;
    callbacks.onDecision?.(enemy, decision);

    // Move if we have a path
    if (decision.path && decision.path.length >= 2) {
      await callbacks.onMoveUnit(enemy, decision.path);
    }

    // Attack if we have a target in range
    if (decision.target) {
      const dist = gridDistance(enemy.col, enemy.row, decision.target.col, decision.target.row);
      if (enemy.weapon && isInRange(enemy.weapon, dist)) {
        await callbacks.onAttack(enemy, decision.target);
      }
    }

    callbacks.onUnitDone(enemy);
  }

  /**
   * Decide where to move and who to attack.
   * Strategy: find tile in movement range that puts a player in weapon range.
   * If none, move toward nearest player.
   *
   * Special behaviors:
   * - Guard enemies: stay put until a player/NPC is within trigger range,
   *   then permanently switch to chase mode.
   * - Boss on seize maps: only consider tiles within 1 manhattan tile of throne.
   *   If no attack available, stay put (don't chase away from throne).
   */
  _decideAction(enemy, allEnemies, playerUnits, npcUnits) {
    // --- Guard AI check ---
    if (enemy.aiMode === 'guard') {
      const attackableUnits = [...playerUnits, ...(npcUnits || [])];
      const nearestDist = Math.min(
        ...attackableUnits.map(u => gridDistance(enemy.col, enemy.row, u.col, u.row)),
        Infinity
      );
      const triggerDist = this.aggressiveMode ? 6 : 3;

      if (nearestDist <= triggerDist) {
        // Trigger: permanently switch to chase
        enemy.aiMode = 'chase';
        if (DEBUG_AI) console.log(`[AI] Guard triggered at (${enemy.col},${enemy.row}), dist=${nearestDist}`);
      } else if (!this.aggressiveMode) {
        // Stay put - no movement, no attack
        if (DEBUG_AI) console.log(`[AI] Guard holding at (${enemy.col},${enemy.row}), nearest=${nearestDist}`);
        return {
          path: null,
          target: null,
          reason: 'guard_hold',
          detail: { nearestDistance: Number.isFinite(nearestDist) ? nearestDist : null, triggerDistance: triggerDist },
        };
      }
    }

    // Build unit position map (exclude this enemy from blocking)
    const unitPositions = new Map();
    for (const u of [...allEnemies, ...playerUnits, ...(npcUnits || [])]) {
      if (u === enemy) continue;
      unitPositions.set(`${u.col},${u.row}`, { faction: u.faction });
    }

    const moveRange = this.grid.getMovementRange(
      enemy.col, enemy.row, enemy.mov, enemy.moveType,
      unitPositions, enemy.faction
    );

    // Add current position to candidates
    let candidates = [{ col: enemy.col, row: enemy.row }];
    for (const [key] of moveRange) {
      const [col, row] = key.split(',').map(Number);
      // Exclude tiles occupied by other units
      if (unitPositions.has(key)) continue;
      candidates.push({ col, row });
    }

    // --- Boss throne clamping ---
    const isBossOnSeize = enemy.isBoss && this.objective === 'seize' && this.thronePos;
    if (isBossOnSeize) {
      // Only consider tiles within 1 manhattan tile of throne
      candidates = candidates.filter(t =>
        gridDistance(t.col, t.row, this.thronePos.col, this.thronePos.row) <= 1
      );
      // Always include current position as fallback
      if (!candidates.some(t => t.col === enemy.col && t.row === enemy.row)) {
        candidates.push({ col: enemy.col, row: enemy.row });
      }
      if (DEBUG_AI) console.log(`[AI] Boss clamped to ${candidates.length} tiles near throne`);
    }

    // Find best attack opportunity
    let bestAttack = null;
    let bestScore = -Infinity;

    // Combine player + NPC units as valid attack targets
    const attackableUnits = [...playerUnits, ...(npcUnits || [])];
    for (const tile of candidates) {
      if (!enemy.weapon) break;

      for (const target of attackableUnits) {
        const dist = gridDistance(tile.col, tile.row, target.col, target.row);
        if (!isInRange(enemy.weapon, dist)) continue;

        // Score: prefer low-HP targets, then anti-turtle priorities in aggressive mode.
        let score = (target.stats.HP - target.currentHP) + (100 - target.currentHP);
        if (this.aggressiveMode) {
          const terrainIdx = this.grid?.mapLayout?.[target.row]?.[target.col];
          if (terrainIdx === TERRAIN_FORT || terrainIdx === TERRAIN_THRONE) score += 35;
          if (target.weapon?.type === 'Staff') score += 25;
        }
        if (score > bestScore) {
          bestScore = score;
          bestAttack = { tile, target };
        }
      }
    }

    if (bestAttack) {
      // Move to attack tile and attack
      const path = this._buildPath(enemy, bestAttack.tile, unitPositions);
      return {
        path,
        target: bestAttack.target,
        reason: 'attack_in_range',
        detail: {
          targetName: bestAttack.target.name || null,
          targetPos: { col: bestAttack.target.col, row: bestAttack.target.row },
          fromPos: { col: enemy.col, row: enemy.row },
          attackTile: { col: bestAttack.tile.col, row: bestAttack.tile.row },
        },
      };
    }

    // Boss on seize: don't chase if no attack available - stay on throne
    if (isBossOnSeize) {
      if (DEBUG_AI) console.log('[AI] Boss staying on throne - no targets in range');
      return {
        path: null,
        target: null,
        reason: 'boss_hold_throne',
        detail: { thronePos: this.thronePos || null },
      };
    }

    // No attack possible - move toward nearest player using path-aware pursuit.
    const nearest = this._findPriorityTarget(enemy, playerUnits);
    if (!nearest) {
      return {
        path: null,
        target: null,
        reason: 'no_viable_target',
        detail: { playerCount: playerUnits.length },
      };
    }

    const pathAwareTile = this._findPathAwareChaseTile(enemy, nearest, candidates, unitPositions);
    if (pathAwareTile) {
      const path = this._buildPath(enemy, pathAwareTile, unitPositions);
      if (path && path.length >= 2) {
        return {
          path,
          target: null,
          reason: 'chase_path_aware',
          detail: {
            nearestTarget: nearest.name || null,
            destination: { col: pathAwareTile.col, row: pathAwareTile.row },
          },
        };
      }
    }

    // Find candidate tile closest to nearest player
    let closestDist = Infinity;
    let closestTile = null;
    for (const tile of candidates) {
      const dist = gridDistance(tile.col, tile.row, nearest.col, nearest.row);
      if (dist < closestDist) {
        closestDist = dist;
        closestTile = tile;
      }
    }

    if (closestTile && (closestTile.col !== enemy.col || closestTile.row !== enemy.row)) {
      const path = this._buildPath(enemy, closestTile, unitPositions);
      if (path && path.length >= 2) {
        return {
          path,
          target: null,
          reason: 'chase_greedy_fallback',
          detail: {
            nearestTarget: nearest.name || null,
            destination: { col: closestTile.col, row: closestTile.row },
            distanceToNearest: closestDist,
          },
        };
      }
    }

    return {
      path: null,
      target: null,
      reason: 'no_reachable_move',
      detail: {
        nearestTarget: nearest.name || null,
        nearestDistance: gridDistance(enemy.col, enemy.row, nearest.col, nearest.row),
      },
    };
  }

  _findPathAwareChaseTile(enemy, target, candidates, unitPositions) {
    const candidateSet = new Set(candidates.map(t => `${t.col},${t.row}`));
    const approachTiles = this._getApproachTilesForTarget(enemy, target);
    if (approachTiles.length === 0) return null;

    let bestPath = null;
    for (const tile of approachTiles) {
      const path = this.grid.findPath(
        enemy.col, enemy.row, tile.col, tile.row, enemy.moveType,
        unitPositions, enemy.faction
      );
      if (!path || path.length < 2) continue;
      if (!bestPath || path.length < bestPath.length) bestPath = path;
    }
    if (!bestPath) return null;

    // Choose the farthest reachable node on the best long-path approach.
    for (let i = bestPath.length - 1; i >= 1; i--) {
      const node = bestPath[i];
      if (candidateSet.has(`${node.col},${node.row}`)) return node;
    }

    return null;
  }

  _getApproachTilesForTarget(enemy, target) {
    if (!enemy.weapon || typeof this.grid.getAttackRange !== 'function') {
      return [{ col: target.col, row: target.row }];
    }

    const tiles = this.grid.getAttackRange(target.col, target.row, enemy.weapon) || [];
    const passable = [];
    for (const tile of tiles) {
      if (this.grid.getMoveCost(tile.col, tile.row, enemy.moveType) === Infinity) continue;
      passable.push(tile);
    }
    return passable;
  }

  _findPriorityTarget(enemy, playerUnits) {
    if (this.aggressiveMode) {
      const rank = (unit) => {
        const terrainIdx = this.grid?.mapLayout?.[unit.row]?.[unit.col];
        if (terrainIdx === TERRAIN_FORT || terrainIdx === TERRAIN_THRONE) return 0;
        if (unit.weapon?.type === 'Staff') return 1;
        return 2;
      };

      const sorted = [...playerUnits].sort((a, b) => {
        const r = rank(a) - rank(b);
        if (r !== 0) return r;
        return gridDistance(enemy.col, enemy.row, a.col, a.row) - gridDistance(enemy.col, enemy.row, b.col, b.row);
      });
      return sorted[0] || null;
    }

    let nearest = null;
    let minDist = Infinity;
    for (const p of playerUnits) {
      const dist = gridDistance(enemy.col, enemy.row, p.col, p.row);
      if (dist < minDist) {
        minDist = dist;
        nearest = p;
      }
    }
    return nearest;
  }

  _buildPath(enemy, destTile, unitPositions) {
    if (destTile.col === enemy.col && destTile.row === enemy.row) return null;
    const path = this.grid.findPath(
      enemy.col, enemy.row, destTile.col, destTile.row, enemy.moveType,
      unitPositions, enemy.faction
    );
    return path;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
