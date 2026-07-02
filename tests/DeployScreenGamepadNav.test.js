import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { DeployScreenOverlay } from '../src/ui/DeployScreenOverlay.js';
import { InputAction } from '../src/utils/InputActions.js';
import { activeInputOwner, _resetInputFocus } from '../src/utils/inputFocus.js';

beforeEach(() => _resetInputFocus());

function makeObj(seed = {}) {
  const o = {
    visible: true,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    text: '',
    handlers: {},
    destroyed: false,
    ...seed,
  };
  const chain =
    (fn) =>
    (...a) => (fn?.(...a), o);
  o.setDepth = chain();
  o.setOrigin = chain();
  o.setStrokeStyle = chain();
  o.setSize = chain((w, h) => {
    if (w != null) o.width = w;
    if (h != null) o.height = h;
  });
  o.setPosition = chain((x, y) => {
    o.x = x;
    o.y = y;
  });
  o.setVisible = chain((v) => (o.visible = v));
  o.setColor = chain((c) => (o.color = c));
  o.setFillStyle = chain((c) => (o.fill = c));
  o.setText = chain((t) => {
    o.text = String(t);
    o.width = Math.max(1, o.text.length) * 6;
  });
  o.setInteractive = chain((opts) => (o.input = { enabled: true, _opts: opts }));
  o.disableInteractive = chain(() => (o.input = { enabled: false }));
  o.on = chain((e, cb) => (o.handlers[e] = cb));
  o.emit = (e, arg) => {
    o.handlers[e]?.(arg);
    return true;
  };
  o.getBounds = () => ({
    x: o.x,
    y: o.y,
    left: o.x,
    right: o.x + o.width,
    top: o.y,
    bottom: o.y + o.height,
    centerX: o.x,
    centerY: o.y,
    width: o.width,
    height: o.height,
  });
  o.destroy = () => (o.destroyed = true);
  o.input = null;
  return o;
}

function makeScene() {
  return {
    cameras: { main: { centerX: 320, centerY: 240, width: 640, height: 480 } },
    registry: { get: (k) => (k === 'audio' ? { playSFX: vi.fn() } : null) },
    add: {
      rectangle: (x, y, w, h) => makeObj({ kind: 'rect', x, y, width: w, height: h }),
      text: (x, y, content) => {
        const t = String(content ?? '');
        return makeObj({ kind: 'text', x, y, text: t, width: Math.max(1, t.length) * 6 });
      },
    },
    input: { on: vi.fn(), off: vi.fn() },
    battleParams: { objective: 'rout' },
    _pinToScreen: vi.fn(),
  };
}

function makeRoster(n) {
  return Array.from({ length: n }, (_, i) => ({
    name: `Unit${i}`,
    className: 'Soldier',
    level: 5,
    isCommander: i === 0,
    currentHP: 20,
    stats: { HP: 20, MOV: 5 },
  }));
}

function show(scene, roster, limits = { min: 1, max: 6 }, onConfirm = vi.fn()) {
  const overlay = new DeployScreenOverlay(scene, { getRoster: () => roster }, { classes: [] });
  scene._deployOverlay = overlay;
  overlay.show(roster, limits, onConfirm);
  return { overlay, onConfirm };
}

const route = (overlay, action, payload) => overlay._onInputActionBound(action, payload);
const navDown = (overlay, n) => {
  for (let i = 0; i < n; i++) route(overlay, InputAction.NAVIGATE, { dy: 1, dx: 0 });
};
const countChecked = (overlay) =>
  overlay.displayObjects.filter((o) => o.kind === 'text' && o.text === '[X]').length;

describe('DeployScreenOverlay gamepad navigation', () => {
  it('claims the input-focus stack and focuses the first row', () => {
    const scene = makeScene();
    const { overlay } = show(scene, makeRoster(5));
    expect(activeInputOwner()).toBe(overlay);
    expect(overlay._focus.index).toBe(0);
    // objects = 5 rows + Confirm/Back/Roster
    expect(overlay._focus.objects.length).toBe(8);
  });

  it('NAVIGATE moves focus and scrolls an off-screen row into view', () => {
    const scene = makeScene();
    const { overlay } = show(scene, makeRoster(14)); // > maxVisibleRows (9)
    const deepRow = overlay._focus.objects[12]; // row index 12, initially off-screen
    expect(deepRow.visible).toBe(false);

    navDown(overlay, 12);
    expect(overlay._focus.index).toBe(12);
    expect(overlay._focus.current()).toBe(deepRow);
    expect(deepRow.visible).toBe(true); // scrolled into view
  });

  it('CONFIRM on a non-commander row toggles its selection', () => {
    const scene = makeScene();
    const { overlay } = show(scene, makeRoster(5));
    const before = countChecked(overlay); // commander auto-selected -> 1
    navDown(overlay, 1); // focus row 1 (not the commander)
    route(overlay, InputAction.CONFIRM);
    expect(countChecked(overlay)).toBe(before + 1);
    route(overlay, InputAction.CONFIRM); // toggle back off
    expect(countChecked(overlay)).toBe(before);
  });

  it('CONFIRM on the commander row is a safe no-op (locked)', () => {
    const scene = makeScene();
    const { overlay } = show(scene, makeRoster(5));
    const before = countChecked(overlay);
    route(overlay, InputAction.CONFIRM); // index 0 = commander, no handler
    expect(countChecked(overlay)).toBe(before);
  });

  it('CONFIRM on the footer Confirm button finalizes deployment', () => {
    const scene = makeScene();
    const roster = makeRoster(5);
    const { overlay, onConfirm } = show(scene, roster);
    navDown(overlay, 5); // step onto Confirm (index === roster.length)
    expect(overlay._focus.index).toBe(5);
    route(overlay, InputAction.CONFIRM);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const selected = onConfirm.mock.calls[0][0];
    expect(selected).toContain(roster[0]); // commander always deploys
  });

  it('_cleanup releases the input-focus scope', () => {
    const scene = makeScene();
    const { overlay } = show(scene, makeRoster(5));
    expect(activeInputOwner()).toBe(overlay);
    overlay._cleanup();
    expect(activeInputOwner()).toBe(null);
    expect(overlay._focus).toBe(null);
  });
});
