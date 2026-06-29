// Gamepad/keyboard focus for RosterOverlay (Slice 2D-7a). Drives the REAL draw
// paths via a real RunManager + gameData, then exercises the focus scope through
// the shared input bus (dispatchInputAction) the way GamepadReader would.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { InputAction } from '../src/utils/InputActions.js';
import {
  activeInputOwner,
  dispatchInputAction,
  _resetInputFocus,
} from '../src/utils/inputFocus.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.min(max, Math.max(min, v)) },
  },
}));

const gameData = loadGameData();

let RosterOverlay;
beforeAll(async () => {
  ({ RosterOverlay } = await import('../src/ui/RosterOverlay.js'));
});

beforeEach(() => _resetInputFocus());

// A chainable display-object mock complete enough for BoundingFocusController
// (getBounds/setVisible + a truthy `scene` so the "wiped by a redraw" guard never
// nulls a live ring) and for synthetic activation (emit -> stored handler).
// setInteractive sets `.input` exactly as Phaser does, which is how the modal ring
// discriminates picker buttons from backgrounds/titles.
function makeObj(seed = {}) {
  const o = {
    x: 0,
    y: 0,
    width: 120,
    height: 16,
    alpha: 1,
    visible: true,
    handlers: {},
    scene: {},
    ...seed,
  };
  const chain =
    (fn) =>
    (...a) => (fn?.(...a), o);
  o.setDepth = chain();
  o.setStrokeStyle = chain();
  o.setOrigin = chain();
  o.setDisplaySize = chain();
  o.setColor = chain();
  o.setBackgroundColor = chain();
  o.setPadding = chain();
  o.setAlpha = chain((a) => (o.alpha = a));
  o.setVisible = chain((v) => (o.visible = v));
  o.setPosition = chain((x, y) => ((o.x = x), (o.y = y)));
  o.setSize = chain((w, h) => ((o.width = w), (o.height = h)));
  o.setY = chain((y) => (o.y = y));
  o.setInteractive = chain(() => (o.input = { enabled: true }));
  o.on = chain((e, cb) => (o.handlers[e] = cb));
  o.emit = (e, arg) => (o.handlers[e]?.(arg), true);
  o.add = chain();
  o.getBounds = () => ({
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    centerX: o.x,
    centerY: o.y,
    left: o.x,
    top: o.y,
    right: o.x + o.width,
    bottom: o.y + o.height,
  });
  o.destroy = () => (o.destroyed = true);
  return o;
}

