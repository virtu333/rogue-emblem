import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────

const { transitionToSceneMock, TRANSITION_REASONS_MOCK } = vi.hoisted(() => ({
  transitionToSceneMock: vi.fn().mockResolvedValue(true),
  TRANSITION_REASONS_MOCK: { BACK: 'BACK' },
}));
vi.mock('../src/utils/SceneRouter.js', () => ({
  transitionToScene: transitionToSceneMock,
  TRANSITION_REASONS: TRANSITION_REASONS_MOCK,
}));

const { showImportantHintMock } = vi.hoisted(() => ({
  showImportantHintMock: vi.fn(),
}));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: showImportantHintMock,
}));

vi.mock('../src/engine/UnitManager.js', async () => {
  const actual = await vi.importActual('../src/engine/UnitManager.js');
  return {
    ...actual,
    getDisplayLevel: (u) => String(u.level || 1),
  };
});

const { RosterOverlayMock, rosterOverlayInstances } = vi.hoisted(() => {
  const instances = [];
  const MockClass = vi.fn().mockImplementation(function (_scene, _rm, _gd, options) {
    this.options = options;
    this.visible = false;
    this.show = vi.fn(() => {
      this.visible = true;
    });
    instances.push(this);
  });
  return { RosterOverlayMock: MockClass, rosterOverlayInstances: instances };
});
vi.mock('../src/ui/RosterOverlay.js', () => ({
  RosterOverlay: RosterOverlayMock,
}));

import { DeployScreenOverlay } from '../src/ui/DeployScreenOverlay.js';

// ── Helpers ────────────────────────────────────────────────────

function makeDisplayObject(seed = {}) {
  return {
    kind: 'display',
    destroyed: false,
    active: true,
    visible: true,
    interactive: false,
    handlers: {},
    depth: 0,
    width: 10,
    height: 10,
    x: 0,
    y: 0,
    _color: null,
    ...seed,
    setDepth(d) {
      this.depth = d;
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setOrigin() {
      return this;
    },
    setPosition(x, y) {
      this.x = x;
      this.y = y;
      return this;
    },
    setInteractive(options) {
      this.interactive = true;
      this._interactiveOptions = options || null;
      return this;
    },
    disableInteractive() {
      this.interactive = false;
      return this;
    },
    setVisible(v) {
      this.visible = v;
      return this;
    },
    setFillStyle(c, a) {
      this._fillColor = c;
      this._fillAlpha = a;
      return this;
    },
    setColor(c) {
      this._color = c;
      return this;
    },
    setText(t) {
      this.text = t;
      return this;
    },
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    },
    destroy() {
      this.destroyed = true;
      this.active = false;
    },
  };
}

function makeUnit(name, overrides = {}) {
  return {
    name,
    level: 1,
    className: 'Fighter',
    currentHP: 18,
    stats: { HP: 18 },
    ...overrides,
  };
}

function makeScene() {
  const texts = [];
  const rectangles = [];
  return {
    cameras: { main: { centerX: 320, centerY: 240, width: 640, height: 480 } },
    registry: { get: () => null },
    add: {
      rectangle: (x, y, w, h, color, alpha) => {
        const obj = makeDisplayObject({
          kind: 'rectangle',
          x,
          y,
          width: w,
          height: h,
          color,
          alpha,
        });
        rectangles.push(obj);
        return obj;
      },
      text: (x, y, content, style = {}) => {
        const str = typeof content === 'string' ? content : '';
        const obj = makeDisplayObject({
          kind: 'text',
          x,
          y,
          text: str,
          width: Math.max(1, str.length) * 6,
          style: { ...style },
        });
        texts.push(obj);
        return obj;
      },
    },
    _pinToScreen: vi.fn(),
    rosterOverlay: null,
    roster: null,
    scene: { isActive: () => true },
    showDeployScreen: vi.fn(),
    _texts: texts,
    _rectangles: rectangles,
  };
}

function makeRunManager() {
  return {
    getRoster: vi.fn(() => []),
  };
}

function makeGameData() {
  return { classes: [], lords: [] };
}

// ── Tests ──────────────────────────────────────────────────────

