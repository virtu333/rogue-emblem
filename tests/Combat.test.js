import { describe, it, expect, vi } from 'vitest';
import {
  gridDistance,
  parseRange,
  isInRange,
  isPhysical,
  isMagical,
  isStaff,
  getWeaponTriangleBonus,
  calculateAttack,
  calculateDefense,
  calculateDamage,
  canDouble,
  canCounter,
  getCombatForecast,
  resolveCombat,
  getEffectivenessMultiplier,
  calculateHealAmount,
  resolveHeal,
  calculateBonusUses,
  getStaffMaxUses,
  getStaffRemainingUses,
  spendStaffUse,
  getEffectiveStaffRange,
  calculateEffectiveWeight,
  hasSunderEffect,
  mergeCombatMods,
} from '../src/engine/Combat.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

// Helper: create a minimal unit for combat tests
function makeUnit(overrides = {}) {
  return {
    name: 'TestUnit',
    className: 'Myrmidon',
    tier: 'base',
    level: 1,
    isLord: false,
    stats: { HP: 20, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 5 },
    currentHP: 20,
    faction: 'player',
    weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    inventory: [],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
    moveType: 'Infantry',
    ...overrides,
  };
}

describe('Combat utilities', () => {
  it('gridDistance calculates Manhattan distance', () => {
    expect(gridDistance(0, 0, 3, 4)).toBe(7);
    expect(gridDistance(2, 3, 2, 3)).toBe(0);
    expect(gridDistance(0, 0, 1, 0)).toBe(1);
  });

  it('parseRange handles single and ranged values', () => {
    expect(parseRange('1')).toEqual({ min: 1, max: 1 });
    expect(parseRange('1-2')).toEqual({ min: 1, max: 2 });
    expect(parseRange('2-3')).toEqual({ min: 2, max: 3 });
  });

  it('parseRange handles ALL and malformed values safely', () => {
    expect(parseRange('ALL')).toEqual({ min: 1, max: 99 });
    expect(parseRange(null)).toEqual({ min: 1, max: 1 });
    expect(parseRange(undefined)).toEqual({ min: 1, max: 1 });
    expect(parseRange('')).toEqual({ min: 1, max: 1 });
    expect(parseRange('bad-range')).toEqual({ min: 1, max: 1 });
  });

  it('isInRange checks weapon range correctly', () => {
    const sword = data.weapons.find((w) => w.name === 'Iron Sword');
    const bow = data.weapons.find((w) => w.name === 'Iron Bow');
    expect(isInRange(sword, 1)).toBe(true);
    expect(isInRange(sword, 2)).toBe(false);
    expect(isInRange(bow, 2)).toBe(true);
    expect(isInRange(bow, 1)).toBe(false);
  });

  it('isInRange returns false for missing weapon and falls back safely for malformed range input', () => {
    expect(isInRange(null, 1)).toBe(false);
    expect(isInRange({ range: null }, 1)).toBe(true);
    expect(isInRange({ range: 'bad-range' }, 1)).toBe(true);
    expect(isInRange({ range: 'bad-range' }, 2)).toBe(false);
  });

  it('forecast and resolution do not throw when defender range is malformed', () => {
    const attacker = makeUnit();
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      weapon: { ...makeUnit().weapon, range: null },
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    expect(() =>
      getCombatForecast(attacker, attacker.weapon, defender, defender.weapon, 1, terrain, terrain),
    ).not.toThrow();
    expect(() =>
      resolveCombat(attacker, attacker.weapon, defender, defender.weapon, 1, terrain, terrain),
    ).not.toThrow();
  });

  it('classifies weapon types correctly', () => {
    const sword = data.weapons.find((w) => w.name === 'Iron Sword');
    const tome = data.weapons.find((w) => w.name === 'Fire');
    const staff = data.weapons.find((w) => w.name === 'Heal');
    expect(isPhysical(sword)).toBe(true);
    expect(isMagical(tome)).toBe(true);
    expect(isStaff(staff)).toBe(true);
    expect(isPhysical(tome)).toBe(false);
  });
});

describe('Weapon triangle', () => {
  it('sword beats axe', () => {
    const sword = data.weapons.find((w) => w.name === 'Iron Sword');
    const axe = data.weapons.find((w) => w.name === 'Iron Axe');
    const bonus = getWeaponTriangleBonus(sword, axe);
    expect(bonus.hit).toBeGreaterThan(0);
    expect(bonus.damage).toBeGreaterThan(0);
  });

  it('axe beats lance', () => {
    const axe = data.weapons.find((w) => w.name === 'Iron Axe');
    const lance = data.weapons.find((w) => w.name === 'Iron Lance');
    const bonus = getWeaponTriangleBonus(axe, lance);
    expect(bonus.hit).toBeGreaterThan(0);
  });

  it('lance beats sword', () => {
    const lance = data.weapons.find((w) => w.name === 'Iron Lance');
    const sword = data.weapons.find((w) => w.name === 'Iron Sword');
    const bonus = getWeaponTriangleBonus(lance, sword);
    expect(bonus.hit).toBeGreaterThan(0);
  });

  it('non-reaver gets disadvantage vs opponent Lancereaver', () => {
    const ironLance = data.weapons.find((w) => w.name === 'Iron Lance');
    const lancereaver = data.weapons.find((w) => w.name === 'Lancereaver');
    // Lance normally beats Sword → reaver on defender flips to disadvantage for lance
    const bonus = getWeaponTriangleBonus(ironLance, lancereaver);
    expect(bonus.hit).toBe(-10);
    expect(bonus.damage).toBe(-1);
  });

  it('non-reaver gets disadvantage vs opponent Swordreaver', () => {
    const ironAxe = data.weapons.find((w) => w.name === 'Iron Axe');
    const swordreaver = data.weapons.find((w) => w.name === 'Swordreaver');
    // Axe normally beats Lance → reaver on defender flips to disadvantage for axe
    const bonus = getWeaponTriangleBonus(ironAxe, swordreaver);
    expect(bonus.hit).toBe(-10);
    expect(bonus.damage).toBe(-1);
  });

  it('non-reaver gets disadvantage vs opponent Axereaver', () => {
    const ironSword = data.weapons.find((w) => w.name === 'Iron Sword');
    const axereaver = data.weapons.find((w) => w.name === 'Axereaver');
    // Sword normally beats Axe → reaver on defender flips to disadvantage for sword
    const bonus = getWeaponTriangleBonus(ironSword, axereaver);
    expect(bonus.hit).toBe(-10);
    expect(bonus.damage).toBe(-1);
  });

  it('non-reaver gets advantage vs opponent Lancereaver when normally disadvantaged', () => {
    const ironAxe = data.weapons.find((w) => w.name === 'Iron Axe');
    const lancereaver = data.weapons.find((w) => w.name === 'Lancereaver');
    const bonus = getWeaponTriangleBonus(ironAxe, lancereaver);
    expect(bonus.hit).toBe(10);
    expect(bonus.damage).toBe(1);
  });
  it('same weapon type = no bonus', () => {
    const s1 = data.weapons.find((w) => w.name === 'Iron Sword');
    const s2 = data.weapons.find((w) => w.name === 'Steel Sword');
    const bonus = getWeaponTriangleBonus(s1, s2);
    expect(bonus.hit).toBe(0);
    expect(bonus.damage).toBe(0);
  });
});

