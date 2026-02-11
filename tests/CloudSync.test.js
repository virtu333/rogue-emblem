import { describe, it, expect } from 'vitest';
import { shouldPreferLocalMeta } from '../src/cloud/CloudSync.js';

describe('CloudSync meta merge guard', () => {
  it('prefers local meta when local savedAt is newer', () => {
    const local = { totalValor: 120, totalSupply: 90, savedAt: 200 };
    const cloud = { totalValor: 50, totalSupply: 30, savedAt: 100 };
    expect(shouldPreferLocalMeta(local, cloud)).toBe(true);
  });

  it('does not prefer local when cloud is newer', () => {
    const local = { totalValor: 120, totalSupply: 90, savedAt: 100 };
    const cloud = { totalValor: 150, totalSupply: 110, savedAt: 200 };
    expect(shouldPreferLocalMeta(local, cloud)).toBe(false);
  });

  it('does not prefer local when timestamps are missing', () => {
    const local = { totalValor: 120, totalSupply: 90 };
    const cloud = { totalValor: 150, totalSupply: 110, savedAt: 200 };
    expect(shouldPreferLocalMeta(local, cloud)).toBe(false);
  });
});
