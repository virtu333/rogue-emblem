// HeadlessBattleVillage — village & bandit secondary objective exercised
// through the headless harness with the act1_village_race fixture: village
// generation, the scripted bandit wave, and both race outcomes (player wins /
// bandits win). Mirrors BattleScene's VillageController wiring.

import { describe, it, expect, afterEach } from 'vitest';
import { HeadlessBattle, HEADLESS_STATES } from './HeadlessBattle.js';
import { loadFixture } from '../fixtures/battles/index.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { TERRAIN, VILLAGE_GOLD_BY_ACT } from '../../src/utils/constants.js';
import { VILLAGE_STATUS } from '../../src/engine/VillageSystem.js';

const gameData = loadGameData();
const fixture = loadFixture('act1_village_race');

function initBattle(seed = 42) {
  installSeed(seed);
  const battle = new HeadlessBattle(
    gameData,
    { ...fixture.battleParams },
    fixture.buildRoster(gameData),
  );
  battle.init();
  return battle;
}

/** Find a seed whose generated map carries both a village and a bandit wave. */
function initBattleWithBanditWave(maxSeeds = 40) {
  for (let seed = 1; seed <= maxSeeds; seed++) {
    const battle = initBattle(seed);
    const hasWave = (battle.battleConfig.reinforcements?.scriptedWaves || []).some((w) =>
      w.spawns?.some((s) => s.aiMode === 'seek_tile'),
    );
    if (battle.battleConfig.villageTile && hasWave) return battle;
  }
  throw new Error('no seed produced a village + bandit wave');
}

afterEach(() => {
  restoreMathRandom();
});

