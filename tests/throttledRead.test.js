import { describe, it, expect, vi } from 'vitest';
import { throttledRead } from '../src/utils/throttledRead.js';

describe('throttledRead', () => {
  it('reads once per ttl window and then refreshes', () => {
    let t = 0;
    let v = 1;
    const read = vi.fn(() => v);
    const get = throttledRead(read, 500, () => t);
    expect(get()).toBe(1);
    v = 2;
    t = 499;
    expect(get()).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
    t = 500;
    expect(get()).toBe(2);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
