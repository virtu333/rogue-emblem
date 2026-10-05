// Item references in headless play (tools/play/parse.js): a name picks an item only
// when it cannot mean two different things.

import { describe, it, expect } from 'vitest';
import { findItem, PlayError } from '../../tools/play/parse.js';

describe('findItem', () => {
  const fresh = { name: 'Iron Sword', uid: 1, might: 5 };
  const twin = { name: 'Iron Sword', uid: 2, might: 5 };
  const worn = { name: 'Iron Sword', uid: 3, might: 5, _usesSpent: 12 };
  const forged = {
    name: 'Iron Sword',
    uid: 4,
    might: 7,
    _forgeLevel: 1,
    _forgeBonuses: { might: 2 },
  };

  it('takes the first of copies alike in all but their uid', () => {
    expect(findItem([fresh, twin], 'iron sword')).toBe(fresh);
    expect(findItem([fresh, twin], 'iron')).toBe(fresh);
  });

  it('refuses a name shared by items that differ, naming each by number and difference', () => {
    for (const token of ['Iron Sword', 'iron']) {
      let error = null;
      try {
        findItem([fresh, worn, forged], token, 'weapon');
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(PlayError);
      expect(error.message).toMatch(/names 3 different weapons/);
      expect(error.message).toMatch(/#2 Iron Sword \(12 uses spent\)/);
      expect(error.message).toMatch(/#3 Iron Sword \(forged \+1, might \+2\)/);
    }
    expect(findItem([fresh, worn, forged], '#3')).toBe(forged);
  });
});
