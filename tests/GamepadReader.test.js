import { describe, it, expect } from 'vitest';
import { GamepadReader } from '../src/utils/GamepadReader.js';
import { InputAction } from '../src/utils/InputActions.js';

const BTN = { A: 0, B: 1, X: 2, Y: 3, L1: 4, R1: 5, L2: 6, START: 9 };
const DPAD = { UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

function makePad(overrides = {}) {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  return { connected: true, mapping: 'standard', buttons, axes: [0, 0, 0, 0], ...overrides };
}
function setButton(pad, index, value) {
  pad.buttons[index] = { pressed: value >= 0.5, value };
}

// `getPad` is a closure so tests can swap/disconnect the pad between polls.
function makeReader(getPad, config) {
  const events = [];
  const reader = new GamepadReader({
    getPads: () => {
      const pad = getPad();
      return pad ? [pad] : [];
    },
    dispatch: (action, payload) => events.push({ action, ...(payload || {}) }),
    config,
  });
  const countOf = (action) => events.filter((e) => e.action === action).length;
  const navs = () => events.filter((e) => e.action === InputAction.NAVIGATE);
  return { reader, events, countOf, navs };
}

describe('GamepadReader — button edge detection', () => {
  it('emits CONFIRM once per press, not every frame while held', () => {
    const pad = makePad();
    const { reader, countOf } = makeReader(() => pad);
    reader.poll(0); // nothing pressed
    setButton(pad, BTN.A, 1);
    reader.poll(16);
    reader.poll(32); // still held
    reader.poll(48);
    expect(countOf(InputAction.CONFIRM)).toBe(1);
  });

  it('re-emits after release and re-press', () => {
    const pad = makePad();
    const { reader, countOf } = makeReader(() => pad);
    setButton(pad, BTN.A, 1);
    reader.poll(0);
    setButton(pad, BTN.A, 0);
    reader.poll(16);
    setButton(pad, BTN.A, 1);
    reader.poll(32);
    expect(countOf(InputAction.CONFIRM)).toBe(2);
  });

  it('maps the standard face/shoulder/start buttons to their actions', () => {
    const pad = makePad();
    const { reader, events } = makeReader(() => pad);
    setButton(pad, BTN.B, 1);
    setButton(pad, BTN.X, 1);
    setButton(pad, BTN.Y, 1);
    setButton(pad, BTN.L1, 1);
    setButton(pad, BTN.R1, 1);
    setButton(pad, BTN.START, 1);
    reader.poll(0);
    const fired = events.map((e) => e.action);
    expect(fired).toEqual(
      expect.arrayContaining([
        InputAction.CANCEL,
        InputAction.DANGER,
        InputAction.ROSTER,
        InputAction.PREV_UNIT,
        InputAction.NEXT_UNIT,
        InputAction.PAUSE,
      ]),
    );
  });
});

describe('GamepadReader — analog triggers are buttons, judged by value', () => {
  it('does not fire below threshold and fires above it even when .pressed is false', () => {
    const pad = makePad();
    const { reader, countOf } = makeReader(() => pad);
    pad.buttons[BTN.L2] = { pressed: false, value: 0.3 };
    reader.poll(0);
    expect(countOf(InputAction.INSPECT)).toBe(0);
    pad.buttons[BTN.L2] = { pressed: false, value: 0.7 };
    reader.poll(16);
    expect(countOf(InputAction.INSPECT)).toBe(1);
  });
});

describe('GamepadReader — navigation DAS/ARR', () => {
  it('fires immediately, waits DAS, then repeats at ARR', () => {
    const pad = makePad();
    const { reader, navs } = makeReader(() => pad, { dasMs: 250, arrMs: 85 });
    setButton(pad, DPAD.RIGHT, 1);
    reader.poll(0); // immediate
    reader.poll(100); // < DAS, no repeat
    reader.poll(260); // >= 250, repeat
    reader.poll(300); // < 260+85, no repeat
    reader.poll(350); // >= 345, repeat
    const n = navs();
    expect(n.length).toBe(3);
    expect(n[0]).toMatchObject({ dx: 1, dy: 0 });
  });

  it('re-fires immediately on direction change', () => {
    const pad = makePad();
    const { reader, navs } = makeReader(() => pad);
    setButton(pad, DPAD.RIGHT, 1);
    reader.poll(0);
    setButton(pad, DPAD.RIGHT, 0);
    setButton(pad, DPAD.DOWN, 1);
    reader.poll(50); // well within DAS, but direction changed -> immediate
    const n = navs();
    expect(n.length).toBe(2);
    expect(n[1]).toMatchObject({ dx: 0, dy: 1 });
  });

  it('reads the left stick past the deadzone when the d-pad is neutral', () => {
    const pad = makePad();
    const { reader, navs } = makeReader(() => pad, { deadzone: 0.5 });
    pad.axes = [-0.8, 0, 0, 0]; // left stick hard left
    reader.poll(0);
    expect(navs()[0]).toMatchObject({ dx: -1, dy: 0 });
  });

  it('ignores stick movement inside the deadzone', () => {
    const pad = makePad();
    const { reader, navs } = makeReader(() => pad, { deadzone: 0.5 });
    pad.axes = [0.3, -0.2, 0, 0];
    reader.poll(0);
    expect(navs().length).toBe(0);
  });

  it('resets on release so the next press fires immediately', () => {
    const pad = makePad();
    const { reader, navs } = makeReader(() => pad);
    setButton(pad, DPAD.RIGHT, 1);
    reader.poll(0);
    setButton(pad, DPAD.RIGHT, 0);
    reader.poll(20); // neutral -> reset
    setButton(pad, DPAD.RIGHT, 1);
    reader.poll(40); // fresh press -> immediate
    expect(navs().length).toBe(2);
  });
});

describe('GamepadReader — connection robustness', () => {
  it('reads a controller at a non-zero slot index', () => {
    const pad = makePad();
    const events = [];
    const reader = new GamepadReader({
      getPads: () => [null, pad],
      dispatch: (action, payload) => events.push({ action, ...(payload || {}) }),
    });
    setButton(pad, BTN.A, 1);
    reader.poll(0);
    expect(events.map((e) => e.action)).toContain(InputAction.CONFIRM);
  });

  it('handles disconnect then re-connect with a clean edge (no stuck press)', () => {
    let pad = makePad();
    const { reader, countOf } = makeReader(() => pad);
    setButton(pad, BTN.A, 1);
    reader.poll(0); // CONFIRM #1
    pad = null; // unplugged
    reader.poll(16);
    pad = makePad(); // replugged, A held again
    setButton(pad, BTN.A, 1);
    reader.poll(32); // fresh edge -> CONFIRM #2
    expect(countOf(InputAction.CONFIRM)).toBe(2);
  });

  it('ignores non-standard-mapping controllers in v1', () => {
    const pad = makePad({ mapping: '' });
    const { reader, events } = makeReader(() => pad);
    setButton(pad, BTN.A, 1);
    reader.poll(0);
    expect(events).toHaveLength(0);
  });

  it('does nothing when no pad is present', () => {
    const { reader, events } = makeReader(() => null);
    reader.poll(0);
    reader.poll(16);
    expect(events).toHaveLength(0);
  });
});
