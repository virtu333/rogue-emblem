import { it, expect } from 'vitest';
import { formatPerkMods } from '../src/ui/rosterDisplay.js';
it('formats mastery mods consistently and hides nonnumeric/zero values', () => {
  expect(formatPerkMods({ critBonus: 5, spdBonus: -2, hitBonus: 0, invalid: 'x' })).toBe(
    '+5 Crit, -2 Spd',
  );
  expect(formatPerkMods(null)).toBe('');
});
