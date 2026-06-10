// Regression tests: LevelUpPopup.show() must ALWAYS resolve. The promise used
// to settle only via the dim-background click, so destroying the popup (or the
// scene shutting down mid-show) left awaiting callers hanging forever.

import { describe, expect, it, vi } from 'vitest';
import { LevelUpPopup } from '../src/ui/LevelUpPopup.js';

function makeDisplayObject() {
  const handlers = {};
  return {
    handlers,
    setDepth() {
      return this;
    },
    setInteractive() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setOrigin() {
      return this;
    },
    once(event, cb) {
      handlers[event] = cb;
      return this;
    },
    destroy: vi.fn(),
  };
}

function makeScene() {
  const onceHandlers = new Map();
  const rectangles = [];
  return {
    cameras: { main: { width: 640, height: 480 } },
    add: {
      rectangle: () => {
        const obj = makeDisplayObject();
        rectangles.push(obj);
        return obj;
      },
      text: () => makeDisplayObject(),
    },
    events: {
      once: vi.fn((event, cb) => {
        const list = onceHandlers.get(event) || [];
        list.push(cb);
        onceHandlers.set(event, list);
      }),
      off: vi.fn(),
    },
    emitShutdown() {
      const list = onceHandlers.get('shutdown') || [];
      onceHandlers.delete('shutdown');
      for (const cb of list) cb();
    },
    _rectangles: rectangles,
  };
}

const unit = {
  name: 'Tester',
  className: 'Knight',
  stats: { HP: 20, STR: 8, MAG: 1, SKL: 5, SPD: 4, DEF: 9, RES: 2, LCK: 3 },
};
const gains = { gains: { HP: 1, STR: 1 }, newLevel: 4 };

async function settles(promise) {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return settled;
}

describe('LevelUpPopup resolution guarantees', () => {
  it('resolves on dismiss click (normal path)', async () => {
    const scene = makeScene();
    const popup = new LevelUpPopup(scene, unit, gains);
    const shown = popup.show();
    expect(await settles(shown)).toBe(false);

    const dimBg = scene._rectangles[0];
    dimBg.handlers.pointerdown();
    expect(await settles(shown)).toBe(true);
  });

  it('resolves when destroy() is called mid-show', async () => {
    const scene = makeScene();
    const popup = new LevelUpPopup(scene, unit, gains);
    const shown = popup.show();

    popup.destroy();
    expect(await settles(shown)).toBe(true);
    expect(popup.objects).toEqual([]);
  });

  it('resolves when the scene shuts down mid-show', async () => {
    const scene = makeScene();
    const popup = new LevelUpPopup(scene, unit, gains);
    const shown = popup.show();

    scene.emitShutdown();
    expect(await settles(shown)).toBe(true);
  });

  it('double destroy is safe and the shutdown hook is unhooked', async () => {
    const scene = makeScene();
    const popup = new LevelUpPopup(scene, unit, gains);
    const shown = popup.show();

    popup.destroy();
    popup.destroy();
    expect(await settles(shown)).toBe(true);
    expect(scene.events.off).toHaveBeenCalledWith('shutdown', expect.any(Function));
  });
});
