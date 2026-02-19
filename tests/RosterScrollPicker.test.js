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
    setDepth() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setInteractive() {
      this._interactive = true;
      return this;
    },
    setOrigin() {
      return this;
    },
    setDisplaySize() {
      return this;
    },
    setColor() {
      return this;
    },
    setPosition(x, y) {
      this.x = x;
      this.y = y;
      return this;
    },
    setSize(width, height) {
      this.width = width;
      this.height = height;
      return this;
    },
    setY(y) {
      this.y = y;
      return this;
    },
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    },
    destroy() {
      this._destroyed = true;
    },
  };
}

function makeSceneStub() {
  const created = { rectangles: [], texts: [] };
  const inputHandlers = {};
  const keyboardHandlers = {};
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
        const obj = makeDisplayObject({
          kind: 'text',
          x: _x,
          y: _y,
          text,
          style,
          width: 200,
          height,
        });
        created.texts.push(obj);
        return obj;
      },
    },
    textures: { exists: () => false },
    registry: { get: () => null },
    input: {
      keyboard: {
        on: (event, cb) => {
          keyboardHandlers[event] = cb;
        },
        off: (event, cb) => {
          if (!keyboardHandlers[event]) return;
          if (!cb || keyboardHandlers[event] === cb) delete keyboardHandlers[event];
        },
      },
      on: (event, cb) => {
        inputHandlers[event] = cb;
      },
      off: (event, cb) => {
        if (!inputHandlers[event]) return;
        if (!cb || inputHandlers[event] === cb) delete inputHandlers[event];
      },
    },
    events: { on() {}, off() {} },
    created,
    inputHandlers,
    keyboardHandlers,
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

function seedRoster(rm, count) {
  const template = structuredClone(rm.roster[0]);
  rm.roster = Array.from({ length: count }, (_, i) => {
    const unit = structuredClone(template);
    unit.name = `Unit${i + 1}`;
    unit.level = Number.isFinite(unit.level) ? unit.level : 1;
    unit.stats = unit.stats || { HP: 20 };
    unit.currentHP = Number.isFinite(unit.currentHP) ? unit.currentHP : unit.stats.HP;
    unit.inventory = Array.isArray(unit.inventory) ? unit.inventory : [];
    unit.consumables = Array.isArray(unit.consumables) ? unit.consumables : [];
    unit.skills = Array.isArray(unit.skills) ? unit.skills : [];
    return unit;
  });
}

function getInteractiveRosterRows(overlay) {
  return overlay.objects.filter(
    (obj) => obj?._rosterList && obj?._interactive && obj.handlers?.pointerdown,
  );
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
    expect(scene.created.texts.some((t) => t.text === 'Page 1/2')).toBe(true);

    // Only 6 scroll buttons on this page (not 12)
    const scrollBtns = overlay.tradeObjects.filter((o) => o._scrollRef !== undefined);
    expect(scrollBtns).toHaveLength(6);

    // Cancel bottom edge fits viewport
    const cancel = overlay.tradeObjects[overlay.tradeObjects.length - 1];
    expect(cancel.y + cancel.height / 2).toBeLessThan(480);

    // Navigate to page 2
    const nextBtn = scene.created.texts.find((t) => t.text === 'Next');
    expect(nextBtn?.handlers.pointerdown).toBeTypeOf('function');
    nextBtn.handlers.pointerdown();

    expect(scene.created.texts.some((t) => t.text === 'Page 2/2')).toBe(true);

    // Page 2 also fits viewport
    const cancel2 = overlay.tradeObjects[overlay.tradeObjects.length - 1];
    expect(cancel2.y + cancel2.height / 2).toBeLessThan(480);
  });
});

