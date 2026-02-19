import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sampleEnemyFromAct } from '../../sim/lib/EnemySampling.js';
import { getData } from '../../sim/lib/SimUnitFactory.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';

describe('EnemySampling', () => {
  const data = getData();

  beforeEach(() => {
    installSeed(4242);
  });

  afterEach(() => {
    restoreMathRandom();
  });

  it('samples class/tier from act pool definitions', () => {
    const sample = sampleEnemyFromAct(data.enemies, data.classes, 'act3');
    const pool = data.enemies.pools.act3;
    expect([...pool.base, ...pool.promoted]).toContain(sample.className);
    expect(['base', 'promoted']).toContain(sample.tier);
  });

  it('respects explicit level range override', () => {
    const sample = sampleEnemyFromAct(data.enemies, data.classes, 'act2', [9, 9]);
    expect(sample.level).toBe(9);
  });
});
