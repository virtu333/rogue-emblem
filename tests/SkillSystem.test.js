import { describe, it, expect } from 'vitest';
import {
  applyAccessoryPhaseCombatMods,
  checkPhoenixBrooch,
  getSkillCombatMods,
  getTurnStartEffects,
  resolveGamblerDelta,
} from '../src/engine/SkillSystem.js';
import { loadGameData } from './testData.js';

describe('SkillSystem turn-start effects', () => {
  it('renewal_aura heals adjacent allies', () => {
    const gameData = loadGameData();
    const sera = {
      name: 'Sera',
      col: 4,
      row: 4,
      skills: ['renewal_aura'],
      stats: { HP: 18 },
      currentHP: 18,
    };
    const ally = {
      name: 'Edric',
      col: 5,
      row: 4,
      skills: [],
      stats: { HP: 20 },
      currentHP: 14,
    };

    const effects = getTurnStartEffects([sera, ally], gameData.skills);
    expect(effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'heal',
          target: ally,
          amount: 3,
          sourceUnit: sera,
        }),
      ]),
    );
  });

  it('supports Soothing Stone accessory heal at turn start', () => {
    const unit = {
      name: 'Edric',
      col: 2,
      row: 2,
      skills: [],
      stats: { HP: 30 },
      currentHP: 20,
      accessory: {
        name: 'Soothing Stone',
        turnStartEffects: { healSelfPercent: 20 },
      },
    };

    const effects = getTurnStartEffects([unit], []);
    expect(effects).toEqual([
      expect.objectContaining({
        type: 'heal',
        target: unit,
        amount: 6,
        source: 'Soothing Stone',
      }),
    ]);
  });
});

describe('SkillSystem accessory combat conditions', () => {
  const baseUnit = {
    name: 'Hero',
    col: 4,
    row: 4,
    currentHP: 20,
    stats: { HP: 20, STR: 10, MAG: 0, SKL: 8, SPD: 8, DEF: 6, RES: 4, LCK: 5 },
    weapon: null,
    skills: [],
  };
  const opponent = {
    name: 'Enemy',
    col: 5,
    row: 4,
    currentHP: 20,
    stats: { HP: 20, STR: 8, MAG: 0, SKL: 6, SPD: 6, DEF: 5, RES: 3, LCK: 2 },
    weapon: null,
    skills: [],
  };

  it('no_ally_within_2 requires no living ally within Manhattan range 2', () => {
    const unit = {
      ...baseUnit,
      accessory: { combatEffects: { atkBonus: 3, condition: 'no_ally_within_2' } },
    };
    const allyFar = { ...baseUnit, name: 'AllyFar', col: 8, row: 8, currentHP: 12 };
    const allyNear = { ...baseUnit, name: 'AllyNear', col: 5, row: 5, currentHP: 12 };

    const farMods = getSkillCombatMods(
      unit,
      opponent,
      [unit, allyFar],
      [opponent],
      [],
      { name: 'Plain' },
      true,
    );
    const nearMods = getSkillCombatMods(
      unit,
      opponent,
      [unit, allyNear],
      [opponent],
      [],
      { name: 'Plain' },
      true,
    );

    expect(farMods.atkBonus).toBe(3);
    expect(nearMods.atkBonus).toBe(0);
  });

  it('enemies_nearby_2plus and on_forest_or_mountain use explicit formulas', () => {
    const unit = {
      ...baseUnit,
      accessory: { combatEffects: { atkBonus: 2, defBonus: 2, condition: 'enemies_nearby_2plus' } },
    };
    const enemyA = { ...opponent, name: 'A', col: 5, row: 4, currentHP: 10 };
    const enemyB = { ...opponent, name: 'B', col: 4, row: 6, currentHP: 10 };
    const oneEnemy = getSkillCombatMods(
      unit,
      opponent,
      [unit],
      [enemyA],
      [],
      { name: 'Plain' },
      true,
    );
    const twoEnemies = getSkillCombatMods(
      unit,
      opponent,
      [unit],
      [enemyA, enemyB],
      [],
      { name: 'Plain' },
      true,
    );

    expect(oneEnemy.atkBonus).toBe(0);
    expect(twoEnemies.atkBonus).toBe(2);
    expect(twoEnemies.defBonus).toBe(2);

    const terrainUnit = {
      ...baseUnit,
      accessory: { combatEffects: { avoidBonus: 12, condition: 'on_forest_or_mountain' } },
    };
    const forestMods = getSkillCombatMods(
      terrainUnit,
      opponent,
      [terrainUnit],
      [opponent],
      [],
      { name: 'Forest' },
      true,
    );
    const mountainMods = getSkillCombatMods(
      terrainUnit,
      opponent,
      [terrainUnit],
      [opponent],
      [],
      { name: 'Mountain' },
      true,
    );
    const plainMods = getSkillCombatMods(
      terrainUnit,
      opponent,
      [terrainUnit],
      [opponent],
      [],
      { name: 'Plain' },
      true,
    );
    expect(forestMods.avoidBonus).toBe(12);
    expect(mountainMods.avoidBonus).toBe(12);
    expect(plainMods.avoidBonus).toBe(0);
  });

  it('isolated_duel fails when a third living unit is within range 2 of either combatant', () => {
    const unit = {
      ...baseUnit,
      accessory: { combatEffects: { atkBonus: 3, condition: 'isolated_duel' } },
    };
    const thirdUnitNearDefender = { ...baseUnit, name: 'Third', col: 6, row: 4, currentHP: 10 };
    const isolated = getSkillCombatMods(
      unit,
      opponent,
      [unit],
      [opponent],
      [],
      { name: 'Plain' },
      true,
    );
    const crowded = getSkillCombatMods(
      unit,
      opponent,
      [unit],
      [opponent, thirdUnitNearDefender],
      [],
      { name: 'Plain' },
      true,
    );
    expect(isolated.atkBonus).toBe(3);
    expect(crowded.atkBonus).toBe(0);
  });
});

