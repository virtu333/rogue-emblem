import { afterEach, expect, it, vi } from 'vitest';
import { loadGameFont, DISPLAY_FONT_PROBE } from '../src/utils/loadGameFont.js';
afterEach(() => vi.useRealTimers());
it('waits for the decoded face before declaring it ready', async () => {
  const pending = {};
  const fonts = {
    load: vi.fn(
      (probe) =>
        new Promise((resolve) => {
          pending[probe] = resolve;
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
  pending['12px "Press Start 2P"']([]);
  expect(await result).toBe(true);
  expect(fonts.load).toHaveBeenCalledWith('12px "Press Start 2P"');
  // The ceremony display face is warmed in parallel but never awaited.
  expect(fonts.load).toHaveBeenCalledWith(DISPLAY_FONT_PROBE);
});
it('does not wait on the display face', async () => {
  const fonts = {
    load: vi.fn((probe) =>
      probe === DISPLAY_FONT_PROBE ? new Promise(() => {}) : Promise.resolve([]),
    ),
  };
  expect(await loadGameFont(fonts)).toBe(true);
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
