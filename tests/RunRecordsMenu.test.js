import { describe, it, expect } from 'vitest';
import { recordDifficulty } from '../src/ui/runRecordsContent.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

describe('Victory records difficulty', () => {
  it('names every rung by its label, not its saved id', () => {
    expect(
      ['normal', 'dusk', 'hard', 'lunatic'].map((id) => recordDifficulty(gameData, id).label),
    ).toEqual(['First Light', 'Dusk', 'Nightfall', 'Black Sun']);
  });

  it('never prints an empty label for an unknown or missing id', () => {
    expect(recordDifficulty(gameData, 'mythic').label).toBe('Mythic');
    expect(recordDifficulty(gameData, undefined).label).not.toBe('');
    expect(recordDifficulty(undefined, 'hard').label).not.toBe('');
  });
});
