import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/ui/MenuSurface.js', () => {
  const node = (tag, text = '', className = '') => ({
    tag,
    textContent: text,
    className,
    children: [],
    classList: { add: vi.fn(), toggle: vi.fn() },
    append(...children) {
      this.children.push(...children);
    },
    setAttribute: vi.fn(),
    focus: vi.fn(),
    remove: vi.fn(),
    querySelector: () => ({ remove: vi.fn() }),
  });
  return {
    element: node,
    button: (text, click, className) => ({ ...node('button', text, className), click }),
    MenuSurface: class {
      constructor() {
        this.root = node('root');
        this.header = node('header');
        this.body = node('body');
      }
      destroy() {}
    },
  };
});
import { progressionResult } from '../src/ui/ProgressionMenus.js';
const unit = { name: 'Edric', className: 'Lord', stats: { HP: 20, STR: 10 } };
const result = { newLevel: 2, gains: { HP: 1, STR: 1 } };
const setup = (speed) => {
  const close = vi.fn();
  const scene = {
    registry: {
      get: () => ({ getBattleSpeed: () => speed, getReduceMotion: () => false, playSFX: vi.fn() }),
    },
  };
  const surface = progressionResult(scene, unit, result, false, [], null, close);
  const confirm = surface.root.children[0].children[0];
  return { close, surface, confirm };
};
afterEach(() => vi.useRealTimers());
it('Instant starts fully revealed and one press continues', () => {
  vi.useFakeTimers();
  const { confirm, close, surface } = setup('instant');
  expect(confirm.textContent).toBe('Continue');
  expect(vi.getTimerCount()).toBe(0);
  confirm.click();
  expect(close).toHaveBeenCalledOnce();
  surface.destroy();
});
it.each([
  ['normal', 120],
  ['fast', 60],
])('%s scales the stat reveal and cleans it up', (speed, interval) => {
  vi.useFakeTimers();
  const { surface, confirm, close } = setup(speed);
  const table = surface.body.children[1];
  const first = table.children[1];
  const before = first.textContent;
  vi.advanceTimersByTime(interval - 1);
  expect(first.textContent).toBe(before);
  vi.advanceTimersByTime(1);
  expect(first.textContent).not.toBe(before);
  confirm.click();
  expect(close).not.toHaveBeenCalled();
  expect(confirm.textContent).toBe('Continue');
  surface.destroy();
  expect(vi.getTimerCount()).toBe(0);
});