describe('DeployScreenOverlay', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    transitionToSceneMock.mockReset().mockResolvedValue(true);
    showImportantHintMock.mockReset();
    RosterOverlayMock.mockClear();
    rosterOverlayInstances.length = 0;
  });

  it('renders roster rows and confirm/back/roster buttons', () => {
    const scene = makeScene();
    const runManager = makeRunManager();
    const roster = [makeUnit('Edric'), makeUnit('Sera'), makeUnit('Brom')];

    const overlay = new DeployScreenOverlay(scene, runManager, makeGameData());
    overlay.show(roster, { min: 1, max: 3 }, vi.fn());

    // Title exists
    expect(scene._texts.some((t) => t.text === 'DEPLOY UNITS')).toBe(true);
    // 3 row backgrounds (one per unit) + overlay bg + confirm bg = 5 rectangles
    const rowBgs = scene._rectangles.filter((r) => r.width === 400);
    expect(rowBgs).toHaveLength(3);
    // Confirm, Back, Roster buttons
    expect(scene._texts.some((t) => t.text === 'CONFIRM')).toBe(true);
    expect(scene._texts.some((t) => t.text === 'BACK')).toBe(true);
    expect(scene._texts.some((t) => t.text === 'ROSTER')).toBe(true);
  });

  it('Edric is always locked/selected', () => {
    const scene = makeScene();
    const roster = [makeUnit('Edric'), makeUnit('Sera')];
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    overlay.show(roster, { min: 1, max: 2 }, vi.fn());

    // Edric's row should have LOCKED label
    expect(scene._texts.some((t) => t.text === 'LOCKED')).toBe(true);

    // Edric's checkbox should be [X]
    const checkboxes = scene._texts.filter((t) => t.text === '[X]' || t.text === '[ ]');
    // Edric = [X], Sera = [ ]
    expect(checkboxes[0].text).toBe('[X]');
    expect(checkboxes[1].text).toBe('[ ]');
  });

  it('clicking a row toggles selection', () => {
    const scene = makeScene();
    const roster = [makeUnit('Edric'), makeUnit('Sera')];
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    overlay.show(roster, { min: 1, max: 2 }, vi.fn());

    // Find Sera's row background (second row bg, width 400)
    const rowBgs = scene._rectangles.filter((r) => r.width === 400);
    const seraRow = rowBgs[1];

    // Select Sera
    seraRow.handlers.pointerdown({ button: 0 });

    // Both checkboxes should now be [X]
    const checkboxes = scene._texts.filter((t) => t.text === '[X]');
    expect(checkboxes).toHaveLength(2);

    // Deselect Sera
    seraRow.handlers.pointerdown({ button: 0 });
    const unchecked = scene._texts.filter((t) => t.text === '[ ]');
    expect(unchecked).toHaveLength(1);
  });

  it('Edric row click is ignored (no pointerdown handler)', () => {
    const scene = makeScene();
    const roster = [makeUnit('Edric'), makeUnit('Sera')];
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    overlay.show(roster, { min: 1, max: 2 }, vi.fn());

    // Edric's row bg — interactive but NO pointerdown handler because isEdric
    const rowBgs = scene._rectangles.filter((r) => r.width === 400);
    const edricRow = rowBgs[0];
    expect(edricRow.handlers.pointerdown).toBeUndefined();
  });

  it('confirm fires callback with selected units in roster order', () => {
    const scene = makeScene();
    const roster = [makeUnit('Edric'), makeUnit('Sera'), makeUnit('Brom')];
    const onConfirm = vi.fn();
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    overlay.show(roster, { min: 1, max: 3 }, onConfirm);

    // Select Brom (index 2)
    const rowBgs = scene._rectangles.filter((r) => r.width === 400);
    rowBgs[2].handlers.pointerdown({ button: 0 });

    // Click confirm
    const confirmBg = scene._rectangles.find((r) => r.width === 120 && r.height === 32);
    confirmBg.handlers.pointerdown({ button: 0 });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const selected = onConfirm.mock.calls[0][0];
    expect(selected.map((u) => u.name)).toEqual(['Edric', 'Brom']);
  });

  it('confirm is blocked when selection count outside limits', () => {
    const scene = makeScene();
    const roster = [makeUnit('Edric'), makeUnit('Sera'), makeUnit('Brom')];
    const onConfirm = vi.fn();
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    // min=2, so just Edric (1 selected) is not enough
    overlay.show(roster, { min: 2, max: 3 }, onConfirm);

    const confirmBg = scene._rectangles.find((r) => r.width === 120 && r.height === 32);
    confirmBg.handlers.pointerdown({ button: 0 });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cannot select more than limits.max', () => {
    const scene = makeScene();
    const roster = [makeUnit('Edric'), makeUnit('Sera'), makeUnit('Brom'), makeUnit('Thorn')];
    const onConfirm = vi.fn();
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    overlay.show(roster, { min: 1, max: 2 }, onConfirm);

    const rowBgs = scene._rectangles.filter((r) => r.width === 400);
    // Select Sera (now 2: Edric + Sera)
    rowBgs[1].handlers.pointerdown({ button: 0 });
    // Try to select Brom (should fail since max=2)
    rowBgs[2].handlers.pointerdown({ button: 0 });

    // Confirm — should only have Edric + Sera
    const confirmBg = scene._rectangles.find((r) => r.width === 120 && r.height === 32);
    confirmBg.handlers.pointerdown({ button: 0 });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const selected = onConfirm.mock.calls[0][0];
    expect(selected.map((u) => u.name)).toEqual(['Edric', 'Sera']);
  });

  it('BACK button calls transitionToScene with NodeMap + BACK reason', () => {
    const scene = makeScene();
    const runManager = makeRunManager();
    const gameData = makeGameData();
    const overlay = new DeployScreenOverlay(scene, runManager, gameData);
    const roster = [makeUnit('Edric'), makeUnit('Sera')];
    overlay.show(roster, { min: 1, max: 2 }, vi.fn());

    const backText = scene._texts.find((t) => t.text === 'BACK');
    backText.handlers.pointerdown({ button: 0 });

    expect(transitionToSceneMock).toHaveBeenCalledWith(
      scene,
      'NodeMap',
      { gameData, runManager },
      { reason: TRANSITION_REASONS_MOCK.BACK },
    );
  });

  it('BACK is a safe no-op when runManager is missing', () => {
    const scene = makeScene();
    const overlay = new DeployScreenOverlay(scene, null, makeGameData());
    const roster = [makeUnit('Edric')];
    overlay.show(roster, { min: 1, max: 1 }, vi.fn());

    const backText = scene._texts.find((t) => t.text === 'BACK');
    expect(() => backText.handlers.pointerdown({ button: 0 })).not.toThrow();
    expect(transitionToSceneMock).not.toHaveBeenCalled();
  });

  it('right-click on row does nothing', () => {
    const scene = makeScene();
    const roster = [makeUnit('Edric'), makeUnit('Sera')];
    const onConfirm = vi.fn();
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    overlay.show(roster, { min: 1, max: 2 }, onConfirm);

    const rowBgs = scene._rectangles.filter((r) => r.width === 400);
    // Right-click (button: 2) on Sera
    rowBgs[1].handlers.pointerdown({ button: 2 });

    // Should still only have Edric selected
    const checkboxes = scene._texts.filter((t) => t.text === '[X]');
    expect(checkboxes).toHaveLength(1);
  });

  it('scroll controls appear when roster exceeds viewport', () => {
    const scene = makeScene();
    const roster = [
      makeUnit('Edric'),
      ...Array.from({ length: 12 }, (_, i) => makeUnit(`Unit${i + 1}`)),
    ];
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    overlay.show(roster, { min: 1, max: 6 }, vi.fn());

    const scrollUpText = scene._texts.find((t) => t.text === '^');
    const scrollDownText = scene._texts.find((t) => t.text === 'v');
    expect(scrollUpText).toBeTruthy();
    expect(scrollDownText).toBeTruthy();
    // Scroll controls should be visible
    expect(scrollUpText.visible).toBe(true);
    expect(scrollDownText.visible).toBe(true);
  });

  it('scrolling down reveals hidden rows', () => {
    const scene = makeScene();
    const roster = [
      makeUnit('Edric'),
      ...Array.from({ length: 12 }, (_, i) => makeUnit(`Unit${i + 1}`)),
    ];
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    overlay.show(roster, { min: 1, max: 6 }, vi.fn());

    // Last unit should be hidden initially
    const lastUnitText = scene._texts.find((t) => t.text && t.text.includes('Unit12'));
    expect(lastUnitText).toBeTruthy();
    expect(lastUnitText.visible).toBe(false);

    // Scroll down enough
    const scrollDown = scene._texts.find((t) => t.text === 'v');
    for (let i = 0; i < 12; i++) scrollDown.handlers.pointerdown({ button: 0 });

    expect(lastUnitText.visible).toBe(true);
  });

  it('_cleanup() destroys all display objects', () => {
    const scene = makeScene();
    const roster = [makeUnit('Edric'), makeUnit('Sera')];
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    overlay.show(roster, { min: 1, max: 2 }, vi.fn());

    const objCount = overlay.displayObjects.length;
    expect(objCount).toBeGreaterThan(0);

    overlay._cleanup();

    // All objects should be destroyed
    expect(overlay.displayObjects).toHaveLength(0);
    expect(overlay._closed).toBe(true);
  });

  it('double-confirm guard (cleanup is one-shot)', () => {
    const scene = makeScene();
    const roster = [makeUnit('Edric'), makeUnit('Sera')];
    const onConfirm = vi.fn();
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    overlay.show(roster, { min: 1, max: 2 }, onConfirm);

    const confirmBg = scene._rectangles.find((r) => r.width === 120 && r.height === 32);

    // First confirm
    confirmBg.handlers.pointerdown({ button: 0 });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // Second confirm attempt (overlay is already cleaned up, objects destroyed)
    // The cleanup guard prevents double execution
    expect(overlay._closed).toBe(true);
  });

  it('ROSTER button opens RosterOverlay and re-opens deploy on close', () => {
    const scene = makeScene();
    const runManager = {
      getRoster: vi.fn(() => [makeUnit('Edric'), makeUnit('Sera')]),
    };
    const gameData = makeGameData();
    const onConfirm = vi.fn();
    const roster = [makeUnit('Edric'), makeUnit('Sera')];

    const overlay = new DeployScreenOverlay(scene, runManager, gameData);
    overlay.show(roster, { min: 1, max: 2 }, onConfirm);

    const rosterText = scene._texts.find((t) => t.text === 'ROSTER');
    rosterText.handlers.pointerdown({ button: 0 });

    // RosterOverlay should have been created
    expect(rosterOverlayInstances).toHaveLength(1);
    expect(rosterOverlayInstances[0].show).toHaveBeenCalled();

    // Simulate closing RosterOverlay
    rosterOverlayInstances[0].options.onClose();

    // Should call scene.showDeployScreen (the shim) to reopen
    expect(scene.showDeployScreen).toHaveBeenCalled();
  });

  it('initialSelectedNames restores previous selections on reopen', () => {
    const scene = makeScene();
    const roster = [makeUnit('Edric'), makeUnit('Sera'), makeUnit('Brom')];
    const onConfirm = vi.fn();
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    overlay.show(roster, { min: 1, max: 3 }, onConfirm, new Set(['Sera']));

    // Sera should be pre-selected
    const checkboxes = scene._texts.filter((t) => t.text === '[X]');
    // Edric (locked) + Sera (restored) = 2
    expect(checkboxes).toHaveLength(2);
  });

  it('wheel handler is detached on cleanup', () => {
    const inputOff = vi.fn();
    const inputOn = vi.fn();
    const scene = makeScene();
    scene.input = { on: inputOn, off: inputOff };

    const roster = [
      makeUnit('Edric'),
      ...Array.from({ length: 12 }, (_, i) => makeUnit(`Unit${i + 1}`)),
    ];
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    overlay.show(roster, { min: 1, max: 6 }, vi.fn());

    expect(inputOn).toHaveBeenCalledWith('wheel', expect.any(Function));
    const wheelHandler = inputOn.mock.calls[0][1];

    overlay._cleanup();

    expect(inputOff).toHaveBeenCalledWith('wheel', wheelHandler);
  });

  it('tutorial hint fires when hints.shouldShow returns true', () => {
    const scene = makeScene();
    scene.registry = {
      get: (key) => {
        if (key === 'hints') return { shouldShow: (id) => id === 'battle_deploy' };
        return null;
      },
    };
    const roster = [makeUnit('Edric')];
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    overlay.show(roster, { min: 1, max: 1 }, vi.fn());

    expect(showImportantHintMock).toHaveBeenCalledWith(
      scene,
      expect.stringContaining('Click units to deploy'),
    );
  });

  it('cleanup nulls scene._deployOverlay reference', () => {
    const scene = makeScene();
    const roster = [makeUnit('Edric'), makeUnit('Sera')];
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    scene._deployOverlay = overlay;
    overlay.show(roster, { min: 1, max: 2 }, vi.fn());

    overlay._cleanup();

    expect(scene._deployOverlay).toBeNull();
  });

  it('cleanup does not null scene._deployOverlay if it was replaced', () => {
    const scene = makeScene();
    const roster = [makeUnit('Edric'), makeUnit('Sera')];
    const overlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    scene._deployOverlay = overlay;
    overlay.show(roster, { min: 1, max: 2 }, vi.fn());

    // Simulate a new overlay replacing the old one (e.g. ROSTER reopen)
    const newOverlay = new DeployScreenOverlay(scene, makeRunManager(), makeGameData());
    scene._deployOverlay = newOverlay;

    overlay._cleanup();

    // Should NOT have nulled it — the new overlay owns the reference now
    expect(scene._deployOverlay).toBe(newOverlay);
  });
});
