import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import {
  resolveDifficultyMode,
  validateDifficultyConfig,
  generateModifierSummary,
  DIFFICULTY_CONTRACT_VERSION,
} from '../src/engine/DifficultyEngine.js';

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
    expect(result.errors.some((e) => e.includes('missing required key: goldMultiplier'))).toBe(
      true,
    );
  });

  it('resolves requested mode with fallback to normal', () => {
    const hard = resolveDifficultyMode(difficulty, 'hard');
    const unknown = resolveDifficultyMode(difficulty, 'unknown_mode');
    expect(hard.id).toBe('hard');
    expect(hard.modifiers.currencyMultiplier).toBe(difficulty.modes.hard.currencyMultiplier);
    expect(unknown.id).toBe('normal');
    expect(unknown.modifiers.currencyMultiplier).toBe(difficulty.modes.normal.currencyMultiplier);
  });

  it('preserves optional label and color fields from config', () => {
    const hard = resolveDifficultyMode(difficulty, 'hard');
    expect(hard.modifiers.label).toBe('Hard');
    expect(hard.modifiers.color).toBe('#ff8800');
    const normal = resolveDifficultyMode(difficulty, 'normal');
    expect(normal.modifiers.label).toBe('Normal');
    expect(normal.modifiers.color).toBe('#44cc44');
    const lunatic = resolveDifficultyMode(difficulty, 'lunatic');
    expect(lunatic.modifiers.label).toBe('Lunatic');
    expect(lunatic.modifiers.color).toBe('#cc3333');
  });

  it('returns default label and color when mode data lacks them', () => {
    const stripped = JSON.parse(JSON.stringify(difficulty));
    delete stripped.modes.normal.label;
    delete stripped.modes.normal.color;
    const result = resolveDifficultyMode(stripped, 'normal');
    expect(result.modifiers.label).toBe('Normal');
    expect(result.modifiers.color).toBe('#44cc44');
  });

  it('includes churchPromotionLimit and growthBonusMultiplier in all modes', () => {
    for (const mode of ['normal', 'hard', 'lunatic']) {
      const resolved = resolveDifficultyMode(difficulty, mode);
      expect(resolved.modifiers).toHaveProperty('churchPromotionLimit');
      expect(resolved.modifiers).toHaveProperty('growthBonusMultiplier');
      expect(Number.isFinite(resolved.modifiers.churchPromotionLimit)).toBe(true);
      expect(Number.isFinite(resolved.modifiers.growthBonusMultiplier)).toBe(true);
    }
  });

  it('hard/lunatic have reduced growthBonusMultiplier and limited church promotions', () => {
    const hard = resolveDifficultyMode(difficulty, 'hard');
    const lunatic = resolveDifficultyMode(difficulty, 'lunatic');
    expect(hard.modifiers.growthBonusMultiplier).toBeLessThan(1);
    expect(lunatic.modifiers.growthBonusMultiplier).toBeLessThan(
      hard.modifiers.growthBonusMultiplier,
    );
    expect(hard.modifiers.churchPromotionLimit).toBeGreaterThan(0);
    expect(lunatic.modifiers.churchPromotionLimit).toBeGreaterThan(0);
    expect(lunatic.modifiers.churchPromotionLimit).toBeLessThan(
      hard.modifiers.churchPromotionLimit,
    );
  });

  it('generateModifierSummary includes church and growth lines for hard', () => {
    const hard = resolveDifficultyMode(difficulty, 'hard');
    const lines = generateModifierSummary(hard.modifiers);
    expect(lines.some((l) => l.includes('Church promotions'))).toBe(true);
    expect(lines.some((l) => l.includes('Growth bonuses'))).toBe(true);
  });

  it('includes enemyLevelBonus and enemyCountBase in all modes', () => {
    for (const mode of ['normal', 'hard', 'lunatic']) {
      const resolved = resolveDifficultyMode(difficulty, mode);
      expect(resolved.modifiers).toHaveProperty('enemyLevelBonus');
      expect(resolved.modifiers).toHaveProperty('enemyCountBase');
      expect(Number.isFinite(resolved.modifiers.enemyLevelBonus)).toBe(true);
      expect(Number.isFinite(resolved.modifiers.enemyCountBase)).toBe(true);
    }
  });

  it('lunatic has higher enemyLevelBonus and enemyCountBase than normal', () => {
    const normal = resolveDifficultyMode(difficulty, 'normal');
    const lunatic = resolveDifficultyMode(difficulty, 'lunatic');
    expect(lunatic.modifiers.enemyLevelBonus).toBeGreaterThan(normal.modifiers.enemyLevelBonus);
    expect(lunatic.modifiers.enemyCountBase).toBeGreaterThan(normal.modifiers.enemyCountBase);
  });

  it('generateModifierSummary includes level and count lines for lunatic', () => {
    const lunatic = resolveDifficultyMode(difficulty, 'lunatic');
    const lines = generateModifierSummary(lunatic.modifiers);
    expect(lines.some((l) => l.includes('Enemy levels'))).toBe(true);
    expect(lines.some((l) => l.includes('Base enemy count'))).toBe(true);
  });
});
