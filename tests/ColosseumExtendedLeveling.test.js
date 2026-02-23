import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROSTER_CAP } from '../src/utils/constants.js';

// ── Hoisted mocks ──
const { gainExperienceMock } = vi.hoisted(() => ({
  gainExperienceMock: vi.fn(),
}));

vi.mock('../src/engine/UnitManager.js', async () => {
  const actual = await vi.importActual('../src/engine/UnitManager.js');
  return {
    ...actual,
    gainExperience: gainExperienceMock,
  };
});

import { ColosseumOverlay } from '../src/ui/ColosseumOverlay.js';
import { loadGameData } from './testData.js';

// ── Helpers (same pattern as ColosseumOverlay.test.js) ──

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
    ...seed,
    setDepth() {
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
    setColor(color) {
      this.style = { ...this.style, color };
      return this;
    },
    setBackgroundColor(bg) {
      this.style = { ...this.style, backgroundColor: bg };
      return this;
    },
    setInteractive(options) {
      this.interactive = true;
      this._interactiveOptions = options || null;
      this.input = { enabled: true };
      return this;
    },
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    },
    destroy() {
      this.destroyed = true;
      this.active = false;
      if (this.input) this.input.enabled = false;
    },
  };
}

function makeScene() {
  const objects = [];
  const timers = [];
  return {
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
        objects.push(obj);
        return obj;
      },
      text: (x, y, text, style = {}) => {
        const obj = makeDisplayObject({ kind: 'text', x, y, text, style: { ...style } });
        objects.push(obj);
        return obj;
      },
    },
    time: {
      delayedCall: (delay, callback) => {
        const timer = makeDisplayObject({
          kind: 'timer',
          delay,
          callback,
          remove: vi.fn(() => timer.destroy()),
        });
        timers.push(timer);
        objects.push(timer);
        return timer;
      },
    },
    tweens: { add: vi.fn() },
    cameras: { main: { centerX: 320, centerY: 240 } },
    registry: { get: () => null },
    _objects: objects,
    _timers: timers,
  };
}

function activeTexts(scene) {
  return scene._objects.filter((obj) => !obj.destroyed && obj.kind === 'text');
}

function hasText(scene, substring) {
  return activeTexts(scene).some((obj) => String(obj.text).includes(substring));
}

function makeRunManager(overrides = {}) {
  return {
    gold: 5000,
    currentAct: 'act1',
    difficultyId: 'normal',
    difficultyMode: null,
    metaEffects: {},
    roster: [],
    getRosterCap() {
      return ROSTER_CAP + (this.metaEffects?.rosterCapBonus || 0);
    },
    awardGold(amount) {
      this.gold += amount;
    },
    spendGold(amount) {
      if (this.gold < amount) return false;
      this.gold -= amount;
      return true;
    },
    markNodeComplete: vi.fn(),
    getDifficultyModifier: () => true,
    ...overrides,
  };
}

function makeExtendedUnit() {
  return {
    name: 'ExtUnit',
    className: 'Swordmaster',
    tier: 'promoted',
    level: 20,
    extendedLevels: 0,
    currentHP: 40,
    xp: 0,
    faction: 'player',
    stats: { HP: 40, STR: 18, MAG: 2, SKL: 20, SPD: 22, DEF: 10, RES: 8, LCK: 12, MOV: 6 },
    weapon: {
      name: 'Iron Sword',
      type: 'Sword',
      might: 5,
      hit: 90,
      crit: 0,
      weight: 5,
      range: [1],
    },
    skills: [],
    accessory: null,
  };
}

function makeChallenger() {
  return {
    unit: {
      name: 'Challenger',
      className: 'Fighter',
      tier: 'base',
      level: 10,
      currentHP: 30,
      stats: { HP: 30, STR: 12, MAG: 0, SKL: 8, SPD: 8, DEF: 6, RES: 2, LCK: 4, MOV: 5 },
      weapon: { name: 'Iron Axe', type: 'Axe', might: 8, hit: 75, crit: 0, weight: 8, range: [1] },
      skills: [],
      accessory: null,
    },
  };
}

let gameData;

beforeEach(() => {
  gameData = loadGameData();
  gainExperienceMock.mockReset();
});

describe('Colosseum extended leveling (mock-driven)', () => {
  it('DR counter increments on extended level-ups via _showResult', () => {
    const scene = makeScene();
    const unit = makeExtendedUnit();
    const runManager = makeRunManager({ roster: [unit] });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-ext-1' }, vi.fn());
    overlay._selectedUnit = unit;
    overlay._selectedTier = {
      name: 'bronze',
      entryFee: 50,
      goldReward: 120,
      xpMultiplier: 1,
      levelOffset: [0, 0],
    };
    overlay._challenger = makeChallenger();
    overlay._fightsPerUnit[unit.name] = 0;
    overlay._levelsGainedThisVisit[unit.name] = 0;

    // Mock gainExperience to return 2 extended level-ups
    gainExperienceMock.mockReturnValue({
      levelUps: [
        { isExtended: true, extendedLevel: 1, gains: { HP: 1 } },
        { isExtended: true, extendedLevel: 2, gains: { SPD: 1 } },
      ],
    });

    overlay._showResult('win', overlay._selectedTier);

    // Production code should have incremented DR counter by 2
    expect(overlay._levelsGainedThisVisit[unit.name]).toBe(2);
    // Verify gainExperience was called with extendedLevelingEnabled flag
    expect(gainExperienceMock).toHaveBeenCalledWith(unit, expect.any(Number), {
      extendedLevelingEnabled: true,
    });
  });

  it('banner shows full jump on multi-level extended gains', () => {
    const scene = makeScene();
    const unit = makeExtendedUnit();
    const runManager = makeRunManager({ roster: [unit] });
    const overlay = new ColosseumOverlay(scene, runManager, gameData);

    overlay.show({ id: 'col-ext-2' }, vi.fn());
    overlay._selectedUnit = unit;
    overlay._selectedTier = {
      name: 'bronze',
      entryFee: 50,
      goldReward: 120,
      xpMultiplier: 1,
      levelOffset: [0, 0],
    };
    overlay._challenger = makeChallenger();
    overlay._fightsPerUnit[unit.name] = 0;
    overlay._levelsGainedThisVisit[unit.name] = 0;

    // Mock: 2 extended level-ups (20→20+1→20+2)
    gainExperienceMock.mockReturnValue({
      levelUps: [
        { isExtended: true, extendedLevel: 1, gains: { HP: 1 } },
        { isExtended: true, extendedLevel: 2, gains: { SPD: 1 } },
      ],
    });

    overlay._showResult('win', overlay._selectedTier);

    // Banner should show the full jump: "20 → 20+2"
    expect(hasText(scene, '20 → 20+2')).toBe(true);
    // Should NOT show partial "20+1 → 20+2"
    expect(hasText(scene, '20+1 → 20+2')).toBe(false);
    // Verify gainExperience was called with extendedLevelingEnabled flag
    expect(gainExperienceMock).toHaveBeenCalledWith(unit, expect.any(Number), {
      extendedLevelingEnabled: true,
    });
  });
});
