import { describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { getCombatForecast, resolveCombat } from '../src/engine/Combat.js';

const data = loadGameData();
const artById = new Map(data.weaponArts.arts.map((art) => [art.id, art]));

function makeUnit(overrides = {}) {
  return {
    name: 'Unit',
    className: 'Myrmidon',
    tier: 'base',
    level: 1,
    stats: { HP: 30, STR: 10, MAG: 0, SKL: 8, SPD: 10, DEF: 6, RES: 3, LCK: 5 },
    currentHP: 30,
    faction: 'player',
    weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
    moveType: 'Infantry',
    ...overrides,
  };
}

function withHitNoCrit(run) {
  const randomSpy = vi.spyOn(Math, 'random');
  let calls = 0;
  randomSpy.mockImplementation(() => {
    calls += 1;
    return (calls % 2 === 1) ? 0 : 0.999;
  });
  try {
    return run();
  } finally {
    randomSpy.mockRestore();
  }
}

describe('Tier 4 weapon art data + parsing', () => {
  it('activates standard multiHit and drain arts with real combat mods', () => {
    const multiHitExpected = {
      sword_astra_strike: { count: 3, damageMultiplier: 0.5 },
      bow_hunters_volley: { count: 2, damageMultiplier: 0.8 },
    };
    for (const [id, expected] of Object.entries(multiHitExpected)) {
      const art = artById.get(id);
      expect(art).toBeTruthy();
      expect(typeof art._deferredMechanic).toBe('undefined');
      const mods = getWeaponArtCombatMods(art);
      expect(mods.multiHit).toEqual(expected);
      expect(mods.atkBonus).toBe(0);
      expect(mods.hitBonus).toBe(0);
      expect(mods.critBonus).toBe(0);
    }

    const drainExpected = {
      magic_healing_light: 0.3,
      magic_nosferatu: 1,
      legend_life_drain: 1.5,
    };
    for (const [id, expected] of Object.entries(drainExpected)) {
      const art = artById.get(id);
      expect(art).toBeTruthy();
      expect(typeof art._deferredMechanic).toBe('undefined');
      const mods = getWeaponArtCombatMods(art);
      expect(mods.drainPercent).toBe(expected);
    }
  });

  it('keeps compound legendary multiHit arts fully structured without deferred markers', () => {
    const expected = {
      legend_phantom_rush: {
        multiHit: { count: 3, damageMultiplier: 0.5 },
        deferred: null,
        atkBonus: 8,
        hitBonus: 10,
      },
      legend_piercing_charge: {
        multiHit: { count: 2, damageMultiplier: 0.8 },
        deferred: null,
        atkBonus: 8,
        hitBonus: 10,
      },
      legend_galeforce_assault: {
        multiHit: { count: 3, damageMultiplier: 0.5 },
        deferred: null,
        atkBonus: 10,
        hitBonus: 5,
      },
      legend_barrage: {
        multiHit: { count: 2, damageMultiplier: 0.8 },
        deferred: null,
        atkBonus: 8,
        hitBonus: 10,
      },
      legend_storm_blade: {
        multiHit: { count: 2, damageMultiplier: 0.8 },
        deferred: null,
        atkBonus: 5,
        hitBonus: 0,
      },
    };

    for (const [id, config] of Object.entries(expected)) {
      const art = artById.get(id);
      expect(art).toBeTruthy();
      if (config.deferred === null) expect(typeof art._deferredMechanic).toBe('undefined');
      else expect(art._deferredMechanic).toBe(config.deferred);
      const mods = getWeaponArtCombatMods(art);
      expect(mods.multiHit).toEqual(config.multiHit);
      expect(mods.atkBonus).toBe(config.atkBonus);
      expect(mods.hitBonus).toBe(config.hitBonus);
    }
  });

  it('rejects invalid tier4 combat mod values during parsing', () => {
    const badMultiHitCount = getWeaponArtCombatMods({
      combatMods: { multiHit: { count: 1, damageMultiplier: 0.5 } },
    });
    const badMultiHitDamage = getWeaponArtCombatMods({
      combatMods: { multiHit: { count: 2, damageMultiplier: 0 } },
    });
    const badDrainZero = getWeaponArtCombatMods({
      combatMods: { drainPercent: 0 },
    });
    const badDrainNaN = getWeaponArtCombatMods({
      combatMods: { drainPercent: Number.NaN },
    });

    expect(badMultiHitCount.multiHit).toBeNull();
    expect(badMultiHitDamage.multiHit).toBeNull();
    expect(badDrainZero.drainPercent).toBeNull();
    expect(badDrainNaN.drainPercent).toBeNull();
  });
});

describe('Tier 4 multiHit combat resolution', () => {
  it('multiHit produces exactly N strikes at scaled per-hit damage', () => {
    const attacker = makeUnit({ name: 'Atk', stats: { HP: 30, STR: 12, MAG: 0, SKL: 8, SPD: 10, DEF: 6, RES: 3, LCK: 5 } });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      weapon: null,
      currentHP: 40,
      stats: { HP: 40, STR: 8, MAG: 0, SKL: 8, SPD: 8, DEF: 4, RES: 2, LCK: 5 },
    });
    const baseForecast = getCombatForecast(attacker, attacker.weapon, defender, defender.weapon, 1, null, null);
    const expectedDamage = Math.max(1, Math.floor(baseForecast.attacker.damage * 0.5));

    const result = withHitNoCrit(() => resolveCombat(
      attacker, attacker.weapon, defender, defender.weapon, 1, null, null,
      {
        atkWeaponArtMods: {
          multiHit: { count: 3, damageMultiplier: 0.5 },
          activated: [{ id: 'weapon_art', name: 'Astra Strike' }],
        },
      }
    ));

    const strikes = result.events.filter((e) => e.type === 'strike' && e.attacker === attacker.name);
    expect(strikes).toHaveLength(3);
    expect(strikes.every((s) => s.damage === expectedDamage)).toBe(true);
  });

  it('multiHit replaces brave strike count and does not stack to 6+', () => {
    const braveSword = data.weapons.find((w) => w.name === 'Brave Sword');
    const attacker = makeUnit({ name: 'Atk', weapon: braveSword, stats: { HP: 30, STR: 12, MAG: 0, SKL: 8, SPD: 10, DEF: 6, RES: 3, LCK: 5 } });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      weapon: null,
      currentHP: 50,
      stats: { HP: 50, STR: 8, MAG: 0, SKL: 8, SPD: 8, DEF: 6, RES: 3, LCK: 5 },
    });

    const result = withHitNoCrit(() => resolveCombat(
      attacker, attacker.weapon, defender, defender.weapon, 1, null, null,
      {
        atkWeaponArtMods: {
          multiHit: { count: 3, damageMultiplier: 0.5 },
          activated: [{ id: 'weapon_art', name: 'Phantom Rush' }],
        },
      }
    ));

    const strikes = result.events.filter((e) => e.type === 'strike' && e.attacker === attacker.name);
    expect(strikes).toHaveLength(3);
  });

  it('suppresses Astra checks on the multiHit side', () => {
    const attacker = makeUnit({ name: 'Atk' });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      weapon: null,
      currentHP: 50,
      stats: { HP: 50, STR: 8, MAG: 0, SKL: 8, SPD: 8, DEF: 6, RES: 3, LCK: 5 },
    });
    const checkAstra = vi.fn(() => ({ triggered: true, strikeCount: 5, damageMult: 0.5, name: 'Astra' }));

    withHitNoCrit(() => resolveCombat(
      attacker, attacker.weapon, defender, defender.weapon, 1, null, null,
      {
        atkWeaponArtMods: {
          multiHit: { count: 3, damageMultiplier: 0.5 },
          activated: [{ id: 'weapon_art', name: 'Astra Strike' }],
        },
        checkAstra,
        skillsData: [],
      }
    ));

    expect(checkAstra).not.toHaveBeenCalled();
  });

  it('keeps doubling suppressed when weapon art is active', () => {
    const attacker = makeUnit({ name: 'Atk', stats: { HP: 30, STR: 10, MAG: 0, SKL: 8, SPD: 22, DEF: 6, RES: 3, LCK: 5 } });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      weapon: null,
      currentHP: 40,
      stats: { HP: 40, STR: 8, MAG: 0, SKL: 8, SPD: 4, DEF: 6, RES: 3, LCK: 5 },
    });

    const result = withHitNoCrit(() => resolveCombat(
      attacker, attacker.weapon, defender, defender.weapon, 1, null, null,
      {
        atkWeaponArtMods: {
          multiHit: { count: 2, damageMultiplier: 0.8 },
          activated: [{ id: 'weapon_art', name: 'Hunter\'s Volley' }],
        },
      }
    ));

    const strikes = result.events.filter((e) => e.type === 'strike' && e.attacker === attacker.name);
    expect(strikes).toHaveLength(2);
  });

  it('resolves defender counter only after attacker multi-hit phase completes', () => {
    const attacker = makeUnit({ name: 'Atk', stats: { HP: 30, STR: 8, MAG: 0, SKL: 8, SPD: 10, DEF: 6, RES: 3, LCK: 5 } });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      currentHP: 30,
      stats: { HP: 30, STR: 8, MAG: 0, SKL: 8, SPD: 8, DEF: 12, RES: 3, LCK: 5 },
      weapon: data.weapons.find((w) => w.name === 'Iron Sword'),
    });

    const result = withHitNoCrit(() => resolveCombat(
      attacker, attacker.weapon, defender, defender.weapon, 1, null, null,
      {
        atkWeaponArtMods: {
          multiHit: { count: 3, damageMultiplier: 0.5 },
          activated: [{ id: 'weapon_art', name: 'Astra Strike' }],
        },
      }
    ));

    const strikes = result.events.filter((e) => e.type === 'strike');
    const firstDefenderStrike = strikes.findIndex((e) => e.attacker === defender.name);
    expect(firstDefenderStrike).toBeGreaterThanOrEqual(3);
    expect(strikes.slice(0, 3).every((e) => e.attacker === attacker.name)).toBe(true);
  });
});

