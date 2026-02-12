import { describe, it, expect, vi } from 'vitest';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { loadGameData } from './testData.js';

describe('Headless Harness Phase Parity', () => {
  const data = loadGameData();
  
  const mockBattleParams = {
    act: 'act1',
    objective: 'rout',
    enemyStatBonus: 0,
    enemyCountBonus: 0
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
        faction: 'player'
      }
    ];

    const battle = new HeadlessBattle(data, mockBattleParams, roster);
    battle.gameData.affixes = data.affixes;
    battle.init();

    // Give an enemy Regenerator and damage them
    const enemy = battle.enemyUnits[0];
    enemy.affixes = ['regenerator'];
    enemy.stats.HP = 20;
    enemy.currentHP = 10;

    // Transition to Player Phase (turn 2)
    // _onPhaseChange('player', 2) is where turn-start effects are applied
    battle.turnManager.phase = 'enemy';
    battle.turnManager.turnNumber = 1;
    
    // This should trigger turn-start for player units, NOT enemy units
    battle._onPhaseChange('player', 2);
    
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
        faction: 'player'
      }
    ];

    const battle = new HeadlessBattle(data, mockBattleParams, roster);
    battle.gameData.affixes = data.affixes;
    battle.init();

    const enemy = battle.enemyUnits[0];
    enemy.affixes = ['regenerator'];
    enemy.stats.HP = 20;
    enemy.currentHP = 10;

    // _processEnemyPhase is where enemy turn-start effects are applied
    await battle._processEnemyPhase();
    
    // Regenerator heals 20% max HP (20 * 0.2 = 4)
    expect(enemy.currentHP).toBe(14);
  });
});
