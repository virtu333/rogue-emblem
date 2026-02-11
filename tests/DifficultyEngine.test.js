import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolveDifficultyMode, validateDifficultyConfig, DIFFICULTY_CONTRACT_VERSION } from '../src/engine/DifficultyEngine.js';

const difficulty = JSON.parse(readFileSync('data/difficulty.json', 'utf8'));

describe('DifficultyEngine', () => {
  it('validates bundled difficulty config', () => {
    const result = validateDifficultyConfig(difficulty);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(difficulty.version).toBe(DIFFICULTY_CONTRACT_VERSION);
  });

  it('rejects missing required mode keys', () => {
    const bad = JSON.parse(JSON.stringify(difficulty));
    delete bad.modes.hard.goldMultiplier;
    const result = validateDifficultyConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('missing required key: goldMultiplier'))).toBe(true);
  });

  it('resolves requested mode with fallback to normal', () => {
    const hard = resolveDifficultyMode(difficulty, 'hard');
    const unknown = resolveDifficultyMode(difficulty, 'unknown_mode');
    expect(hard.id).toBe('hard');
    expect(hard.modifiers.currencyMultiplier).toBe(difficulty.modes.hard.currencyMultiplier);
    expect(unknown.id).toBe('normal');
    expect(unknown.modifiers.currencyMultiplier).toBe(difficulty.modes.normal.currencyMultiplier);
  });
});