describe('Tier 4 drainPercent combat resolution', () => {
  it('applies 30% drain per strike even without rollStrikeSkills context', () => {
    const attacker = makeUnit({ name: 'Atk', currentHP: 10, stats: { HP: 30, STR: 12, MAG: 0, SKL: 8, SPD: 10, DEF: 6, RES: 3, LCK: 5 } });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      weapon: null,
      currentHP: 35,
      stats: { HP: 35, STR: 8, MAG: 0, SKL: 8, SPD: 8, DEF: 4, RES: 2, LCK: 5 },
    });

    const result = withHitNoCrit(() => resolveCombat(
      attacker, attacker.weapon, defender, defender.weapon, 1, null, null,
      {
        atkWeaponArtMods: {
          drainPercent: 0.3,
          activated: [{ id: 'weapon_art', name: 'Healing Light' }],
        },
      }
    ));

    const strike = result.events.find((e) => e.type === 'strike' && e.attacker === attacker.name);
    const expectedHeal = Math.min(Math.floor(strike.damage * 0.3), defender.currentHP);
    expect(strike.heal).toBe(expectedHeal);
    expect(result.attackerHP).toBe(Math.min(attacker.stats.HP, attacker.currentHP + expectedHeal));
  });

  it('applies 100% drain as full damage dealt', () => {
    const attacker = makeUnit({ name: 'Atk', currentHP: 10, stats: { HP: 40, STR: 14, MAG: 0, SKL: 8, SPD: 10, DEF: 6, RES: 3, LCK: 5 } });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      weapon: null,
      currentHP: 60,
      stats: { HP: 60, STR: 8, MAG: 0, SKL: 8, SPD: 8, DEF: 3, RES: 2, LCK: 5 },
    });

    const result = withHitNoCrit(() => resolveCombat(
      attacker, attacker.weapon, defender, defender.weapon, 1, null, null,
      {
        atkWeaponArtMods: {
          drainPercent: 1,
          activated: [{ id: 'weapon_art', name: 'Nosferatu' }],
        },
      }
    ));

    const strike = result.events.find((e) => e.type === 'strike' && e.attacker === attacker.name);
    expect(strike.heal).toBe(strike.damage);
  });

  it('applies 150% drain and can heal above damage dealt', () => {
    const attacker = makeUnit({
      name: 'Atk',
      currentHP: 8,
      stats: { HP: 40, STR: 16, MAG: 0, SKL: 8, SPD: 10, DEF: 6, RES: 3, LCK: 5 },
      weapon: data.weapons.find((w) => w.name === 'Soulreaver'),
    });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      weapon: null,
      currentHP: 60,
      stats: { HP: 60, STR: 8, MAG: 0, SKL: 8, SPD: 8, DEF: 3, RES: 2, LCK: 5 },
    });

    const result = withHitNoCrit(() => resolveCombat(
      attacker, attacker.weapon, defender, defender.weapon, 1, null, null,
      {
        atkWeaponArtMods: {
          drainPercent: 1.5,
          activated: [{ id: 'weapon_art', name: 'Life Drain' }],
        },
      }
    ));

    const strike = result.events.find((e) => e.type === 'strike' && e.attacker === attacker.name);
    expect(strike.heal).toBeGreaterThan(strike.damage);
  });

  it('caps drain heal at target remaining HP', () => {
    const attacker = makeUnit({
      name: 'Atk',
      currentHP: 8,
      stats: { HP: 40, STR: 20, MAG: 0, SKL: 8, SPD: 10, DEF: 6, RES: 3, LCK: 5 },
      weapon: data.weapons.find((w) => w.name === 'Soulreaver'),
    });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      weapon: null,
      currentHP: 4,
      stats: { HP: 4, STR: 8, MAG: 0, SKL: 8, SPD: 8, DEF: 0, RES: 0, LCK: 5 },
    });

    const result = withHitNoCrit(() => resolveCombat(
      attacker, attacker.weapon, defender, defender.weapon, 1, null, null,
      {
        atkWeaponArtMods: {
          drainPercent: 1.5,
          activated: [{ id: 'weapon_art', name: 'Life Drain' }],
        },
      }
    ));

    const strike = result.events.find((e) => e.type === 'strike' && e.attacker === attacker.name);
    expect(strike.heal).toBe(4);
  });

  it('uses highest-heal-wins across skill/weapon/art sources (weaker art than weapon)', () => {
    const attacker = makeUnit({
      name: 'Atk',
      currentHP: 8,
      stats: { HP: 40, STR: 18, MAG: 0, SKL: 8, SPD: 10, DEF: 6, RES: 3, LCK: 5 },
      weapon: data.weapons.find((w) => w.name === 'Soulreaver'),
    });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      weapon: null,
      currentHP: 60,
      stats: { HP: 60, STR: 8, MAG: 0, SKL: 8, SPD: 8, DEF: 3, RES: 2, LCK: 5 },
    });
    const rollStrikeSkills = vi.fn((striker, normalDamage) => ({
      modifiedDamage: normalDamage,
      heal: 2,
      lethal: false,
      extraStrike: false,
      activated: [],
    }));

    const result = withHitNoCrit(() => resolveCombat(
      attacker, attacker.weapon, defender, defender.weapon, 1, null, null,
      {
        atkWeaponArtMods: {
          drainPercent: 0.3,
          activated: [{ id: 'weapon_art', name: 'Life Drain' }],
        },
        rollStrikeSkills,
        skillsData: [],
      }
    ));

    const strike = result.events.find((e) => e.type === 'strike' && e.attacker === attacker.name);
    const expectedHeal = Math.min(strike.damage, defender.currentHP);
    expect(rollStrikeSkills).toHaveBeenCalled();
    expect(strike.heal).toBe(expectedHeal);
    expect(strike.heal).not.toBe(2);
  });

  it('caps highest-heal-wins at target HP when skill heal is oversized', () => {
    const attacker = makeUnit({
      name: 'Atk',
      currentHP: 8,
      stats: { HP: 40, STR: 18, MAG: 0, SKL: 8, SPD: 10, DEF: 6, RES: 3, LCK: 5 },
      weapon: data.weapons.find((w) => w.name === 'Soulreaver'),
    });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      weapon: null,
      currentHP: 5,
      stats: { HP: 60, STR: 8, MAG: 0, SKL: 8, SPD: 8, DEF: 3, RES: 2, LCK: 5 },
    });
    const rollStrikeSkills = vi.fn((striker, normalDamage) => ({
      modifiedDamage: normalDamage,
      heal: 12,
      lethal: false,
      extraStrike: false,
      activated: [],
    }));

    const result = withHitNoCrit(() => resolveCombat(
      attacker, attacker.weapon, defender, defender.weapon, 1, null, null,
      {
        atkWeaponArtMods: {
          drainPercent: 0.3,
          activated: [{ id: 'weapon_art', name: 'Life Drain' }],
        },
        rollStrikeSkills,
        skillsData: [],
      }
    ));

    const strike = result.events.find((e) => e.type === 'strike' && e.attacker === attacker.name);
    expect(rollStrikeSkills).toHaveBeenCalled();
    expect(strike.heal).toBe(defender.currentHP);
    expect(strike.heal).not.toBe(12);
  });
});