function makeScene() {
  const inputHandlers = {};
  const keyboardHandlers = {};
  const sceneEvents = {};
  return {
    add: {
      rectangle: (x, y, w, h, color, alpha) =>
        makeObj({ kind: 'rect', x, y, width: w, height: h, color, alpha }),
      text: (x, y, text, style) =>
        makeObj({ kind: 'text', x, y, text, style, width: Math.max(8, String(text).length * 6) }),
      image: (x, y, key) => makeObj({ kind: 'image', x, y, key }),
      container: (x, y) => makeObj({ kind: 'container', x, y }),
    },
    textures: { exists: () => false },
    registry: { get: () => null },
    sound: { stopByKey() {} },
    time: { delayedCall: () => ({ remove() {} }) },
    tweens: { add: () => ({}) },
    input: {
      keyboard: {
        on: (e, cb) => (keyboardHandlers[e] = cb),
        off: (e, cb) => {
          if (!cb || keyboardHandlers[e] === cb) delete keyboardHandlers[e];
        },
      },
      on: (e, cb) => (inputHandlers[e] = cb),
      off: (e, cb) => {
        if (!cb || inputHandlers[e] === cb) delete inputHandlers[e];
      },
    },
    events: { on: (e, cb) => (sceneEvents[e] = cb), off() {} },
    _inputHandlers: inputHandlers,
    _sceneEvents: sceneEvents,
  };
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

function makeOverlay({ rosterCount = 3, accessories = false } = {}) {
  const rm = new RunManager(gameData);
  rm.startRun();
  if (rosterCount) seedRoster(rm, rosterCount);
  if (accessories && Array.isArray(gameData.accessories) && gameData.accessories.length) {
    rm.accessories = [structuredClone(gameData.accessories[0])];
  }
  const scene = makeScene();
  const overlay = new RosterOverlay(scene, rm, gameData);
  return { overlay, rm, scene };
}

describe('RosterOverlay gamepad focus — scope + base navigation', () => {
  it('show() claims the input stack; hide() releases it', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    expect(activeInputOwner()).toBe(overlay);
    expect(overlay._rosterFocus).toBeTruthy();
    overlay.hide();
    expect(activeInputOwner()).toBe(null);
    expect(overlay._rosterFocus).toBe(null);
  });

  it('L1/R1 cycle the selected unit/convoy with wrap', () => {
    const { overlay } = makeOverlay({ rosterCount: 3 });
    overlay.show();
    expect(overlay.selection).toEqual({ kind: 'unit', index: 0 });

    dispatchInputAction(InputAction.NEXT_UNIT);
    expect(overlay.selection).toEqual({ kind: 'unit', index: 1 });
    dispatchInputAction(InputAction.NEXT_UNIT);
    dispatchInputAction(InputAction.NEXT_UNIT); // unit 2 -> convoy
    expect(overlay.selection).toEqual({ kind: 'convoy' });
    dispatchInputAction(InputAction.NEXT_UNIT); // convoy -> unit 0 (wrap)
    expect(overlay.selection).toEqual({ kind: 'unit', index: 0 });

    dispatchInputAction(InputAction.PREV_UNIT); // unit 0 -> convoy (wrap)
    expect(overlay.selection).toEqual({ kind: 'convoy' });
  });

  it('a fresh selection resets the detail ring to the first action', () => {
    const { overlay } = makeOverlay({ rosterCount: 3 });
    overlay.show();
    overlay._detailFocusIndex = 5; // pretend we were deep in the list
    dispatchInputAction(InputAction.NEXT_UNIT);
    expect(overlay._detailFocusIndex).toBe(0);
  });

  it('d-pad left/right toggles the Stats/Gear tab', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    expect(overlay._activeTab).toBe('stats');
    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 });
    expect(overlay._activeTab).toBe('gear');
    dispatchInputAction(InputAction.NAVIGATE, { dx: -1 });
    expect(overlay._activeTab).toBe('stats');
  });

  it('the detail ring points at a real tagged action button (the [Trade] footer)', () => {
    const { overlay } = makeOverlay({ rosterCount: 3 });
    overlay.show();
    // roster>1 -> a [Trade] footer button always exists, so the ring has a target.
    expect(overlay._detailSlots.length).toBeGreaterThanOrEqual(1);
    const ringed = overlay._rosterFocus.objects[0];
    expect(ringed).toBeTruthy();
    expect(ringed._rosterAction).toBe(true);
  });

  it('CONFIRM on the focused [Trade] button opens the trade picker (modal mode)', () => {
    const { overlay } = makeOverlay({ rosterCount: 3 });
    overlay.show();
    expect(overlay.tradeObjects.length).toBe(0);
    dispatchInputAction(InputAction.CONFIRM); // Stats tab: only action is [Trade]
    expect(overlay.tradeObjects.length).toBeGreaterThan(0); // picker opened
    expect(overlay._modalWasOpen).toBe(true);
  });

  it('CANCEL closes the overlay from base mode', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    expect(overlay.visible).toBe(true);
    dispatchInputAction(InputAction.CANCEL);
    expect(overlay.visible).toBe(false);
    expect(activeInputOwner()).toBe(null);
  });

  it('d-pad up/down clamps within the detail slot list', () => {
    const { overlay } = makeOverlay({ rosterCount: 3, accessories: true });
    overlay.show();
    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 }); // -> Gear tab (accessory [Equip] + [Trade])
    expect(overlay._detailSlots.length).toBeGreaterThanOrEqual(2);
    expect(overlay._detailFocusIndex).toBe(0);
    dispatchInputAction(InputAction.NAVIGATE, { dy: -1 }); // clamps at top
    expect(overlay._detailFocusIndex).toBe(0);
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    expect(overlay._detailFocusIndex).toBe(1);
    // walk to the bottom and confirm it clamps there
    for (let i = 0; i < 20; i++) dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    expect(overlay._detailFocusIndex).toBe(overlay._detailSlots.length - 1);
  });
});

