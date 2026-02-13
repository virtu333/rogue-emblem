import { describe, it, expect } from 'vitest';
import {
  calculateDamage,
  calculateHitRate,
  calculateCritRate,
  getCombatForecast,
  calculateAttack,
  calculateAvoid,
  canDouble,
} from '../src/engine/Combat.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const ironSword = data.weapons.find(w => w.name === 'Iron Sword');
const ironLance = data.weapons.find(w => w.name === 'Iron Lance');
const plainTerrain = data.terrain.find(t => t.name === 'Plain') || { avoidBonus: '0', defBonus: '0' };

function makeUnit(statOverrides = {}) {
  return {
    name: 'TestUnit',
    className: 'Myrmidon',
    tier: 'base',
    level: 1,
    isLord: false,
    stats: { HP: 20, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 3, LCK: 5, MOV: 5, ...statOverrides },
    currentHP: statOverrides.HP || 20,
    faction: 'player',
    weapon: ironSword,
    inventory: [ironSword],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
    moveType: 'Infantry',
    weaponRank: 'Prof',
    accessory: null,
  };
}

const STR_RANGE = [0, 5, 10, 15, 20, 30];
const DEF_RANGE = [0, 5, 10, 15, 20, 30];
const SKL_RANGE = [0, 5, 10, 15, 20, 30];
const SPD_RANGE = [0, 5, 10, 15, 20, 30];

