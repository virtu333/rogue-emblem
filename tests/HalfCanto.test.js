// Half Canto (Dave, Oct 2026): the Bow Knight and the Wyvern Lord may move again after
// acting, but only half the movement they have left, rounded down.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { cantoAllowance, cantoRuleFor } from '../src/engine/CantoRule.js';
import { getClassInnateSkills } from '../src/engine/UnitManager.js';
import { readActionContinuation } from '../src/engine/ActionContinuation.js';

const { skills } = loadGameData();
const unit = (ids, extra = {}) => ({ name: 'U', faction: 'player', skills: ids, ...extra });

describe('Half Canto data', () => {
  it('is innate to the Bow Knight and the Wyvern Lord only', () => {
    expect(getClassInnateSkills('Bow Knight', skills)).toContain('half_canto');
    expect(getClassInnateSkills('Wyvern Lord', skills)).toContain('half_canto');
    for (const cls of ['Paladin', 'Falcon Knight', 'Sniper', 'Archer', 'Wyvern Rider']) {
      expect(getClassInnateSkills(cls, skills)).not.toContain('half_canto');
    }
    // Neither gets full Canto.
    expect(getClassInnateSkills('Bow Knight', skills)).not.toContain('canto');
    expect(getClassInnateSkills('Wyvern Lord', skills)).not.toContain('canto');
  });

  it('works after any action', () => {
    expect(cantoRuleFor(unit(['half_canto']), skills)).toBe('any');
  });
});

describe('cantoAllowance', () => {
  it('halves what is left, rounded down', () => {
    const cases = [
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
      [5, 2],
      [8, 4],
    ];
    for (const [left, want] of cases) {
      expect(cantoAllowance(unit(['half_canto']), left, {}, skills)).toBe(want);
      expect(cantoAllowance(unit(['half_canto']), left, { afterCombat: true }, skills)).toBe(want);
    }
  });

  it('full Canto gives everything left; no Canto gives nothing', () => {
    expect(cantoAllowance(unit(['canto']), 5, {}, skills)).toBe(5);
    expect(cantoAllowance(unit(['canto', 'half_canto']), 5, {}, skills)).toBe(5);
    expect(cantoAllowance(unit(['vantage']), 5, {}, skills)).toBe(0);
    expect(cantoAllowance(unit([]), 5, {}, skills)).toBe(0);
  });

  it('Measured Step counts only after a noncombat action', () => {
    const both = unit(['measured_step', 'half_canto']);
    expect(cantoAllowance(both, 5, {}, skills)).toBe(5);
    expect(cantoAllowance(both, 5, { afterCombat: true }, skills)).toBe(2);
    expect(cantoAllowance(unit(['measured_step']), 5, { afterCombat: true }, skills)).toBe(0);
  });

  it('a root stops it', () => {
    const rooted = unit(['half_canto'], {
      _conditions: [{ id: 'root', turnsRemaining: 1 }],
    });
    expect(cantoRuleFor(rooted, skills)).toBe(null);
    expect(cantoAllowance(rooted, 6, {}, skills)).toBe(0);
  });
});

describe('the saved continuation keeps afterCombat', () => {
  it('reads it back and refuses a malformed one', () => {
    expect(readActionContinuation({ kind: 'finish', unitName: 'U', afterCombat: true })).toEqual({
      kind: 'finish',
      unitName: 'U',
      afterCombat: true,
    });
    expect(readActionContinuation({ kind: 'finish', unitName: 'U', afterCombat: 'yes' })).toBe(
      null,
    );
  });
});
