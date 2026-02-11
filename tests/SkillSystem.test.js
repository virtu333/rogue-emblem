import { describe, it, expect } from 'vitest';
import { getTurnStartEffects } from '../src/engine/SkillSystem.js';
import { loadGameData } from './testData.js';

describe('SkillSystem turn-start effects', () => {
  it('renewal_aura heals adjacent allies', () => {
    const gameData = loadGameData();
    const sera = {
      name: 'Sera',
      col: 4,
      row: 4,
      skills: ['renewal_aura'],
      stats: { HP: 18 },
      currentHP: 18,
    };
    const ally = {
      name: 'Edric',
      col: 5,
      row: 4,
      skills: [],
      stats: { HP: 20 },
      currentHP: 14,
    };

    const effects = getTurnStartEffects([sera, ally], gameData.skills);
    expect(effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'heal',
          target: ally,
          amount: 5,
          sourceUnit: sera,
        }),
      ])
    );
  });
});