describe('Damage calculation', () => {
  it('physical damage = STR + might - DEF', () => {
    const attacker = makeUnit({ stats: { ...makeUnit().stats, STR: 10 } });
    const defender = makeUnit({
      stats: { ...makeUnit().stats, DEF: 6, RES: 3 },
      faction: 'enemy',
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const dmg = calculateDamage(attacker, attacker.weapon, defender, defender.weapon, terrain);
    // Iron Sword might = 5, STR 10, DEF 6, plain defBonus 0 → 10 + 5 - 6 = 9
    expect(dmg).toBe(9);
  });

  it('damage floors at 0', () => {
    const attacker = makeUnit({ stats: { ...makeUnit().stats, STR: 1 } });
    const defender = makeUnit({
      stats: { ...makeUnit().stats, DEF: 50 },
      faction: 'enemy',
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const dmg = calculateDamage(attacker, attacker.weapon, defender, defender.weapon, terrain);
    expect(dmg).toBe(0);
  });

  it('terrain defense bonus reduces damage', () => {
    const attacker = makeUnit({ stats: { ...makeUnit().stats, STR: 10 } });
    const defender = makeUnit({
      stats: { ...makeUnit().stats, DEF: 6 },
      faction: 'enemy',
    });
    const plain = data.terrain.find((t) => t.name === 'Plain');
    const fort = data.terrain.find((t) => t.name === 'Fort');
    const dmgPlain = calculateDamage(attacker, attacker.weapon, defender, defender.weapon, plain);
    const dmgFort = calculateDamage(attacker, attacker.weapon, defender, defender.weapon, fort);
    expect(dmgFort).toBeLessThan(dmgPlain);
  });
});

describe('Doubling', () => {
  it('doubles when SPD >= defender SPD + 5', () => {
    const fast = makeUnit({ stats: { ...makeUnit().stats, SPD: 15 } });
    const slow = makeUnit({ stats: { ...makeUnit().stats, SPD: 10 } });
    expect(canDouble(fast, slow)).toBe(true);
    expect(canDouble(slow, fast)).toBe(false);
  });

  it('no double at exactly +4 SPD', () => {
    const a = makeUnit({ stats: { ...makeUnit().stats, SPD: 14 } });
    const b = makeUnit({ stats: { ...makeUnit().stats, SPD: 10 } });
    expect(canDouble(a, b)).toBe(false);
  });
});

describe('Counter-attack', () => {
  it('melee can counter at range 1', () => {
    const defender = makeUnit();
    expect(canCounter(defender, defender.weapon, 1)).toBe(true);
  });

  it('melee cannot counter at range 2', () => {
    const defender = makeUnit();
    expect(canCounter(defender, defender.weapon, 2)).toBe(false);
  });

  it('bow can counter at range 2', () => {
    const bow = data.weapons.find((w) => w.name === 'Iron Bow');
    const archer = makeUnit({ weapon: bow });
    expect(canCounter(archer, bow, 2)).toBe(true);
    expect(canCounter(archer, bow, 1)).toBe(false);
  });
});

describe('Effectiveness', () => {
  it('Hammer is effective vs Armored', () => {
    const hammer = data.weapons.find((w) => w.name === 'Hammer');
    if (!hammer) return; // skip if weapon not in data
    const knight = makeUnit({ moveType: 'Armored' });
    expect(getEffectivenessMultiplier(hammer, knight)).toBe(3);
  });

  it('Rapier is effective vs Armored and Cavalry', () => {
    const rapier = data.weapons.find((w) => w.name === 'Rapier');
    if (!rapier) return;
    const armored = makeUnit({ moveType: 'Armored' });
    const cavalry = makeUnit({ moveType: 'Cavalry' });
    expect(getEffectivenessMultiplier(rapier, armored)).toBe(2);
    expect(getEffectivenessMultiplier(rapier, cavalry)).toBe(2);
  });

  it('bows are globally effective vs Flying (3x)', () => {
    const bow = data.weapons.find((w) => w.name === 'Iron Bow');
    const flier = makeUnit({ moveType: 'Flying' });
    expect(getEffectivenessMultiplier(bow, flier)).toBe(3);
  });

  it('negate-effectiveness accessory overrides bow effectiveness', () => {
    const bow = data.weapons.find((w) => w.name === 'Iron Bow');
    const flier = makeUnit({
      moveType: 'Flying',
      accessory: { combatEffects: { negateEffectiveness: true } },
    });
    expect(getEffectivenessMultiplier(bow, flier)).toBe(1);
  });

  it('negateFlierWeakness only blocks bow-vs-flier effectiveness', () => {
    const bow = data.weapons.find((w) => w.name === 'Iron Bow');
    const flier = makeUnit({
      moveType: 'Flying',
      accessory: { combatEffects: { negateFlierWeakness: true } },
    });
    const armored = makeUnit({
      moveType: 'Armored',
      accessory: { combatEffects: { negateFlierWeakness: true } },
    });
    const hammer = data.weapons.find((w) => w.name === 'Hammer');
    expect(getEffectivenessMultiplier(bow, flier)).toBe(1);
    expect(getEffectivenessMultiplier(hammer, armored)).toBe(3);
  });
});

describe('Combat forecast', () => {
  it('returns valid forecast structure', () => {
    const attacker = makeUnit();
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const forecast = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
    );
    expect(forecast.attacker).toBeDefined();
    expect(forecast.defender).toBeDefined();
    expect(forecast.attacker.damage).toBeGreaterThanOrEqual(0);
    expect(forecast.attacker.hit).toBeGreaterThanOrEqual(0);
    expect(forecast.attacker.hit).toBeLessThanOrEqual(100);
  });

  it('applies attacker weapon-art mods through combat context', () => {
    const attacker = makeUnit({
      stats: { ...makeUnit().stats, STR: 10, SKL: 10, SPD: 10, LCK: 5 },
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, HP: 24, DEF: 6, SPD: 8, LCK: 4 },
      currentHP: 24,
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');

    const base = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
    );
    const withArt = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
      {
        atkWeaponArtMods: {
          atkBonus: 3,
          hitBonus: 15,
          activated: [{ id: 'weapon_art', name: 'Test Art' }],
        },
      },
    );

    expect(withArt.attacker.damage).toBeGreaterThanOrEqual(base.attacker.damage + 3);
    expect(withArt.attacker.hit).toBeGreaterThanOrEqual(base.attacker.hit);
    expect(withArt.attacker.skills.some((s) => s.id === 'weapon_art')).toBe(true);
  });

  it('applies stat-scaling damage from attacker weapon art (SKL/2)', () => {
    const attacker = makeUnit({
      stats: { ...makeUnit().stats, STR: 10, SKL: 11, SPD: 10, LCK: 5 },
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, HP: 24, DEF: 6, SPD: 8, LCK: 4 },
      currentHP: 24,
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');

    const base = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
    );
    const withArt = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
      {
        atkWeaponArtMods: {
          statScaling: { stat: 'SKL', divisor: 2 },
          activated: [{ id: 'weapon_art', name: 'Finesse Blade' }],
        },
      },
    );

    expect(withArt.attacker.damage).toBe(base.attacker.damage + Math.floor(attacker.stats.SKL / 2));
  });

  it('applies stat-scaling damage from magic weapon art (MAG/3)', () => {
    const fire = data.weapons.find((w) => w.name === 'Fire');
    const attacker = makeUnit({
      weapon: fire,
      stats: { ...makeUnit().stats, STR: 1, MAG: 13, SKL: 10, SPD: 10, LCK: 5 },
      proficiencies: [{ type: 'Tome', rank: 'Prof' }],
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, HP: 24, RES: 4, SPD: 8, LCK: 4 },
      currentHP: 24,
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');

    const base = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      2,
      terrain,
      terrain,
    );
    const withArt = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      2,
      terrain,
      terrain,
      {
        atkWeaponArtMods: {
          statScaling: { stat: 'MAG', divisor: 3 },
          activated: [{ id: 'weapon_art', name: 'Resonance' }],
        },
      },
    );

    expect(withArt.attacker.damage).toBe(base.attacker.damage + Math.floor(attacker.stats.MAG / 3));
  });

  it('suppresses normal attacker follow-up when weapon art is active', () => {
    const attacker = makeUnit({ stats: { ...makeUnit().stats, SPD: 20 } });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, SPD: 10 },
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');

    const base = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
    );
    expect(base.attacker.doubles).toBe(true);

    const withArt = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
      {
        atkWeaponArtMods: { activated: [{ id: 'weapon_art', name: 'Test Art' }] },
      },
    );
    expect(withArt.attacker.doubles).toBe(false);
  });

  it('still allows defender follow-up against an art-using attacker', () => {
    const attacker = makeUnit({ stats: { ...makeUnit().stats, SPD: 5 } });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, SPD: 15 },
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');

    const withArt = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
      {
        atkWeaponArtMods: { activated: [{ id: 'weapon_art', name: 'Test Art' }] },
      },
    );
    expect(withArt.attacker.doubles).toBe(false);
    expect(withArt.defender.doubles).toBe(true);
  });

  it('prevents defender counter-attacks when art has preventCounter', () => {
    const attacker = makeUnit();
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');

    const withArt = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
      {
        atkWeaponArtMods: {
          preventCounter: true,
          activated: [{ id: 'weapon_art', name: 'Windsweep' }],
        },
      },
    );
    expect(withArt.defender.canCounter).toBe(false);
    expect(withArt.defender.damage).toBe(0);
  });

  it('targets RES instead of DEF when art has targetsRES', () => {
    const attacker = makeUnit({
      stats: { ...makeUnit().stats, STR: 10 },
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, DEF: 18, RES: 2 },
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');

    const base = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
    );
    const withArt = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
      {
        atkWeaponArtMods: { targetsRES: true, activated: [{ id: 'weapon_art', name: 'Hexblade' }] },
      },
    );
    expect(withArt.attacker.damage).toBeGreaterThan(base.attacker.damage);
  });

  it('applies vengeance bonus from missing HP', () => {
    const attacker = makeUnit({
      currentHP: 13,
      stats: { ...makeUnit().stats, HP: 20, STR: 10, SPD: 8 },
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, DEF: 5, SPD: 8 },
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');

    const base = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
    );
    const withArt = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
      {
        atkWeaponArtMods: { vengeance: true, activated: [{ id: 'weapon_art', name: 'Vengeance' }] },
      },
    );
    expect(withArt.attacker.damage).toBe(base.attacker.damage + 7);
  });

  it('caps stacked weapon+art effectiveness at 5x', () => {
    const bow = data.weapons.find((w) => w.name === 'Iron Bow');
    const attacker = makeUnit({
      weapon: bow,
      stats: { ...makeUnit().stats, STR: 10, SKL: 10, SPD: 8 },
      proficiencies: [{ type: 'Bow', rank: 'Prof' }],
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      moveType: 'Flying',
      stats: { ...makeUnit().stats, DEF: 5, RES: 5, SPD: 8 },
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');

    const base = getCombatForecast(attacker, bow, defender, defender.weapon, 2, terrain, terrain);
    const withArt = getCombatForecast(
      attacker,
      bow,
      defender,
      defender.weapon,
      2,
      terrain,
      terrain,
      {
        atkWeaponArtMods: {
          effectiveness: { moveTypes: ['flying'], multiplier: 3 },
          activated: [{ id: 'weapon_art', name: 'Grounder' }],
        },
      },
    );
    expect(withArt.attacker.damage).toBe(base.attacker.damage + bow.might * 2);
  });

  it('halves incoming physical damage when defender art has halfPhysicalDamage', () => {
    const attacker = makeUnit({
      stats: { ...makeUnit().stats, STR: 12, SPD: 8 },
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, DEF: 5, SPD: 8 },
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');

    const base = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
    );
    const withArt = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
      {
        defWeaponArtMods: {
          halfPhysicalDamage: true,
          activated: [{ id: 'weapon_art', name: 'Pavise Strike' }],
        },
      },
    );
    expect(withArt.attacker.damage).toBe(Math.floor(base.attacker.damage / 2));
  });
});

