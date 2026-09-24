import { it, expect } from 'vitest';
import { assignAffixesToEnemySpawns } from '../src/engine/AffixEngine.js';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import { ACT_CONFIG } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
it('keeps Normal Act1 unaffixed and offers a small safe late-act affix pool', () => {
  const data = loadGameData();
  installSeed(42);
  try {
    const spawns = Array.from({ length: 10000 }, () => ({ className: 'Fighter' }));
    expect(
      assignAffixesToEnemySpawns(spawns, {
        affixConfig: data.affixes,
        difficultyId: 'normal',
        act: 'act1',
      }),
    ).toEqual(spawns);
    const later = assignAffixesToEnemySpawns(spawns, {
      affixConfig: data.affixes,
      difficultyId: 'normal',
      act: 'act3',
    });
    const affixed = later.filter((s) => s.affixes?.length);
    expect(affixed.length).toBeGreaterThan(400);
    expect(affixed.length).toBeLessThan(600);
    expect(
      affixed.every(
        (s) =>
          s.affixes.length === 1 && !['deathburst', 'haste', 'teleporter'].includes(s.affixes[0]),
      ),
    ).toBe(true);
  } finally {
    restoreMathRandom();
  }
});
it('offers services on Act1 forks while preserving forced battle and boss rows', () => {
  installSeed(17);
  let shops = 0,
    churches = 0,
    total = 0;
  try {
    for (let i = 0; i < 300; i++) {
      const map = generateNodeMap('act1', ACT_CONFIG.act1);
      for (const n of map.nodes) {
        if (n.row >= 2 && n.row < ACT_CONFIG.act1.rows - 2) {
          total++;
          shops += n.type === 'shop';
          churches += n.type === 'church';
        }
      }
    }
    expect(shops / total).toBeGreaterThan(0.14);
    expect(churches / total).toBeGreaterThan(0.06);
  } finally {
    restoreMathRandom();
  }
});