describe('Combat property tests', () => {
  describe('calculateDamage', () => {
    it('never returns NaN across STR/DEF ranges', () => {
      for (const str of STR_RANGE) {
        for (const def of DEF_RANGE) {
          const dmg = calculateDamage(
            makeUnit({ STR: str }), ironSword,
            makeUnit({ DEF: def }), ironSword,
            plainTerrain
          );
          expect(Number.isNaN(dmg)).toBe(false);
        }
      }
    });

    it('is always non-negative', () => {
      for (const str of STR_RANGE) {
        for (const def of DEF_RANGE) {
          const dmg = calculateDamage(
            makeUnit({ STR: str }), ironSword,
            makeUnit({ DEF: def }), ironSword,
            plainTerrain
          );
          expect(dmg).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('is monotonically non-decreasing with STR (fixed DEF)', () => {
      let prevDmg = -Infinity;
      for (const str of STR_RANGE) {
        const dmg = calculateDamage(
          makeUnit({ STR: str }), ironSword,
          makeUnit({ DEF: 10 }), ironSword,
          plainTerrain
        );
        expect(dmg).toBeGreaterThanOrEqual(prevDmg);
        prevDmg = dmg;
      }
    });

    it('is monotonically non-increasing with DEF (fixed STR)', () => {
      let prevDmg = Infinity;
      for (const def of DEF_RANGE) {
        const dmg = calculateDamage(
          makeUnit({ STR: 15 }), ironSword,
          makeUnit({ DEF: def }), ironSword,
          plainTerrain
        );
        expect(dmg).toBeLessThanOrEqual(prevDmg);
        prevDmg = dmg;
      }
    });

    it('returns integer values', () => {
      for (const str of STR_RANGE) {
        const dmg = calculateDamage(
          makeUnit({ STR: str }), ironSword,
          makeUnit({ DEF: 7 }), ironSword,
          plainTerrain
        );
        expect(Number.isInteger(dmg)).toBe(true);
      }
    });
  });

  describe('calculateHitRate', () => {
    it('is always in [0, 100]', () => {
      for (const skl of SKL_RANGE) {
        for (const spd of SPD_RANGE) {
          const hit = calculateHitRate(
            makeUnit({ SKL: skl }), ironSword,
            makeUnit({ SPD: spd }), plainTerrain
          );
          expect(hit).toBeGreaterThanOrEqual(0);
          expect(hit).toBeLessThanOrEqual(100);
          expect(Number.isNaN(hit)).toBe(false);
        }
      }
    });
  });

  describe('calculateCritRate', () => {
    it('is always non-negative and <= 100', () => {
      for (const skl of SKL_RANGE) {
        const crit = calculateCritRate(
          makeUnit({ SKL: skl }), ironSword,
          makeUnit({ LCK: 5 })
        );
        expect(crit).toBeGreaterThanOrEqual(0);
        expect(crit).toBeLessThanOrEqual(100);
        expect(Number.isNaN(crit)).toBe(false);
      }
    });

    it('is monotonically non-decreasing with SKL', () => {
      let prevCrit = -Infinity;
      for (const skl of SKL_RANGE) {
        const crit = calculateCritRate(
          makeUnit({ SKL: skl }), ironSword,
          makeUnit({ LCK: 5 })
        );
        expect(crit).toBeGreaterThanOrEqual(prevCrit);
        prevCrit = crit;
      }
    });
  });

  describe('getCombatForecast', () => {
    it('fields are never NaN across stat ranges', () => {
      for (const str of [0, 10, 20]) {
        for (const def of [0, 10, 20]) {
          const forecast = getCombatForecast(
            makeUnit({ STR: str }), ironSword,
            makeUnit({ DEF: def }), ironLance,
            1, plainTerrain, plainTerrain
          );

          for (const side of [forecast.attacker, forecast.defender]) {
            for (const [k, v] of Object.entries(side)) {
              if (typeof v === 'number') {
                expect(Number.isNaN(v), `${side.name}.${k} is NaN (STR=${str}, DEF=${def})`).toBe(false);
              }
            }
          }
        }
      }
    });

    it('attacker.damage is non-negative', () => {
      for (const str of STR_RANGE) {
        const forecast = getCombatForecast(
          makeUnit({ STR: str }), ironSword,
          makeUnit({ DEF: 15 }), ironLance,
          1, plainTerrain, plainTerrain
        );
        expect(forecast.attacker.damage).toBeGreaterThanOrEqual(0);
      }
    });

    it('hit and crit are in [0, 100]', () => {
      for (const skl of SKL_RANGE) {
        const forecast = getCombatForecast(
          makeUnit({ SKL: skl }), ironSword,
          makeUnit({ SPD: skl }), ironLance,
          1, plainTerrain, plainTerrain
        );
        expect(forecast.attacker.hit).toBeGreaterThanOrEqual(0);
        expect(forecast.attacker.hit).toBeLessThanOrEqual(100);
        expect(forecast.attacker.crit).toBeGreaterThanOrEqual(0);
        expect(forecast.attacker.crit).toBeLessThanOrEqual(100);
      }
    });

    it('attackCount is a positive integer when weapon exists', () => {
      const forecast = getCombatForecast(
        makeUnit({ SPD: 20 }), ironSword,
        makeUnit({ SPD: 5 }), ironLance,
        1, plainTerrain, plainTerrain
      );
      expect(forecast.attacker.attackCount).toBeGreaterThan(0);
      expect(Number.isInteger(forecast.attacker.attackCount)).toBe(true);
    });

    it('returns zeroed forecast for null weapon', () => {
      const forecast = getCombatForecast(
        makeUnit(), null,
        makeUnit(), ironLance,
        1, plainTerrain, plainTerrain
      );
      expect(forecast.attacker.damage).toBe(0);
      expect(forecast.attacker.hit).toBe(0);
      expect(forecast.attacker.attackCount).toBe(0);
    });
  });

  describe('calculateAttack', () => {
    it('never returns NaN', () => {
      for (const str of STR_RANGE) {
        const atk = calculateAttack(makeUnit({ STR: str }), ironSword);
        expect(Number.isNaN(atk)).toBe(false);
      }
    });
  });

  describe('calculateAvoid', () => {
    it('never returns NaN', () => {
      for (const spd of SPD_RANGE) {
        const avoid = calculateAvoid(makeUnit({ SPD: spd }), plainTerrain);
        expect(Number.isNaN(avoid)).toBe(false);
      }
    });
  });

  describe('canDouble', () => {
    it('returns boolean across speed ranges', () => {
      for (const atkSpd of SPD_RANGE) {
        for (const defSpd of SPD_RANGE) {
          const result = canDouble(
            makeUnit({ SPD: atkSpd }), makeUnit({ SPD: defSpd }),
            ironSword, ironLance
          );
          expect(typeof result).toBe('boolean');
        }
      }
    });
  });
});
