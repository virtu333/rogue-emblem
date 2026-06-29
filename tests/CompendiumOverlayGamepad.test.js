// Gamepad/keyboard focus for CompendiumOverlay (Slice 2D-7c). Drives the REAL
// show()/_draw() path against a mock scene with real game data, then exercises the
// focus scope through the shared input bus (dispatchInputAction). L1/R1 cycle tabs;
// d-pad up/down cycle the sub-filter; d-pad left/right page within the filtered list.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InputAction } from '../src/utils/InputActions.js';
import {
  activeInputOwner,
  dispatchInputAction,
  pushInputScope,
  _resetInputFocus,
} from '../src/utils/inputFocus.js';
import { loadGameData } from './testData.js';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { CompendiumOverlay } from '../src/ui/CompendiumOverlay.js';

const gameData = loadGameData();

// Mirrors TAB_DEFS order in CompendiumOverlay.js (Lords/Terrain have no sub-filters).
const TAB_LABELS = [
  'Arms',
  'Skills',
  'Arts',
  'Class',
  'Items',
  'Lords',
  'Bless',
  'Terrain',
  'Affixes',
];
const LORDS_TAB = TAB_LABELS.indexOf('Lords'); // filter-less

beforeEach(() => _resetInputFocus());

function makeObj(seed = {}) {
  const o = { x: 0, y: 0, width: 40, height: 12, handlers: {}, scene: {}, ...seed };
  const chain =
    (fn) =>
    (...a) => (fn?.(...a), o);
  o.setDepth = chain();
  o.setStrokeStyle = chain();
  o.setOrigin = chain();
  o.setColor = chain();
  o.setAlpha = chain();
  o.setPosition = chain((x, y) => ((o.x = x), (o.y = y)));
  o.setSize = chain((w, h) => ((o.width = w), (o.height = h)));
  o.setVisible = chain((v) => (o.visible = v));
  o.setInteractive = chain(() => (o.input = { enabled: true }));
  o.on = chain((e, cb) => (o.handlers[e] = cb));
  o.emit = (e, arg) => (o.handlers[e]?.(arg), true);
  o.getBounds = () => ({
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    centerX: o.x,
    centerY: o.y,
  });
  o.destroy = () => (o.destroyed = true);
  return o;
}

function makeGraphics() {
  const g = makeObj({ kind: 'graphics' });
  g.lineStyle = () => g;
  g.beginPath = () => g;
  g.moveTo = () => g;
  g.lineTo = () => g;
  g.strokePath = () => g;
  return g;
}

function makeScene() {
  return {
    cameras: { main: { centerX: 320, centerY: 240 } },
    add: {
      rectangle: (x, y, width, height) => makeObj({ kind: 'rect', x, y, width, height }),
      text: (x, y, text) => makeObj({ kind: 'text', x, y, text }),
      graphics: () => makeGraphics(),
    },
    input: {
      keyboard: { addKey: () => ({ on: vi.fn(), off: vi.fn() }), on: vi.fn(), off: vi.fn() },
    },
    game: { events: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } },
    events: { on: vi.fn(), once: vi.fn() },
  };
}

function makeOverlay() {
  const scene = makeScene();
  const onClose = vi.fn();
  const overlay = new CompendiumOverlay(scene, gameData, onClose);
  return { overlay, scene, onClose };
}

describe('CompendiumOverlay gamepad focus', () => {
  it('show() claims the input stack and rings the active tab; hide() releases it', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    expect(activeInputOwner()).toBe(overlay);
    expect(overlay._focus.objects[0]).toBe(overlay._activeTabObj);
    expect(overlay._activeTabObj.text).toBe(TAB_LABELS[0]); // Arms
    overlay.hide();
    expect(activeInputOwner()).toBe(null);
    expect(overlay._focus).toBe(null);
  });

  it('L1/R1 cycle tabs with wraparound and re-point the ring', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    const n = TAB_LABELS.length;

    dispatchInputAction(InputAction.NEXT_UNIT); // 0 -> 1
    expect(overlay.activeTabIndex).toBe(1);
    expect(overlay._focus.objects[0].text).toBe(TAB_LABELS[1]); // Skills

    dispatchInputAction(InputAction.PREV_UNIT); // 1 -> 0
    dispatchInputAction(InputAction.PREV_UNIT); // 0 -> wraps to last
    expect(overlay.activeTabIndex).toBe(n - 1);
  });

  it('d-pad up/down cycle the sub-filter and reset the page', () => {
    const { overlay } = makeOverlay();
    overlay.show(); // tab 0 = Arms (has filters)
    overlay.currentPage = 2;

    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    expect(overlay.activeFilterIndex).toBe(1);
    expect(overlay.currentPage).toBe(0); // page reset on filter change
    dispatchInputAction(InputAction.NAVIGATE, { dy: -1 });
    expect(overlay.activeFilterIndex).toBe(0);
  });

  it('up/down is a no-op on a filter-less tab (Lords)', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    for (let i = 0; i < LORDS_TAB; i++) dispatchInputAction(InputAction.NEXT_UNIT);
    expect(overlay.activeTabIndex).toBe(LORDS_TAB);
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    expect(overlay.activeFilterIndex).toBe(0); // unchanged
  });

  it('d-pad left/right page within the filtered list, clamped at the ends', () => {
    const { overlay } = makeOverlay();
    overlay.show(); // Arms / All — many weapons, multiple pages
    const totalPages = Math.max(
      1,
      Math.ceil(overlay._getFilteredItems().length / overlay._itemsPerPage()),
    );
    expect(totalPages).toBeGreaterThan(1);

    dispatchInputAction(InputAction.NAVIGATE, { dx: -1 }); // clamp at first
    expect(overlay.currentPage).toBe(0);
    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 });
    expect(overlay.currentPage).toBe(1);
    for (let i = 0; i < totalPages + 5; i++) dispatchInputAction(InputAction.NAVIGATE, { dx: 1 });
    expect(overlay.currentPage).toBe(totalPages - 1); // clamps at last
  });

  it('switching tabs resets both the sub-filter and the page', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 }); // filter 1
    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 }); // page 1
    expect(overlay.activeFilterIndex).toBe(1);
    expect(overlay.currentPage).toBe(1);
    dispatchInputAction(InputAction.NEXT_UNIT); // next tab
    expect(overlay.activeFilterIndex).toBe(0);
    expect(overlay.currentPage).toBe(0);
  });

  it('CANCEL closes the overlay; CANCEL exits search mode first', () => {
    const { overlay, onClose } = makeOverlay();
    overlay.show();
    overlay.searchInputActive = true;
    dispatchInputAction(InputAction.CANCEL);
    expect(overlay.searchInputActive).toBe(false);
    expect(overlay.visible).toBe(true); // exited search, still open

    dispatchInputAction(InputAction.CANCEL);
    expect(overlay.visible).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(activeInputOwner()).toBe(null);
  });

  it('only the topmost (compendium) scope receives dispatched actions', () => {
    const sceneSpy = vi.fn();
    pushInputScope({ id: 'pause' }, sceneSpy);
    const { overlay } = makeOverlay();
    overlay.show();
    dispatchInputAction(InputAction.NEXT_UNIT);
    expect(sceneSpy).not.toHaveBeenCalled();
    expect(overlay.activeTabIndex).toBe(1);
  });
});
