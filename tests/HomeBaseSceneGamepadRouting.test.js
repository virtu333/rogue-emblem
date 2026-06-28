import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.min(max, Math.max(min, v)) },
  },
}));

import { HomeBaseScene } from '../src/scenes/HomeBaseScene.js';
import { InputAction } from '../src/utils/InputActions.js';

function makeScene(overrides = {}) {
  const s = new HomeBaseScene();
  return Object.assign(s, {
    _homeFocus: { move: vi.fn(), activate: vi.fn() },
    requestCancel: vi.fn(),
    drawUI: vi.fn(),
    _hideMetaTooltips: vi.fn(),
    activeTab: 'recruit_stats',
    tabScrollOffsets: {},
    ...overrides,
  });
}

describe('HomeBaseScene gamepad routing', () => {
  it('NAVIGATE drives focus; CONFIRM activates', () => {
    const s = makeScene();
    s._onInputAction(InputAction.NAVIGATE, { dy: 1, dx: 0 });
    expect(s._homeFocus.move).toHaveBeenCalledWith(1);
    s._onInputAction(InputAction.NAVIGATE, { dy: 0, dx: -1 });
    expect(s._homeFocus.move).toHaveBeenCalledWith(-1);
    s._onInputAction(InputAction.CONFIRM);
    expect(s._homeFocus.activate).toHaveBeenCalledTimes(1);
  });

  it('CANCEL/PAUSE cascade through requestCancel', () => {
    const s = makeScene();
    s._onInputAction(InputAction.CANCEL);
    s._onInputAction(InputAction.PAUSE);
    expect(s.requestCancel).toHaveBeenCalledTimes(2);
    expect(s.requestCancel).toHaveBeenCalledWith({ allowExit: true });
  });

  it('L1/R1 cycle tabs, but not while a picker modal is open', () => {
    const s = makeScene();
    s._onInputAction(InputAction.NEXT_UNIT); // recruit_stats -> lord_bonuses
    expect(s.activeTab).toBe('lord_bonuses');
    expect(s.drawUI).toHaveBeenCalled();
    s._onInputAction(InputAction.PREV_UNIT); // back to recruit_stats
    expect(s.activeTab).toBe('recruit_stats');

    s.drawUI.mockClear();
    s._commanderPickerObjects = [{}];
    s._onInputAction(InputAction.NEXT_UNIT);
    expect(s.activeTab).toBe('recruit_stats'); // unchanged while picker open
    expect(s.drawUI).not.toHaveBeenCalled();
  });

  it('_cycleTab wraps around the 6 categories', () => {
    const s = makeScene({ activeTab: 'starting_skills' }); // last
    s._cycleTab(1);
    expect(s.activeTab).toBe('recruit_stats'); // wrapped to first
    s._cycleTab(-1);
    expect(s.activeTab).toBe('starting_skills');
  });
});

describe('HomeBaseScene _refreshHomeFocus focusable collection', () => {
  const handBtn = (y) => ({
    y,
    x: 0,
    input: { enabled: true, cursor: 'pointer' },
    listenerCount: () => 1,
  });
  const infoLabel = (y) => ({
    y,
    x: 0,
    input: { enabled: true, cursor: undefined }, // no hand cursor
    listenerCount: () => 1,
  });

  it('collects only hand-cursor + pointerdown objects, in reading order', () => {
    const setObjects = vi.fn();
    const b1 = handBtn(50);
    const b2 = handBtn(10);
    const label = infoLabel(30);
    const s = makeScene({
      _homeFocus: { setObjects },
      children: { list: [b1, label, b2] },
    });
    s._refreshHomeFocus();
    const passed = setObjects.mock.calls[0][0];
    expect(passed).toEqual([b2, b1]); // sorted by y, label excluded
  });

  it('restricts to live picker objects while a modal is open', () => {
    const setObjects = vi.fn();
    const pickerBtn = { ...handBtn(100), scene: {} };
    const baseBtn = { ...handBtn(10), scene: {} };
    const s = makeScene({
      _homeFocus: { setObjects },
      children: { list: [baseBtn] },
      _commanderPickerObjects: [pickerBtn],
    });
    s._refreshHomeFocus();
    expect(setObjects.mock.calls[0][0]).toEqual([pickerBtn]); // base excluded
  });

  it('no-ops during shutdown', () => {
    const setObjects = vi.fn();
    const s = makeScene({ _homeFocus: { setObjects }, _sceneShuttingDown: true });
    s._refreshHomeFocus();
    expect(setObjects).not.toHaveBeenCalled();
  });
});