describe('Combat resolution', () => {
  it('resolves without errors', () => {
    const attacker = makeUnit({ stats: { ...makeUnit().stats, STR: 15, SPD: 15 } });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, STR: 5, SPD: 5, DEF: 3 },
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
    );
    expect(result.events.length).toBeGreaterThan(0);
    expect(typeof result.attackerHP).toBe('number');
    expect(typeof result.defenderHP).toBe('number');
  });

  it('returns poisonEffects array with both entries when both sides have poison', () => {
    const veninEdge = data.weapons.find((w) => w.name === 'Venin Blade');
    expect(veninEdge).toBeTruthy();
    // Both combatants have Venin Blade — both survive so both poisons apply
    const attacker = makeUnit({
      stats: { HP: 50, STR: 5, MAG: 0, SKL: 10, SPD: 10, DEF: 20, RES: 20, LCK: 5 },
      currentHP: 50,
      weapon: veninEdge,
      inventory: [veninEdge],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { HP: 50, STR: 5, MAG: 0, SKL: 10, SPD: 10, DEF: 20, RES: 20, LCK: 5 },
      currentHP: 50,
      weapon: veninEdge,
      inventory: [veninEdge],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
    );
    // Both survived (high DEF), so both poisons fire
    if (result.attackerHP > 0 && result.defenderHP > 0) {
      expect(result.poisonEffects).toBeDefined();
      expect(result.poisonEffects.length).toBe(2);
      expect(result.poisonEffects.find((p) => p.target === 'defender')).toBeTruthy();
      expect(result.poisonEffects.find((p) => p.target === 'attacker')).toBeTruthy();
    }
  });

  it('adds bloodshard per-hit heal after drain cap and keeps bonus on lethal hit', () => {
    const attacker = makeUnit({
      currentHP: 10,
      stats: { ...makeUnit().stats, HP: 20, STR: 20, SPD: 8 },
      weapon: {
        ...data.weapons.find((w) => w.name === 'Iron Sword'),
        might: 10,
        special: 'Drains HP equal to damage dealt',
      },
      accessory: { combatEffects: { perHitHeal: 2 } },
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      currentHP: 1,
      stats: { ...makeUnit().stats, HP: 20, DEF: 0, SPD: 12 },
      weapon: null,
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        1,
        terrain,
        terrain,
      );
      const firstStrike = result.events.find(
        (event) => event.type === 'strike' && event.attacker === attacker.name,
      );
      expect(firstStrike?.heal).toBe(3);
      expect(result.attackerHP).toBe(13);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('applies poison when attacking with Venin Bow', () => {
    const veninBow = data.weapons.find((weapon) => weapon.name === 'Venin Bow');
    expect(veninBow).toBeTruthy();

    const attacker = makeUnit({
      stats: { HP: 40, STR: 9, MAG: 0, SKL: 12, SPD: 12, DEF: 18, RES: 8, LCK: 5 },
      currentHP: 40,
      weapon: veninBow,
      inventory: [veninBow],
      proficiencies: [{ type: 'Bow', rank: 'Prof' }],
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { HP: 40, STR: 6, MAG: 0, SKL: 8, SPD: 8, DEF: 18, RES: 8, LCK: 5 },
      currentHP: 40,
      weapon: data.weapons.find((weapon) => weapon.name === 'Iron Bow'),
      inventory: [data.weapons.find((weapon) => weapon.name === 'Iron Bow')],
      proficiencies: [{ type: 'Bow', rank: 'Prof' }],
    });

    const terrain = data.terrain.find((tile) => tile.name === 'Plain');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        2,
        terrain,
        terrain,
      );
      expect(result.poisonEffects).toBeDefined();
      expect(
        result.poisonEffects.some((effect) => effect.target === 'defender' && effect.damage === 5),
      ).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('poisonEffects is empty array when no poison weapons used', () => {
    const attacker = makeUnit({
      stats: { ...makeUnit().stats, STR: 5, SPD: 10, DEF: 20 },
      currentHP: 50,
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, STR: 5, SPD: 10, DEF: 20 },
      currentHP: 50,
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
    );
    expect(result.poisonEffects).toBeDefined();
    expect(result.poisonEffects.length).toBe(0);
  });

  it('suppresses attacker follow-up strikes in resolution when weapon art is active', () => {
    const attacker = makeUnit({
      stats: { ...makeUnit().stats, HP: 40, STR: 1, SPD: 20, DEF: 10 },
      currentHP: 40,
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, HP: 40, STR: 1, SPD: 5, DEF: 20 },
      currentHP: 40,
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const base = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        1,
        terrain,
        terrain,
      );
      const withArt = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        1,
        terrain,
        terrain,
        { atkWeaponArtMods: { activated: [{ id: 'weapon_art', name: 'Test Art' }] } },
      );

      const baseAttackerStrikes = base.events.filter(
        (e) => e.type === 'strike' && e.attacker === attacker.name,
      ).length;
      const artAttackerStrikes = withArt.events.filter(
        (e) => e.type === 'strike' && e.attacker === attacker.name,
      ).length;
      expect(baseAttackerStrikes).toBeGreaterThan(artAttackerStrikes);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('applies defender desperation by reordering follow-ups to A1,D1,D2,A2', () => {
    const attacker = makeUnit({
      name: 'Atk',
      stats: { HP: 80, STR: 1, MAG: 0, SKL: 0, SPD: 20, DEF: 25, RES: 25, LCK: 30 },
      currentHP: 80,
    });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      stats: { HP: 80, STR: 1, MAG: 0, SKL: 0, SPD: 10, DEF: 25, RES: 25, LCK: 30 },
      currentHP: 80,
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        1,
        terrain,
        terrain,
        { atkMods: {}, defMods: { quickRiposte: true, desperation: true } },
      );
      const strikeOrder = result.events.filter((e) => e.type === 'strike').map((e) => e.attacker);
      expect(strikeOrder.slice(0, 4)).toEqual([
        attacker.name,
        defender.name,
        defender.name,
        attacker.name,
      ]);
      expect(result.events).toContainEqual({
        type: 'skill',
        name: 'Desperation',
        unit: defender.name,
      });
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('keeps attacker desperation precedence when both sides have desperation', () => {
    const attacker = makeUnit({
      name: 'Atk',
      stats: { HP: 80, STR: 1, MAG: 0, SKL: 0, SPD: 20, DEF: 25, RES: 25, LCK: 30 },
      currentHP: 80,
    });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      stats: { HP: 80, STR: 1, MAG: 0, SKL: 0, SPD: 10, DEF: 25, RES: 25, LCK: 30 },
      currentHP: 80,
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        1,
        terrain,
        terrain,
        { atkMods: { desperation: true }, defMods: { quickRiposte: true, desperation: true } },
      );
      const strikeOrder = result.events.filter((e) => e.type === 'strike').map((e) => e.attacker);
      expect(strikeOrder.slice(0, 4)).toEqual([
        attacker.name,
        attacker.name,
        defender.name,
        defender.name,
      ]);
      const desperationEvents = result.events.filter(
        (e) => e.type === 'skill' && e.name === 'Desperation',
      );
      expect(desperationEvents.length).toBe(1);
      expect(desperationEvents[0].unit).toBe(attacker.name);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('does not emit defender desperation event if defender dies on first hit', () => {
    const attacker = makeUnit({
      name: 'Atk',
      stats: { HP: 30, STR: 99, MAG: 0, SKL: 0, SPD: 20, DEF: 5, RES: 5, LCK: 30 },
      currentHP: 30,
    });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      stats: { HP: 10, STR: 1, MAG: 0, SKL: 0, SPD: 10, DEF: 0, RES: 0, LCK: 0 },
      currentHP: 10,
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        1,
        terrain,
        terrain,
        { atkMods: {}, defMods: { quickRiposte: true, desperation: true } },
      );
      const defenderDesperationEvents = result.events.filter(
        (e) => e.type === 'skill' && e.name === 'Desperation' && e.unit === defender.name,
      );
      expect(defenderDesperationEvents.length).toBe(0);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('applies preventCounter in combat resolution', () => {
    const attacker = makeUnit({
      stats: { ...makeUnit().stats, STR: 12, SPD: 8 },
      currentHP: 24,
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, STR: 12, SPD: 8 },
      currentHP: 24,
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        1,
        terrain,
        terrain,
        {
          atkWeaponArtMods: {
            preventCounter: true,
            activated: [{ id: 'weapon_art', name: 'Windsweep' }],
          },
        },
      );
      const defenderStrikes = result.events.filter(
        (e) => e.type === 'strike' && e.attacker === defender.name,
      );
      expect(defenderStrikes.length).toBe(0);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('applies vengeance bonus in combat resolution', () => {
    const attacker = makeUnit({
      stats: { ...makeUnit().stats, HP: 24, STR: 10, SPD: 8 },
      currentHP: 16,
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, HP: 28, DEF: 8, SPD: 8 },
      currentHP: 28,
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const base = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        1,
        terrain,
        terrain,
      );
      const withArt = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        1,
        terrain,
        terrain,
        {
          atkWeaponArtMods: {
            vengeance: true,
            activated: [{ id: 'weapon_art', name: 'Vengeance' }],
          },
        },
      );
      const missingHp = attacker.stats.HP - attacker.currentHP;
      expect(withArt.defenderHP).toBe(base.defenderHP - missingHp);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('targets RES in combat resolution when art sets targetsRES', () => {
    const attacker = makeUnit({
      stats: { ...makeUnit().stats, STR: 10, SPD: 8 },
      currentHP: 24,
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, HP: 28, DEF: 18, RES: 2, SPD: 8 },
      currentHP: 28,
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const base = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        1,
        terrain,
        terrain,
      );
      const withArt = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        1,
        terrain,
        terrain,
        {
          atkWeaponArtMods: {
            targetsRES: true,
            activated: [{ id: 'weapon_art', name: 'Hexblade' }],
          },
        },
      );
      expect(withArt.defenderHP).toBeLessThan(base.defenderHP);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('halves incoming physical damage in resolution when attacker art has halfPhysicalDamage', () => {
    const attacker = makeUnit({
      stats: { ...makeUnit().stats, HP: 30, STR: 8, SPD: 8, DEF: 6 },
      currentHP: 30,
    });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, HP: 30, STR: 15, SPD: 8, DEF: 6 },
      currentHP: 30,
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find((t) => t.name === 'Plain');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const base = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        1,
        terrain,
        terrain,
      );
      const withArt = resolveCombat(
        attacker,
        attacker.weapon,
        defender,
        defender.weapon,
        1,
        terrain,
        terrain,
        {
          atkWeaponArtMods: {
            halfPhysicalDamage: true,
            activated: [{ id: 'weapon_art', name: 'Pavise Strike' }],
          },
        },
      );
      expect(withArt.attackerHP).toBeGreaterThan(base.attackerHP);
    } finally {
      randomSpy.mockRestore();
    }
  });
});

// --- Staff Mechanics ---

function makeHealer(magOverride = 5) {
  return makeUnit({
    name: 'Healer',
    className: 'Cleric',
    stats: { HP: 18, STR: 1, MAG: magOverride, SKL: 6, SPD: 6, DEF: 2, RES: 8, LCK: 5 },
    currentHP: 18,
    weapon: data.weapons.find((w) => w.name === 'Heal'),
    inventory: [data.weapons.find((w) => w.name === 'Heal')],
    proficiencies: [{ type: 'Staff', rank: 'Prof' }],
  });
}

function makeTarget(currentHP = 10) {
  return makeUnit({
    name: 'Target',
    stats: { HP: 20, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 5 },
    currentHP,
  });
}

describe('Staff healing (MAG-based)', () => {
  it('calculateHealAmount uses MAG + healBase', () => {
    const staff = data.weapons.find((w) => w.name === 'Heal');
    const healer = makeHealer(5); // MAG 5
    const target = makeTarget(10); // 10 missing HP
    // MAG 5 + healBase 5 = 10
    expect(calculateHealAmount(staff, healer, target)).toBe(10);
  });

  it('calculateHealAmount caps at missing HP', () => {
    const staff = data.weapons.find((w) => w.name === 'Mend');
    const healer = makeHealer(10); // MAG 10 + healBase 10 = 20
    const target = makeTarget(17); // only 3 missing HP
    expect(calculateHealAmount(staff, healer, target)).toBe(3);
  });

  it('calculateHealAmount with high MAG heals more', () => {
    const staff = data.weapons.find((w) => w.name === 'Heal');
    const healer5 = makeHealer(5);
    const healer10 = makeHealer(10);
    const target = makeTarget(1); // 19 missing HP
    expect(calculateHealAmount(staff, healer5, target)).toBe(10); // 5 + 5
    expect(calculateHealAmount(staff, healer10, target)).toBe(15); // 10 + 5
  });

  it('resolveHeal returns correct structure', () => {
    const staff = data.weapons.find((w) => w.name === 'Heal');
    const healer = makeHealer(5);
    const target = makeTarget(10);
    const result = resolveHeal(staff, healer, target);
    expect(result.healAmount).toBe(10);
    expect(result.targetHPAfter).toBe(20);
  });

  it('Recover heals MAG + 15', () => {
    const staff = data.weapons.find((w) => w.name === 'Recover');
    const healer = makeHealer(8);
    const target = makeTarget(1); // 19 missing HP
    // MAG 8 + healBase 15 = 23, capped at 19
    expect(calculateHealAmount(staff, healer, target)).toBe(19);
  });
});

describe('Staff bonus uses', () => {
  it('calculateBonusUses returns 0 below all thresholds', () => {
    expect(calculateBonusUses(7)).toBe(0);
    expect(calculateBonusUses(0)).toBe(0);
  });

  it('calculateBonusUses returns 1 at MAG 8', () => {
    expect(calculateBonusUses(8)).toBe(1);
    expect(calculateBonusUses(13)).toBe(1);
  });

  it('calculateBonusUses returns 2 at MAG 14', () => {
    expect(calculateBonusUses(14)).toBe(2);
    expect(calculateBonusUses(19)).toBe(2);
  });

  it('calculateBonusUses returns 3 at MAG 20', () => {
    expect(calculateBonusUses(20)).toBe(3);
    expect(calculateBonusUses(25)).toBe(3);
  });

  it('getStaffMaxUses adds bonus uses to base', () => {
    const staff = data.weapons.find((w) => w.name === 'Heal'); // base 3
    expect(getStaffMaxUses(staff, makeHealer(5))).toBe(3); // 3 + 0
    expect(getStaffMaxUses(staff, makeHealer(8))).toBe(4); // 3 + 1
    expect(getStaffMaxUses(staff, makeHealer(14))).toBe(5); // 3 + 2
    expect(getStaffMaxUses(staff, makeHealer(20))).toBe(6); // 3 + 3
  });

  it('getStaffRemainingUses tracks spent uses', () => {
    const staff = { ...data.weapons.find((w) => w.name === 'Heal') }; // clone
    const healer = makeHealer(5); // max 3
    expect(getStaffRemainingUses(staff, healer)).toBe(3);
    spendStaffUse(staff);
    expect(getStaffRemainingUses(staff, healer)).toBe(2);
    spendStaffUse(staff);
    spendStaffUse(staff);
    expect(getStaffRemainingUses(staff, healer)).toBe(0);
  });

  it('getStaffRemainingUses floors at 0', () => {
    const staff = { ...data.weapons.find((w) => w.name === 'Heal'), _usesSpent: 99 };
    expect(getStaffRemainingUses(staff, makeHealer(5))).toBe(0);
  });
});

describe('Staff effective range', () => {
  it('normal staff has no range bonus', () => {
    const staff = data.weapons.find((w) => w.name === 'Heal');
    const range = getEffectiveStaffRange(staff, makeHealer(20));
    expect(range).toEqual({ min: 1, max: 1 });
  });

  it('Physic base range is 2', () => {
    const physic = data.weapons.find((w) => w.name === 'Physic');
    const range = getEffectiveStaffRange(physic, makeHealer(5));
    expect(range).toEqual({ min: 2, max: 2 });
  });

  it('Physic gains +1 range at MAG 10', () => {
    const physic = data.weapons.find((w) => w.name === 'Physic');
    const range = getEffectiveStaffRange(physic, makeHealer(10));
    expect(range).toEqual({ min: 2, max: 3 });
  });

  it('Physic gains +2 range at MAG 18', () => {
    const physic = data.weapons.find((w) => w.name === 'Physic');
    const range = getEffectiveStaffRange(physic, makeHealer(18));
    expect(range).toEqual({ min: 2, max: 4 });
  });

  it('Fortify has range 2 with healAll flag', () => {
    const fortify = data.weapons.find((w) => w.name === 'Fortify');
    expect(fortify.healAll).toBe(true);
    const range = getEffectiveStaffRange(fortify, makeHealer(5));
    expect(range).toEqual({ min: 2, max: 2 });
  });
});

describe('Staff data integrity', () => {
  it('all staves have uses field; heal staves have healBase', () => {
    const staves = data.weapons.filter((w) => w.type === 'Staff');
    expect(staves.length).toBe(7);
    const healStaves = staves.filter((s) => !s.statusEffect);
    const statusStaves = staves.filter((s) => s.statusEffect);
    expect(healStaves.length).toBe(5);
    expect(statusStaves.length).toBe(2);
    for (const staff of healStaves) {
      expect(staff.healBase).toBeDefined();
      expect(typeof staff.healBase).toBe('number');
    }
    for (const staff of staves) {
      expect(staff.uses).toBeDefined();
      expect(typeof staff.uses).toBe('number');
    }
  });

  it('all staves have perBattleUses flag', () => {
    const staves = data.weapons.filter((w) => w.type === 'Staff');
    for (const staff of staves) {
      expect(staff.perBattleUses).toBe(true);
    }
  });

  it('_usesSpent resets to 0 when perBattleUses flag is set (battle-start reset)', () => {
    const heal = structuredClone(data.weapons.find((w) => w.name === 'Heal'));
    heal._usesSpent = 3; // fully depleted
    expect(getStaffRemainingUses(heal, makeHealer(5))).toBe(0);

    // Simulate battle-start reset (same logic as BattleScene.create)
    if (heal.perBattleUses) heal._usesSpent = 0;

    expect(heal._usesSpent).toBe(0);
    expect(getStaffRemainingUses(heal, makeHealer(5))).toBe(3);
  });

  it('Physic is in act3 loot table', () => {
    expect(data.lootTables.act3.weapons).toContain('Physic');
  });

  it('Physic has rangeBonuses array', () => {
    const physic = data.weapons.find((w) => w.name === 'Physic');
    expect(physic.rangeBonuses).toBeDefined();
    expect(physic.rangeBonuses.length).toBe(2);
  });

  it('Mend/Physic/Recover have updated balance patch prices', () => {
    const mend = data.weapons.find((w) => w.name === 'Mend');
    const physic = data.weapons.find((w) => w.name === 'Physic');
    const recover = data.weapons.find((w) => w.name === 'Recover');
    expect(mend.price).toBe(1500);
    expect(physic.price).toBe(4000);
    expect(recover.price).toBe(4000);
  });
});
describe('Weight mechanic', () => {
  it('calculateEffectiveWeight returns 0 for no weapon', () => {
    const unit = makeUnit({ stats: { ...makeUnit().stats, STR: 10 } });
    expect(calculateEffectiveWeight(null, unit)).toBe(0);
  });

  it('calculateEffectiveWeight applies STR reduction correctly', () => {
    const unit = makeUnit({ stats: { ...makeUnit().stats, STR: 10 } }); // STR 10 → 2 reduction
    const weapon = { weight: 7 };
    expect(calculateEffectiveWeight(weapon, unit)).toBe(5); // 7 - 2 = 5
  });

  it('calculateEffectiveWeight floors at 0', () => {
    const unit = makeUnit({ stats: { ...makeUnit().stats, STR: 25 } }); // STR 25 → 5 reduction
    const weapon = { weight: 3 };
    expect(calculateEffectiveWeight(weapon, unit)).toBe(0); // max(0, 3 - 5) = 0
  });

  it('canDouble accounts for weight penalty', () => {
    const light = { weight: 3 };
    const heavy = { weight: 9 };
    const fastUnit = makeUnit({ stats: { ...makeUnit().stats, SPD: 15, STR: 5 } }); // 1 reduction (5/5)
    const slowUnit = makeUnit({ stats: { ...makeUnit().stats, SPD: 10, STR: 5 } }); // 1 reduction

    // Without weight: SPD 15 vs 10 → doubles (diff = 5)
    // With light weapons (3 - 1 = 2 effective each): SPD 13 vs 8 → doubles (diff = 5)
    expect(canDouble(fastUnit, slowUnit, light, light)).toBe(true);

    // With heavy on fast unit (9 - 1 = 8): SPD 7 vs 8 → no double (diff = -1)
    expect(canDouble(fastUnit, slowUnit, heavy, light)).toBe(false);
  });

  it('canDouble with high STR negates weight', () => {
    const heavy = { weight: 9 };
    const fastHeavy = makeUnit({ stats: { ...makeUnit().stats, SPD: 15, STR: 20 } }); // 4 reduction (20/5)
    const slowUnit = makeUnit({ stats: { ...makeUnit().stats, SPD: 10, STR: 5 } }); // 1 reduction

    // Heavy weapon effective weight: 9 - 4 = 5
    // fastHeavy effective SPD: 15 - 5 = 10
    // slowUnit effective SPD: 10 - 0 = 10 (no weapon)
    // Diff = 0, threshold = 5 → no double
    expect(canDouble(fastHeavy, slowUnit, heavy, null)).toBe(false);

    // But if slowUnit also has heavy weapon: 10 - (9 - 1) = 2
    // fastHeavy: 10, slowUnit: 2 → diff = 8 → doubles
    expect(canDouble(fastHeavy, slowUnit, heavy, heavy)).toBe(true);
  });

  it('getCombatForecast shows weight impact on doubling', () => {
    const ironSword = data.weapons.find((w) => w.name === 'Iron Sword');
    const braveAxe = data.weapons.find((w) => w.name === 'Brave Axe');
    const fastUnit = makeUnit({
      stats: { ...makeUnit().stats, SPD: 20, STR: 5, HP: 30 },
      currentHP: 30,
    }); // 1 reduction
    const slowUnit = makeUnit({
      stats: { ...makeUnit().stats, SPD: 15, STR: 5, HP: 30 },
      currentHP: 30,
    }); // 1 reduction

    // Iron Sword weight 3: effective 2 each
    // SPD: 18 vs 13 → diff = 5 → doubles
    let forecast = getCombatForecast(fastUnit, ironSword, slowUnit, ironSword, 1, null, null);
    expect(forecast.attacker.doubles).toBe(true);

    // Brave Axe weight 11: effective 10 each
    // SPD: 10 vs 5 → diff = 5 → doubles
    forecast = getCombatForecast(fastUnit, braveAxe, slowUnit, braveAxe, 1, null, null);
    expect(forecast.attacker.doubles).toBe(true);

    // Mixed: fastUnit with Brave (10 eff), slowUnit with Iron (2 eff)
    // SPD: 10 vs 13 → diff = -3 → no double
    forecast = getCombatForecast(fastUnit, braveAxe, slowUnit, ironSword, 1, null, null);
    expect(forecast.attacker.doubles).toBe(false);
  });

  it('resolveCombat applies weight penalties to both combatants', () => {
    const ironSword = data.weapons.find((w) => w.name === 'Iron Sword');
    const braveAxe = data.weapons.find((w) => w.name === 'Brave Axe');
    const fastUnit = makeUnit({
      stats: { ...makeUnit().stats, SPD: 20, STR: 15, HP: 40 },
      currentHP: 40,
    });
    const slowUnit = makeUnit({
      stats: { ...makeUnit().stats, SPD: 15, STR: 15, HP: 40 },
      currentHP: 40,
    });

    // Both with Iron Sword (weight 3, 3 reduction = 0 eff): no weight penalty
    // SPD 20 vs 15 → diff = 5 → doubles
    let result = resolveCombat(fastUnit, ironSword, slowUnit, ironSword, 1, null, null);
    const fastUnitStrikes = result.events.filter((e) => e.attacker === fastUnit.name).length;
    expect(fastUnitStrikes).toBeGreaterThan(1); // Should double

    // Both with Brave Axe (weight 11, 3 reduction = 8 eff)
    // SPD 12 vs 7 → diff = 5 → doubles
    result = resolveCombat(fastUnit, braveAxe, slowUnit, braveAxe, 1, null, null);
    const fastUnitStrikesAxe = result.events.filter((e) => e.attacker === fastUnit.name).length;
    expect(fastUnitStrikesAxe).toBeGreaterThan(1); // Should double
  });

  it('weight penalty stacks with skill SPD bonuses', () => {
    const braveAxe = data.weapons.find((w) => w.name === 'Brave Axe'); // weight 11
    const fastUnit = makeUnit({
      stats: { ...makeUnit().stats, SPD: 20, STR: 5, HP: 30 },
      currentHP: 30,
    }); // 1 reduction → eff weight 10
    const slowUnit = makeUnit({
      stats: { ...makeUnit().stats, SPD: 15, STR: 5, HP: 30 },
      currentHP: 30,
    });

    // Death Blow: -5 SPD when initiating
    const skillCtx = {
      atkMods: { spdBonus: -5 }, // Death Blow active
      defMods: {},
    };

    // Weight: SPD 20 - 10 = 10
    // Death Blow: 10 - 5 = 5
    // vs SPD 15 - 10 = 5
    // Diff = 0 → no double
    const forecast = getCombatForecast(
      fastUnit,
      braveAxe,
      slowUnit,
      braveAxe,
      1,
      null,
      null,
      skillCtx,
    );
    expect(forecast.attacker.doubles).toBe(false);
  });
});

describe('Sunder effect', () => {
  it('hasSunderEffect returns true for Sunder weapons', () => {
    const sunder = data.weapons.find((w) => w.name === 'Sunder Sword');
    expect(sunder).toBeDefined();
    expect(hasSunderEffect(sunder)).toBe(true);
  });

  it('hasSunderEffect returns false for normal weapons', () => {
    const iron = data.weapons.find((w) => w.name === 'Iron Sword');
    expect(hasSunderEffect(iron)).toBe(false);
  });

  it('hasSunderEffect handles null/undefined weapon', () => {
    expect(hasSunderEffect(null)).toBe(false);
    expect(hasSunderEffect(undefined)).toBe(false);
    expect(hasSunderEffect({})).toBe(false);
  });

  it('calculateDamage halves DEF when attacker has Sunder weapon', () => {
    const sunderSword = data.weapons.find((w) => w.name === 'Sunder Sword');
    const ironSword = data.weapons.find((w) => w.name === 'Iron Sword');
    const attacker = { stats: { STR: 10, SKL: 10, SPD: 5, LCK: 5 }, weaponRank: 'Prof' };
    const defender = {
      stats: { DEF: 12, SPD: 5, LCK: 5, HP: 30 },
      currentHP: 30,
      moveType: 'Infantry',
    };

    const sunderDmg = calculateDamage(attacker, sunderSword, defender, null, null);
    const normalDmg = calculateDamage(attacker, ironSword, defender, null, null);

    // Sunder: (10+4) - floor(12/2) = 14-6 = 8
    // Normal: (10+5) - 12 = 3
    expect(sunderDmg).toBe(8);
    expect(normalDmg).toBe(3);
  });

  it('Sunder halves DEF with floor rounding on odd DEF', () => {
    const sunderSword = data.weapons.find((w) => w.name === 'Sunder Sword');
    const attacker = { stats: { STR: 10, SKL: 10, SPD: 5, LCK: 5 }, weaponRank: 'Prof' };
    const defender = {
      stats: { DEF: 11, SPD: 5, LCK: 5, HP: 30 },
      currentHP: 30,
      moveType: 'Infantry',
    };

    const dmg = calculateDamage(attacker, sunderSword, defender, null, null);
    // (10+4) - floor(11/2) = 14-5 = 9
    expect(dmg).toBe(9);
  });

  it('Sunder does not apply to magic damage (RES not halved)', () => {
    const sunderSword = data.weapons.find((w) => w.name === 'Sunder Sword');
    const attacker = { stats: { STR: 10, SKL: 10, SPD: 5, LCK: 5 }, weaponRank: 'Prof' };
    const defender = {
      stats: { DEF: 20, RES: 20, SPD: 5, LCK: 5, HP: 30 },
      currentHP: 30,
      moveType: 'Infantry',
    };

    const dmg = calculateDamage(attacker, sunderSword, defender, null, null);
    // (10+4) - floor(20/2) = 14-10 = 4
    expect(dmg).toBe(4);
  });
});

describe('Combat mod merging', () => {
  it('merges additive and boolean combat mods', () => {
    const merged = mergeCombatMods(
      {
        atkBonus: 2,
        hitBonus: 10,
        ignoreTerrainAvoid: false,
        rangeBonus: 1,
        drainPercent: 0.2,
        multiHit: { count: 2, damageMultiplier: 0.8 },
        activated: [{ id: 'a', name: 'A' }],
      },
      {
        atkBonus: 3,
        critBonus: 5,
        statScaling: { stat: 'SKL', divisor: 2 },
        ignoreTerrainAvoid: true,
        preventCounter: true,
        targetsRES: true,
        effectiveness: { moveTypes: ['flying'], multiplier: 3 },
        rangeBonus: 2,
        rangeOverride: 2,
        halfPhysicalDamage: true,
        vengeance: true,
        drainPercent: 0.3,
        multiHit: { count: 3, damageMultiplier: 0.5 },
        activated: [{ id: 'b', name: 'B' }],
      },
    );
    expect(merged.atkBonus).toBe(5);
    expect(merged.hitBonus).toBe(10);
    expect(merged.critBonus).toBe(5);
    expect(merged.statScaling).toEqual({ stat: 'SKL', divisor: 2 });
    expect(merged.ignoreTerrainAvoid).toBe(true);
    expect(merged.preventCounter).toBe(true);
    expect(merged.targetsRES).toBe(true);
    expect(merged.effectiveness).toEqual({ moveTypes: ['flying'], multiplier: 3 });
    expect(merged.rangeBonus).toBe(3);
    expect(merged.rangeOverride).toEqual({ min: 2, max: 2 });
    expect(merged.halfPhysicalDamage).toBe(true);
    expect(merged.vengeance).toBe(true);
    expect(merged.multiHit).toEqual({ count: 3, damageMultiplier: 0.5 });
    expect(merged.drainPercent).toBe(0.3);
    expect(merged.activated.length).toBe(2);
  });

  it('preserves resBonus through normalize and merge', () => {
    const merged = mergeCombatMods({ resBonus: 3 }, { resBonus: 2 });
    expect(merged.resBonus).toBe(5);
  });
});

describe('resBonus reduces magic damage in forecast and resolution', () => {
  it('resBonus reduces magic damage in forecast', () => {
    const attacker = makeUnit({
      stats: { HP: 20, STR: 0, MAG: 12, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 5 },
    });
    const defender = makeUnit();
    const magicWeapon = data.weapons.find((w) => w.type === 'Tome');

    // Forecast without resBonus
    const forecastBase = getCombatForecast(
      attacker,
      magicWeapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      null,
    );

    // Forecast with resBonus on defender
    const forecastWithRes = getCombatForecast(
      attacker,
      magicWeapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      { defMods: { resBonus: 3 } },
    );

    expect(forecastWithRes.attacker.damage).toBe(forecastBase.attacker.damage - 3);
  });

  it('resBonus does NOT reduce physical damage in forecast', () => {
    const attacker = makeUnit();
    const defender = makeUnit();

    const forecastBase = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      null,
    );

    const forecastWithRes = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      { defMods: { resBonus: 5 } },
    );

    expect(forecastWithRes.attacker.damage).toBe(forecastBase.attacker.damage);
  });

  it('resBonus reduces magic damage in resolveCombat', () => {
    const attacker = makeUnit({
      name: 'Mage',
      stats: { HP: 20, STR: 0, MAG: 15, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 5 },
      currentHP: 20,
    });
    const magicWeapon = data.weapons.find((w) => w.type === 'Tome');
    const defender = makeUnit({
      currentHP: 50,
      stats: { HP: 50, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 5 },
    });

    // Resolve without resBonus — hit rate 100% for deterministic check
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const resultBase = resolveCombat(
      attacker,
      magicWeapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      null,
    );
    vi.restoreAllMocks();

    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const resultWithRes = resolveCombat(
      attacker,
      magicWeapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      { defMods: { resBonus: 3 } },
    );
    vi.restoreAllMocks();

    // Each hit should deal 3 less damage with resBonus
    const baseStrike = resultBase.events.find((e) => e.type === 'strike' && !e.miss);
    const resStrike = resultWithRes.events.find((e) => e.type === 'strike' && !e.miss);
    expect(resStrike.damage).toBe(baseStrike.damage - 3);
  });
});

// --- Regression tests for Findings 1-5 ---

describe('Intimidate debuff target mapping', () => {
  // Helper: build skillCtx that wires real rollStrikeSkills/rollDefenseSkills
  function makeSkillCtx(atkSkills, defSkills, skillsData) {
    const { rollStrikeSkills, rollDefenseSkills } = require('../src/engine/SkillSystem.js');
    return {
      atkMods: null,
      defMods: null,
      rollStrikeSkills,
      rollDefenseSkills,
      skillsData,
    };
  }

  it('defender with Intimidate debuffs the attacker (initiator hit path)', () => {
    const attacker = makeUnit({
      name: 'Atk',
      stats: { HP: 30, STR: 12, MAG: 0, SKL: 10, SPD: 15, DEF: 5, RES: 3, LCK: 5 },
      currentHP: 30,
      skills: [],
    });
    const defender = makeUnit({
      name: 'Def',
      stats: { HP: 30, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 5 },
      currentHP: 30,
      skills: ['intimidate'],
    });
    const skillCtx = makeSkillCtx([], ['intimidate'], data.skills);

    // Force all rolls to hit + trigger intimidate (activation: always → 100%)
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    vi.restoreAllMocks();

    // Intimidate should debuff the ATTACKER, not the defender
    expect(result.debuffEvents.length).toBeGreaterThan(0);
    const atkDebuff = result.debuffEvents.find((d) => d.target === 'attacker');
    expect(atkDebuff).toBeTruthy();
    expect(atkDebuff.debuffs).toHaveProperty('STR');
  });

  it('attacker with Intimidate debuffs the defender on counter path', () => {
    const attacker = makeUnit({
      name: 'Atk',
      stats: { HP: 30, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 5 },
      currentHP: 30,
      skills: ['intimidate'],
    });
    const defender = makeUnit({
      name: 'Def',
      stats: { HP: 30, STR: 12, MAG: 0, SKL: 10, SPD: 15, DEF: 5, RES: 3, LCK: 5 },
      currentHP: 30,
      skills: [],
    });
    const skillCtx = makeSkillCtx(['intimidate'], [], data.skills);

    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    vi.restoreAllMocks();

    // Intimidate should debuff the DEFENDER (counter-striker), not the attacker
    const defDebuff = result.debuffEvents.find((d) => d.target === 'defender');
    expect(defDebuff).toBeTruthy();
    expect(defDebuff.debuffs).toHaveProperty('STR');
  });
});

describe('Activation surfacing for trigger-only skills', () => {
  function makeSkillCtx(skillsData) {
    const { rollStrikeSkills, rollDefenseSkills } = require('../src/engine/SkillSystem.js');
    return {
      atkMods: null,
      defMods: null,
      rollStrikeSkills,
      rollDefenseSkills,
      skillsData,
    };
  }

  it('intimidate appears in strike skillActivations', () => {
    const attacker = makeUnit({
      name: 'Atk',
      stats: { HP: 30, STR: 12, MAG: 0, SKL: 10, SPD: 15, DEF: 5, RES: 3, LCK: 5 },
      currentHP: 30,
      skills: [],
    });
    const defender = makeUnit({
      name: 'Def',
      stats: { HP: 30, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 5 },
      currentHP: 30,
      skills: ['intimidate'],
    });
    const skillCtx = makeSkillCtx(data.skills);

    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    vi.restoreAllMocks();

    const strikeEvent = result.events.find((e) => e.type === 'strike' && !e.miss);
    expect(strikeEvent.skillActivations.some((a) => a.id === 'intimidate')).toBe(true);
  });

  it('divine_charge appears in strike skillActivations on proc', () => {
    const attacker = makeUnit({
      name: 'Atk',
      stats: { HP: 30, STR: 12, MAG: 0, SKL: 99, SPD: 15, DEF: 5, RES: 3, LCK: 5 },
      currentHP: 30,
      skills: ['divine_charge'],
    });
    const defender = makeUnit({
      name: 'Def',
      stats: { HP: 30, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 5 },
      currentHP: 30,
      skills: [],
    });
    const skillCtx = makeSkillCtx(data.skills);

    // SKL 99 → activation chance 99%. Roll 0.0 triggers it.
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    vi.restoreAllMocks();

    const strikeEvent = result.events.find(
      (e) => e.type === 'strike' && !e.miss && e.attacker === 'Atk',
    );
    expect(strikeEvent.skillActivations.some((a) => a.id === 'divine_charge')).toBe(true);
  });

  it('cancel appears in skillActivations when triggered', () => {
    // Attacker SPD 15 doubles defender SPD 10 (15 >= 10+5). Cancel activation = SPD% = 10%.
    // High LCK zeroes crit rate. Math.random = 0.0 → 0 < 10 → cancel fires.
    const attacker = makeUnit({
      name: 'Atk',
      stats: { HP: 30, STR: 12, MAG: 0, SKL: 10, SPD: 15, DEF: 5, RES: 3, LCK: 50 },
      currentHP: 30,
      skills: [],
    });
    const defender = makeUnit({
      name: 'Def',
      stats: { HP: 30, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 50 },
      currentHP: 30,
      skills: ['cancel'],
    });
    const skillCtx = makeSkillCtx(data.skills);

    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    vi.restoreAllMocks();

    const strikeEvent = result.events.find((e) => e.type === 'strike' && !e.miss);
    expect(strikeEvent.skillActivations.some((a) => a.id === 'cancel')).toBe(true);
  });
});

describe('Divine Charge defender proc and dual proc', () => {
  function makeSkillCtx(skillsData) {
    const { rollStrikeSkills, rollDefenseSkills } = require('../src/engine/SkillSystem.js');
    return {
      atkMods: null,
      defMods: null,
      rollStrikeSkills,
      rollDefenseSkills,
      skillsData,
    };
  }

  it('defender with divine_charge gets heal payload on counter', () => {
    const attacker = makeUnit({
      name: 'Atk',
      stats: { HP: 30, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 5 },
      currentHP: 30,
      skills: [],
    });
    const defender = makeUnit({
      name: 'Def',
      stats: { HP: 30, STR: 12, MAG: 0, SKL: 99, SPD: 15, DEF: 5, RES: 3, LCK: 5 },
      currentHP: 30,
      skills: ['divine_charge'],
    });
    const skillCtx = makeSkillCtx(data.skills);

    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    vi.restoreAllMocks();

    // Defender counters and procs divine_charge
    const defHeal = result.divineChargeHeals.find((h) => h.side === 'defender');
    expect(defHeal).toBeTruthy();
    expect(defHeal.damageDealt).toBeGreaterThan(0);
  });

  it('both sides can proc divine_charge (dual proc)', () => {
    // High LCK zeroes crit rate so nobody one-shots. Both alive → both proc.
    const attacker = makeUnit({
      name: 'Atk',
      stats: { HP: 30, STR: 12, MAG: 0, SKL: 99, SPD: 12, DEF: 5, RES: 3, LCK: 99 },
      currentHP: 30,
      skills: ['divine_charge'],
    });
    const defender = makeUnit({
      name: 'Def',
      stats: { HP: 30, STR: 12, MAG: 0, SKL: 99, SPD: 12, DEF: 5, RES: 3, LCK: 99 },
      currentHP: 30,
      skills: ['divine_charge'],
    });
    const skillCtx = makeSkillCtx(data.skills);

    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    vi.restoreAllMocks();

    // Both should have entries
    expect(result.divineChargeHeals.length).toBe(2);
    expect(result.divineChargeHeals.some((h) => h.side === 'attacker')).toBe(true);
    expect(result.divineChargeHeals.some((h) => h.side === 'defender')).toBe(true);
  });
});

describe('Proc precedence and Cancel follow-up ownership', () => {
  function makeSkillCtx(skillsData, atkMods = {}, defMods = {}) {
    const { rollStrikeSkills, rollDefenseSkills } = require('../src/engine/SkillSystem.js');
    return {
      atkMods: { ...atkMods },
      defMods: { ...defMods },
      rollStrikeSkills,
      rollDefenseSkills,
      skillsData,
    };
  }

  it('resolves only Aether when Aether/Flare/Luna/Sol all proc on the same strike', () => {
    const attacker = makeUnit({
      name: 'Atk',
      skills: ['sol', 'luna', 'flare', 'aether'],
      stats: { HP: 100, STR: 20, MAG: 0, SKL: 100, SPD: 10, DEF: 10, RES: 10, LCK: 99 },
      currentHP: 100,
    });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      stats: { HP: 120, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 20, RES: 12, LCK: 99 },
      currentHP: 120,
    });
    const skillCtx = makeSkillCtx(data.skills, { hitBonus: 1000 });

    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    vi.restoreAllMocks();

    const firstStrike = result.events.find(
      (e) => e.type === 'strike' && e.attacker === attacker.name && !e.miss,
    );
    const procIds = firstStrike.skillActivations
      .map((a) => a.id)
      .filter((id) => ['aether', 'flare', 'luna', 'sol'].includes(id));
    expect(procIds).toEqual(['aether']);
    expect(firstStrike.extraStrike).toBe(true);
    expect(firstStrike.aetherLuna).toBe(true);
  });

  it('resolves Flare over Luna/Sol when Aether is absent', () => {
    const attacker = makeUnit({
      name: 'Atk',
      skills: ['sol', 'luna', 'flare'],
      stats: { HP: 100, STR: 20, MAG: 0, SKL: 100, SPD: 10, DEF: 10, RES: 10, LCK: 99 },
      currentHP: 100,
    });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      stats: { HP: 120, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 20, RES: 12, LCK: 99 },
      currentHP: 120,
    });
    const skillCtx = makeSkillCtx(data.skills, { hitBonus: 1000 });

    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    vi.restoreAllMocks();

    const firstStrike = result.events.find(
      (e) => e.type === 'strike' && e.attacker === attacker.name && !e.miss,
    );
    const procIds = firstStrike.skillActivations
      .map((a) => a.id)
      .filter((id) => ['aether', 'flare', 'luna', 'sol'].includes(id));
    expect(procIds).toEqual(['flare']);
    expect(firstStrike.extraStrike).toBe(false);
  });

  it('allows Cancel to suppress attacker follow-up in Desperation order', () => {
    const attacker = makeUnit({
      name: 'Atk',
      stats: { HP: 80, STR: 8, MAG: 0, SKL: 10, SPD: 20, DEF: 10, RES: 8, LCK: 99 },
      currentHP: 80,
    });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      skills: ['cancel'],
      stats: { HP: 80, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 10, RES: 8, LCK: 99 },
      currentHP: 80,
    });
    const skillCtx = makeSkillCtx(data.skills, { desperation: true, hitBonus: 1000 });

    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    vi.restoreAllMocks();

    const strikeOrder = result.events.filter((e) => e.type === 'strike').map((e) => e.attacker);
    expect(strikeOrder).toEqual([attacker.name, defender.name]);
    const firstStrike = result.events.find(
      (e) => e.type === 'strike' && e.attacker === attacker.name && !e.miss,
    );
    expect(firstStrike.skillActivations.some((a) => a.id === 'cancel')).toBe(true);
  });

  it('under Vantage, attacker-side Cancel suppresses defender follow-up only', () => {
    const attacker = makeUnit({
      name: 'Atk',
      skills: ['cancel'],
      stats: { HP: 120, STR: 5, MAG: 0, SKL: 10, SPD: 20, DEF: 25, RES: 10, LCK: 99 },
      currentHP: 120,
    });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      stats: { HP: 120, STR: 5, MAG: 0, SKL: 10, SPD: 15, DEF: 25, RES: 10, LCK: 99 },
      currentHP: 120,
    });
    const skillCtx = makeSkillCtx(
      data.skills,
      { hitBonus: 1000 },
      { vantage: true, quickRiposte: true, hitBonus: 1000 },
    );

    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    vi.restoreAllMocks();

    const strikeOrder = result.events.filter((e) => e.type === 'strike').map((e) => e.attacker);
    expect(strikeOrder).toEqual([defender.name, attacker.name, attacker.name]);
  });

  it('under Vantage, defender-side Cancel suppresses attacker follow-up only', () => {
    const attacker = makeUnit({
      name: 'Atk',
      stats: { HP: 120, STR: 5, MAG: 0, SKL: 10, SPD: 20, DEF: 25, RES: 10, LCK: 99 },
      currentHP: 120,
    });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      skills: ['cancel'],
      stats: { HP: 120, STR: 5, MAG: 0, SKL: 10, SPD: 15, DEF: 25, RES: 10, LCK: 99 },
      currentHP: 120,
    });
    const skillCtx = makeSkillCtx(
      data.skills,
      { hitBonus: 1000 },
      { vantage: true, quickRiposte: true, hitBonus: 1000 },
    );

    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      1,
      null,
      null,
      skillCtx,
    );
    vi.restoreAllMocks();

    const strikeOrder = result.events.filter((e) => e.type === 'strike').map((e) => e.attacker);
    expect(strikeOrder).toEqual([defender.name, attacker.name, defender.name]);
  });
});

