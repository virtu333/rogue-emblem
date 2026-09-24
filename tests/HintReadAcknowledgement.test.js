import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { CaravanController } from '../src/ui/CaravanController.js';
const surfaces = vi.hoisted(() => []);
vi.mock('../src/utils/domUI.js', () => ({ hasDOMHost: () => true }));
vi.mock('../src/ui/MenuSurface.js', () => ({
  element: () => ({}),
  button: (text, action) => ({ text, action }),
  MenuSurface: class {
    constructor(scene, title, close) {
      this.close = close;
      this.root = { classList: { add() {} } };
      this.header = { querySelector: () => ({ remove() {} }) };
      this.body = {
        append: (...children) => {
          this.children = children;
        },
      };
      surfaces.push(this);
    }
    destroy() {}
    focusContent() {}
  },
}));
import {
  showContextualHint,
  hintReadingPolicy,
  claimContextualHint,
  observeContextualHint,
  isHintTextVisible,
} from '../src/ui/HintDisplay.js';
const message =
  'Rewinds last the whole run, not one battle. Each act boss grants one additional charge.';
function fixture() {
  const seen = new Set();
  const hints = { hasSeen: (id) => seen.has(id), markSeen: (id) => seen.add(id) };
  const scene = {
    events: new EventEmitter(),
    battleParams: { battleSeed: 1 },
    battleState: 'PLAYER_IDLE',
    registry: { get: (key) => (key === 'hints' ? hints : { getHints: () => true }) },
  };
  return { scene, seen };
}
beforeEach(() => {
  vi.useFakeTimers();
  surfaces.length = 0;
});
afterEach(() => vi.useRealTimers());
describe('hint reading contract', () => {
  it('keeps long hints until an explicit acknowledgement and ignores opening input', async () => {
    const { scene, seen } = fixture();
    showContextualHint(scene, 'rewind', message);
    const panel = surfaces[0];
    panel.children[1].action();
    expect(seen.size).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(seen.size).toBe(0);
    panel.children[1].action();
    await scene._minorHintQueue;
    expect(seen.has('rewind')).toBe(true);
  });
  it('leaves interrupted hints unseen and available next battle', async () => {
    const { scene, seen } = fixture();
    showContextualHint(scene, 'rewind', message);
    scene.events.emit('shutdown');
    await scene._minorHintQueue;
    expect(seen.size).toBe(0);
    expect(scene.events.listenerCount('shutdown')).toBe(0);
  });
  it('uses a bounded reading duration only for short hints', () => {
    expect(hintReadingPolicy('A short hint')).toEqual({ requiresDismissal: false, duration: 4000 });
    expect(hintReadingPolicy(message).requiresDismissal).toBe(true);
  });
});

describe('deferred and inline lessons', () => {
  it.each(['battle_consumable_supply', 'battle_staff_scope', 'battle_heal_uses'])(
    'defers %s until idle instead of silently dropping it',
    async (id) => {
      const { scene, seen } = fixture();
      scene.battleState = 'UNIT_ACTION_MENU';
      expect(showContextualHint(scene, id, message)).toBe(true);
      expect(showContextualHint(scene, id, message)).toBe(false);
      expect(surfaces).toHaveLength(0);
      scene.battleState = 'PLAYER_IDLE';
      scene.events.emit('update');
      await Promise.resolve();
      expect(surfaces).toHaveLength(1);
      expect(seen.size).toBe(0);
      await vi.advanceTimersByTimeAsync(500);
      surfaces[0].children[1].action();
      await scene._minorHintQueue;
      expect(seen.has(id)).toBe(true);
      expect(scene.events.listenerCount('update')).toBe(0);
    },
  );
  it('does not show a deferred hint after shutdown', async () => {
    const { scene, seen } = fixture();
    scene.battleState = 'SELECTING_HEAL_TARGET';
    showContextualHint(scene, 'battle_heal_uses', message);
    scene.events.emit('shutdown');
    await Promise.resolve();
    scene.battleState = 'PLAYER_IDLE';
    scene.events.emit('update');
    expect(surfaces).toHaveLength(0);
    expect(seen.size).toBe(0);
    expect(scene.events.listenerCount('update')).toBe(0);
  });
  it('only acknowledges inline forecast notes after a reading window, with cancellation allowing retry', async () => {
    const { scene, seen } = fixture();
    expect(claimContextualHint(scene, 'forecast')).toBe(true);
    const close = observeContextualHint(scene, 'forecast', message, () => true);
    await vi.advanceTimersByTimeAsync(100);
    close();
    expect(seen.size).toBe(0);
    expect(claimContextualHint(scene, 'forecast')).toBe(true);
    observeContextualHint(scene, 'forecast', message, () => true);
    await vi.advanceTimersByTimeAsync(hintReadingPolicy(message).duration);
    expect(seen.has('forecast')).toBe(true);
    expect(scene.events.listenerCount('update')).toBe(0);
  });
  it('does not acknowledge a hidden or interrupted inline forecast', async () => {
    const { scene, seen } = fixture();
    claimContextualHint(scene, 'forecast');
    let visible = true;
    observeContextualHint(scene, 'forecast', message, () => visible);
    visible = false;
    scene.events.emit('update');
    await vi.advanceTimersByTimeAsync(20000);
    expect(seen.size).toBe(0);
    visible = true;
    scene.events.emit('update');
    await vi.advanceTimersByTimeAsync(100);
    scene.events.emit('shutdown');
    await vi.advanceTimersByTimeAsync(20000);
    expect(seen.size).toBe(0);
  });
});

