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

  it('applies affix mods, act hit bonus, and blessing terrain bonuses in skill context', () => {
    const gameData = loadGameData();
    const attacker = {
      name: 'Edric',
      faction: 'player',
      col: 0,
      row: 0,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 7, SPD: 7, DEF: 6, RES: 3, LCK: 4, MOV: 5 },
      weapon: null,
      inventory: [],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      affixes: ['berserker'],
      accessory: null,
    };
    const defender = {
      name: 'Bandit',
      faction: 'enemy',
      col: 1,
      row: 0,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 20, STR: 8, MAG: 0, SKL: 6, SPD: 6, DEF: 5, RES: 2, LCK: 2, MOV: 5 },
      weapon: null,
      inventory: [],
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
      skills: [],
      affixes: [],
      accessory: null,
    };

    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    battle.turnManager = { turnNumber: 2, currentPhase: 'player' };
    battle.playerUnits = [attacker];
    battle.enemyUnits = [defender];
    battle.npcUnits = [];
    battle.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getTerrainAt(col, row) {
        if (col === 0 && row === 0) return { name: 'Forest' };
        return { name: 'Plain' };
      },
      getMoveCost() { return 1; },
      updateFogOfWar() {},
    };
    battle.runManager = {
      getActHitBonusForUnit() { return 7; },
      getTerrainCombatBonuses() {
        return [{ terrains: ['Forest'], avoidBonus: 11, defBonus: 4 }];
      },
    };

    const ctx = battle._buildSkillCtx(attacker, defender, null);
    expect(ctx.atkMods.atkBonus).toBe(5);
    expect(ctx.atkMods.defBonus).toBe(1);
    expect(ctx.atkMods.avoidBonus).toBe(11);
    expect(ctx.atkMods.hitBonus).toBe(7);
    expect(ctx.defMods.hitBonus).toBe(7);
  });
});
