import { describe, expect, it, vi } from 'vitest';
import { assignAffixesToEnemySpawns } from '../src/engine/AffixEngine.js';

const BASE_CONFIG = {
  affixes: [
    { id: 'thorns', tier: 1, weight: 1 },
    { id: 'regenerator', tier: 1, weight: 1 },
    { id: 'teleporter', tier: 2, weight: 1 },
    { id: 'anchored', tier: 1, weight: 1 },
  ],
  config: {
    difficultyGating: {
      normal: { affixChance: 0, maxAffixesPerUnit: 0, tierPool: [] },
      hard: { affixChance: 1, maxAffixesPerUnit: 1, tierPool: [1] },
      lunatic: { affixChance: 1, maxAffixesPerUnit: 2, tierPool: [1, 2] },
    },
    actScaling: {
      act1: { chanceMultiplier: 1 },
      act2: { chanceMultiplier: 1 },
      act3: { chanceMultiplier: 1 },
      finalBoss: { chanceMultiplier: 1 },
    },
    exclusions: [
      { rule: 'mutually_exclusive', affixes: ['teleporter', 'anchored'] },
      { rule: 'class_exclude', affix: 'teleporter', classes: ['Knight'] },
    ],
  },
};

describe('AffixEngine', () => {
  it('does not assign affixes on normal difficulty', () => {
    const spawns = [{ className: 'Fighter', isBoss: false }];
    const next = assignAffixesToEnemySpawns(spawns, {
      affixConfig: BASE_CONFIG,
      difficultyId: 'normal',
      act: 'act1',
    });
    expect(next[0].affixes).toBeUndefined();
  });

  it('assigns only allowed tier affixes on hard', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const spawns = [{ className: 'Fighter', isBoss: false }];
      const next = assignAffixesToEnemySpawns(spawns, {
        affixConfig: BASE_CONFIG,
        difficultyId: 'hard',
        act: 'act1',
      });
      expect(Array.isArray(next[0].affixes)).toBe(true);
      expect(next[0].affixes.length).toBe(1);
      expect(next[0].affixes).not.toContain('teleporter');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('never assigns class-excluded affixes', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const spawns = [{ className: 'Knight', isBoss: false }];
      const next = assignAffixesToEnemySpawns(spawns, {
        affixConfig: BASE_CONFIG,
        difficultyId: 'lunatic',
        act: 'act1',
      });
      expect(next[0].affixes || []).not.toContain('teleporter');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('never assigns mutually exclusive affix pairs to one unit', () => {
    const randomValues = [0, 0, 0.99, 0, 0, 0];
    let idx = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => randomValues[idx++] ?? 0);
    try {
      const spawns = [{ className: 'Fighter', isBoss: false }];
      const next = assignAffixesToEnemySpawns(spawns, {
        affixConfig: BASE_CONFIG,
        difficultyId: 'lunatic',
        act: 'act1',
      });
      const assigned = new Set(next[0].affixes || []);
      expect(!(assigned.has('teleporter') && assigned.has('anchored'))).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('never assigns affixes to bosses', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const spawns = [{ className: 'Fighter', isBoss: true }];
      const next = assignAffixesToEnemySpawns(spawns, {
        affixConfig: BASE_CONFIG,
        difficultyId: 'lunatic',
        act: 'act1',
      });
      expect(next[0].affixes).toBeUndefined();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

