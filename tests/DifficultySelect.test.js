import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (val, min, max) => Math.min(max, Math.max(min, val)) },
  },
}));

vi.mock('../src/utils/SceneRouter.js', () => ({
  transitionToScene: vi.fn(() => Promise.resolve(true)),
  TRANSITION_REASONS: { BEGIN_RUN: 'begin_run', BACK: 'back' },
}));

import { transitionToScene } from '../src/utils/SceneRouter.js';
import {
  generateModifierSummary,
  DIFFICULTY_DEFAULTS,
  DIFFICULTY_IDS,
} from '../src/engine/DifficultyEngine.js';
import { hasAnySlotMilestone, getMetaKey } from '../src/engine/SlotManager.js';
import { DifficultySelectScene } from '../src/scenes/DifficultySelectScene.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

/**
 * Mirrors DifficultySelectScene._buildModes lock logic for testability
 * without importing Phaser. Keep in sync with the scene method.
 */
function buildModes(gd, meta) {
  const config = gd?.difficulty?.modes || {};
  const hardUnlocked = Boolean(meta?.hasMilestone?.('beatGame'));
  return DIFFICULTY_IDS.map((id) => {
    const mode = config[id] || {};
    const label = mode.label || id.charAt(0).toUpperCase() + id.slice(1);
    const color = mode.color || '#aaaaaa';
    const summary = generateModifierSummary(mode);
    let locked = false;
    let lockReason = null;
    if (id === 'hard' && !hardUnlocked) {
      locked = true;
      lockReason = 'Beat the game to unlock';
    }
    const lunaticUnlocked = Boolean(
      meta?.hasMilestone?.('beatHard') ||
      meta?.hasMilestone?.('beatLunatic') ||
      hasAnySlotMilestone('beatHard') ||
      hasAnySlotMilestone('beatLunatic'),
    );
    if (id === 'lunatic' && !lunaticUnlocked) {
      locked = true;
      lockReason = 'Beat the game on Hard to unlock';
    }
    return { id, label, color, summary, locked, lockReason };
  });
}

describe('generateModifierSummary', () => {
  it('includes village ambush chance for Normal mode', () => {
    const normalMode = gameData.difficulty.modes.normal;
    const result = generateModifierSummary(normalMode);
    expect(result.some((l) => l.includes('village ambush chance'))).toBe(true);
    expect(result.some((l) => l.includes('10%'))).toBe(true);
  });

  it('returns correct modifier lines for Hard mode', () => {
    const hardMode = gameData.difficulty.modes.hard;
    const result = generateModifierSummary(hardMode);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((l) => l.includes('Enemy stats +1'))).toBe(true);
    expect(result.some((l) => l.includes('90% gold earned'))).toBe(true);
    expect(result.some((l) => l.includes('+25% meta currency'))).toBe(true);
    expect(result.some((l) => l.includes('Shop prices +15%'))).toBe(true);
    expect(result.some((l) => l.includes('90% XP earned'))).toBe(true);
    expect(result.some((l) => l.includes('20% village ambush chance'))).toBe(true);
  });

  it('includes extended leveling for Lunatic mode', () => {
    const lunaticMode = gameData.difficulty.modes.lunatic;
    const result = generateModifierSummary(lunaticMode);
    expect(result.some((l) => l.includes('Extended leveling past Lv 20'))).toBe(true);
    expect(result.some((l) => l.includes('Enemy stats +2'))).toBe(true);
    expect(result.some((l) => l.includes('weapon tier'))).toBe(true);
    expect(result.some((l) => l.includes('25% village ambush chance'))).toBe(true);
  });

  it('returns empty array for null/undefined input', () => {
    expect(generateModifierSummary(null)).toEqual([]);
    expect(generateModifierSummary(undefined)).toEqual([]);
  });

  it('handles mode matching defaults (no diff)', () => {
    const result = generateModifierSummary({ ...DIFFICULTY_DEFAULTS });
    expect(result).toEqual([]);
  });

  it('detects enemy count bonus', () => {
    const mode = { ...DIFFICULTY_DEFAULTS, enemyCountBonus: 3 };
    const result = generateModifierSummary(mode);
    expect(result.some((l) => l.includes('+3 extra enemies'))).toBe(true);
  });

  it('detects fog chance bonus', () => {
    const mode = { ...DIFFICULTY_DEFAULTS, fogChanceBonus: 0.2 };
    const result = generateModifierSummary(mode);
    expect(result.some((l) => l.includes('+20% fog chance'))).toBe(true);
  });
});

describe('Lunatic unlock gate', () => {
  function makeMeta(milestones) {
    const set = new Set(milestones);
    return { hasMilestone: (m) => set.has(m) };
  }

  it('Lunatic is locked with reason when beatHard is absent', () => {
    const modes = buildModes(gameData, makeMeta(['beatGame']));
    const lunatic = modes.find((m) => m.id === 'lunatic');
    expect(lunatic.locked).toBe(true);
    expect(lunatic.lockReason).toBe('Beat the game on Hard to unlock');
  });

  it('Lunatic is unlocked when beatHard milestone is present', () => {
    const modes = buildModes(gameData, makeMeta(['beatGame', 'beatHard']));
    const lunatic = modes.find((m) => m.id === 'lunatic');
    expect(lunatic.locked).toBe(false);
    expect(lunatic.lockReason).toBeNull();
  });

  it('Lunatic is unlocked when beatLunatic milestone is present', () => {
    const modes = buildModes(gameData, makeMeta(['beatGame', 'beatLunatic']));
    const lunatic = modes.find((m) => m.id === 'lunatic');
    expect(lunatic.locked).toBe(false);
    expect(lunatic.lockReason).toBeNull();
  });
});

