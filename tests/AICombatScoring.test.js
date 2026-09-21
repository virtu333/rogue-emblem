import { describe, expect, it } from 'vitest';
import { AIController } from '../src/engine/AIController.js';
const weapon = { name: 'Sword', type: 'Sword', might: 5, hit: 100, crit: 0, weight: 0, range: '1' };
const unit = (extra = {}) => ({
  name: 'Unit',
  col: 1,
  row: 1,
  currentHP: 30,
  stats: { HP: 30, STR: 10, MAG: 0, SKL: 10, SPD: 8, DEF: 5, RES: 0, LCK: 0 },
  weapon,
  proficiencies: [{ type: 'Sword', rank: 'Prof' }],
  skills: [],
  ...extra,
});
describe('forecast-based AI scoring', () => {
  it('prefers a killable healthy fragile unit over a wounded zero-damage tank', () => {
    const ai = new AIController({}, {});
    const enemy = unit();
    const tank = unit({ col: 2, currentHP: 5, stats: { ...unit().stats, DEF: 50 } });
    const fragile = unit({ col: 2, currentHP: 10, stats: { ...unit().stats, HP: 10, DEF: 0 } });
    expect(ai._scoreAttackTarget(enemy, fragile)).toBeGreaterThan(
      ai._scoreAttackTarget(enemy, tank),
    );
  });
  it('weights counter damage more strongly when attacker is wounded', () => {
    const ai = new AIController({}, {});
    const target = unit({ col: 2 });
    expect(ai._scoreAttackTarget(unit({ currentHP: 5 }), target)).toBeLessThan(
      ai._scoreAttackTarget(unit(), target),
    );
  });
  it('uses destination terrain and position without mutating the canonical enemy', () => {
    const ai = new AIController(
      { getTerrainAt: (c, _r) => ({ avoidBonus: c === 2 ? 20 : 0, defBonus: c === 2 ? 1 : 0 }) },
      {},
    );
    const enemy = unit();
    const target = unit({ col: 3 });
    const original = structuredClone(enemy);
    const protectedScore = ai._scoreAttackTarget(enemy, target, false, { col: 2, row: 1 });
    const openScore = ai._scoreAttackTarget(enemy, target, false, { col: 3, row: 2 });
    expect(protectedScore).toBeGreaterThan(openScore);
    expect(enemy).toEqual(original);
  });
});
