import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateBossRecruitCandidatesMock } = vi.hoisted(() => ({
  generateBossRecruitCandidatesMock: vi.fn(),
}));

vi.mock('../src/engine/BossRecruitSystem.js', async () => {
  const actual = await vi.importActual('../src/engine/BossRecruitSystem.js');
  return {
    ...actual,
    generateBossRecruitCandidates: generateBossRecruitCandidatesMock,
  };
});

vi.mock('../src/utils/uiStyles.js', async () => {
  const actual = await vi.importActual('../src/utils/uiStyles.js');
  return {
    ...actual,
    applyTextResolution: (text) => text,
  };
});

vi.mock('../src/engine/UnitManager.js', async () => {
  const actual = await vi.importActual('../src/engine/UnitManager.js');
  return {
    ...actual,
    getDisplayLevel: (u) => String(u.level || 1),
  };
});

import { BossRecruitOverlay } from '../src/ui/BossRecruitOverlay.js';

// ── Mock helpers ────────────────────────────────────────────────

function makeDisplayObject(seed = {}) {
  return {
    kind: 'display',
    destroyed: false,
    active: true,
    visible: true,
    interactive: false,
    input: null,
    handlers: {},
    style: {},
    depth: 0,
    width: 10,
    height: 10,
    x: 0,
    y: 0,
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
    setAlpha(alpha) {
      this.alpha = alpha;
      return this;
    },
    setPosition(x, y) {
      this.x = x;
      this.y = y;
      return this;
    },
    setResolution() {
      return this;
    },
    setInteractive(options) {
      this.interactive = true;
      this._interactiveOptions = options || null;
      this.input = { enabled: true };
      return this;
    },
    on(event, cb) {
      if (!this.handlers) this.handlers = {};
      this.handlers[event] = cb;
      return this;
    },
    getBounds() {
      return {
        x: this.x,
        y: this.y,
        right: this.x + (this.width || 10),
        left: this.x,
        top: this.y,
        bottom: this.y + (this.height || 10),
        width: this.width || 10,
        height: this.height || 10,
      };
    },
    destroy() {
      this.destroyed = true;
      this.active = false;
      if (this.input) this.input.enabled = false;
    },
  };
}

function makeScene() {
  return {
    cameras: { main: { centerX: 320, centerY: 240, width: 640, height: 480 } },
    registry: { get: () => null },
    add: {
      rectangle: (x, y, w, h, color, alpha) =>
        makeDisplayObject({ kind: 'rectangle', x, y, width: w, height: h, color, alpha }),
      text: (x, y, content, style = {}) => {
        const str = typeof content === 'string' ? content : '';
        return makeDisplayObject({
          kind: 'text',
          x,
          y,
          text: str,
          width: Math.max(1, str.length) * 6,
          style: { ...style },
        });
      },
      container: (x, y, children = []) =>
        makeDisplayObject({ kind: 'container', x, y, list: children }),
    },
    time: {
      delayedCall: vi.fn((ms, cb) => ({ remove: vi.fn(), cb, ms })),
    },
    _pinToScreen: vi.fn(),
    _hideMenuTooltip: vi.fn(),
    _clearMenuTooltipTimer: vi.fn(),
    hideLootRoster: vi.fn(),
    _menuTooltip: null,
  };
}

function makeRunManager(overrides = {}) {
  return {
    currentAct: 'act1',
    roster: [],
    fallenUnits: [],
    getEffectiveMetaEffects: () => ({}),
    ...overrides,
  };
}

function makeCandidate(name, className, isLord = false) {
  return {
    unit: {
      name,
      className,
      level: 5,
      stats: { HP: 20, STR: 8, MAG: 3, SKL: 6, SPD: 7, DEF: 5, RES: 3, LCK: 4, MOV: 5 },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      consumables: [],
      weapons: [],
      faction: 'player',
    },
    isLord,
    className,
    displayName: name,
  };
}