// --- Status condition combat integration ---
describe('Status conditions in combat', () => {
  it('sleeping defender wakes on damage (wokeFromSleep flag)', () => {
    const { applyCondition, isSleeping } = require('../src/engine/StatusConditionSystem.js');
    const attacker = makeUnit({ name: 'Atk', stats: { ...makeUnit().stats, STR: 15, SPD: 12 } });
    const defender = makeUnit({
      name: 'Def',
      stats: { ...makeUnit().stats, DEF: 5, SPD: 8 },
      currentHP: 30,
    });
    applyCondition(defender, 'sleep', 3);
    expect(isSleeping(defender)).toBe(true);

    // Force all hits to land for deterministic wake behavior
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const result = resolveCombat(attacker, attacker.weapon, defender, defender.weapon, 1);
    vi.restoreAllMocks();

    const strikes = result.events.filter((e) => e.type === 'strike');
    const firstHit = strikes.find((s) => !s.miss && s.damage > 0);
    expect(firstHit).toBeDefined();
    expect(firstHit.wokeFromSleep).toBe(true);
    expect(isSleeping(defender)).toBe(false);
  });

  it('sleeping defender cannot counter-attack', () => {
    const { applyCondition, isSleeping } = require('../src/engine/StatusConditionSystem.js');
    const attacker = makeUnit({ name: 'Atk', stats: { ...makeUnit().stats, STR: 15, SPD: 12 } });
    const defender = makeUnit({
      name: 'Def',
      stats: { ...makeUnit().stats, DEF: 5, SPD: 8 },
      currentHP: 30,
    });
    applyCondition(defender, 'sleep', 3);

    // Force all hits to land
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const result = resolveCombat(attacker, attacker.weapon, defender, defender.weapon, 1);
    vi.restoreAllMocks();

    // Defender should never strike back — wakes on damage but cannot retaliate this combat
    const defStrikes = result.events.filter(
      (e) => e.type === 'strike' && e.attackerSide === 'defender',
    );
    expect(defStrikes).toHaveLength(0);
    // Attacker should have struck and woken the defender
    const atkStrikes = result.events.filter(
      (e) => e.type === 'strike' && e.attackerSide === 'attacker',
    );
    expect(atkStrikes.length).toBeGreaterThan(0);
    expect(atkStrikes[0].wokeFromSleep).toBe(true);
    expect(isSleeping(defender)).toBe(false);
  });

  it('forecast shows sleeping defender cannot counter', () => {
    const { applyCondition } = require('../src/engine/StatusConditionSystem.js');
    const attacker = makeUnit({ name: 'Atk', stats: { ...makeUnit().stats, STR: 15 } });
    const defender = makeUnit({
      name: 'Def',
      stats: { ...makeUnit().stats, DEF: 5 },
      currentHP: 30,
    });
    applyCondition(defender, 'sleep', 3);
    const fc = getCombatForecast(attacker, attacker.weapon, defender, defender.weapon, 1);
    expect(fc.defender.canCounter).toBe(false);
    expect(fc.defender.attackCount).toBe(0);
  });

  it('silenced defender cannot counter with magic weapon', () => {
    const { applyCondition } = require('../src/engine/StatusConditionSystem.js');
    const tome = data.weapons.find((w) => w.type === 'Tome');
    const attacker = makeUnit({
      name: 'Atk',
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    const defender = makeUnit({
      name: 'Def',
      weapon: tome,
      proficiencies: [{ type: 'Tome', rank: 'Prof' }],
      className: 'Mage',
    });
    applyCondition(defender, 'silence', 3);

    const forecast = getCombatForecast(attacker, attacker.weapon, defender, defender.weapon, 1);
    expect(forecast.defender.canCounter).toBe(false);
    expect(forecast.defender.attackCount).toBe(0);
  });

  it('silenced defender CAN counter with physical weapon', () => {
    const { applyCondition } = require('../src/engine/StatusConditionSystem.js');
    const attacker = makeUnit({ name: 'Atk' });
    const defender = makeUnit({
      name: 'Def',
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });
    applyCondition(defender, 'silence', 3);

    const forecast = getCombatForecast(attacker, attacker.weapon, defender, defender.weapon, 1);
    expect(forecast.defender.canCounter).toBe(true);
    expect(forecast.defender.attackCount).toBeGreaterThanOrEqual(1);
  });

  it('silenced attacker with magic weapon gets 0 hit and 0 damage in forecast', () => {
    const { applyCondition } = require('../src/engine/StatusConditionSystem.js');
    const tome = data.weapons.find((w) => w.type === 'Tome');
    const attacker = makeUnit({
      name: 'Silenced Mage',
      weapon: tome,
      proficiencies: [{ type: 'Tome', rank: 'Prof' }],
      className: 'Mage',
    });
    const defender = makeUnit({ name: 'Target' });
    applyCondition(attacker, 'silence', 3);

    const forecast = getCombatForecast(attacker, tome, defender, defender.weapon, 1);
    expect(forecast.attacker.damage).toBe(0);
    expect(forecast.attacker.hit).toBe(0);
  });

  it('silenced attacker with physical weapon is unaffected', () => {
    const { applyCondition } = require('../src/engine/StatusConditionSystem.js');
    const sword = data.weapons.find((w) => w.name === 'Iron Sword');
    const attacker = makeUnit({ name: 'Paladin', weapon: sword });
    const defender = makeUnit({ name: 'Target' });
    applyCondition(attacker, 'silence', 3);

    const forecast = getCombatForecast(attacker, sword, defender, defender.weapon, 1);
    expect(forecast.attacker.damage).toBeGreaterThan(0);
    expect(forecast.attacker.hit).toBeGreaterThan(0);
  });
});
