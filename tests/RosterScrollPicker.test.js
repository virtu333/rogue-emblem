import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.min(max, Math.max(min, value)) },
  },
}));

const gameData = loadGameData();

let RosterOverlay;
beforeAll(async () => {
  ({ RosterOverlay } = await import('../src/ui/RosterOverlay.js'));
});

function makeDisplayObject(seed = {}) {
  return {
    ...seed,
    handlers: {},
    setDepth() { return this; },
    setStrokeStyle() { return this; },
    setInteractive() { this._interactive = true; return this; },
    setOrigin() { return this; },
    setDisplaySize() { return this; },
    setColor() { return this; },
    setY(y) { this.y = y; return this; },
    on(event, cb) { this.handlers[event] = cb; return this; },
    destroy() { this._destroyed = true; },
  };
}

function makeSceneStub() {
  const created = { rectangles: [], texts: [] };
  const scene = {
    add: {
      rectangle: (x, y, width, height, color, alpha) => {
        const obj = makeDisplayObject({ kind: 'rectangle', x, y, width, height, color, alpha });
        created.rectangles.push(obj);
        return obj;
      },
      text: (_x, _y, text, style) => {
        // Simulate Phaser text height: multi-line text is taller
        const lineCount = String(text).split('\n').length;
        const height = lineCount > 1 ? 40 : 20;
        const obj = makeDisplayObject({ kind: 'text', x: _x, y: _y, text, style, width: 200, height });
        created.texts.push(obj);
        return obj;
      },
    },
    textures: { exists: () => false },
    registry: { get: () => null },
    input: { keyboard: { on() {}, off() {} }, on() {}, off() {} },
    events: { on() {}, off() {} },
    created,
  };
  return scene;
}

function makeOverlay() {
  const rm = new RunManager(gameData);
  rm.startRun();
  const scene = makeSceneStub();
  const overlay = new RosterOverlay(scene, rm, {
    lords: gameData.lords || [],
    classes: gameData.classes || [],
    skills: gameData.skills || [],
    accessories: gameData.accessories || [],
    weaponArts: gameData.weaponArts || { arts: [] },
  });
  return { overlay, rm, scene };
}

describe('scroll picker layout', () => {
  it('positions buttons sequentially and panel fits viewport', () => {
    const { overlay, rm } = makeOverlay();
    const unit = rm.roster[0];

    rm.scrolls = [
      { name: 'Sol Scroll', type: 'Scroll', skillId: 'sol' },
      { name: 'Luna Scroll', type: 'Scroll', skillId: 'luna' },
      { name: 'Adept Scroll', type: 'Scroll', skillId: 'adept' },
      { name: 'Vantage Scroll', type: 'Scroll', skillId: 'vantage' },
    ];

    overlay._showScrollPicker(unit);

    // tradeObjects: bg, title, 4 buttons, pageLabel, cancel = 8
    expect(overlay.tradeObjects.length).toBe(8);

    // Extract positioned elements (skip bg at index 0)
    const [_bg, title, ...rest] = overlay.tradeObjects;
    const btns = rest.slice(0, 4);

    // Title should be positioned first
    expect(title.y).toBeGreaterThan(0);

    // Each button's y should be greater than the previous
    let prevY = title.y;
    for (const btn of btns) {
      expect(btn.y).toBeGreaterThan(prevY);
      prevY = btn.y;
    }

    // Cancel is the last element
    const cancel = overlay.tradeObjects[overlay.tradeObjects.length - 1];
    expect(cancel.y).toBeGreaterThan(prevY);

    // Panel must fit within 480px viewport
    expect(cancel.y + cancel.height / 2).toBeLessThan(480);
  });

  it('pages large scroll pools and each page fits viewport', () => {
    const { overlay, rm, scene } = makeOverlay();
    const unit = rm.roster[0];

    // 12 scrolls: exceeds SCROLL_PICKER_MAX_PER_PAGE (6) → 2 pages
    const skillIds = ['sol', 'luna', 'adept', 'vantage', 'wrath', 'miracle', 'guard', 'astra'];
    rm.scrolls = Array.from({ length: 12 }, (_v, i) => ({
      name: `Scroll ${i + 1}`,
      type: 'Scroll',
      skillId: skillIds[i % skillIds.length],
    }));

    overlay._showScrollPicker(unit);

    // Page 1: bg, title, 6 buttons, pageLabel, prev, next, cancel = 12
    expect(scene.created.texts.some(t => t.text === 'Page 1/2')).toBe(true);

    // Only 6 scroll buttons on this page (not 12)
    const scrollBtns = overlay.tradeObjects.filter(
      o => o._scrollRef !== undefined
    );
    expect(scrollBtns).toHaveLength(6);

    // Cancel bottom edge fits viewport
    const cancel = overlay.tradeObjects[overlay.tradeObjects.length - 1];
    expect(cancel.y + cancel.height / 2).toBeLessThan(480);

    // Navigate to page 2
    const nextBtn = scene.created.texts.find(t => t.text === 'Next');
    expect(nextBtn?.handlers.pointerdown).toBeTypeOf('function');
    nextBtn.handlers.pointerdown();

    expect(scene.created.texts.some(t => t.text === 'Page 2/2')).toBe(true);

    // Page 2 also fits viewport
    const cancel2 = overlay.tradeObjects[overlay.tradeObjects.length - 1];
    expect(cancel2.y + cancel2.height / 2).toBeLessThan(480);
  });
});