function makeGameData() {
  return {
    classes: [{ name: 'Myrmidon', tier: 'base', description: 'A swift blade.' }],
    weapons: [],
    recruits: {},
    skills: [],
    lords: [],
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('BossRecruitOverlay', () => {
  let scene;
  let runManager;
  let gameData;
  let overlay;

  beforeEach(() => {
    scene = makeScene();
    runManager = makeRunManager();
    gameData = makeGameData();
    overlay = new BossRecruitOverlay(scene, runManager, gameData);
    generateBossRecruitCandidatesMock.mockReset();
  });

  it('renders candidate cards and skip button (displayObjects populated)', () => {
    const candidates = [
      makeCandidate('Arin', 'Myrmidon'),
      makeCandidate('Bran', 'Fighter'),
      makeCandidate('Cora', 'Archer'),
    ];
    generateBossRecruitCandidatesMock.mockReturnValue(candidates);

    const cb = vi.fn();
    overlay.show(cb);

    // Should have created display objects (dark overlay + title + subtitle + 3 cards + skip card + footer)
    expect(overlay.displayObjects.length).toBeGreaterThan(0);
    // Callback should not have been called yet (waiting for user selection)
    expect(cb).not.toHaveBeenCalled();
  });

  it('clicking a candidate card fires callback with that unit', () => {
    const candidates = [
      makeCandidate('Arin', 'Myrmidon'),
      makeCandidate('Bran', 'Fighter'),
      makeCandidate('Cora', 'Archer'),
    ];
    generateBossRecruitCandidatesMock.mockReturnValue(candidates);

    const cb = vi.fn();
    overlay.show(cb);

    // Find the first candidate card (a rectangle with pointerdown handler)
    const cards = overlay.displayObjects.filter(
      (obj) => obj.kind === 'rectangle' && obj.handlers?.pointerdown && obj.depth === 701,
    );
    // Should have 3 candidate cards + 1 skip card = 4 interactive rectangles at depth 701
    // (dark overlay is at depth 700)
    expect(cards.length).toBe(4);

    // Click the first candidate card (left mouse button)
    cards[0].handlers.pointerdown({ button: 0 });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(candidates[0].unit);
  });

  it('clicking skip fires callback with null', () => {
    const candidates = [
      makeCandidate('Arin', 'Myrmidon'),
      makeCandidate('Bran', 'Fighter'),
      makeCandidate('Cora', 'Archer'),
    ];
    generateBossRecruitCandidatesMock.mockReturnValue(candidates);

    const cb = vi.fn();
    overlay.show(cb);

    // Skip card is the last interactive rectangle at depth 701
    const cards = overlay.displayObjects.filter(
      (obj) => obj.kind === 'rectangle' && obj.handlers?.pointerdown && obj.depth === 701,
    );
    const skipCard = cards[cards.length - 1];

    skipCard.handlers.pointerdown({ button: 0 });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('double-tap on card after resolution does not fire second callback (one-shot guard)', () => {
    const candidates = [makeCandidate('Arin', 'Myrmidon')];
    generateBossRecruitCandidatesMock.mockReturnValue(candidates);

    const cb = vi.fn();
    overlay.show(cb);

    const cards = overlay.displayObjects.filter(
      (obj) => obj.kind === 'rectangle' && obj.handlers?.pointerdown && obj.depth === 701,
    );
    const candidateCard = cards[0];

    // First click resolves
    candidateCard.handlers.pointerdown({ button: 0 });
    expect(cb).toHaveBeenCalledTimes(1);

    // Second click on same card does nothing (one-shot latch)
    candidateCard.handlers.pointerdown({ button: 0 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('skip after card selection does not fire second callback', () => {
    const candidates = [makeCandidate('Arin', 'Myrmidon'), makeCandidate('Bran', 'Fighter')];
    generateBossRecruitCandidatesMock.mockReturnValue(candidates);

    const cb = vi.fn();
    overlay.show(cb);

    const cards = overlay.displayObjects.filter(
      (obj) => obj.kind === 'rectangle' && obj.handlers?.pointerdown && obj.depth === 701,
    );
    const candidateCard = cards[0];
    const skipCard = cards[cards.length - 1];

    // Select a candidate
    candidateCard.handlers.pointerdown({ button: 0 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(candidates[0].unit);

    // Attempt skip after resolution
    skipCard.handlers.pointerdown({ button: 0 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('_cleanup() destroys all display objects', () => {
    const candidates = [makeCandidate('Arin', 'Myrmidon')];
    generateBossRecruitCandidatesMock.mockReturnValue(candidates);

    const cb = vi.fn();
    overlay.show(cb);

    const objsBefore = [...overlay.displayObjects];
    expect(objsBefore.length).toBeGreaterThan(0);
    expect(objsBefore.every((obj) => !obj.destroyed)).toBe(true);

    overlay._cleanup();

    expect(objsBefore.every((obj) => obj.destroyed)).toBe(true);
    expect(scene._hideMenuTooltip).toHaveBeenCalled();
    expect(scene.hideLootRoster).toHaveBeenCalled();
  });

  it('empty candidates fires callback immediately with null', () => {
    generateBossRecruitCandidatesMock.mockReturnValue(null);

    const cb = vi.fn();
    overlay.show(cb);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(null);
    // No display objects created
    expect(overlay.displayObjects.length).toBe(0);
  });

  it('empty array candidates fires callback immediately with null', () => {
    generateBossRecruitCandidatesMock.mockReturnValue([]);

    const cb = vi.fn();
    overlay.show(cb);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(null);
    expect(overlay.displayObjects.length).toBe(0);
  });

  it('right-click on card does not fire callback', () => {
    const candidates = [makeCandidate('Arin', 'Myrmidon')];
    generateBossRecruitCandidatesMock.mockReturnValue(candidates);

    const cb = vi.fn();
    overlay.show(cb);

    const cards = overlay.displayObjects.filter(
      (obj) => obj.kind === 'rectangle' && obj.handlers?.pointerdown && obj.depth === 701,
    );
    // Right-click (button 2)
    cards[0].handlers.pointerdown({ button: 2 });
    expect(cb).not.toHaveBeenCalled();
  });

  it('right-click on skip does not fire callback', () => {
    const candidates = [makeCandidate('Arin', 'Myrmidon')];
    generateBossRecruitCandidatesMock.mockReturnValue(candidates);

    const cb = vi.fn();
    overlay.show(cb);

    const cards = overlay.displayObjects.filter(
      (obj) => obj.kind === 'rectangle' && obj.handlers?.pointerdown && obj.depth === 701,
    );
    const skipCard = cards[cards.length - 1];
    skipCard.handlers.pointerdown({ button: 2 });
    expect(cb).not.toHaveBeenCalled();
  });

  it('cleanup is called automatically on resolve', () => {
    const candidates = [makeCandidate('Arin', 'Myrmidon')];
    generateBossRecruitCandidatesMock.mockReturnValue(candidates);

    const cb = vi.fn();
    overlay.show(cb);

    const objsBefore = [...overlay.displayObjects];
    expect(objsBefore.length).toBeGreaterThan(0);

    const cards = overlay.displayObjects.filter(
      (obj) => obj.kind === 'rectangle' && obj.handlers?.pointerdown && obj.depth === 701,
    );
    cards[0].handlers.pointerdown({ button: 0 });

    // All display objects should be destroyed after resolution
    expect(objsBefore.every((obj) => obj.destroyed)).toBe(true);
    expect(scene._hideMenuTooltip).toHaveBeenCalled();
  });

  it('passes correct args to generateBossRecruitCandidates', () => {
    const meta = { goldBonus: 50 };
    const fallen = [{ name: 'FallenHero' }];
    const roster = [{ name: 'Edric', className: 'Lord' }];
    runManager.currentAct = 'act2';
    runManager.roster = roster;
    runManager.fallenUnits = fallen;
    runManager.getEffectiveMetaEffects = () => meta;

    generateBossRecruitCandidatesMock.mockReturnValue(null);

    const cb = vi.fn();
    overlay.show(cb);

    expect(generateBossRecruitCandidatesMock).toHaveBeenCalledWith(
      'act2',
      roster,
      gameData,
      meta,
      fallen,
    );
  });

  it('lord candidate card renders lord tag', () => {
    const candidates = [makeCandidate('Kira', 'Ranger', true)];
    generateBossRecruitCandidatesMock.mockReturnValue(candidates);

    const cb = vi.fn();
    overlay.show(cb);

    // Find text objects containing '[LORD]'
    const lordTags = overlay.displayObjects.filter(
      (obj) => obj.kind === 'text' && obj.text === '[LORD]',
    );
    expect(lordTags.length).toBe(1);
  });

  it('_pinToScreen is called with displayObjects', () => {
    const candidates = [makeCandidate('Arin', 'Myrmidon')];
    generateBossRecruitCandidatesMock.mockReturnValue(candidates);

    const cb = vi.fn();
    overlay.show(cb);

    expect(scene._pinToScreen).toHaveBeenCalled();
    expect(scene._pinToScreen).toHaveBeenCalledWith(overlay.displayObjects);
  });
});