describe('left roster overflow behavior', () => {
  it('auto-scrolls selected unit into view while preserving unit->convoy wrap order', () => {
    const { overlay, rm } = makeOverlay();
    seedRoster(rm, 14);

    overlay.show();
    overlay.select('unit', rm.roster.length - 1);

    const selectedUnitRow = getInteractiveRosterRows(overlay).find((row) => row.alpha === 1);
    expect(selectedUnitRow).toBeTruthy();
    expect(selectedUnitRow.y - selectedUnitRow.height / 2).toBeGreaterThanOrEqual(50);
    expect(selectedUnitRow.y + selectedUnitRow.height / 2).toBeLessThanOrEqual(414);
    expect(overlay._rosterScrollOffset).toBeGreaterThan(0);

    overlay._cycleSelection(1);
    expect(overlay.selection).toEqual({ kind: 'convoy' });

    overlay._cycleSelection(1);
    expect(overlay.selection).toEqual({ kind: 'unit', index: 0 });
    expect(overlay._rosterScrollOffset).toBe(0);
  });

  it('supports wheel and drag scrolling in left panel while keeping convoy row fixed', () => {
    const { overlay, rm, scene } = makeOverlay();
    seedRoster(rm, 14);

    overlay.show();

    const getConvoyY = () => {
      const rows = getInteractiveRosterRows(overlay);
      return Math.max(...rows.map((row) => row.y));
    };

    const initialConvoyY = getConvoyY();
    expect(overlay.objects.some((obj) => obj?._rosterList && obj.text === '\u25bc')).toBe(true);
    expect(overlay.objects.some((obj) => obj?._rosterList && obj.text === '\u25b2')).toBe(false);
    const wheelHandler = scene.inputHandlers.wheel;
    expect(wheelHandler).toBeTypeOf('function');

    wheelHandler({ x: 40, y: 120 }, null, 0, 120);
    expect(overlay._rosterScrollOffset).toBeGreaterThan(0);
    expect(overlay.objects.some((obj) => obj?._rosterList && obj.text === '\u25b2')).toBe(true);
    expect(getConvoyY()).toBe(initialConvoyY);

    const pointerDown = scene.inputHandlers.pointerdown;
    const pointerMove = scene.inputHandlers.pointermove;
    const pointerUp = scene.inputHandlers.pointerup;
    expect(pointerDown).toBeTypeOf('function');
    expect(pointerMove).toBeTypeOf('function');
    expect(pointerUp).toBeTypeOf('function');

    const beforeDrag = overlay._rosterScrollOffset;
    pointerDown({ id: 1, x: 40, y: 120 });
    pointerMove({ id: 1, x: 40, y: 40, isDown: true });
    pointerUp({ id: 1, x: 40, y: 40 });

    expect(overlay._rosterScrollOffset).toBeGreaterThan(beforeDrag);
    expect(getConvoyY()).toBe(initialConvoyY);
  });

  it('renders at least eight unit rows at tiny non-zero offsets', () => {
    const { overlay, rm } = makeOverlay();
    seedRoster(rm, 14);

    overlay.show();
    overlay._rosterScrollOffset = 1;
    overlay.drawUnitList();

    const rows = getInteractiveRosterRows(overlay);
    const convoyY = Math.max(...rows.map((row) => row.y));
    const unitRows = rows.filter((row) => row.y < convoyY);
    expect(unitRows.length).toBeGreaterThanOrEqual(8);
  });

  it('redraws the left list when detail-only clamp changes selection validity', () => {
    const { overlay, rm } = makeOverlay();
    seedRoster(rm, 5);

    overlay.show();
    overlay.select('unit', 4);
    rm.roster = rm.roster.slice(0, 2);

    overlay.drawUnitDetails();

    expect(overlay.selection).toEqual({ kind: 'unit', index: 1 });
    expect(getInteractiveRosterRows(overlay)).toHaveLength(3); // 2 units + convoy
  });

  it('does not draw unit text above the unit viewport on partial offsets', () => {
    const { overlay, rm } = makeOverlay();
    seedRoster(rm, 14);

    overlay.show();
    overlay._rosterScrollOffset = 24;
    overlay.drawUnitList();

    const unitNameTexts = overlay.objects.filter(
      (obj) => obj?._rosterList && typeof obj.text === 'string' && obj.text.startsWith('Unit'),
    );
    expect(unitNameTexts.length).toBeGreaterThan(0);
    for (const textObj of unitNameTexts) {
      expect(textObj.y).toBeGreaterThanOrEqual(50);
      expect(textObj.y).toBeLessThan(414);
    }
  });

  it('redraws the left list when roster changes while convoy is selected', () => {
    const { overlay, rm } = makeOverlay();
    seedRoster(rm, 5);

    overlay.show();
    overlay.select('convoy');
    expect(getInteractiveRosterRows(overlay)).toHaveLength(6); // 5 units + convoy

    rm.roster = rm.roster.slice(0, 2);
    overlay.drawUnitDetails();

    expect(overlay.selection).toEqual({ kind: 'convoy' });
    expect(getInteractiveRosterRows(overlay)).toHaveLength(3); // 2 units + convoy
  });

  it('redraws left list for same-count in-place roster mutations while convoy is selected', () => {
    const { overlay, rm } = makeOverlay();
    seedRoster(rm, 5);

    overlay.show();
    overlay.select('convoy');

    rm.roster[0].name = 'ZZZ_Renamed';
    rm.roster[0].currentHP = Math.max(1, (rm.roster[0].currentHP || 1) - 1);
    overlay.drawUnitDetails();

    const rosterTexts = overlay.objects.filter(
      (obj) => obj?._rosterList && typeof obj.text === 'string',
    );
    expect(rosterTexts.some((obj) => String(obj.text).startsWith('ZZZ_Renamed'))).toBe(true);
  });
});
