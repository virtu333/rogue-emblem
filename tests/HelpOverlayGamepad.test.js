// Gamepad/keyboard focus for HelpOverlay (Slice 2D-7c). Drives the REAL show()/_draw()
// path against a mock scene with the real HELP_TABS data, then exercises the focus
// scope through the shared input bus (dispatchInputAction) the way GamepadReader would.
// Bumpers (L1/R1) and d-pad up/down cycle tabs; d-pad left/right page within a tab.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InputAction } from '../src/utils/InputActions.js';
import {
  activeInputOwner,
  dispatchInputAction,
  pushInputScope,
  _resetInputFocus,
} from '../src/utils/inputFocus.js';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { HelpOverlay } from '../src/ui/HelpOverlay.js';
import { HELP_TABS } from '../src/data/helpContent.js';

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
  const sceneEvents = {}; // captured scene lifecycle handlers (e.g. 'shutdown')
  const keyHandlers = {}; // captured scene.input.keyboard handlers (e.g. 'keydown')
  return {
    cameras: { main: { centerX: 320, centerY: 240 } },
    add: {
      rectangle: (x, y, width, height) => makeObj({ kind: 'rect', x, y, width, height }),
      text: (x, y, text) => makeObj({ kind: 'text', x, y, text }),
      graphics: () => makeGraphics(),
    },
    input: {
      keyboard: {
        addKey: () => ({ on: vi.fn(), off: vi.fn() }),
        on: (ev, cb) => (keyHandlers[ev] = cb),
        off: vi.fn(),
      },
    },
    game: { events: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } },
    events: {
      on: (ev, cb) => (sceneEvents[ev] ||= []).push(cb),
      once: (ev, cb) => (sceneEvents[ev] ||= []).push(cb),
    },
    _emitSceneEvent: (ev) => (sceneEvents[ev] || []).forEach((cb) => cb()),
    _keyHandlers: keyHandlers,
  };
}

function makeOverlay() {
  const scene = makeScene();
  const onClose = vi.fn();
  const overlay = new HelpOverlay(scene, onClose);
  return { overlay, scene, onClose };
}

// Index of a tab with >1 page (Combat / Arms) for the paging tests.
const MULTI_PAGE_TAB = HELP_TABS.findIndex((t) => t.pages.length > 1);
const MULTI_PAGE_COUNT = HELP_TABS[MULTI_PAGE_TAB].pages.length;

