import { describe, expect, it } from 'vitest';
import {
  BLESSINGS_CONTRACT_VERSION,
  validateBlessingsConfig,
  assertValidBlessingsConfig,
  buildBlessingIndex,
  createSeededRng,
  selectBlessingOptions,
} from '../src/engine/BlessingEngine.js';
import { loadGameData } from './testData.js';

describe('BlessingEngine', () => {
  it('validates bundled blessings config', () => {
    const gameData = loadGameData();
    const result = validateBlessingsConfig(gameData.blessings);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(gameData.blessings.version).toBe(BLESSINGS_CONTRACT_VERSION);
  });

  it('rejects duplicate IDs', () => {
    const gameData = loadGameData();
    const copy = JSON.parse(JSON.stringify(gameData.blessings));
    copy.blessings.push({ ...copy.blessings[0] });
    const result = validateBlessingsConfig(copy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('duplicate'))).toBe(true);
  });

  it('buildBlessingIndex returns id map', () => {
    const gameData = loadGameData();
    const index = buildBlessingIndex(gameData.blessings);
    expect(index.size).toBe(gameData.blessings.blessings.length);
    expect(index.has('steady_hands')).toBe(true);
  });

  it('assertValidBlessingsConfig throws on invalid config', () => {
    expect(() => assertValidBlessingsConfig({})).toThrow();
  });

  it('selectBlessingOptions is deterministic for same seed', () => {
    const gameData = loadGameData();
    const rngA = createSeededRng(1337);
    const rngB = createSeededRng(1337);
    const a = selectBlessingOptions(gameData.blessings, rngA, { count: 4 });
    const b = selectBlessingOptions(gameData.blessings, rngB, { count: 4 });
    expect(a.map(x => x.id)).toEqual(b.map(x => x.id));
  });

  it('selectBlessingOptions includes at least one tier-1 by default', () => {
    const gameData = loadGameData();
    const rng = createSeededRng(7);
    const selected = selectBlessingOptions(gameData.blessings, rng, { count: 3 });
    expect(selected.some(x => x.tier === 1)).toBe(true);
  });

  it('different seeds can yield different blessing choices', () => {
    const gameData = loadGameData();
    const first = selectBlessingOptions(gameData.blessings, createSeededRng(11), { count: 4 });
    const second = selectBlessingOptions(gameData.blessings, createSeededRng(999), { count: 4 });
    expect(first.map(x => x.id).join(',')).not.toBe(second.map(x => x.id).join(','));
  });

  it('respects excludes rules when selecting options', () => {
    const config = {
      version: 1,
      blessings: [
        { id: 'a', name: 'A', tier: 1, description: 'A', boons: [{ type: 'noop', params: {} }], costs: [], excludes: ['b'] },
        { id: 'b', name: 'B', tier: 2, description: 'B', boons: [{ type: 'noop', params: {} }], costs: [] },
        { id: 'c', name: 'C', tier: 2, description: 'C', boons: [{ type: 'noop', params: {} }], costs: [] },
      ],
    };
    const selected = selectBlessingOptions(config, createSeededRng(1), { count: 3 });
    const ids = selected.map(x => x.id);
    expect(ids.includes('a') && ids.includes('b')).toBe(false);
  });
});
