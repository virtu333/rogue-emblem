import { describe, it, expect } from 'vitest';
import {
  calculateEffectiveSpeed,
  getStaticCombatStats,
  getCombatForecast,
  resolveCombat,
} from '../src/engine/Combat.js';

function makeUnit(overrides = {}) {
  return {
    name: overrides.name || 'Unit',
    stats: {
      HP: 30,
      STR: 10,
      MAG: 5,
      SKL: 10,
      SPD: 10,
      LCK: 5,
      DEF: 5,
      RES: 5,
      MOV: 5,
      ...(overrides.stats || {}),
    },
    currentHP: overrides.currentHP ?? (overrides.stats?.HP || 30),
    moveType: overrides.moveType || 'Infantry',
    weaponRank: overrides.weaponRank || 'E',
    accessory: overrides.accessory || null,
  };
}

describe('Combat UI Stats Logic', () => {
  const mockUnit = makeUnit();

  it('calculateEffectiveSpeed accounts for weight penalty', () => {
    const heavyWeapon = { type: 'Axe', range: '1', weight: 5, might: 5, hit: 80, crit: 0, special: '' };
    const as = calculateEffectiveSpeed(mockUnit, heavyWeapon);
    expect(as).toBe(7); // STR 10 => 2 burden reduction, so 10 - (5-2)
  });

  it('calculateEffectiveSpeed includes weapon SPD bonus', () => {
    const speedyWeapon = { type: 'Sword', range: '1', weight: 1, might: 5, hit: 90, crit: 0, special: '+2 SPD when equipped' };
    const as = calculateEffectiveSpeed(mockUnit, speedyWeapon);
    expect(as).toBe(12);
  });

  it('getStaticCombatStats returns base (non-situational) AS', () => {
    const heavyWeapon = { type: 'Axe', range: '1', weight: 5, might: 5, hit: 80, crit: 0, special: '' };
    const stats = getStaticCombatStats(mockUnit, heavyWeapon);
    expect(stats.weight).toBe(3);
    expect(stats.as).toBe(7);
    expect(stats.atk).toBe(15);
  });

  it('forecast AS includes situational speed bonuses (e.g. Darting Blow)', () => {
    const weapon = { type: 'Sword', range: '1', weight: 0, might: 5, hit: 90, crit: 0, special: '' };
    const attacker = makeUnit({ name: 'Attacker', stats: { SPD: 10 } });
    const defender = makeUnit({ name: 'Defender', stats: { SPD: 10 } });

    const baseForecast = getCombatForecast(attacker, weapon, defender, weapon, 1, null, null);
    const boostedForecast = getCombatForecast(
      attacker,
      weapon,
      defender,
      weapon,
      1,
      null,
      null,
      { atkMods: { spdBonus: 6 }, defMods: {} }
    );

    expect(baseForecast.attacker.as).toBe(10);
    expect(boostedForecast.attacker.as).toBe(16);
  });

  it('resolveCombat doubling stays aligned with forecast when weapon SPD bonus is present', () => {
    const fastBonusWeapon = {
      type: 'Sword',
      range: '1',
      might: 5,
      hit: 100,
      crit: 0,
      weight: 0,
      special: '+2 SPD when equipped',
    };
    const neutralWeapon = {
      type: 'Sword',
      range: '1',
      might: 5,
      hit: 100,
      crit: 0,
      weight: 0,
      special: '',
    };

    const attacker = makeUnit({ name: 'A', stats: { SPD: 10 } });
    const defender = makeUnit({ name: 'D', stats: { SPD: 7 } });

    const forecast = getCombatForecast(attacker, fastBonusWeapon, defender, neutralWeapon, 1, null, null);
    expect(forecast.attacker.doubles).toBe(true);

    const result = resolveCombat(attacker, fastBonusWeapon, defender, neutralWeapon, 1, null, null);
    const attackerStrikes = result.events.filter((e) => e.attacker === attacker.name).length;
    expect(attackerStrikes).toBeGreaterThan(1);
  });
});