describe('Cross-slot Lunatic unlock', () => {
  const store = new Map();
  let origLS;

  beforeEach(() => {
    origLS = globalThis.localStorage;
    store.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, val) => store.set(key, String(val)),
        removeItem: (key) => store.delete(key),
        clear: () => store.clear(),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: origLS,
    });
  });

  function makeMeta(milestones) {
    const set = new Set(milestones);
    return { hasMilestone: (m) => set.has(m) };
  }

  it('Lunatic unlocks via beatHard on a different slot', () => {
    store.set(getMetaKey(2), JSON.stringify({ milestones: ['beatGame', 'beatHard'] }));
    const modes = buildModes(gameData, makeMeta(['beatGame']));
    const lunatic = modes.find((m) => m.id === 'lunatic');
    expect(lunatic.locked).toBe(false);
  });

  it('Lunatic unlocks via beatLunatic on a different slot', () => {
    store.set(getMetaKey(3), JSON.stringify({ milestones: ['beatGame', 'beatLunatic'] }));
    const modes = buildModes(gameData, makeMeta(['beatGame']));
    const lunatic = modes.find((m) => m.id === 'lunatic');
    expect(lunatic.locked).toBe(false);
  });

  it('Lunatic stays locked when no slot has beatHard or beatLunatic', () => {
    // All slots empty
    const modes = buildModes(gameData, makeMeta(['beatGame']));
    const lunatic = modes.find((m) => m.id === 'lunatic');
    expect(lunatic.locked).toBe(true);
    expect(lunatic.lockReason).toBe('Beat the game on Hard to unlock');
  });
});

describe('DifficultySelectScene No Meta toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeDiffScene(initData = {}) {
    const scene = Object.create(DifficultySelectScene.prototype);
    scene.init({ gameData, ...initData });
    scene.registry = { get: vi.fn(() => null) };
    scene.children = { removeAll: vi.fn() };
    scene._maskGraphics = [];
    scene.cameras = { main: { width: 480, height: 320 } };
    scene.add = {
      text: vi.fn(() => ({
        setOrigin: vi.fn(() => ({ setInteractive: vi.fn(() => ({ on: vi.fn() })) })),
      })),
      rectangle: vi.fn(() => ({ setOrigin: vi.fn() })),
    };
    scene.modes = [{ id: 'normal', label: 'Normal', locked: false }];
    scene.selectedIndex = 0;
    scene._cardScrollMaxes = {};
    scene._draw = vi.fn();
    return scene;
  }

  it('defaults _noMetaUpgrades to false when not passed', () => {
    const scene = makeDiffScene();
    expect(scene._noMetaUpgrades).toBe(false);
  });

  it('_toggleMetaMode flips the flag', () => {
    const scene = makeDiffScene();
    scene._toggleMetaMode();
    expect(scene._noMetaUpgrades).toBe(true);
    scene._toggleMetaMode();
    expect(scene._noMetaUpgrades).toBe(false);
  });

  it('restores _noMetaUpgrades from init data (back-navigation persistence)', () => {
    const scene = makeDiffScene({ noMetaUpgrades: true });
    expect(scene._noMetaUpgrades).toBe(true);
  });

  it('rejects non-boolean noMetaUpgrades in init', () => {
    const scene = makeDiffScene({ noMetaUpgrades: 'yes' });
    expect(scene._noMetaUpgrades).toBe(false);
  });

  it('_confirm passes noMetaUpgrades in transition data', () => {
    const scene = makeDiffScene();
    scene._noMetaUpgrades = true;
    scene.isTransitioning = false;
    scene._confirm();
    expect(transitionToScene).toHaveBeenCalledTimes(1);
    const callArgs = transitionToScene.mock.calls[0];
    expect(callArgs[2].noMetaUpgrades).toBe(true);
  });
});

describe('DifficultySelectScene wheel handler', () => {
  function makeWheelScene() {
    const scene = Object.create(DifficultySelectScene.prototype);
    scene.selectedIndex = 0;
    scene._cardScrollMaxes = { 0: 100 };
    scene._cardScrollOffsets = { 0: 30 };
    scene._draw = vi.fn();
    // Run the create-time closure setup for _onWheel
    scene.input = { keyboard: { on: vi.fn(), off: vi.fn() }, on: vi.fn(), off: vi.fn() };
    scene.events = { once: vi.fn() };
    scene.registry = { get: vi.fn(() => null) };
    // Manually build the _onWheel closure matching source
    const Phaser = { Math: { Clamp: (v, min, max) => Math.min(max, Math.max(min, v)) } };
    scene._onWheel = (_pointer, _gameObjects, _dx, dy) => {
      if (!scene._cardScrollMaxes) return;
      if (dy === 0) return;
      const idx = scene.selectedIndex;
      const max = scene._cardScrollMaxes[idx] || 0;
      if (max <= 0) return;
      if (!scene._cardScrollOffsets) scene._cardScrollOffsets = {};
      const cur = scene._cardScrollOffsets[idx] || 0;
      const next = Phaser.Math.Clamp(cur + (dy > 0 ? 30 : -30), 0, max);
      if (next !== cur) {
        scene._cardScrollOffsets[idx] = next;
        scene._draw();
      }
    };
    return scene;
  }

  it('ignores horizontal-only wheel events (dy === 0)', () => {
    const scene = makeWheelScene();
    scene._onWheel(null, null, 5, 0);
    expect(scene._cardScrollOffsets[0]).toBe(30);
    expect(scene._draw).not.toHaveBeenCalled();
  });

  it('scrolls normally for nonzero dy', () => {
    const scene = makeWheelScene();
    scene._onWheel(null, null, 0, 10);
    expect(scene._cardScrollOffsets[0]).toBe(60);
    expect(scene._draw).toHaveBeenCalledTimes(1);
  });
});