describe('HelpOverlay gamepad focus', () => {
  it('show() claims the input stack and rings the active tab; hide() releases it', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    expect(activeInputOwner()).toBe(overlay);
    expect(overlay._focus).toBeTruthy();
    expect(overlay._focus.objects[0]).toBe(overlay._activeTabObj);
    expect(overlay._activeTabObj.text).toBe(HELP_TABS[0].label);
    overlay.hide();
    expect(activeInputOwner()).toBe(null);
    expect(overlay._focus).toBe(null);
  });

  it('R1/L1 cycle tabs with wraparound and re-point the ring', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    const n = HELP_TABS.length;

    dispatchInputAction(InputAction.NEXT_UNIT); // 0 -> 1
    expect(overlay.activeTabIndex).toBe(1);
    expect(overlay._focus.objects[0].text).toBe(HELP_TABS[1].label); // ring followed

    dispatchInputAction(InputAction.PREV_UNIT); // 1 -> 0
    dispatchInputAction(InputAction.PREV_UNIT); // 0 -> wraps to last
    expect(overlay.activeTabIndex).toBe(n - 1);
    dispatchInputAction(InputAction.NEXT_UNIT); // last -> wraps to 0
    expect(overlay.activeTabIndex).toBe(0);
  });

  it('d-pad up/down also cycle tabs (Help has no sub-filters)', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 }); // 0 -> 1
    expect(overlay.activeTabIndex).toBe(1);
    dispatchInputAction(InputAction.NAVIGATE, { dy: -1 }); // 1 -> 0
    expect(overlay.activeTabIndex).toBe(0);
  });

  it('d-pad left/right page within a multi-page tab, clamped at the ends', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    // Jump to a multi-page tab via repeated NEXT.
    for (let i = 0; i < MULTI_PAGE_TAB; i++) dispatchInputAction(InputAction.NEXT_UNIT);
    expect(overlay.activeTabIndex).toBe(MULTI_PAGE_TAB);
    expect(overlay.currentPage).toBe(0);

    dispatchInputAction(InputAction.NAVIGATE, { dx: -1 }); // clamp at first page
    expect(overlay.currentPage).toBe(0);
    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 }); // -> page 1
    expect(overlay.currentPage).toBe(1);
    for (let i = 0; i < 10; i++) dispatchInputAction(InputAction.NAVIGATE, { dx: 1 });
    expect(overlay.currentPage).toBe(MULTI_PAGE_COUNT - 1); // clamps at last page
  });

  it('switching tabs resets the page to 0', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    for (let i = 0; i < MULTI_PAGE_TAB; i++) dispatchInputAction(InputAction.NEXT_UNIT);
    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 }); // page 1
    expect(overlay.currentPage).toBe(1);
    dispatchInputAction(InputAction.NEXT_UNIT); // next tab
    expect(overlay.currentPage).toBe(0);
  });

  it('CANCEL closes the overlay and fires onClose', () => {
    const { overlay, onClose } = makeOverlay();
    overlay.show();
    dispatchInputAction(InputAction.CANCEL);
    expect(overlay.visible).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(activeInputOwner()).toBe(null);
  });

  it('CANCEL exits keyboard search mode first, without closing', () => {
    const { overlay, onClose } = makeOverlay();
    overlay.show();
    overlay.searchInputActive = true;
    dispatchInputAction(InputAction.CANCEL);
    expect(overlay.searchInputActive).toBe(false);
    expect(overlay.visible).toBe(true); // still open
    expect(onClose).not.toHaveBeenCalled();
  });

  it('only the topmost (help) scope receives dispatched actions', () => {
    const sceneSpy = vi.fn();
    pushInputScope({ id: 'pause' }, sceneSpy);
    const { overlay } = makeOverlay();
    overlay.show();
    dispatchInputAction(InputAction.NEXT_UNIT);
    expect(sceneSpy).not.toHaveBeenCalled();
    expect(overlay.activeTabIndex).toBe(1);
  });

  it('CONFIRM advances in reading order: next page, then next tab', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    // Jump to a multi-page tab, then A steps through its pages...
    for (let i = 0; i < MULTI_PAGE_TAB; i++) dispatchInputAction(InputAction.NEXT_UNIT);
    dispatchInputAction(InputAction.CONFIRM);
    expect(overlay.currentPage).toBe(1);
    for (let i = 0; i < MULTI_PAGE_COUNT + 2; i++) dispatchInputAction(InputAction.CONFIRM);
    // ...and past the last page A rolls into the next tab at page 0.
    expect(overlay.activeTabIndex).toBeGreaterThan(MULTI_PAGE_TAB);
    expect(overlay.currentPage).toBeLessThan(MULTI_PAGE_COUNT - 1);
  });

  it("'/' enters search mode via the real keyboard path; pad nav is gated until CANCEL exits", () => {
    const { overlay, scene } = makeOverlay();
    overlay.show();
    // Real keydown path: '/' arms search-input mode, typed keys build the query.
    scene._keyHandlers.keydown({ key: '/' });
    expect(overlay.searchInputActive).toBe(true);
    scene._keyHandlers.keydown({ key: 'f' });
    scene._keyHandlers.keydown({ key: 'e' });
    expect(overlay.searchQuery).toBe('fe');

    // While typing, tab/page/CONFIRM pad actions must not clobber the search jump.
    const tabAtSearch = overlay.activeTabIndex;
    const pageAtSearch = overlay.currentPage;
    dispatchInputAction(InputAction.NEXT_UNIT);
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 });
    dispatchInputAction(InputAction.CONFIRM);
    expect(overlay.activeTabIndex).toBe(tabAtSearch);
    expect(overlay.currentPage).toBe(pageAtSearch);

    // CANCEL exits search mode first; the next CANCEL closes as usual.
    dispatchInputAction(InputAction.CANCEL);
    expect(overlay.searchInputActive).toBe(false);
    expect(overlay.visible).toBe(true);
    dispatchInputAction(InputAction.NEXT_UNIT); // pad nav live again
    expect(overlay.activeTabIndex).not.toBe(tabAtSearch);
  });

  it('scene shutdown while open releases the input scope (no leak to the next scene)', () => {
    const { overlay, scene } = makeOverlay();
    overlay.show();
    expect(activeInputOwner()).toBe(overlay);
    scene._emitSceneEvent('shutdown'); // hard shutdown, host never called hide()
    expect(activeInputOwner()).toBe(null);
    expect(overlay._focus).toBe(null);
    expect(() => overlay.hide()).not.toThrow(); // later host-driven hide stays safe
  });
});

describe('composed pause -> help teardown (real overlays, real scopes)', () => {
  it('PauseOverlay.hideForTransition drains both scopes while Help covers the pause menu', async () => {
    const { PauseOverlay } = await import('../src/ui/PauseOverlay.js');
    const scene = makeScene();
    const pause = new PauseOverlay(scene, { onResume: vi.fn() });
    // Minimal live pause state without running show(): one menu button + real focus.
    pause.visible = true;
    pause._menuButtons = [makeObj({ kind: 'text', text: 'Resume' })];
    pause._setupFocus(); // real BoundingFocusController + real pushInputScope

    const help = new HelpOverlay(scene, null);
    help.show(); // pushes its scope above pause (covers it)
    pause.helpOverlay = help;
    expect(activeInputOwner()).toBe(help);

    // The battle-scene shutdown path: hideForTransition must unwind BOTH scopes.
    pause.hideForTransition();
    expect(help.visible).toBe(false);
    expect(activeInputOwner()).toBe(null);
  });
});