describe('SkillSystem checkPhoenixBrooch', () => {
  it('triggers once per map when under threshold and never on lethal state', () => {
    const unit = {
      name: 'Edric',
      stats: { HP: 20 },
      currentHP: 4,
      accessory: {
        name: 'Phoenix Brooch',
        combatEffects: {
          phoenixBrooch: {
            thresholdPercent: 0.25,
            healFlat: 10,
          },
        },
      },
    };

    const first = checkPhoenixBrooch(unit);
    expect(first.triggered).toBe(true);
    expect(unit.currentHP).toBe(14);
    expect(unit._phoenixBroochUsed).toBe(true);

    const second = checkPhoenixBrooch(unit);
    expect(second.triggered).toBe(false);

    unit._phoenixBroochUsed = false;
    unit.currentHP = 0;
    const lethal = checkPhoenixBrooch(unit);
    expect(lethal.triggered).toBe(false);
  });
});

describe('SkillSystem accessory phase helpers', () => {
  it('resolveGamblerDelta caches per-unit roll in provided session', () => {
    const unit = {
      name: 'Edric',
      accessory: {
        combatEffects: {
          gambler: {
            winChance: 0.5,
            winAtkBonus: 5,
            lossAtkPenalty: 3,
          },
        },
      },
    };
    const session = { gamblerAtkDeltaByUnit: new Map() };

    const first = resolveGamblerDelta(unit, session, () => 0.9);
    const second = resolveGamblerDelta(unit, session, () => 0.1);

    expect(first).toBe(-3);
    expect(second).toBe(-3);
  });

  it('applyAccessoryPhaseCombatMods applies Moontide and Gambler aliases', () => {
    const unit = {
      name: 'Sera',
      accessory: {
        combatEffects: {
          moontide: true,
          gamblerCoin: true,
        },
      },
    };
    const session = { gamblerAtkDeltaByUnit: new Map() };
    const mods = { atkBonus: 0, defBonus: 0 };

    applyAccessoryPhaseCombatMods(unit, mods, {
      turnNumber: 2,
      rollSession: session,
      rng: () => 0.0,
    });

    expect(mods.atkBonus).toBe(5);
    expect(mods.defBonus).toBe(2);
  });
});

describe('SkillSystem Fury crit scaling edge cases', () => {
  it('Fury skill with stats.HP = 0 returns finite critBonus (not NaN)', () => {
    const gameData = loadGameData();
    const furySkill = gameData.skills.find((s) => s.effects?.critScalesWithMissingHP);
    if (!furySkill) throw new Error('No Fury-type skill found in skills.json');

    const unit = {
      name: 'Test',
      col: 5,
      row: 5,
      skills: [furySkill.id],
      stats: { HP: 0, STR: 10, MAG: 5, SKL: 10, SPD: 8, DEF: 6, RES: 4, LCK: 5 },
      currentHP: 0,
      weapon: gameData.weapons.find((w) => w.type === 'Sword'),
      accessory: null,
    };

    const mods = getSkillCombatMods(unit, unit, [], [], gameData.skills, null);
    expect(Number.isFinite(mods.critBonus)).toBe(true);
  });
});

