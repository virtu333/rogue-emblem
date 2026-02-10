import { describe, it, expect } from 'vitest';
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
    weapon: data.weapons.find(w => w.name === 'Iron Sword'),
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

  it('isInRange checks weapon range correctly', () => {
    const sword = data.weapons.find(w => w.name === 'Iron Sword');
    const bow = data.weapons.find(w => w.name === 'Iron Bow');
    expect(isInRange(sword, 1)).toBe(true);
    expect(isInRange(sword, 2)).toBe(false);
    expect(isInRange(bow, 2)).toBe(true);
    expect(isInRange(bow, 1)).toBe(false);
  });

  it('classifies weapon types correctly', () => {
    const sword = data.weapons.find(w => w.name === 'Iron Sword');
    const tome = data.weapons.find(w => w.name === 'Fire');
    const staff = data.weapons.find(w => w.name === 'Heal');
    expect(isPhysical(sword)).toBe(true);
    expect(isMagical(tome)).toBe(true);
    expect(isStaff(staff)).toBe(true);
    expect(isPhysical(tome)).toBe(false);
  });
});

describe('Weapon triangle', () => {
  it('sword beats axe', () => {
    const sword = data.weapons.find(w => w.name === 'Iron Sword');
    const axe = data.weapons.find(w => w.name === 'Iron Axe');
    const bonus = getWeaponTriangleBonus(sword, axe);
    expect(bonus.hit).toBeGreaterThan(0);
    expect(bonus.damage).toBeGreaterThan(0);
  });

  it('axe beats lance', () => {
    const axe = data.weapons.find(w => w.name === 'Iron Axe');
    const lance = data.weapons.find(w => w.name === 'Iron Lance');
    const bonus = getWeaponTriangleBonus(axe, lance);
    expect(bonus.hit).toBeGreaterThan(0);
  });

  it('lance beats sword', () => {
    const lance = data.weapons.find(w => w.name === 'Iron Lance');
    const sword = data.weapons.find(w => w.name === 'Iron Sword');
    const bonus = getWeaponTriangleBonus(lance, sword);
    expect(bonus.hit).toBeGreaterThan(0);
  });

  it('same weapon type = no bonus', () => {
    const s1 = data.weapons.find(w => w.name === 'Iron Sword');
    const s2 = data.weapons.find(w => w.name === 'Steel Sword');
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
    const terrain = data.terrain.find(t => t.name === 'Plain');
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
    const terrain = data.terrain.find(t => t.name === 'Plain');
    const dmg = calculateDamage(attacker, attacker.weapon, defender, defender.weapon, terrain);
    expect(dmg).toBe(0);
  });

  it('terrain defense bonus reduces damage', () => {
    const attacker = makeUnit({ stats: { ...makeUnit().stats, STR: 10 } });
    const defender = makeUnit({
      stats: { ...makeUnit().stats, DEF: 6 },
      faction: 'enemy',
    });
    const plain = data.terrain.find(t => t.name === 'Plain');
    const fort = data.terrain.find(t => t.name === 'Fort');
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
    const bow = data.weapons.find(w => w.name === 'Iron Bow');
    const archer = makeUnit({ weapon: bow });
    expect(canCounter(archer, bow, 2)).toBe(true);
    expect(canCounter(archer, bow, 1)).toBe(false);
  });
});

describe('Effectiveness', () => {
  it('Hammer is effective vs Armored', () => {
    const hammer = data.weapons.find(w => w.name === 'Hammer');
    if (!hammer) return; // skip if weapon not in data
    const knight = makeUnit({ moveType: 'Armored' });
    expect(getEffectivenessMultiplier(hammer, knight)).toBe(3);
  });
});

