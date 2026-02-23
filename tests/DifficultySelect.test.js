import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateModifierSummary, DIFFICULTY_DEFAULTS, DIFFICULTY_IDS } from '../src/engine/DifficultyEngine.js';
import { hasAnySlotMilestone, getMetaKey } from '../src/engine/SlotManager.js';
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
      meta?.hasMilestone?.('beatHard') || meta?.hasMilestone?.('beatLunatic')
      || hasAnySlotMilestone('beatHard') || hasAnySlotMilestone('beatLunatic')
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
