import { describe, it, expect, vi } from 'vitest';
import { isMagical, getCombatForecast, resolveCombat } from '../src/engine/Combat.js';
import { rollDefenseSkills } from '../src/engine/SkillSystem.js';
import { filterClassPoolByDifficulty } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

// Helper: minimal unit for combat tests
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

describe('Breath weapons exist in data', () => {
  const breathWeapons = data.weapons.filter((w) => w.type === 'Breath');

  it('3 Breath weapons exist', () => {
    expect(breathWeapons).toHaveLength(3);
  });

  it('all have type Breath', () => {
    for (const w of breathWeapons) {
      expect(w.type).toBe('Breath');
    }
  });

  it('Fire Breath: might 8, hit 80, range 1-2, tier Iron, price 0', () => {
    const fb = data.weapons.find((w) => w.name === 'Fire Breath');
    expect(fb).toBeTruthy();
    expect(fb.might).toBe(8);
    expect(fb.hit).toBe(80);
    expect(fb.range).toBe('1-2');
    expect(fb.tier).toBe('Iron');
    expect(fb.price).toBe(0);
  });

  it('Toxic Breath: might 11, special includes Poison, tier Steel', () => {
    const tb = data.weapons.find((w) => w.name === 'Toxic Breath');
    expect(tb).toBeTruthy();
    expect(tb.might).toBe(11);
    expect(tb.special).toMatch(/Poison/i);
    expect(tb.tier).toBe('Steel');
  });

  it('Ancient Breath: might 15, crit 5, rankRequired Mast, tier Silver', () => {
    const ab = data.weapons.find((w) => w.name === 'Ancient Breath');
    expect(ab).toBeTruthy();
    expect(ab.might).toBe(15);
    expect(ab.crit).toBe(5);
    expect(ab.rankRequired).toBe('Mast');
    expect(ab.tier).toBe('Silver');
  });
});

describe('Breath is magical', () => {
  it('isMagical returns true for Breath weapons', () => {
    const fb = data.weapons.find((w) => w.name === 'Fire Breath');
    expect(isMagical(fb)).toBe(true);
  });

  it('damage uses MAG not STR via getCombatForecast', () => {
    const fireBreath = data.weapons.find((w) => w.name === 'Fire Breath');
    const terrain = data.terrain.find((t) => t.name === 'Plain');

    // Attacker: high MAG, zero STR — if physical, damage would be 0+8-15 < 0
    // If magical, damage = 20+8-5 = 23
    const attacker = makeUnit({
      name: 'Dragon',
      className: 'Dragon',
      stats: { HP: 28, STR: 0, MAG: 20, SKL: 10, SPD: 5, DEF: 10, RES: 8, LCK: 2 },
      currentHP: 28,
      weapon: fireBreath,
      proficiencies: [{ type: 'Breath', rank: 'Prof' }],
      moveType: 'Flying',
    });

    const defender = makeUnit({
      name: 'Target',
      stats: { HP: 30, STR: 5, MAG: 0, SKL: 5, SPD: 5, DEF: 15, RES: 5, LCK: 5 },
      currentHP: 30,
    });

    const forecast = getCombatForecast(
      attacker,
      fireBreath,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
    );
    // MAG(20) + might(8) - RES(5) = 23
    expect(forecast.attacker.damage).toBe(23);
  });
});

describe('Toxic Breath poison', () => {
  it('Toxic Breath applies poison via resolveCombat', () => {
    const toxicBreath = data.weapons.find((w) => w.name === 'Toxic Breath');
    const terrain = data.terrain.find((t) => t.name === 'Plain');

    // Attacker with Toxic Breath
    const attacker = makeUnit({
      name: 'Dragon',
      className: 'Dragon',
      stats: { HP: 28, STR: 0, MAG: 10, SKL: 10, SPD: 5, DEF: 10, RES: 8, LCK: 2 },
      currentHP: 28,
      weapon: toxicBreath,
      proficiencies: [{ type: 'Breath', rank: 'Prof' }],
      moveType: 'Flying',
    });

    // Defender with high HP so both survive
    const defender = makeUnit({
      name: 'Target',
      stats: { HP: 50, STR: 5, MAG: 0, SKL: 5, SPD: 5, DEF: 20, RES: 20, LCK: 5 },
      currentHP: 50,
    });

    // Force hits
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const result = resolveCombat(
      attacker,
      toxicBreath,
      defender,
      defender.weapon,
      1,
      terrain,
      terrain,
    );
    vi.restoreAllMocks();

    // Both should survive — poison fires on the defender
    if (result.attackerHP > 0 && result.defenderHP > 0) {
      expect(result.poisonEffects).toBeDefined();
      const defPoison = result.poisonEffects.find((p) => p.target === 'defender');
      expect(defPoison).toBeTruthy();
      expect(defPoison.damage).toBe(5);
    }
  });
});

