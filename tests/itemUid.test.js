import { describe, expect, it } from 'vitest';
import { ensureItemUid, generateItemUid, _resetUidCounter } from '../src/utils/itemUid.js';

describe('itemUid', () => {
  it('generateItemUid returns unique values', () => {
    _resetUidCounter();
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const uid = generateItemUid();
      expect(seen.has(uid)).toBe(false);
      seen.add(uid);
    }
  });

  it('ensureItemUid is idempotent', () => {
    _resetUidCounter();
    const item = { name: 'Iron Sword' };
    ensureItemUid(item);
    const first = item.uid;
    ensureItemUid(item);
    expect(item.uid).toBe(first);
  });

  it('uid survives structuredClone and JSON round-trip', () => {
    _resetUidCounter();
    const item = ensureItemUid({ name: 'Vulnerary', type: 'Consumable' });
    const cloned = structuredClone(item);
    const roundTripped = JSON.parse(JSON.stringify(item));
    expect(cloned.uid).toBe(item.uid);
    expect(roundTripped.uid).toBe(item.uid);
  });

  it('reset counter resets deterministic prefix sequence', () => {
    _resetUidCounter();
    const first = generateItemUid();
    _resetUidCounter();
    const afterReset = generateItemUid();
    expect(first.startsWith('itm_1_')).toBe(true);
    expect(afterReset.startsWith('itm_1_')).toBe(true);
  });
});