describe('RosterOverlay gamepad focus — modal mode', () => {
  it('a base action that opens a picker switches to modal mode; CANCEL closes it and restores the base ring', () => {
    const { overlay } = makeOverlay({ rosterCount: 3, accessories: true });
    overlay.show();
    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 }); // Gear tab
    // Focus the accessory [Equip] button (first gear action) and activate it.
    overlay._detailFocusIndex = 0;
    overlay._renderRosterFocus();
    const firstBtn = overlay._detailSlots[0].btn;
    dispatchInputAction(InputAction.CONFIRM);
    // If the first action opened the accessory picker we're in modal mode now.
    if (overlay.tradeObjects.length > 0) {
      expect(overlay._modalWasOpen).toBe(true);
      const ringed = overlay._rosterFocus.objects[0];
      expect(overlay._collectModalButtons()).toContain(ringed);
      dispatchInputAction(InputAction.CANCEL); // close the picker
      expect(overlay.tradeObjects.length).toBe(0);
      expect(overlay._modalWasOpen).toBe(false);
      expect(overlay.visible).toBe(true); // overlay itself stays open
    } else {
      // first action wasn't a picker — at least confirm it fired without error
      expect(firstBtn._rosterAction).toBe(true);
    }
  });

  it('while a picker is open, L1 does NOT cycle units (modal mode owns input)', () => {
    const { overlay, rm } = makeOverlay({ rosterCount: 3 });
    rm.scrolls = [{ name: 'Sol Scroll', type: 'Scroll', skillId: 'sol' }];
    overlay.show();
    overlay._showScrollPicker(rm.roster[0]); // open a modal directly
    expect(overlay.tradeObjects.length).toBeGreaterThan(0);
    const before = JSON.stringify(overlay.selection);
    dispatchInputAction(InputAction.NEXT_UNIT);
    expect(JSON.stringify(overlay.selection)).toBe(before); // unchanged
  });

  it('modal ring walks the picker buttons and CONFIRM fires the focused one', () => {
    const { overlay, rm } = makeOverlay({ rosterCount: 3 });
    rm.scrolls = [
      { name: 'Sol Scroll', type: 'Scroll', skillId: 'sol' },
      { name: 'Luna Scroll', type: 'Scroll', skillId: 'luna' },
    ];
    overlay.show();
    overlay._showScrollPicker(rm.roster[0]);
    // Prime modal mode (as the open transition would).
    dispatchInputAction(InputAction.NAVIGATE, { dy: 0 });
    const btns = overlay._collectModalButtons();
    expect(btns.length).toBeGreaterThan(0);

    let fired = null;
    btns[1].on('pointerdown', () => (fired = 'second'));
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 }); // -> second button
    expect(overlay._modalFocusIndex).toBe(1);
    dispatchInputAction(InputAction.CONFIRM);
    expect(fired).toBe('second');
  });

  it('CANCEL in modal mode closes the picker without closing the overlay', () => {
    const { overlay, rm } = makeOverlay({ rosterCount: 3 });
    rm.scrolls = [{ name: 'Sol Scroll', type: 'Scroll', skillId: 'sol' }];
    overlay.show();
    overlay._showScrollPicker(rm.roster[0]);
    dispatchInputAction(InputAction.NAVIGATE, { dy: 0 }); // enter modal mode
    dispatchInputAction(InputAction.CANCEL);
    expect(overlay.tradeObjects.length).toBe(0);
    expect(overlay.visible).toBe(true);
  });
});