describe('Dragon classes exist', () => {
  const dragon = data.classes.find((c) => c.name === 'Dragon');
  const dragonLord = data.classes.find((c) => c.name === 'Dragon Lord');

  it('Dragon is base tier with Flying moveType and Breath proficiency', () => {
    expect(dragon).toBeTruthy();
    expect(dragon.tier).toBe('base');
    expect(dragon.moveType).toBe('Flying');
    expect(dragon.weaponProficiencies).toMatch(/Breath/);
  });

  it('Dragon promotesTo Dragon Lord', () => {
    expect(dragon.promotesTo).toContain('Dragon Lord');
  });

  it('Dragon baseStats: HP 28, MAG 8, DEF 10, RES 8', () => {
    expect(dragon.baseStats.HP).toBe(28);
    expect(dragon.baseStats.MAG).toBe(8);
    expect(dragon.baseStats.DEF).toBe(10);
    expect(dragon.baseStats.RES).toBe(8);
  });

  it('Dragon Lord is promoted tier from Dragon', () => {
    expect(dragonLord).toBeTruthy();
    expect(dragonLord.tier).toBe('promoted');
    expect(dragonLord.promotesFrom).toBe('Dragon');
  });

  it('Dragon Lord has full 9-stat promotionBonuses including MOV', () => {
    const bonusKeys = Object.keys(dragonLord.promotionBonuses);
    expect(bonusKeys).toContain('HP');
    expect(bonusKeys).toContain('STR');
    expect(bonusKeys).toContain('MAG');
    expect(bonusKeys).toContain('SKL');
    expect(bonusKeys).toContain('SPD');
    expect(bonusKeys).toContain('DEF');
    expect(bonusKeys).toContain('RES');
    expect(bonusKeys).toContain('LCK');
    expect(bonusKeys).toContain('MOV');
    expect(bonusKeys).toHaveLength(9);
  });
});

describe('dragon_scale skill', () => {
  const dragonScale = data.skills.find((s) => s.id === 'dragon_scale');

  it('exists with trigger on-defend and activation always', () => {
    expect(dragonScale).toBeTruthy();
    expect(dragonScale.trigger).toBe('on-defend');
    expect(dragonScale.activation).toBe('always');
  });

  it('rollDefenseSkills with dragon_scale reduces damage by 3', () => {
    const defender = makeUnit({
      skills: ['dragon_scale'],
      currentHP: 20,
    });

    // activation=always, so any random value triggers it
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const result = rollDefenseSkills(defender, 10, true, data.skills);
    vi.restoreAllMocks();

    expect(result.modifiedDamage).toBe(7); // 10 - 3
    expect(result.activated.find((a) => a.id === 'dragon_scale')).toBeTruthy();
  });

  it('dragon_scale damage cannot go below 0', () => {
    const defender = makeUnit({
      skills: ['dragon_scale'],
      currentHP: 20,
    });

    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const result = rollDefenseSkills(defender, 2, true, data.skills);
    vi.restoreAllMocks();

    expect(result.modifiedDamage).toBe(0); // max(0, 2-3) = 0
  });
});

describe('Enemy pool inclusion', () => {
  const pools = data.enemies.pools;

  it('act2 base pool includes Zombie', () => {
    expect(pools.act2.base).toContain('Zombie');
  });

  it('act2 base pool does NOT include Dragon', () => {
    expect(pools.act2.base).not.toContain('Dragon');
  });

  it('act3 base pool includes Dragon', () => {
    expect(pools.act3.base).toContain('Dragon');
  });

  it('act3 promoted pool includes Revenant', () => {
    expect(pools.act3.promoted).toContain('Revenant');
  });

  it('act4 promoted pool includes Revenant and Dragon Lord', () => {
    expect(pools.act4.promoted).toContain('Revenant');
    expect(pools.act4.promoted).toContain('Dragon Lord');
  });
});

describe('Difficulty gating of new classes in enemy pools', () => {
  const pools = data.enemies.pools;

  it('act2 base on Normal does NOT include Zombie', () => {
    const filtered = filterClassPoolByDifficulty(pools.act2.base, 'normal');
    expect(filtered).not.toContain('Zombie');
  });

  it('act2 base on Hard DOES include Zombie', () => {
    const filtered = filterClassPoolByDifficulty(pools.act2.base, 'hard');
    expect(filtered).toContain('Zombie');
  });

  it('act3 base on Normal does NOT include Dragon', () => {
    const filtered = filterClassPoolByDifficulty(pools.act3.base, 'normal');
    expect(filtered).not.toContain('Dragon');
  });

  it('act4 promoted on Normal does NOT include Revenant or Dragon Lord', () => {
    const filtered = filterClassPoolByDifficulty(pools.act4.promoted, 'normal');
    expect(filtered).not.toContain('Revenant');
    expect(filtered).not.toContain('Dragon Lord');
  });

  it('act4 promoted on Hard DOES include Revenant and Dragon Lord', () => {
    const filtered = filterClassPoolByDifficulty(pools.act4.promoted, 'hard');
    expect(filtered).toContain('Revenant');
    expect(filtered).toContain('Dragon Lord');
  });
});
