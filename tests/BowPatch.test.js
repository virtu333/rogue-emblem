import { describe, it, expect } from 'vitest';
import {
  isInRange,
  canCounter,
  getConditionalWeaponBonuses,
  getCombatForecast,
} from '../src/engine/Combat.js';
import { getSkillCombatMods } from '../src/engine/SkillSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function findWeapon(name) {
  return data.weapons.find((w) => w.name === name);
}

function findClass(name) {
  return data.classes.find((c) => c.name === name);
}

function makeUnit(overrides = {}) {
  return {
    name: 'TestUnit',
    className: 'Archer',
    tier: 'base',
    level: 5,
    isLord: false,
    stats: { HP: 22, STR: 8, MAG: 0, SKL: 10, SPD: 8, DEF: 5, RES: 3, LCK: 5 },
    currentHP: 22,
    faction: 'player',
    weapon: findWeapon('Iron Bow'),
    inventory: [],
    proficiencies: [{ type: 'Bow', rank: 'Prof' }],
    skills: [],
    moveType: 'Infantry',
    col: 3,
    row: 3,
    accessory: null,
    ...overrides,
  };
}

describe('Bow Patch — Data Validation', () => {
  it('Shortbow exists with correct stats', () => {
    const w = findWeapon('Shortbow');
    expect(w).toBeDefined();
    expect(w.type).toBe('Bow');
    expect(w.tier).toBe('Steel');
    expect(w.rankRequired).toBe('Prof');
    expect(w.might).toBe(5);
    expect(w.hit).toBe(75);
    expect(w.crit).toBe(0);
    expect(w.weight).toBe(5);
    expect(w.range).toBe('1-2');
    expect(w.price).toBe(1200);
    expect(w.special).toContain('Close-range bow');
  });

  it('Recurve Bow exists with correct stats', () => {
    const w = findWeapon('Recurve Bow');
    expect(w).toBeDefined();
    expect(w.type).toBe('Bow');
    expect(w.tier).toBe('Silver');
    expect(w.rankRequired).toBe('Prof');
    expect(w.might).toBe(8);
    expect(w.hit).toBe(70);
    expect(w.range).toBe('1-2');
    expect(w.price).toBe(2200);
  });

  it('Doublebow exists with correct stats', () => {
    const w = findWeapon('Doublebow');
    expect(w).toBeDefined();
    expect(w.type).toBe('Bow');
    expect(w.tier).toBe('Legend');
    expect(w.rankRequired).toBe('Mast');
    expect(w.might).toBe(11);
    expect(w.hit).toBe(85);
    expect(w.crit).toBe(5);
    expect(w.weight).toBe(6);
    expect(w.range).toBe('1-2');
    expect(w.price).toBe(0);
    expect(w.special).toContain('if no adjacent allies');
  });

  it('total bow count includes the 3 new bows (at least 11)', () => {
    const bows = data.weapons.filter((w) => w.type === 'Bow');
    expect(bows.length).toBeGreaterThanOrEqual(11);
  });
});

describe('Bow Patch — Proficiency Changes', () => {
  it('Assassin has Bows (P) in proficiencies', () => {
    const cls = findClass('Assassin');
    expect(cls.weaponProficiencies).toContain('Bows (P)');
    expect(cls.weaponProficiencies).toContain('Swords (M)');
  });

  it('Ranger has Swords (P) and Bows (P)', () => {
    const cls = findClass('Ranger');
    expect(cls.weaponProficiencies).toContain('Swords (P)');
    expect(cls.weaponProficiencies).toContain('Bows (P)');
  });

  it('Vanguard has Swords (M), Axes (P), and Bows (P)', () => {
    const cls = findClass('Vanguard');
    expect(cls.weaponProficiencies).toContain('Swords (M)');
    expect(cls.weaponProficiencies).toContain('Axes (P)');
    expect(cls.weaponProficiencies).toContain('Bows (P)');
  });

  it('Voss lord has Bows (P) in weapon field', () => {
    const voss = data.lords.find((l) => l.name === 'Voss');
    expect(voss.weapon).toContain('Bows (P)');
    expect(voss.weapon).toContain('Swords (P)');
  });

  it('Sniper still has Bows (M) only', () => {
    const cls = findClass('Sniper');
    expect(cls.weaponProficiencies).toBe('Bows (M)');
  });

  it('Myrmidon cannot equip bows (no Bow proficiency)', () => {
    const cls = findClass('Myrmidon');
    expect(cls.weaponProficiencies).not.toContain('Bow');
  });
});