describe('Tier 4 forecast parity', () => {
  it('surfaces multiHit count/damage and drainPercent for UI', () => {
    const attacker = makeUnit({ name: 'Atk', stats: { HP: 30, STR: 12, MAG: 0, SKL: 8, SPD: 10, DEF: 6, RES: 3, LCK: 5 } });
    const defender = makeUnit({
      name: 'Def',
      faction: 'enemy',
      weapon: null,
      currentHP: 40,
      stats: { HP: 40, STR: 8, MAG: 0, SKL: 8, SPD: 8, DEF: 4, RES: 2, LCK: 5 },
    });

    const base = getCombatForecast(attacker, attacker.weapon, defender, defender.weapon, 1, null, null);
    const forecast = getCombatForecast(attacker, attacker.weapon, defender, defender.weapon, 1, null, null, {
      atkWeaponArtMods: {
        multiHit: { count: 2, damageMultiplier: 0.8 },
        drainPercent: 0.3,
        activated: [{ id: 'weapon_art', name: 'Hunter\'s Volley' }],
      },
    });

    expect(forecast.attacker.attackCount).toBe(2);
    expect(forecast.attacker.damage).toBe(Math.max(1, Math.floor(base.attacker.damage * 0.8)));
    expect(forecast.attacker.multiHit).toEqual({ count: 2, damageMultiplier: 0.8 });
    expect(forecast.attacker.drainPercent).toBe(0.3);
  });
});
