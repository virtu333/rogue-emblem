import { describe, it, expect } from 'vitest';
import { compactBattleObjective, sidebarCounters } from '../src/ui/battleSidebarDisplay.js';
describe('battle sidebar labels', () => {
  it('retains progress and switches from defeating the boss to capturing the throne', () => {
    expect(compactBattleObjective('Escape: Only Lords must exit (1/2)\nOthers are safe')).toBe(
      'Escape · Lords 1/2',
    );
    expect(compactBattleObjective('Seize: Defeat boss, then capture throne')).toBe(
      'Seize · Defeat the boss',
    );
    expect(compactBattleObjective('Seize: Capture throne with a Lord!')).toBe(
      'Seize · Capture throne',
    );
    expect(compactBattleObjective('Rout: 4 enemies + 2 reviving')).toContain('2 reviving');
  });
  it('keeps par/rating and charges explicit, omitting unavailable par', () => {
    expect(sidebarCounters('Turn: 4 / Par: 7 (S)', 1)).toBe('Par 7 · S | Rewinds 1');
    expect(sidebarCounters('Turn: 4', 0)).toBe('Rewinds 0');
  });
});