it('acknowledges the caravan lesson only after dismissal, never just on spawning', async () => {
  const { scene, seen } = fixture();
  Object.assign(scene, {
    battleConfig: { caravanSpawn: { col: 3, row: 1 } },
    npcUnits: [],
    addUnitGraphic() {},
  });
  new CaravanController(scene).spawnIfConfigured();
  expect(seen.has('battle_caravan')).toBe(false);
  expect(surfaces).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(500);
  surfaces[0].children[1].action();
  await scene._minorHintQueue;
  expect(seen.has('battle_caravan')).toBe(true);
});

it('waits through caravan creation and deployment before presenting the first battle hint', async () => {
  const { scene, seen } = fixture();
  delete scene.battleState;
  Object.assign(scene, {
    battleConfig: { caravanSpawn: { col: 3, row: 1 } },
    npcUnits: [],
    addUnitGraphic() {},
  });
  new CaravanController(scene).spawnIfConfigured();
  expect(surfaces).toHaveLength(0);
  scene.events.emit('update');
  await Promise.resolve();
  expect(surfaces).toHaveLength(0);
  scene.battleState = 'DEPLOY';
  scene.events.emit('update');
  await Promise.resolve();
  expect(surfaces).toHaveLength(0);
  scene.battleState = 'PLAYER_IDLE';
  scene.events.emit('update');
  await Promise.resolve();
  expect(surfaces).toHaveLength(1);
  expect(seen.has('battle_caravan')).toBe(false);
  await vi.advanceTimersByTimeAsync(500);
  surfaces[0].children[1].action();
  await scene._minorHintQueue;
  expect(seen.has('battle_caravan')).toBe(true);
});

it('starts the reading window only when an offscreen forecast note is scrolled fully into view', async () => {
  const { scene, seen } = fixture();
  claimContextualHint(scene, 'forecast');
  let visible = false;
  observeContextualHint(scene, 'forecast', message, () => visible);
  await vi.advanceTimersByTimeAsync(20000);
  expect(seen.size).toBe(0);
  visible = true;
  scene.events.emit('update');
  await vi.advanceTimersByTimeAsync(hintReadingPolicy(message).duration - 100);
  expect(seen.size).toBe(0);
  await vi.advanceTimersByTimeAsync(100);
  expect(seen.has('forecast')).toBe(true);
});
it('rejects offscreen and clipped text, not merely detached text', () => {
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (node) => node.style;
  try {
    const parent = {
      style: { overflowY: 'auto' },
      getBoundingClientRect: () => ({ top: 0, bottom: 200, left: 0, right: 400 }),
    };
    let top = 250;
    const note = {
      isConnected: true,
      style: {},
      parentElement: parent,
      getBoundingClientRect: () => ({
        top,
        bottom: top + 50,
        left: 10,
        right: 300,
        width: 290,
        height: 50,
      }),
    };
    expect(isHintTextVisible(note)).toBe(false);
    top = 180;
    expect(isHintTextVisible(note)).toBe(false);
    top = 100;
    expect(isHintTextVisible(note)).toBe(true);
  } finally {
    globalThis.getComputedStyle = original;
  }
});
