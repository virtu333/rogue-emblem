import { describe, it, expect } from 'vitest';
import { recordDifficultyLabel } from '../src/ui/RunRecordsMenu.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

describe('Victory records difficulty', () => {
  it('names every rung by its label, not its saved id', () => {
    expect(
      ['normal', 'dusk', 'hard', 'lunatic'].map((id) => recordDifficultyLabel(gameData, id)),
    ).toEqual(['First Light', 'Dusk', 'Nightfall', 'Black Sun']);
  });

  it('never prints an empty label for an unknown or missing id', () => {
    expect(recordDifficultyLabel(gameData, 'mythic')).toBe('Mythic');
    expect(recordDifficultyLabel(gameData, undefined)).toBe('Unknown');
    expect(recordDifficultyLabel(undefined, 'hard')).not.toBe('');
  });
});
