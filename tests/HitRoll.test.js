import { it, expect } from 'vitest';
import { rollHit, hitProbability } from '../src/engine/HitRoll.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
it('draws twice even at guaranteed hit/miss boundaries, leaving Crit and proc rolls separate', () => {
  for (const hit of [0, 100]) {
    let draws = 0;
    expect(
      rollHit(hit, () => {
        draws++;
        return 0.5;
      }),
    ).toBe(hit === 100);
    expect(draws).toBe(2);
  }
  expect(
    rollHit(
      75,
      (() => {
        const draws = [0.99, 0.1];
        return () => draws.shift();
      })(),
    ),
  ).toBe(true);
});
it('matches the continuous 2RN distribution symmetrically', () => {
  installSeed(8675309);
  try {
    for (const hit of [0, 25, 50, 75, 100]) {
      let successes = 0;
      for (let n = 0; n < 100000; n++) successes += rollHit(hit);
      expect(successes / 100000).toBeCloseTo(hitProbability(hit), 2);
    }
    expect(hitProbability(75)).toBe(0.875);
    expect(hitProbability(25)).toBe(0.125);
  } finally {
    restoreMathRandom();
  }
});
