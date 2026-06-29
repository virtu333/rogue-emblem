import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.max(min, Math.min(max, v)) },
  },
}));

import { ShopController } from '../src/ui/ShopController.js';
import { InputAction } from '../src/utils/InputActions.js';
import {
  activeInputOwner,
  dispatchInputAction,
  _resetInputFocus,
} from '../src/utils/inputFocus.js';

beforeEach(() => _resetInputFocus());

function makeObj(seed = {}) {
  const o = { visible: true, x: 0, y: 0, width: 10, height: 10, handlers: {}, ...seed };
  const chain =
    (fn) =>
    (...a) => (fn?.(...a), o);
  o.setStrokeStyle = chain();
  o.setDepth = chain();
  o.setPosition = chain((x, y) => ((o.x = x), (o.y = y)));
  o.setSize = chain((w, h) => ((o.width = w), (o.height = h)));
  o.setVisible = chain((v) => (o.visible = v));
  o.on = chain((e, cb) => (o.handlers[e] = cb));
  o.emit = (e, arg) => (o.handlers[e]?.(arg), true);
  o.getBounds = () => ({ centerX: o.x, centerY: o.y, width: o.width, height: o.height });
  o.destroy = () => (o.destroyed = true);
  return o;
}

function button(fired, name) {
  const b = makeObj({ name });
  b.on('pointerdown', (p) => {
    if (p?.button !== 0) return;
    fired.push(name);
  });
  return b;
}

function makeScene(over = {}) {
  return {
    // ring carries a truthy `scene` so BoundingFocusController's "wiped by a redraw"
    // guard (this.ring.scene == null) doesn't null a live ring, as real Phaser rings do.
    add: { rectangle: () => makeObj({ kind: 'ring', scene: {} }) },
    shopOverlay: [{}],
    shopContentGroup: [],
    shopTabObjects: [],
    activeShopTab: 'buy',
    shopScrollOffsets: { buy: 0, sell: 0, forge: 0 },
    shopScrollMax: 0,
    _shopFocusEntries: [],
    _shopRerollBtn: null,
    _shopViewingMap: false,
    _shopViewingRoster: false,
    forgePicker: null,
    unitPicker: null,
    drawShopTabs: vi.fn(),
    drawActiveTabContent: vi.fn(),
    renderUnitPicker: vi.fn(),
    requestCancel: vi.fn(),
    runManager: { roster: [] },
    ...over,
  };
}

// Stand up the shop scope with explicit fixed buttons + content focus entries,
// plus the matching tagged buttons in shopContentGroup so CONFIRM can resolve them.
function setupController(scene, fired, { entries = [], reroll = false } = {}) {
  const ctrl = new ShopController(scene);
  ctrl._shopFixed = {
    viewMap: button(fired, 'viewMap'),
    roster: button(fired, 'roster'),
    leave: button(fired, 'leave'),
  };
  scene._shopFocusEntries = entries.map((e, i) => ({
    key: i,
    y: e.y ?? 105 + i * 24,
    h: e.h ?? 24,
  }));
  scene.shopContentGroup = entries.map((e, i) => {
    const b = button(fired, e.name || `row${i}`);
    b._shopFocusKey = i;
    return b;
  });
  if (reroll) scene._shopRerollBtn = button(fired, 'reroll');
  ctrl._setupShopFocus();
  return ctrl;
}

