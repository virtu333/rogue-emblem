// engine/TerrainHealing.js: the Fort/Throne heal both BattleScene and the headless
// harness settle at a side's turn start.
import { describe, expect, it } from 'vitest';
import {
  isHealingTerrainIndex,
  resetFortHealStreak,
  settleTerrainHeal,
} from '../src/engine/TerrainHealing.js';

// TERRAIN order (constants.js): Plain 0, Forest 1, Fort 3, Throne 4.
const PLAIN = 0;
const FOREST = 1;
const FORT = 3;
const THRONE = 4;

const unit = (hp, max) => ({ currentHP: hp, stats: { HP: max } });

describe('settleTerrainHeal', () => {
  it('heals a tenth of max HP, decaying while the unit sits on the Fort', () => {
    const u = unit(1, 40);
    // Base 4 (40 / 10), then x1, x0.67, x0.34, x0.17, x0 (floored): 4, 2, 1, 0, 0.
    expect([1, 2, 3, 4, 5].map(() => settleTerrainHeal(u, FORT))).toEqual([4, 2, 1, 0, 0]);
    expect(u._fortHealStreak).toBe(5);
  });

  it('at least 1 HP; a Throne heals too; other ground never does and resets the streak', () => {
    expect(settleTerrainHeal(unit(1, 9), FORT)).toBe(1);
    expect(settleTerrainHeal(unit(10, 20), THRONE)).toBe(2);
    const u = unit(5, 20);
    settleTerrainHeal(u, FORT);
    settleTerrainHeal(u, FORT);
    expect(settleTerrainHeal(u, FOREST)).toBe(0);
    expect(u._fortHealStreak).toBe(0);
    expect(settleTerrainHeal(u, FORT)).toBe(2);
    expect(settleTerrainHeal(unit(5, 20), PLAIN)).toBe(0);
  });

  it('a unit at full HP heals nothing and keeps its streak', () => {
    const u = unit(20, 20);
    u._fortHealStreak = 2;
    expect(settleTerrainHeal(u, FORT)).toBe(0);
    expect(u._fortHealStreak).toBe(2);
  });

  it('attacking resets the streak', () => {
    const u = unit(5, 20);
    settleTerrainHeal(u, FORT);
    resetFortHealStreak(u);
    expect(settleTerrainHeal(u, FORT)).toBe(2);
  });

  it('only Forts and Thrones are healing ground', () => {
    expect([PLAIN, FOREST, FORT, THRONE].map(isHealingTerrainIndex)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});