describe('SkillSystem silence blocking', () => {
  it('silenced unit gets no skill combat mods', () => {
    const { applyCondition } = require('../src/engine/StatusConditionSystem.js');
    const gameData = loadGameData();
    const unit = {
      name: 'Silenced',
      col: 5,
      row: 5,
      skills: ['wrath', 'vantage'],
      stats: { HP: 30, STR: 10, MAG: 5, SKL: 10, SPD: 8, DEF: 6, RES: 4, LCK: 5 },
      currentHP: 12,
      weapon: gameData.weapons.find((w) => w.type === 'Sword'),
      accessory: null,
    };
    const enemy = {
      name: 'Enemy',
      col: 5,
      row: 6,
      skills: [],
      stats: { HP: 30, STR: 10, MAG: 0, SKL: 10, SPD: 8, DEF: 6, RES: 4, LCK: 5 },
      currentHP: 30,
      weapon: gameData.weapons.find((w) => w.type === 'Sword'),
      accessory: null,
    };
    applyCondition(unit, 'silence', 3);

    const mods = getSkillCombatMods(unit, enemy, [], [], gameData.skills, null);
    // Wrath would normally give crit bonus below 50% HP, but silence blocks it
    expect(mods.critBonus || 0).toBe(0);
  });

  it('silenced unit skipped in getTurnStartEffects', () => {
    const { applyCondition } = require('../src/engine/StatusConditionSystem.js');
    const gameData = loadGameData();
    const unit = {
      name: 'Silenced',
      col: 3,
      row: 3,
      skills: ['renewal'],
      stats: { HP: 30, STR: 10, MAG: 5, SKL: 10, SPD: 8, DEF: 6, RES: 4, LCK: 5 },
      currentHP: 20,
      weapon: null,
      accessory: null,
    };
    applyCondition(unit, 'silence', 3);

    const effects = getTurnStartEffects([unit], gameData.skills);
    // Renewal heals at turn start, but silence blocks skill effects
    const healEffect = effects.find((e) => e.unit === unit && e.hpChange > 0);
    expect(healEffect).toBeUndefined();
  });
});

describe('SkillSystem dead-unit aura guards', () => {
  const gameData = loadGameData();

  it('dead ally (currentHP=0) should NOT project passive-aura buffs', () => {
    const unit = {
      name: 'Hero',
      col: 4,
      row: 4,
      currentHP: 20,
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 8, SPD: 8, DEF: 6, RES: 4, LCK: 5 },
      weapon: null,
      skills: [],
    };
    const deadAlly = {
      name: 'DeadAlly',
      col: 5,
      row: 4,
      currentHP: 0,
      stats: { HP: 20 },
      skills: ['charisma'],
    };
    const opponent = {
      name: 'Enemy',
      col: 6,
      row: 4,
      currentHP: 20,
      stats: { HP: 20, STR: 8, MAG: 0, SKL: 6, SPD: 6, DEF: 5, RES: 3, LCK: 2 },
      weapon: null,
      skills: [],
    };

    const mods = getSkillCombatMods(
      unit,
      opponent,
      [unit, deadAlly],
      [opponent],
      gameData.skills,
      { name: 'Plain' },
      true,
    );

    // Charisma gives +10 hit, +5 avoid — dead ally should give 0
    expect(mods.hitBonus).toBe(0);
    expect(mods.avoidBonus).toBe(0);
  });

  it('dead enemy (currentHP=0) should NOT project passive-aura debuffs', () => {
    const unit = {
      name: 'Hero',
      col: 4,
      row: 4,
      currentHP: 20,
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 8, SPD: 8, DEF: 6, RES: 4, LCK: 5 },
      weapon: null,
      skills: [],
    };
    const deadEnemy = {
      name: 'DeadDragon',
      col: 5,
      row: 4,
      currentHP: 0,
      stats: { HP: 40 },
      skills: ['draconic_aura'],
    };

    const mods = getSkillCombatMods(
      unit,
      deadEnemy,
      [unit],
      [deadEnemy],
      gameData.skills,
      { name: 'Plain' },
      true,
    );

    // Draconic Aura gives -10 hit, -1 atk — dead enemy should give 0
    expect(mods.hitBonus).toBe(0);
    expect(mods.atkBonus).toBe(0);
  });

  it('dead source unit should NOT project renewal_aura healing', () => {
    const deadHealer = {
      name: 'FallenHealer',
      col: 4,
      row: 4,
      skills: ['renewal_aura'],
      stats: { HP: 20 },
      currentHP: 0,
    };
    const livingAlly = {
      name: 'Survivor',
      col: 5,
      row: 4,
      skills: [],
      stats: { HP: 20 },
      currentHP: 12,
    };

    const effects = getTurnStartEffects([deadHealer, livingAlly], gameData.skills);
    const healFromDead = effects.find((e) => e.type === 'heal' && e.sourceUnit === deadHealer);
    expect(healFromDead).toBeUndefined();
  });

  it('dead ally should NOT receive renewal_aura healing', () => {
    const healer = {
      name: 'Healer',
      col: 4,
      row: 4,
      skills: ['renewal_aura'],
      stats: { HP: 18 },
      currentHP: 18,
    };
    const deadAlly = {
      name: 'FallenUnit',
      col: 5,
      row: 4,
      skills: [],
      stats: { HP: 20 },
      currentHP: 0,
    };

    const effects = getTurnStartEffects([healer, deadAlly], gameData.skills);
    const healForDead = effects.find((e) => e.type === 'heal' && e.target === deadAlly);
    expect(healForDead).toBeUndefined();
  });
});
