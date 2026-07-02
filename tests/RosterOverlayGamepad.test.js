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
  pushInputScope,
  popInputScope,
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

  it('CONFIRM on the focused [Trade] button opens the trade picker and paints the modal ring', () => {
    const { overlay } = makeOverlay({ rosterCount: 3 });
    overlay.show();
    expect(overlay.tradeObjects.length).toBe(0);
    dispatchInputAction(InputAction.CONFIRM); // Stats tab: only action is [Trade]
    expect(overlay.tradeObjects.length).toBeGreaterThan(0); // picker opened
    expect(overlay._modalWasOpen).toBe(true);
    // The post-action re-check renders the modal ring immediately on open: it must
    // already point at a live picker button (not stay on the base detail button).
    expect(overlay._collectModalButtons()).toContain(overlay._rosterFocus.objects[0]);
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
  it('opening the accessory picker from the Gear tab switches to modal mode; CANCEL closes it and restores the base ring', () => {
    const { overlay, rm } = makeOverlay({ rosterCount: 3, accessories: true });
    const unit = rm.roster[0];
    unit.inventory = []; // no weapon [Equip]/[Store] -> the only [Equip] is the accessory one
    unit.consumables = [];
    unit.accessory = null; // -> the Gear tab shows the accessory [Equip]
    overlay.show();
    dispatchInputAction(InputAction.NAVIGATE, { dx: 1 }); // -> Gear tab

    // Focus the accessory [Equip] slot deterministically (no ambiguity now).
    const idx = overlay._detailSlots.findIndex((s) => s.btn && /Equip/.test(s.btn.text));
    expect(idx).toBeGreaterThanOrEqual(0);
    overlay._detailFocusIndex = idx;
    overlay._renderRosterFocus();

    dispatchInputAction(InputAction.CONFIRM); // opens _showAccessoryPicker
    expect(overlay.tradeObjects.length).toBeGreaterThan(0);
    expect(overlay._modalWasOpen).toBe(true);
    expect(overlay._collectModalButtons()).toContain(overlay._rosterFocus.objects[0]);

    dispatchInputAction(InputAction.CANCEL); // close the picker
    expect(overlay.tradeObjects.length).toBe(0);
    expect(overlay._modalWasOpen).toBe(false);
    expect(overlay.visible).toBe(true); // overlay itself stays open
  });

  it('paging a picker (Next/Prev) resets the modal ring to the first item, not Cancel', () => {
    const { overlay, rm } = makeOverlay({ rosterCount: 3 });
    // 9 accessories at ACCESSORY_PICKER_MAX_ROWS=8 -> 2 pages (page 0 has a Next btn).
    rm.accessories = gameData.accessories.slice(0, 9).map((a) => structuredClone(a));
    overlay.show();
    overlay._showAccessoryPicker(rm.roster[0]);
    dispatchInputAction(InputAction.NAVIGATE, { dy: 0 }); // enter modal mode

    const page0 = overlay._collectModalButtons();
    const nextIdx = page0.findIndex((b) => b.text === 'Next');
    expect(nextIdx).toBeGreaterThan(0); // [8 items..., Next, Cancel]
    for (let i = 0; i < nextIdx; i++) dispatchInputAction(InputAction.NAVIGATE, { dy: 1 });
    expect(overlay._modalFocusIndex).toBe(nextIdx); // ring on Next

    dispatchInputAction(InputAction.CONFIRM); // page -> 2; rebuilds with fewer buttons
    // The stale index would clamp onto Cancel/Prev; the fix snaps it back to item 0.
    expect(overlay._modalFocusIndex).toBe(0);
    const ringed = overlay._rosterFocus.objects[0];
    expect(overlay._collectModalButtons()).toContain(ringed);
    expect(['Cancel', 'Prev', 'Next']).not.toContain(ringed.text); // a real item, not nav/cancel
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

  it('cycling units clears a stale reclass-picker flag so CANCEL still closes the overlay', () => {
    // Regression: leaving the in-pane reclass picker via L1/R1 (or any select())
    // must clear _inReclassPicker, else the next CANCEL refreshes instead of closing.
    const { overlay } = makeOverlay({ rosterCount: 3 });
    overlay.show();
    overlay._inReclassPicker = true; // as if the picker were open on this unit
    dispatchInputAction(InputAction.NEXT_UNIT); // cycle -> drawUnitDetails clears the flag
    expect(overlay._inReclassPicker).toBe(false);
    dispatchInputAction(InputAction.CANCEL); // now genuinely closes (not a no-op refresh)
    expect(overlay.visible).toBe(false);
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

describe('RosterOverlay gamepad focus — nested over a parent scope (church/shop sub-view)', () => {
  it('opening over a parent covers it (onTopChange false) and closing re-exposes it exactly once', () => {
    // The load-bearing pattern every opener reuses: church/shop push a scope whose
    // onTopChange hides/restores their ring; RosterOverlay.show() must nest ON TOP
    // and hide()/CANCEL must pop back, firing the parent's onTopChange exactly once
    // each way. (ShopController/ChurchController register exactly this shape.)
    const cover = [];
    const parent = {};
    pushInputScope(
      parent,
      () => {},
      (isTop) => cover.push(isTop),
    );
    expect(activeInputOwner()).toBe(parent);
    cover.length = 0; // ignore the parent's own gain-top (true) notification

    const { overlay } = makeOverlay({ rosterCount: 2 });
    overlay.show(); // roster scope pushed above the parent
    expect(activeInputOwner()).toBe(overlay);
    expect(cover).toEqual([false]); // parent covered -> its ring would hide

    dispatchInputAction(InputAction.CANCEL); // roster CANCEL -> hide() -> pop
    expect(activeInputOwner()).toBe(parent); // control restored to the parent
    expect(cover).toEqual([false, true]); // re-exposed exactly once -> ring restores
    popInputScope(parent);
  });
});
