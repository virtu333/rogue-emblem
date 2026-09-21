import { describe, expect, it, vi } from 'vitest';
import { pickFresh } from '../src/utils/pickFresh.js';
describe('narrative shuffle bags', () => {
  it('visits every line before repeating and survives serialization without gameplay RNG', () => {
    const random = vi.spyOn(Math, 'random');
    const state = {};
    const pool = ['a', 'b', 'c'];
    expect(new Set(pool.map(() => pickFresh(pool, 'node', state, 42))).size).toBe(3);
    const restored = JSON.parse(JSON.stringify(state));
    expect(pickFresh(pool, 'node', restored, 42)).toBe(pickFresh(pool, 'node', state, 42));
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
  it('tolerates changed pools, duplicate lines and old state', () => {
    const state = { node: { cycle: 0, seen: ['removed', 'a'] } };
    expect(pickFresh(['a', 'b', 'b'], 'node', state)).toBe('b');
    expect(pickFresh([], 'empty', state)).toBeNull();
  });
});
