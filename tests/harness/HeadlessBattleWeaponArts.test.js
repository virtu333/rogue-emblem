import { describe, expect, it } from 'vitest';
import { HeadlessBattle } from './HeadlessBattle.js';
import { loadGameData } from '../testData.js';

describe('HeadlessBattle weapon arts', () => {
  it('supports explicit player art selection and applies cost/usage once', () => {
    const gameData = loadGameData();
    const art = gameData.weaponArts.arts.find((entry) => entry.id === 'sword_poison_strike');
    const weapon = {
      id: 'test_blade',
      name: 'Test Blade',
      type: 'Sword',
      might: 8,
      hit: 100,
      crit: 0,
      weight: 5,
      range: '1',
      special: '',
      weaponArtIds: [art.id],
      weaponArtSources: ['scroll'],
    };
    const attacker = {
      name: 'Edric',
      faction: 'player',
      col: 0,
      row: 0,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 24, STR: 12, MAG: 0, SKL: 9, SPD: 9, DEF: 7, RES: 3, LCK: 5, MOV: 5 },
      weaponRank: 'Mast',
      weapon,
      inventory: [weapon],
      proficiencies: [{ type: 'Sword', rank: 'Mast' }],
      skills: [],
      accessory: null,
      _gambitUsedThisTurn: true,
    };
    const defender = {
      name: 'Bandit',
      faction: 'enemy',
      col: 1,
      row: 0,
      moveType: 'Infantry',
      currentHP: 30,
      stats: { HP: 30, STR: 8, MAG: 0, SKL: 6, SPD: 6, DEF: 4, RES: 1, LCK: 2, MOV: 5 },
      weaponRank: 'Prof',
      weapon: null,
      inventory: [],
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
      skills: [],
      accessory: null,
    };

    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    battle.turnManager = { turnNumber: 1, unitActed() {} };
    battle.battleConfig = { objective: 'rout' };
    battle.gameData = gameData;
    battle.playerUnits = [attacker];
    battle.enemyUnits = [defender];
    battle.npcUnits = [];
    battle.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getTerrainAt() { return {}; },
      getMoveCost() { return 1; },
      updateFogOfWar() {},
    };
    battle.selectedUnit = attacker;
    battle._setSelectedWeaponArt(attacker, art.id, weapon);

    battle._executeCombat(attacker, defender);

    expect(attacker.currentHP).toBeLessThan(20);
    expect(attacker._battleWeaponArtUsage?.map?.[art.id]).toBe(1);
    expect(attacker._battleWeaponArtUsage?.turn?.[art.id]).toBe(1);
  });
});