describe('Bow Patch — Range & Counter-Attack', () => {
  it('Shortbow is in range at distance 1 and 2', () => {
    const shortbow = findWeapon('Shortbow');
    expect(isInRange(shortbow, 1)).toBe(true);
    expect(isInRange(shortbow, 2)).toBe(true);
    expect(isInRange(shortbow, 3)).toBe(false);
  });

  it('Archer with Shortbow can counter at melee range', () => {
    const shortbow = findWeapon('Shortbow');
    expect(canCounter({}, shortbow, 1)).toBe(true);
    expect(canCounter({}, shortbow, 2)).toBe(true);
  });

  it('Archer with Iron Bow cannot counter at melee range', () => {
    const ironBow = findWeapon('Iron Bow');
    expect(canCounter({}, ironBow, 1)).toBe(false);
    expect(canCounter({}, ironBow, 2)).toBe(true);
  });

  it('Doublebow covers range 1-2', () => {
    const doublebow = findWeapon('Doublebow');
    expect(isInRange(doublebow, 1)).toBe(true);
    expect(isInRange(doublebow, 2)).toBe(true);
    expect(isInRange(doublebow, 3)).toBe(false);
  });
});

describe('Bow Patch — Doublebow Conditional Bonus', () => {
  it('returns +4 ATK/SPD when unit has no adjacent allies', () => {
    const doublebow = findWeapon('Doublebow');
    const unit = makeUnit({ weapon: doublebow, col: 5, row: 5 });
    const farAlly = makeUnit({ name: 'FarAlly', col: 5, row: 7 }); // distance 2
    const result = getConditionalWeaponBonuses(doublebow, unit, [unit, farAlly]);
    expect(result.atkBonus).toBe(4);
    expect(result.spdBonus).toBe(4);
  });

  it('returns 0 when adjacent ally present', () => {
    const doublebow = findWeapon('Doublebow');
    const unit = makeUnit({ weapon: doublebow, col: 5, row: 5 });
    const adjacentAlly = makeUnit({ name: 'Adjacent', col: 5, row: 6 }); // distance 1
    const result = getConditionalWeaponBonuses(doublebow, unit, [unit, adjacentAlly]);
    expect(result.atkBonus).toBe(0);
    expect(result.spdBonus).toBe(0);
  });

  it('ally at distance 2 does not block bonus', () => {
    const doublebow = findWeapon('Doublebow');
    const unit = makeUnit({ weapon: doublebow, col: 3, row: 3 });
    const allyD2 = makeUnit({ name: 'D2Ally', col: 3, row: 5 }); // distance 2
    const result = getConditionalWeaponBonuses(doublebow, unit, [unit, allyD2]);
    expect(result.atkBonus).toBe(4);
    expect(result.spdBonus).toBe(4);
  });

  it('returns 0 for non-conditional weapons', () => {
    const ironBow = findWeapon('Iron Bow');
    const unit = makeUnit({ weapon: ironBow, col: 3, row: 3 });
    const result = getConditionalWeaponBonuses(ironBow, unit, [unit]);
    expect(result.atkBonus).toBe(0);
    expect(result.spdBonus).toBe(0);
  });

  it('returns bonus when unit is completely alone', () => {
    const doublebow = findWeapon('Doublebow');
    const unit = makeUnit({ weapon: doublebow, col: 3, row: 3 });
    const result = getConditionalWeaponBonuses(doublebow, unit, [unit]);
    expect(result.atkBonus).toBe(4);
    expect(result.spdBonus).toBe(4);
  });

  it('treats null ally list as empty for conditional weapon bonus checks', () => {
    const doublebow = findWeapon('Doublebow');
    const unit = makeUnit({ weapon: doublebow, col: 3, row: 3 });
    const result = getConditionalWeaponBonuses(doublebow, unit, null);
    expect(result.atkBonus).toBe(4);
    expect(result.spdBonus).toBe(4);
  });
});

