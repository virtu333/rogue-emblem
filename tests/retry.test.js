import { describe, it, expect, vi } from 'vitest';
import { retryBooleanAction } from '../src/utils/retry.js';

describe('retryBooleanAction', () => {
  it('returns true on first successful attempt', async () => {
    const action = vi.fn().mockResolvedValue(true);
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await retryBooleanAction(action, { attempts: 3, initialDelayMs: 50, wait });

    expect(result).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('retries failed attempts and eventually succeeds', async () => {
    const action = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await retryBooleanAction(action, {
      attempts: 4,
      initialDelayMs: 100,
      delayMultiplier: 2,
      wait,
    });

    expect(result).toBe(true);
    expect(action).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 100);
    expect(wait).toHaveBeenNthCalledWith(2, 200);
  });

  it('returns false after exhausting all attempts', async () => {
    const action = vi.fn().mockResolvedValue(false);
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await retryBooleanAction(action, {
      attempts: 3,
      initialDelayMs: 25,
      delayMultiplier: 2,
      wait,
    });

    expect(result).toBe(false);
    expect(action).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 25);
    expect(wait).toHaveBeenNthCalledWith(2, 50);
  });
});
