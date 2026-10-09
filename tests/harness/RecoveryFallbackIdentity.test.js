// Live-battle identity for the AI's branch-and-bound path searches
// (docs/specs/large-maps/02-encounters-and-pacing.md §2.4): every _findRecoveryFallbackTile
// and _findPathAwareChaseTile call the enemy phases of real headless battles make returns
// exactly what the exhaustive search before it returned (tests/pathfindingReference.js),
// on the boards, occupancy and no-move streaks the battles themselves produce.
//
// The players stand still and cannot be hurt, so enemies pile up around them and stall,
// which is what drives the recovery fallback (two phases without a move). The battle
// keeps the shipped result, so it plays on exactly as it would without the check.
import { describe, it, expect } from 'vitest';
import { AIController } from '../../src/engine/AIController.js';
import { createLordUnit } from '../../src/engine/UnitManager.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { loadGameData } from '../testData.js';
import { HeadlessBattle } from './HeadlessBattle.js';
import {
  referencePathAwareChaseTile,
  referenceRecoveryFallbackTile,
} from '../pathfindingReference.js';

const show = (value) => JSON.stringify(value);

function sameRecovery(a, b) {
  if (a === null || b === null) return a === b;
  return a.target === b.target && a.pathLength === b.pathLength && show(a.tile) === show(b.tile);
}

async function playPassiveBattle(seed, size, objective) {
  installSeed(seed);
  try {
    const [cols, rows] = size.split('x').map(Number);
    const gameData = loadGameData();
    gameData.mapSizes = ['Act 1', 'Act 2', 'Act 3', 'Act 4'].map((phase) => ({
      phase: `${phase} (B)`,
      mapSize: size,
      tiles: cols * rows,
    }));
    gameData.enemies.enemyCountByTiles = { 0: [2, 200] };
    const roster = gameData.lords.map((lord) => {
      const unit = createLordUnit(
        lord,
        gameData.classes.find((c) => c.name === lord.class),
        gameData.weapons,
      );
      Object.assign(unit.stats, { HP: 999, DEF: 40, RES: 40, STR: 0, MAG: 0 });
      unit.currentHP = 999;
      unit.inventory = [];
      unit.weapon = null;
      return unit;
    });
    const battle = new HeadlessBattle(
      gameData,
      { act: 'act3', objective, difficultyId: 'normal', deployCount: 7, row: 4 },
      roster,
    );
    battle.init();
    for (let turn = 1; turn <= 12; turn++) {
      await battle.endTurn();
      if (battle.battleState === 'ENEMY_PHASE') await battle._processEnemyPhase();
      if (battle.battleState !== 'PLAYER_IDLE') break;
    }
  } finally {
    restoreMathRandom();
  }
}

describe('AI branch and bound in live battles', () => {
  it('decides every recovery and path-aware chase exactly as the exhaustive search', async () => {
    const proto = AIController.prototype;
    const recovery = proto._findRecoveryFallbackTile;
    const chase = proto._findPathAwareChaseTile;
    const stats = { recovery: 0, recoveryChosen: 0, chase: 0, chaseChosen: 0 };
    const mismatches = [];
    proto._findRecoveryFallbackTile = function (enemy, targets, candidates, positions, range) {
      const expected = referenceRecoveryFallbackTile(
        this,
        enemy,
        targets,
        candidates,
        positions,
        range,
      );
      const actual = recovery.call(this, enemy, targets, candidates, positions, range);
      stats.recovery++;
      if (expected) stats.recoveryChosen++;
      if (!sameRecovery(actual, expected)) mismatches.push({ kind: 'recovery', expected, actual });
      return actual;
    };
    proto._findPathAwareChaseTile = function (enemy, target, candidates, positions, range) {
      const expected = referencePathAwareChaseTile(
        this,
        enemy,
        target,
        candidates,
        positions,
        range,
      );
      const actual = chase.call(this, enemy, target, candidates, positions, range);
      stats.chase++;
      if (expected) stats.chaseChosen++;
      if (show(actual) !== show(expected)) mismatches.push({ kind: 'chase', expected, actual });
      return actual;
    };
    try {
      for (const size of ['18x13', '24x16']) {
        for (let seed = 1; seed <= 6; seed++) {
          for (const objective of ['rout', 'seize']) {
            await playPassiveBattle(seed * 101, size, objective);
          }
        }
      }
    } finally {
      proto._findRecoveryFallbackTile = recovery;
      proto._findPathAwareChaseTile = chase;
    }

    expect(mismatches.slice(0, 3)).toEqual([]);
    expect(stats.recovery).toBeGreaterThan(30);
    expect(stats.recoveryChosen).toBeGreaterThan(25);
    expect(stats.chase).toBeGreaterThan(700);
    expect(stats.chaseChosen).toBeGreaterThan(550);
  }, 120_000);
});
