// battleParams.deployCount: how many units a battle deployed. A resumed battle has no
// deployment (its units come from the checkpoint) and must keep the recorded count, or
// the Last (four or more deployed) can never be earned in a resumed battle.
import { describe, expect, it } from 'vitest';
import { battleDeployCount } from '../src/engine/BattleDeployCount.js';

const roster = (n) => Array.from({ length: n }, (_, i) => ({ name: `U${i}` }));

describe('battleDeployCount', () => {
  it('a fresh battle counts the deployed roster', () => {
    expect(battleDeployCount({ deployedRoster: roster(5) })).toBe(5);
    expect(battleDeployCount({ deployedRoster: roster(1), recorded: 6 })).toBe(1);
  });

  it('a resumed battle keeps the count recorded when it began', () => {
    expect(battleDeployCount({ resuming: true, recorded: 5 })).toBe(5);
    expect(battleDeployCount({ resuming: true, recorded: 8 })).toBe(8);
  });

  it('a resumed battle without a usable record falls back to 2', () => {
    for (const recorded of [undefined, null, 0, -3, 2.5, 'x'])
      expect(battleDeployCount({ resuming: true, recorded })).toBe(2);
  });

  it('the tutorial is always two, and a standalone battle without a roster is two', () => {
    expect(battleDeployCount({ tutorialMode: true, deployedRoster: roster(5) })).toBe(2);
    expect(battleDeployCount({ recorded: 5 })).toBe(2);
  });
});
