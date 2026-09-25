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
  it('agrees the rout count with its verb', () => {
    expect(compactBattleObjective('Rout: 1 enemy remaining')).toBe('Rout · 1 enemy remains');
    expect(compactBattleObjective('Rout: 2 enemies remaining')).toBe('Rout · 2 enemies remain');
    expect(compactBattleObjective('Rout: 0 enemies remaining\nRecruit: Talk')).toBe(
      'Rout · 0 enemies remain',
    );
  });
  it('keeps par/rating and charges explicit, omitting unavailable par', () => {
    expect(sidebarCounters('Turn: 4 / Par: 7 (S)', 1)).toBe('Par 7 · S | Rewinds 1');
    expect(sidebarCounters('Turn: 4', 0)).toBe('Rewinds 0');
  });
});
