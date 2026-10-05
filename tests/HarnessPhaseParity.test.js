import { describe, it, expect } from 'vitest';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { loadGameData } from './testData.js';
import { TERRAIN } from '../src/utils/constants.js';

describe('Headless Harness Phase Parity', () => {
  const data = loadGameData();

  const mockBattleParams = {
    act: 'act1',
    objective: 'rout',
    enemyStatBonus: 0,
    enemyCountBonus: 0,
  };

  it('Enemy Regenerator does NOT tick during Player Phase', async () => {
    const roster = [
      {
        name: 'Edric',
        className: 'Lord',
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5, MOV: 5 },
        currentHP: 20,
        inventory: [],
        proficiencies: [{ type: 'Sword', rank: 'Prof' }],
        skills: [],
        moveType: 'Infantry',
        faction: 'player',
      },
    ];

    const battle = new HeadlessBattle(data, mockBattleParams, roster);
    battle.gameData.affixes = data.affixes;
    battle.init();

    // Give an enemy Regenerator and damage them
    const enemy = battle.enemyUnits[0];
    enemy.affixes = ['regenerator'];
    enemy.stats.HP = 20;
    enemy.currentHP = 10;

    // Set up a completed enemy phase; the real transition applies only the
    // player side's turn-start effects.
    battle.turnManager.currentPhase = 'enemy';
    battle.turnManager.endEnemyPhase();
    expect(battle.turnManager.turnNumber).toBe(2);
    expect(battle.turnManager.currentPhase).toBe('player');

    expect(enemy.currentHP).toBe(10); // Should remain at 10
  });

  it('Enemy Regenerator ticks during start of Enemy Phase', async () => {
    const roster = [
      {
        name: 'Edric',
        className: 'Lord',
        stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5, MOV: 5 },
        currentHP: 20,
        inventory: [],
        proficiencies: [{ type: 'Sword', rank: 'Prof' }],
        skills: [],
        moveType: 'Infantry',
        faction: 'player',
      },
    ];

    const battle = new HeadlessBattle(data, mockBattleParams, roster);
    battle.gameData.affixes = data.affixes;
    battle.init();

    const enemy = battle.enemyUnits[0];
    enemy.affixes = ['regenerator'];
    enemy.stats.HP = 20;
    enemy.currentHP = 10;
    // The Regenerator alone: a Fort or Throne under the enemy would heal it too, as in the
    // scene (engine/TerrainHealing.js).
    battle.grid.mapLayout[enemy.row][enemy.col] = TERRAIN.Plain;

    // Enter the enemy phase through the real transition before processing AI.
    await battle.endTurn();
    await battle._processEnemyPhase();

    // Regenerator heals 20% max HP (20 * 0.2 = 4)
    expect(enemy.currentHP).toBe(14);
  });
});
