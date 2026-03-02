import { describe, expect, it } from 'vitest';
import { formatUses, getConsumableDescription } from '../src/utils/consumableText.js';

describe('consumableText', () => {
  it('formats consumable descriptions by effect', () => {
    expect(getConsumableDescription({ effect: 'heal', value: 20 })).toBe('Restore 20 HP');
    expect(getConsumableDescription({ effect: 'healFull' })).toBe('Restore HP to full');
    expect(getConsumableDescription({ effect: 'promote' })).toBe('Promote a Lv 10+ unit');
    expect(getConsumableDescription({ effect: 'statBoost', stat: 'STR', value: 2 })).toBe(
      'Permanent +2 STR',
    );
    expect(getConsumableDescription({ effect: 'cure' })).toBe('Cure all status conditions');
    expect(getConsumableDescription({ effect: 'cureHeal', value: 15 })).toBe(
      'Cure conditions & restore 15 HP',
    );
  });

  it('uses correct reclass article for infantry and mounted labels', () => {
    expect(getConsumableDescription({ effect: 'reclass', subEffect: 'infantry' })).toBe(
      'Reclass to an infantry class',
    );
    expect(getConsumableDescription({ effect: 'reclass', subEffect: 'mounted' })).toBe(
      'Reclass to a mounted class',
    );
  });

  it('returns empty string for null and unknown effects', () => {
    expect(getConsumableDescription(null)).toBe('');
    expect(getConsumableDescription({})).toBe('');
    expect(getConsumableDescription({ effect: 'unknown' })).toBe('');
  });

  it('formats uses with singular/plural handling', () => {
    expect(formatUses({ uses: 1 })).toBe('1 use');
    expect(formatUses({ uses: 3 })).toBe('3 uses');
    expect(formatUses({ uses: '2' })).toBe('2 uses');
  });

  it('returns empty uses text for missing or invalid values', () => {
    expect(formatUses(null)).toBe('');
    expect(formatUses({})).toBe('');
    expect(formatUses({ uses: 'x' })).toBe('');
  });
});
