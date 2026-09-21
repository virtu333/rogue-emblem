import { describe, it, expect } from 'vitest';
import { createBattleRng, isBattleRngState, keyedBattleRandom } from '../src/engine/BattleRng.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';

describe('battle RNG cursor', () => {
  it.each([0, 1, 42, 0xffffffff])('matches the existing stream for seed %i', (seed) => {
    const old = createSeededRng(seed),
      current = createBattleRng(seed);
    for (let i = 0; i < 10000; i++) expect(current()).toBe(old());
  });
  it('JSON cursor restore continues exactly without replaying old draws', () => {
    const live = createBattleRng(773);
    for (let i = 0; i < 151; i++) live();
    const state = JSON.parse(JSON.stringify(live.getState()));
    const resumed = createBattleRng(0, state);
    for (let i = 0; i < 1000; i++) expect(resumed()).toBe(live());
  });
  it('keyed forecast draws are repeatable and do not advance gameplay', () => {
    const live = createBattleRng(99);
    const state = live.getState();
    const sample = (key) => keyedBattleRandom(state.cursor, key)();
    const a = sample('u1:u2:gambler');
    sample('u1:u3:gambler');
    expect(sample('u1:u2:gambler')).toBe(a);
    expect(live.getState()).toEqual(state);
    expect(live()).toBe(createBattleRng(99)());
  });
  it('rejects unknown or malformed persisted RNG state', () => {
    for (const value of [
      null,
      {},
      { algorithm: 'v2', cursor: 1 },
      { algorithm: 'mulberry32-v1', cursor: -1 },
      { algorithm: 'mulberry32-v1', cursor: 1.5 },
    ]) {
      expect(isBattleRngState(value)).toBe(false);
    }
  });
});