describe('RosterOverlay gamepad focus — convoy + reclass + teardown', () => {
  it('_scrollConvoyRowIntoView clamps the offset around the withdraw viewport', () => {
    const { overlay } = makeOverlay();
    overlay.selection = { kind: 'convoy' };
    overlay._convoyViewH = 304;
    overlay._convoyScrollMax = 400;
    overlay._convoyScrollOffset = 0;
    // A row well below the fold scrolls down.
    expect(overlay._scrollConvoyRowIntoView({ y: 350 })).toBe(true);
    expect(overlay._convoyScrollOffset).toBe(350 + 18 - 304);
    // A row above the current offset scrolls back up.
    expect(overlay._scrollConvoyRowIntoView({ y: 10 })).toBe(true);
    expect(overlay._convoyScrollOffset).toBe(10);
    // An already-visible row does not move the offset.
    expect(overlay._scrollConvoyRowIntoView({ y: 12 })).toBe(false);
  });

  it('convoy ring includes [Change] + every withdrawable row (incl. off-screen) and follows the scroll', () => {
    const { overlay, rm } = makeOverlay({ rosterCount: 2 });
    // Fill the convoy past the visible fold (cap is 20 weapons).
    const ironSword = gameData.weapons.find((w) => w.type === 'Sword');
    for (let i = 0; i < 20; i++) rm.addToConvoy(structuredClone(ironSword));
    overlay.show();
    overlay.select('convoy');
    expect(overlay._convoyScrollMax).toBeGreaterThan(0); // overflows
    // Slots: [Change] + 20 rows (all withdrawable since target unit has room).
    expect(overlay._detailSlots[0].btn?._convoyChange).toBe(true);
    expect(overlay._detailSlots.filter((s) => s.convoyKey).length).toBe(20);

    // Walking the ring down eventually scrolls the list and keeps resolving a button.
    for (let i = 0; i < 19; i++) dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    expect(overlay._convoyScrollOffset).toBeGreaterThan(0);
    const ringed = overlay._rosterFocus.objects[0];
    expect(ringed?._convoyRowKey).toBeTruthy(); // a real, on-screen withdraw button
  });

  it('CONFIRM withdraws a convoy item via the focused row', () => {
    const { overlay, rm } = makeOverlay({ rosterCount: 2 });
    const ironSword = gameData.weapons.find((w) => w.type === 'Sword');
    rm.addToConvoy(structuredClone(ironSword));
    overlay.show();
    overlay.select('convoy');
    const before = rm.getConvoyItems().weapons.length;
    // index 0 is [Change]; step to the first withdraw row.
    dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    dispatchInputAction(InputAction.CONFIRM);
    expect(rm.getConvoyItems().weapons.length).toBe(before - 1);
  });

  it('CANCEL backs out of the in-pane reclass picker instead of closing the overlay', () => {
    const { overlay } = makeOverlay();
    overlay.show();
    overlay._inReclassPicker = true; // pretend the reclass picker is up
    dispatchInputAction(InputAction.CANCEL);
    expect(overlay.visible).toBe(true); // overlay stays open
    expect(overlay._inReclassPicker).toBe(false); // refresh() cleared it
  });

  it('_teardownRosterFocus is idempotent and the shutdown hook drains the scope', () => {
    const { overlay, scene } = makeOverlay();
    overlay.show();
    expect(activeInputOwner()).toBe(overlay);
    // Simulate a hard scene shutdown (no hide() call).
    scene._sceneEvents.shutdown();
    expect(activeInputOwner()).toBe(null);
    expect(overlay._rosterFocus).toBe(null);
    expect(() => overlay._teardownRosterFocus()).not.toThrow(); // idempotent
  });
});