describe('Bow Patch — Combat Integration', () => {
  it('Doublebow bonus works even without skillsData (null)', () => {
    const doublebow = findWeapon('Doublebow');
    const unit = makeUnit({ weapon: doublebow, col: 5, row: 5 });
    const opponent = makeUnit({ name: 'Enemy', col: 5, row: 4, faction: 'enemy' });
    const mods = getSkillCombatMods(unit, opponent, [unit], [opponent], null, null, true);
    expect(mods.atkBonus).toBe(4);
    expect(mods.spdBonus).toBe(4);
  });

  it('getSkillCombatMods includes Doublebow bonus when isolated', () => {
    const doublebow = findWeapon('Doublebow');
    const unit = makeUnit({
      weapon: doublebow,
      col: 5,
      row: 5,
      proficiencies: [{ type: 'Bow', rank: 'Mast' }],
    });
    const opponent = makeUnit({ name: 'Enemy', col: 5, row: 4, faction: 'enemy' });
    const mods = getSkillCombatMods(unit, opponent, [unit], [opponent], data.skills, null, true);
    expect(mods.atkBonus).toBe(4);
    expect(mods.spdBonus).toBe(4);
  });

  it('getSkillCombatMods excludes Doublebow bonus when adjacent ally', () => {
    const doublebow = findWeapon('Doublebow');
    const unit = makeUnit({
      weapon: doublebow,
      col: 5,
      row: 5,
      proficiencies: [{ type: 'Bow', rank: 'Mast' }],
    });
    const ally = makeUnit({ name: 'Ally', col: 5, row: 6 });
    const opponent = makeUnit({ name: 'Enemy', col: 5, row: 4, faction: 'enemy' });
    const mods = getSkillCombatMods(
      unit,
      opponent,
      [unit, ally],
      [opponent],
      data.skills,
      null,
      true,
    );
    expect(mods.atkBonus).toBe(0);
    expect(mods.spdBonus).toBe(0);
  });

  it('getCombatForecast reflects Doublebow bonus in damage', () => {
    const doublebow = findWeapon('Doublebow');
    const unit = makeUnit({
      weapon: doublebow,
      col: 5,
      row: 5,
      proficiencies: [{ type: 'Bow', rank: 'Mast' }],
    });
    const enemy = makeUnit({
      name: 'Enemy',
      col: 5,
      row: 4,
      faction: 'enemy',
      weapon: findWeapon('Iron Sword'),
    });
    const plain = data.terrain.find((t) => t.name === 'Plain');
    const skillCtx = {
      atkMods: getSkillCombatMods(unit, enemy, [unit], [enemy], data.skills, plain, true),
      defMods: getSkillCombatMods(enemy, unit, [enemy], [unit], data.skills, plain, false),
    };

    const forecast = getCombatForecast(
      unit,
      doublebow,
      enemy,
      enemy.weapon,
      1,
      plain,
      plain,
      skillCtx,
    );
    // Doublebow: STR(8) + bonus(4) + might(11) = 23, minus enemy DEF(5) = 18
    expect(forecast.attacker.damage).toBe(18);
  });
});

describe('Bow Patch — Loot Tables', () => {
  it('Shortbow is in act1 weapons pool', () => {
    expect(data.lootTables.act1.weapons).toContain('Shortbow');
  });

  it('Recurve Bow is in act2 weapons pool', () => {
    expect(data.lootTables.act2.weapons).toContain('Recurve Bow');
  });

  it('Doublebow is in act3 legendaryWeapon pool', () => {
    expect(data.lootTables.act3.legendaryWeapon).toContain('Doublebow');
  });
});
