import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { ChurchController } from '../src/ui/ChurchController.js';
import { InputAction } from '../src/utils/InputActions.js';
import { activeInputOwner, _resetInputFocus } from '../src/utils/inputFocus.js';

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

function fixedButton(fired, name) {
  const b = makeObj({ name });
  b.on('pointerdown', () => fired.push(name));
  return b;
}

function makeScene(over = {}) {
  return {
    add: { rectangle: () => makeObj({ kind: 'ring' }) },
    churchOverlay: [{}],
    churchContentGroup: [],
    _churchScrollItems: [],
    churchScrollOffset: 0,
    churchScrollMax: 0,
    _churchViewingMap: false,
    _churchViewingRoster: false,
    drawChurchScrollContent: vi.fn(),
    requestCancel: vi.fn(),
    _exitChurchMapView: vi.fn(),
    ...over,
  };
}

function setupController(scene, fired) {
  const ctrl = new ChurchController(scene);
  ctrl._churchFixed = {
    heal: fixedButton(fired, 'heal'),
    viewMap: fixedButton(fired, 'viewMap'),
    roster: fixedButton(fired, 'roster'),
    leave: fixedButton(fired, 'leave'),
  };
  ctrl._setupChurchFocus();
  return ctrl;
}

describe('ChurchController gamepad focus', () => {
  it('builds the slot list (Heal + content rows + View Map/Roster/Leave) and claims the stack', () => {
    const scene = makeScene({
      _churchScrollItems: [
        { type: 'label', y: 0 },
        { type: 'revive', y: 25 },
        { type: 'promote', y: 55 },
      ],
    });
    const ctrl = setupController(scene, []);
    // heal + 2 content + viewMap + roster + leave = 6
    expect(ctrl._churchSlots.map((s) => s.kind)).toEqual([
      'fixed',
      'content',
      'content',
      'fixed',
      'fixed',
      'fixed',
    ]);
    expect(activeInputOwner()).toBe(ctrl);
  });

  it('includes Browse Wares as a fixed ruins hub slot', () => {
    const fired = [];
    const scene = makeScene();
    const ctrl = new ChurchController(scene);
    ctrl._churchFixed = {
      heal: fixedButton(fired, 'heal'),
      browse: fixedButton(fired, 'browse'),
      viewMap: fixedButton(fired, 'viewMap'),
      roster: fixedButton(fired, 'roster'),
      leave: fixedButton(fired, 'leave'),
    };
    ctrl._setupChurchFocus();

    expect(ctrl._churchSlots.map((slot) => slot.btn?.name)).toEqual([
      'heal',
      'browse',
      'viewMap',
      'roster',
      'leave',
    ]);
    ctrl._onChurchInput(InputAction.NAVIGATE, { dy: 1 });
    ctrl._onChurchInput(InputAction.CONFIRM);
    expect(fired).toEqual(['browse']);
  });

  it('NAVIGATE clamps within the slot list; CONFIRM activates the focused fixed button', () => {
    const fired = [];
    const ctrl = setupController(makeScene(), fired); // no content -> [heal, viewMap, roster, leave]
    expect(ctrl._churchFocusIndex).toBe(0);
    ctrl._onChurchInput(InputAction.NAVIGATE, { dy: -1 }); // already at top -> clamps
    expect(ctrl._churchFocusIndex).toBe(0);
    ctrl._onChurchInput(InputAction.CONFIRM); // heal
    expect(fired).toEqual(['heal']);

    ctrl._onChurchInput(InputAction.NAVIGATE, { dy: 1 }); // viewMap
    ctrl._onChurchInput(InputAction.CONFIRM);
    expect(fired).toEqual(['heal', 'viewMap']);
  });

  it('CANCEL routes through requestCancel; ROSTER triggers the Roster button', () => {
    const fired = [];
    const scene = makeScene();
    const ctrl = setupController(scene, fired);
    ctrl._onChurchInput(InputAction.CANCEL);
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);
    ctrl._onChurchInput(InputAction.ROSTER);
    expect(fired).toEqual(['roster']);
  });

  it('activates a scrolled-in content row by its rendered button', () => {
    const scene = makeScene({
      _churchScrollItems: [{ type: 'promote', y: 0 }],
    });
    const fired = [];
    const ctrl = setupController(scene, fired);
    // Simulate the rendered button for item 0.
    const promoteBtn = makeObj();
    promoteBtn._churchItemIndex = 0;
    promoteBtn.on('pointerdown', () => fired.push('promote0'));
    scene.churchContentGroup = [promoteBtn];

    ctrl._churchFocusIndex = 1; // the content slot
    ctrl._onChurchInput(InputAction.CONFIRM);
    expect(fired).toEqual(['promote0']);
  });

  it('map-view: CONFIRM/CANCEL return to the church, NAVIGATE is ignored', () => {
    const scene = makeScene({ _churchViewingMap: true });
    const ctrl = setupController(scene, []);
    ctrl._onChurchInput(InputAction.NAVIGATE, { dy: 1 });
    expect(scene._exitChurchMapView).not.toHaveBeenCalled();
    ctrl._onChurchInput(InputAction.CONFIRM);
    expect(scene._exitChurchMapView).toHaveBeenCalledTimes(1);
  });

  it('roster sub-view: only CANCEL acts (closes via requestCancel)', () => {
    const fired = [];
    const scene = makeScene({ _churchViewingRoster: true });
    const ctrl = setupController(scene, fired);
    ctrl._onChurchInput(InputAction.CONFIRM);
    ctrl._onChurchInput(InputAction.NAVIGATE, { dy: 1 });
    expect(fired).toEqual([]); // inert
    ctrl._onChurchInput(InputAction.CANCEL);
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);
  });

  it('_scrollChurchItemIntoView scrolls an item below the fold into view', () => {
    const scene = makeScene({
      _churchScrollItems: [{ type: 'promote', y: 400 }],
      churchScrollMax: 500,
    });
    const ctrl = setupController(scene, []);
    scene.drawChurchScrollContent.mockClear();
    ctrl._scrollChurchItemIntoView(0);
    expect(scene.churchScrollOffset).toBeGreaterThan(0);
    expect(scene.drawChurchScrollContent).toHaveBeenCalled();
  });

  it('_teardownChurchFocus releases the scope', () => {
    const ctrl = setupController(makeScene(), []);
    expect(activeInputOwner()).toBe(ctrl);
    ctrl._teardownChurchFocus();
    expect(activeInputOwner()).toBe(null);
    expect(ctrl._churchFocus).toBe(null);
  });
});