describe('HeadlessBattle — village & bandit objective', () => {
  it('fixture generates a Village tile and an intact village state', () => {
    const battle = initBattle();
    const tile = battle.battleConfig.villageTile;
    expect(tile).toBeTruthy();
    expect(battle.battleConfig.mapLayout[tile.row][tile.col]).toBe(TERRAIN.Village);
    expect(battle._villageState).toEqual({ col: tile.col, row: tile.row, status: 'intact' });
  });

  it('the turn-1 scripted wave spawns seek_tile bandits after the first enemy phase', async () => {
    const battle = initBattleWithBanditWave();
    battle.aiController.processEnemyPhase = async () => {}; // isolate the spawn step

    battle.turnManager.turnNumber = 1;
    battle.turnManager.currentPhase = 'enemy';
    battle.battleState = HEADLESS_STATES.ENEMY_PHASE;
    await battle._processEnemyPhase();

    const bandits = battle.enemyUnits.filter((u) => u.aiMode === 'seek_tile');
    expect(bandits.length).toBeGreaterThan(0);
    expect(bandits.length).toBeLessThanOrEqual(2);
    for (const bandit of bandits) {
      expect(bandit.aiTargetTile).toEqual(battle.battleConfig.villageTile);
      expect(bandit._isReinforcement).toBe(true);
      expect(bandit._reinforcementRewardMultiplier).toBe(0.85);
    }
  });

  it('player wins the race: ending an action on the village pays gold + a convoy item, never XP', () => {
    const battle = initBattle();
    const tile = battle.battleConfig.villageTile;
    // Pre-seed a live bandit so the visit's revert-to-chase is observable.
    const bandit = battle._addEnemyFromSpawn({
      className: 'Fighter',
      level: 1,
      col: 0,
      row: 0,
      aiMode: 'seek_tile',
      aiTargetTile: { ...tile },
    });
    expect(bandit.aiMode).toBe('seek_tile');

    const unit = battle.playerUnits[0];
    const xpBefore = unit.xp;
    const levelBefore = unit.level;
    unit.col = tile.col;
    unit.row = tile.row;

    battle.selectUnit(unit.name);
    battle.moveTo(tile.col, tile.row); // staying in place is a legal move
    battle.chooseAction('Wait');

    expect(battle._villageState.status).toBe(VILLAGE_STATUS.VISITED);
    expect(battle.goldEarned).toBe(VILLAGE_GOLD_BY_ACT.act1);
    expect(battle.villageRewardItems).toHaveLength(1);
    expect(typeof battle.villageRewardItems[0].name).toBe('string');
    // Reward pays in a different currency than kills: no XP.
    expect(unit.xp).toBe(xpBefore);
    expect(unit.level).toBe(levelBefore);
    // Tile converts to Plain; surviving bandits join the battle.
    expect(battle.grid.mapLayout[tile.row][tile.col]).toBe(TERRAIN.Plain);
    expect(bandit.aiMode).toBe('chase');
    expect(bandit.aiTargetTile).toBeUndefined();
    // Visiting never affects victory: the battle is still running.
    expect(battle.result).toBeNull();
  });

  it('does not re-trigger the reward when another unit ends on the resolved tile', () => {
    const battle = initBattle();
    const tile = battle.battleConfig.villageTile;
    const [first, second] = battle.playerUnits;
    first.col = tile.col;
    first.row = tile.row;
    battle.selectUnit(first.name);
    battle.moveTo(tile.col, tile.row);
    battle.chooseAction('Wait');
    expect(battle.goldEarned).toBe(VILLAGE_GOLD_BY_ACT.act1);

    // First unit steps off in spirit; second unit stands on the same tile.
    first.col = 0;
    first.row = 0;
    second.col = tile.col;
    second.row = tile.row;
    battle.selectUnit(second.name);
    battle.moveTo(tile.col, tile.row);
    battle.chooseAction('Wait');
    expect(battle.goldEarned).toBe(VILLAGE_GOLD_BY_ACT.act1);
    expect(battle.villageRewardItems).toHaveLength(1);
  });

  it('bandits win the race: a seek_tile bandit reaching the tile razes the village', async () => {
    const battle = initBattle();
    const tile = battle.battleConfig.villageTile;
    // Clear the procedural enemies so the phase exercises only the bandits
    // (rout victory is deferred until reinforcements are checked, and the
    // bandit squad itself keeps the field non-empty).
    battle.enemyUnits.length = 0;
    // Move players far into a corner so they cannot contest.
    for (const u of battle.playerUnits) {
      u.col = 0;
      u.row = 0;
    }
    battle.playerUnits[0].col = 0;
    battle.playerUnits[0].row = 0;
    if (battle.playerUnits[1]) {
      battle.playerUnits[1].col = 1;
      battle.playerUnits[1].row = 0;
    }

    // Bandit starts adjacent to the village: one enemy phase finishes the race.
    const adjacent = { col: tile.col, row: tile.row - 1 };
    const bandit = battle._addEnemyFromSpawn({
      className: 'Fighter',
      level: 1,
      col: adjacent.col,
      row: adjacent.row,
      aiMode: 'seek_tile',
      aiTargetTile: { ...tile },
    });
    expect(bandit).toBeTruthy();

    battle.turnManager.turnNumber = 5; // off the scripted wave's schedule
    battle.turnManager.currentPhase = 'enemy';
    battle.battleState = HEADLESS_STATES.ENEMY_PHASE;
    await battle._processEnemyPhase();

    expect(battle._villageState.status).toBe(VILLAGE_STATUS.RAZED);
    expect(battle.grid.mapLayout[tile.row][tile.col]).toBe(TERRAIN.Plain);
    expect(battle.goldEarned).toBe(0);
    expect(battle.villageRewardItems).toHaveLength(0);
    // The arsonist joins the battle as a regular chaser.
    expect(bandit.aiMode).toBe('chase');
    expect(bandit.aiTargetTile).toBeUndefined();
    // Razing never affects victory/defeat.
    expect(battle.result).toBeNull();
  });

  it('a player unit ending on a razed tile gets nothing', async () => {
    const battle = initBattle();
    const tile = battle.battleConfig.villageTile;
    battle._villageState.status = VILLAGE_STATUS.RAZED;

    const unit = battle.playerUnits[0];
    unit.col = tile.col;
    unit.row = tile.row;
    battle.selectUnit(unit.name);
    battle.moveTo(tile.col, tile.row);
    battle.chooseAction('Wait');

    expect(battle.goldEarned).toBe(0);
    expect(battle.villageRewardItems).toHaveLength(0);
  });

  it('seek_tile spawns arriving after the village resolved revert to chase immediately', () => {
    const battle = initBattle();
    const tile = battle.battleConfig.villageTile;
    battle._villageState.status = VILLAGE_STATUS.VISITED;

    const lateBandit = battle._addEnemyFromSpawn({
      className: 'Fighter',
      level: 1,
      col: 0,
      row: 0,
      aiMode: 'seek_tile',
      aiTargetTile: { ...tile },
    });
    expect(lateBandit.aiMode).toBe('chase');
    expect(lateBandit.aiTargetTile).toBeUndefined();
  });

  it('bandits count toward rout: village state never blocks victory', () => {
    const battle = initBattle();
    battle.enemyUnits.length = 0; // all enemies (incl. bandits) dead
    expect(battle._checkBattleEnd()).toBe(true);
    expect(battle.result).toBe('victory');
    // Village still intact and unvisited — irrelevant to the win condition.
    expect(battle._villageState.status).toBe(VILLAGE_STATUS.INTACT);
  });
});
