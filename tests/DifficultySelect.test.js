import { describe, it, expect } from 'vitest';
import { generateModifierSummary, DIFFICULTY_DEFAULTS } from '../src/engine/DifficultyEngine.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

describe('generateModifierSummary', () => {
  it('returns empty array for Normal mode (no modifiers)', () => {
    const normalMode = gameData.difficulty.modes.normal;
    const result = generateModifierSummary(normalMode);
    expect(result).toEqual([]);
  });

  it('returns correct modifier lines for Hard mode', () => {
    const hardMode = gameData.difficulty.modes.hard;
    const result = generateModifierSummary(hardMode);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(l => l.includes('Enemy stats +1'))).toBe(true);
    expect(result.some(l => l.includes('90% gold earned'))).toBe(true);
    expect(result.some(l => l.includes('+25% meta currency'))).toBe(true);
    expect(result.some(l => l.includes('Shop prices +15%'))).toBe(true);
    expect(result.some(l => l.includes('90% XP earned'))).toBe(true);
  });

  it('includes extended leveling for Lunatic mode', () => {
    const lunaticMode = gameData.difficulty.modes.lunatic;
    const result = generateModifierSummary(lunaticMode);
    expect(result.some(l => l.includes('Extended enemy leveling'))).toBe(true);
    expect(result.some(l => l.includes('Enemy stats +2'))).toBe(true);
    expect(result.some(l => l.includes('weapon tier'))).toBe(true);
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
    expect(result.some(l => l.includes('+3 extra enemies'))).toBe(true);
  });

  it('detects fog chance bonus', () => {
    const mode = { ...DIFFICULTY_DEFAULTS, fogChanceBonus: 0.2 };
    const result = generateModifierSummary(mode);
    expect(result.some(l => l.includes('+20% fog chance'))).toBe(true);
  });
});
