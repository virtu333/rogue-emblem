import { afterEach, expect, it, vi } from 'vitest';
import { loadGameFont } from '../src/utils/loadGameFont.js';
afterEach(() => vi.useRealTimers());
it('waits for the decoded face before declaring it ready', async () => {
  let ready;
  const fonts = {
    load: vi.fn(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    ),
  };
  const result = loadGameFont(fonts);
  let settled = false;
  result.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  ready([]);
  expect(await result).toBe(true);
  expect(fonts.load).toHaveBeenCalledWith('12px "Press Start 2P"');
});
it('does not block startup indefinitely on a missing font', async () => {
  vi.useFakeTimers();
  const result = loadGameFont({ load: () => new Promise(() => {}) });
  await vi.advanceTimersByTimeAsync(2000);
  expect(await result).toBe(false);
});
it('allows a fallback when font loading is unsupported or fails', async () => {
  expect(await loadGameFont(null)).toBe(false);
  expect(await loadGameFont({ load: () => Promise.reject(new Error('unavailable')) })).toBe(false);
});