describe('Combat forecast', () => {
  it('returns valid forecast structure', () => {
    const attacker = makeUnit();
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      weapon: data.weapons.find(w => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find(t => t.name === 'Plain');
    const forecast = getCombatForecast(attacker, attacker.weapon, defender, defender.weapon, 1, terrain, terrain);
    expect(forecast.attacker).toBeDefined();
    expect(forecast.defender).toBeDefined();
    expect(forecast.attacker.damage).toBeGreaterThanOrEqual(0);
    expect(forecast.attacker.hit).toBeGreaterThanOrEqual(0);
    expect(forecast.attacker.hit).toBeLessThanOrEqual(100);
  });
});

describe('Combat resolution', () => {
  it('resolves without errors', () => {
    const attacker = makeUnit({ stats: { ...makeUnit().stats, STR: 15, SPD: 15 } });
    const defender = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      stats: { ...makeUnit().stats, STR: 5, SPD: 5, DEF: 3 },
      weapon: data.weapons.find(w => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find(t => t.name === 'Plain');
    const result = resolveCombat(attacker, attacker.weapon, defender, defender.weapon, 1, terrain, terrain);
    expect(result.events.length).toBeGreaterThan(0);
    expect(typeof result.attackerHP).toBe('number');
    expect(typeof result.defenderHP).toBe('number');
  });

  it('returns poisonEffects array with both entries when both sides have poison', () => {
    const veninEdge = data.weapons.find(w => w.name === 'Venin Blade');
    if (!veninEdge) return; // skip if weapon not in data
    // Both combatants have Venin Blade — both survive so both poisons apply
    const attacker = makeUnit({
      stats: { HP: 50, STR: 5, MAG: 0, SKL: 10, SPD: 10, DEF: 20, RES: 20, LCK: 5 },
      currentHP: 50,
      weapon: veninEdge,
      inventory: [veninEdge],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    });
    const defender = makeUnit({
      name: 'Enemy', faction: 'enemy',
      stats: { HP: 50, STR: 5, MAG: 0, SKL: 10, SPD: 10, DEF: 20, RES: 20, LCK: 5 },
      currentHP: 50,
      weapon: veninEdge,
      inventory: [veninEdge],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    });
    const terrain = data.terrain.find(t => t.name === 'Plain');
    const result = resolveCombat(attacker, attacker.weapon, defender, defender.weapon, 1, terrain, terrain);
    // Both survived (high DEF), so both poisons fire
    if (result.attackerHP > 0 && result.defenderHP > 0) {
      expect(result.poisonEffects).toBeDefined();
      expect(result.poisonEffects.length).toBe(2);
      expect(result.poisonEffects.find(p => p.target === 'defender')).toBeTruthy();
      expect(result.poisonEffects.find(p => p.target === 'attacker')).toBeTruthy();
    }
  });

  it('poisonEffects is empty array when no poison weapons used', () => {
    const attacker = makeUnit({ stats: { ...makeUnit().stats, STR: 5, SPD: 10, DEF: 20 }, currentHP: 50 });
    const defender = makeUnit({
      name: 'Enemy', faction: 'enemy',
      stats: { ...makeUnit().stats, STR: 5, SPD: 10, DEF: 20 }, currentHP: 50,
      weapon: data.weapons.find(w => w.name === 'Iron Sword'),
    });
    const terrain = data.terrain.find(t => t.name === 'Plain');
    const result = resolveCombat(attacker, attacker.weapon, defender, defender.weapon, 1, terrain, terrain);
    expect(result.poisonEffects).toBeDefined();
    expect(result.poisonEffects.length).toBe(0);
  });
});

// --- Staff Mechanics ---

function makeHealer(magOverride = 5) {
  return makeUnit({
    name: 'Healer',
    className: 'Cleric',
    stats: { HP: 18, STR: 1, MAG: magOverride, SKL: 6, SPD: 6, DEF: 2, RES: 8, LCK: 5 },
    currentHP: 18,
    weapon: data.weapons.find(w => w.name === 'Heal'),
    inventory: [data.weapons.find(w => w.name === 'Heal')],
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
    const staff = data.weapons.find(w => w.name === 'Heal');
    const healer = makeHealer(5); // MAG 5
    const target = makeTarget(10); // 10 missing HP
    // MAG 5 + healBase 5 = 10
    expect(calculateHealAmount(staff, healer, target)).toBe(10);
  });

  it('calculateHealAmount caps at missing HP', () => {
    const staff = data.weapons.find(w => w.name === 'Mend');
    const healer = makeHealer(10); // MAG 10 + healBase 10 = 20
    const target = makeTarget(17); // only 3 missing HP
    expect(calculateHealAmount(staff, healer, target)).toBe(3);
  });

  it('calculateHealAmount with high MAG heals more', () => {
    const staff = data.weapons.find(w => w.name === 'Heal');
    const healer5 = makeHealer(5);
    const healer10 = makeHealer(10);
    const target = makeTarget(1); // 19 missing HP
    expect(calculateHealAmount(staff, healer5, target)).toBe(10); // 5 + 5
    expect(calculateHealAmount(staff, healer10, target)).toBe(15); // 10 + 5
  });

  it('resolveHeal returns correct structure', () => {
    const staff = data.weapons.find(w => w.name === 'Heal');
    const healer = makeHealer(5);
    const target = makeTarget(10);
    const result = resolveHeal(staff, healer, target);
    expect(result.healAmount).toBe(10);
    expect(result.targetHPAfter).toBe(20);
  });

  it('Recover heals MAG + 15', () => {
    const staff = data.weapons.find(w => w.name === 'Recover');
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
    const staff = data.weapons.find(w => w.name === 'Heal'); // base 3
    expect(getStaffMaxUses(staff, makeHealer(5))).toBe(3);   // 3 + 0
    expect(getStaffMaxUses(staff, makeHealer(8))).toBe(4);   // 3 + 1
    expect(getStaffMaxUses(staff, makeHealer(14))).toBe(5);  // 3 + 2
    expect(getStaffMaxUses(staff, makeHealer(20))).toBe(6);  // 3 + 3
  });

  it('getStaffRemainingUses tracks spent uses', () => {
    const staff = { ...data.weapons.find(w => w.name === 'Heal') }; // clone
    const healer = makeHealer(5); // max 3
    expect(getStaffRemainingUses(staff, healer)).toBe(3);
    spendStaffUse(staff);
    expect(getStaffRemainingUses(staff, healer)).toBe(2);
    spendStaffUse(staff);
    spendStaffUse(staff);
    expect(getStaffRemainingUses(staff, healer)).toBe(0);
  });

  it('getStaffRemainingUses floors at 0', () => {
    const staff = { ...data.weapons.find(w => w.name === 'Heal'), _usesSpent: 99 };
    expect(getStaffRemainingUses(staff, makeHealer(5))).toBe(0);
  });
});

describe('Staff effective range', () => {
  it('normal staff has no range bonus', () => {
    const staff = data.weapons.find(w => w.name === 'Heal');
    const range = getEffectiveStaffRange(staff, makeHealer(20));
    expect(range).toEqual({ min: 1, max: 1 });
  });

  it('Physic base range is 2', () => {
    const physic = data.weapons.find(w => w.name === 'Physic');
    const range = getEffectiveStaffRange(physic, makeHealer(5));
    expect(range).toEqual({ min: 2, max: 2 });
  });

  it('Physic gains +1 range at MAG 10', () => {
    const physic = data.weapons.find(w => w.name === 'Physic');
    const range = getEffectiveStaffRange(physic, makeHealer(10));
    expect(range).toEqual({ min: 2, max: 3 });
  });

  it('Physic gains +2 range at MAG 18', () => {
    const physic = data.weapons.find(w => w.name === 'Physic');
    const range = getEffectiveStaffRange(physic, makeHealer(18));
    expect(range).toEqual({ min: 2, max: 4 });
  });

  it('Fortify has range 2 with healAll flag', () => {
    const fortify = data.weapons.find(w => w.name === 'Fortify');
    expect(fortify.healAll).toBe(true);
    const range = getEffectiveStaffRange(fortify, makeHealer(5));
    expect(range).toEqual({ min: 2, max: 2 });
  });
});

describe('Staff data integrity', () => {
  it('all staves have healBase and uses fields', () => {
    const staves = data.weapons.filter(w => w.type === 'Staff');
    expect(staves.length).toBe(5);
    for (const staff of staves) {
      expect(staff.healBase).toBeDefined();
      expect(staff.uses).toBeDefined();
      expect(typeof staff.healBase).toBe('number');
      expect(typeof staff.uses).toBe('number');
    }
  });

  it('Physic is in act3 loot table', () => {
    expect(data.lootTables.act3.weapons).toContain('Physic');
  });

  it('Physic has rangeBonuses array', () => {
    const physic = data.weapons.find(w => w.name === 'Physic');
    expect(physic.rangeBonuses).toBeDefined();
    expect(physic.rangeBonuses.length).toBe(2);
  });
});
