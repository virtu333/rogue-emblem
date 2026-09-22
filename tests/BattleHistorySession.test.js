import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
vi.mock('../src/scenes/BattleHistoryScene.js', () => ({
  BattleHistoryScene: class {
    constructor(key, ready) {
      this.key = key;
      this.ready = ready;
    }
  },
}));
import { BattleHistorySession } from '../src/ui/BattleHistorySession.js';
function host() {
  let active = true,
    visible = true;
  const camera = {
    scrollX: 15,
    scrollY: 30,
    zoom: 1.3,
    setScroll(x, y) {
      this.scrollX = x;
      this.scrollY = y;
      return this;
    },
    setZoom(z) {
      this.zoom = z;
      return this;
    },
  };
  const manager = {
    keys: {},
    pause: vi.fn(() => {
      active = false;
    }),
    resume: vi.fn(() => {
      active = true;
    }),
    add: vi.fn((key, scene) => {
      scene.scene = { setVisible: vi.fn() };
      scene.cameras = { main: { width: 640, height: 480, zoom: 1, setBounds: vi.fn() } };
      scene.renderer = {
        clear: vi.fn(),
        cancel: vi.fn(),
        show: vi.fn((frame, transition, settled) => {
          scene.settle = settled;
        }),
      };
      manager.keys[key] = scene;
      scene.ready(scene);
    }),
    remove: vi.fn((key) => {
      delete manager.keys[key];
    }),
  };
  return {
    events: new EventEmitter(),
    cameras: { main: camera },
    game: { scene: manager },
    scene: {
      key: 'Battle',
      isActive: () => active,
      isPaused: () => !active,
      isVisible: () => visible,
      setVisible: (v) => {
        visible = v;
      },
    },
  };
}
describe('historical scene lifecycle', () => {
  it('acquires synchronously and closing before import completion leaves no queued pause or scene', async () => {
    const h = host(),
      session = new BattleHistorySession(h);
    expect(h.scene.isPaused()).toBe(true);
    session.destroy();
    session.destroy();
    expect(h.scene.isActive()).toBe(true);
    expect(h.scene.isVisible()).toBe(true);
    expect(await session.ready).toBeNull();
    expect(h.game.scene.add).not.toHaveBeenCalled();
    expect(h.game.scene.resume).toHaveBeenCalledTimes(1);
    expect(h.events.listenerCount('shutdown')).toBe(0);
  });
  it('latest selection owns settlement, and shutdown never resumes its old host', async () => {
    const h = host(),
      session = new BattleHistorySession(h),
      first = vi.fn(),
      second = vi.fn();
    await session.show({ cols: 10, rows: 10 }, {}, first);
    const obsolete = session.scene.settle;
    await session.show({ cols: 12, rows: 10 }, {}, second);
    obsolete();
    expect(first).not.toHaveBeenCalled();
    session.scene.settle();
    expect(second).toHaveBeenCalledWith(true);
    h.events.emit('shutdown');
    expect(session.destroyed).toBe(true);
    expect(h.game.scene.resume).not.toHaveBeenCalled();
    expect(h.game.scene.keys).toEqual({});
  });
  it('a rendering failure reports unavailable without touching the paused host', async () => {
    const h = host(),
      session = new BattleHistorySession(h),
      settled = vi.fn();
    await session.ready;
    session.scene.renderer.show.mockImplementation(() => {
      throw Error('texture missing');
    });
    await session.show({ cols: 10, rows: 10 }, {}, settled);
    expect(settled).toHaveBeenCalledWith(false);
    expect(h.scene.isPaused()).toBe(true);
    session.destroy();
    expect(h.scene.isActive()).toBe(true);
  });
});