describe('ShopController gamepad focus', () => {
  it('claims the input stack and builds [content..., reroll?, viewMap, roster, leave] slots', () => {
    const scene = makeScene();
    const ctrl = setupController(scene, [], {
      entries: [{ name: 'a' }, { name: 'b' }],
      reroll: true,
    });
    expect(activeInputOwner()).toBe(ctrl);
    expect(ctrl._buildShopSlots().map((s) => s.kind)).toEqual([
      'content',
      'content',
      'fixed', // reroll
      'fixed', // viewMap
      'fixed', // roster
      'fixed', // leave
    ]);
  });

  it('NAVIGATE clamps within the slot list; CONFIRM fires the focused content row', () => {
    const fired = [];
    const ctrl = setupController(makeScene(), fired, {
      entries: [{ name: 'sword' }, { name: 'axe' }],
    });
    expect(ctrl._shopFocusIndex).toBe(0);
    ctrl._onShopInput(InputAction.NAVIGATE, { dy: -1 }); // already at top -> clamps
    expect(ctrl._shopFocusIndex).toBe(0);
    ctrl._onShopInput(InputAction.CONFIRM);
    expect(fired).toEqual(['sword']);

    ctrl._onShopInput(InputAction.NAVIGATE, { dy: 1 }); // axe
    ctrl._onShopInput(InputAction.CONFIRM);
    expect(fired).toEqual(['sword', 'axe']);
  });

  it('CONFIRM fires a focused fixed button (Leave) reached by navigating past content', () => {
    const fired = [];
    // No content -> slots are [viewMap, roster, leave].
    const ctrl = setupController(makeScene(), fired);
    ctrl._onShopInput(InputAction.NAVIGATE, { dy: 1 }); // roster
    ctrl._onShopInput(InputAction.NAVIGATE, { dy: 1 }); // leave
    ctrl._onShopInput(InputAction.CONFIRM);
    expect(fired).toEqual(['leave']);
  });

  it('L1/R1 cycle tabs (with wrap); d-pad left/right also switch tabs', () => {
    const scene = makeScene();
    const ctrl = setupController(scene, []);
    ctrl._onShopInput(InputAction.NEXT_UNIT); // buy -> sell
    expect(scene.activeShopTab).toBe('sell');
    ctrl._onShopInput(InputAction.NEXT_UNIT); // sell -> forge
    expect(scene.activeShopTab).toBe('forge');
    ctrl._onShopInput(InputAction.NEXT_UNIT); // forge -> buy (wrap)
    expect(scene.activeShopTab).toBe('buy');
    ctrl._onShopInput(InputAction.PREV_UNIT); // buy -> forge (wrap)
    expect(scene.activeShopTab).toBe('forge');
    ctrl._onShopInput(InputAction.NAVIGATE, { dx: 1 }); // forge -> buy (wrap)
    expect(scene.activeShopTab).toBe('buy');
    expect(scene.drawShopTabs).toHaveBeenCalled();
  });

  it('switching tabs resets focus to the first row', () => {
    const scene = makeScene();
    const ctrl = setupController(scene, [], { entries: [{ name: 'a' }, { name: 'b' }] });
    ctrl._onShopInput(InputAction.NAVIGATE, { dy: 1 });
    expect(ctrl._shopFocusIndex).toBe(1);
    ctrl._onShopInput(InputAction.NEXT_UNIT); // switch tab
    expect(ctrl._shopFocusIndex).toBe(0);
  });

  it('CANCEL routes through requestCancel; ROSTER triggers the Roster button', () => {
    const fired = [];
    const scene = makeScene();
    const ctrl = setupController(scene, fired);
    ctrl._onShopInput(InputAction.CANCEL);
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);
    ctrl._onShopInput(InputAction.ROSTER);
    expect(fired).toEqual(['roster']);
  });

  it('map-view: CONFIRM/CANCEL return via requestCancel, NAVIGATE is ignored', () => {
    const scene = makeScene({ _shopViewingMap: true });
    const ctrl = setupController(scene, []);
    ctrl._onShopInput(InputAction.NAVIGATE, { dy: 1 });
    expect(scene.requestCancel).not.toHaveBeenCalled();
    ctrl._onShopInput(InputAction.CONFIRM);
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);
  });

  it('roster sub-view: only CANCEL acts (closes via requestCancel)', () => {
    const fired = [];
    const scene = makeScene({ _shopViewingRoster: true });
    const ctrl = setupController(scene, fired);
    ctrl._onShopInput(InputAction.CONFIRM);
    ctrl._onShopInput(InputAction.NAVIGATE, { dy: 1 });
    expect(fired).toEqual([]); // inert
    ctrl._onShopInput(InputAction.CANCEL);
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);
  });

  it('_scrollShopRowIntoView scrolls a row below the fold into view and redraws', () => {
    const scene = makeScene({ shopScrollMax: 500 });
    const ctrl = setupController(scene, []);
    scene.drawActiveTabContent.mockClear();
    ctrl._scrollShopRowIntoView({ y: 400, h: 24 });
    expect(scene.shopScrollOffsets.buy).toBeGreaterThan(0);
    expect(scene.drawActiveTabContent).toHaveBeenCalled();
  });

  it('_teardownShopFocus releases the scope', () => {
    const ctrl = setupController(makeScene(), []);
    expect(activeInputOwner()).toBe(ctrl);
    ctrl._teardownShopFocus();
    expect(activeInputOwner()).toBe(null);
    expect(ctrl._shopFocus).toBe(null);
  });

  it('forge-stat modal: pushes its own scope; NAVIGATE/CONFIRM/CANCEL drive it', () => {
    const fired = [];
    const scene = makeScene();
    const ctrl = setupController(scene, fired);
    const mt = button(fired, 'mt');
    const crit = button(fired, 'crit');
    const cancel = button(fired, 'cancel');
    expect(ctrl._shopFocus.ring.visible).toBe(true); // shop ring shown before the modal
    const teardown = ctrl._attachModalFocus([mt, crit], cancel, 460);
    expect(activeInputOwner()).not.toBe(ctrl); // modal scope on top
    expect(ctrl._shopFocus.ring.visible).toBe(false); // shop ring auto-hidden under the modal

    dispatchInputAction(InputAction.CONFIRM); // first button (mt)
    expect(fired).toEqual(['mt']);
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 }); // crit
    dispatchInputAction(InputAction.CONFIRM);
    expect(fired).toEqual(['mt', 'crit']);
    dispatchInputAction(InputAction.CANCEL); // cancel button
    expect(fired).toEqual(['mt', 'crit', 'cancel']);

    teardown();
    expect(activeInputOwner()).toBe(ctrl); // shop scope restored
    expect(ctrl._shopFocus.ring.visible).toBe(true); // shop ring restored when re-exposed
  });

  it('unit-picker modal: walks roster rows then Cancel; CONFIRM fires the focused row', () => {
    const fired = [];
    const roster = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
    const scene = makeScene({
      runManager: { roster },
      unitPickerState: { offset: 0, maxOffset: 0, viewportTop: 120, viewportBottom: 400 },
    });
    const ctrl = setupController(scene, fired);
    // Tagged rendered rows + cancel, as renderUnitPicker would produce them.
    scene.unitPicker = roster.map((u, i) => {
      const b = button(fired, `unit${i}`);
      b._unitPickerIndex = i;
      return b;
    });
    scene._unitPickerCancelBtn = button(fired, 'pickerCancel');

    const teardown = ctrl._attachUnitPickerFocus();
    expect(activeInputOwner()).not.toBe(ctrl);

    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 }); // unit 0 -> unit 1
    dispatchInputAction(InputAction.CONFIRM);
    expect(fired).toEqual(['unit1']);

    dispatchInputAction(InputAction.CANCEL); // jumps straight to Cancel
    expect(fired).toEqual(['unit1', 'pickerCancel']);

    teardown();
    expect(activeInputOwner()).toBe(ctrl);
  });

  it('unit-picker modal: navigating past the last unit lands on Cancel', () => {
    const fired = [];
    const roster = [{ name: 'A' }, { name: 'B' }];
    const scene = makeScene({
      runManager: { roster },
      unitPickerState: { offset: 0, maxOffset: 0, viewportTop: 120, viewportBottom: 400 },
    });
    const ctrl = setupController(scene, fired);
    scene.unitPicker = roster.map((u, i) => {
      const b = button(fired, `unit${i}`);
      b._unitPickerIndex = i;
      return b;
    });
    scene._unitPickerCancelBtn = button(fired, 'pickerCancel');

    const teardown = ctrl._attachUnitPickerFocus();
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 }); // -> unit 1
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 }); // -> Cancel slot
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 }); // clamps at Cancel
    dispatchInputAction(InputAction.CONFIRM);
    expect(fired).toEqual(['pickerCancel']);
    teardown();
  });

  it('unit-picker installs a refocus hook (re-resolves rows after a non-pad scroll redraw)', () => {
    const fired = [];
    const roster = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
    const scene = makeScene({
      runManager: { roster },
      unitPickerState: { offset: 0, maxOffset: 0, viewportTop: 120, viewportBottom: 400 },
    });
    const ctrl = setupController(scene, fired);
    const makeRows = () => {
      scene.unitPicker = roster.map((u, i) => {
        const b = button(fired, `unit${i}`);
        b._unitPickerIndex = i;
        return b;
      });
      scene._unitPickerCancelBtn = button(fired, 'pickerCancel');
    };
    makeRows();

    expect(ctrl._unitPickerRefocus).toBe(null);
    const teardown = ctrl._attachUnitPickerFocus();
    expect(typeof ctrl._unitPickerRefocus).toBe('function'); // hook installed by attach

    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 }); // focus unit 1

    // Simulate a mouse-wheel / touch-drag scroll: rows destroyed + recreated, then
    // renderUnitPicker invokes the hook. It must re-resolve without throwing...
    makeRows();
    expect(() => ctrl._unitPickerRefocus()).not.toThrow();

    // ...and CONFIRM still hits the freshly-rendered unit 1 (selection stays correct).
    dispatchInputAction(InputAction.CONFIRM);
    expect(fired).toContain('unit1');

    teardown();
    expect(ctrl._unitPickerRefocus).toBe(null); // hook cleared on teardown
  });

  it('_setShopRingVisible(true) restores the ring only once the map/roster sub-view flag is cleared', () => {
    // Guards the NodeMapScene requestCancel ordering fix: _setShopOverlayVisibility(true)
    // must run AFTER _shopViewingMap is cleared, else the ring render self-suppresses.
    const scene = makeScene();
    const ctrl = setupController(scene, []);
    ctrl._setShopRingVisible(false);
    expect(ctrl._shopFocus.ring.visible).toBe(false);

    scene._shopViewingMap = true; // still in map view -> restore is suppressed
    ctrl._setShopRingVisible(true);
    expect(ctrl._shopFocus.ring.visible).toBe(false);

    scene._shopViewingMap = false; // flag cleared first -> ring restores
    ctrl._setShopRingVisible(true);
    expect(ctrl._shopFocus.ring.visible).toBe(true);
  });

  it('destroy() with a modal scope still open drains the whole input stack', () => {
    const fired = [];
    const scene = makeScene();
    const ctrl = setupController(scene, fired);
    // Simulate an open forge-stat modal (as showForgeStatPicker would leave it).
    ctrl._forgePickerTeardown = ctrl._attachModalFocus(
      [button(fired, 'mt')],
      button(fired, 'cancel'),
      460,
    );
    expect(activeInputOwner()).not.toBe(ctrl); // modal scope on top

    ctrl.destroy();
    expect(activeInputOwner()).toBe(null); // both the modal AND shop scopes popped
    expect(ctrl._forgePickerTeardown).toBe(null);
    expect(ctrl._shopFocus).toBe(null);
  });
});
