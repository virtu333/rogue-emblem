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

  it('never assigns affixes to non-Entity bosses', () => {
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

  describe('Entity affix assignment', () => {
    const ENTITY_CONFIG = {
      affixes: [
        { id: 'regenerator', tier: 1, weight: 1 },
        { id: 'thorns', tier: 1, weight: 1 },
        { id: 'venomous', tier: 1, weight: 1 },
        { id: 'corrosive', tier: 1, weight: 1 },
        { id: 'shielded', tier: 1, weight: 1 },
        { id: 'berserker', tier: 1, weight: 1 },
        { id: 'rally', tier: 1, weight: 1 },
        { id: 'anchored', tier: 1, weight: 1 },
        { id: 'teleporter', tier: 2, weight: 1 },
        { id: 'deathburst', tier: 1, weight: 1 },
        { id: 'haste', tier: 1, weight: 1 },
      ],
      config: {
        difficultyGating: {
          normal: { affixChance: 0, maxAffixesPerUnit: 0, tierPool: [] },
          hard: { affixChance: 1, maxAffixesPerUnit: 1, tierPool: [1] },
          lunatic: { affixChance: 1, maxAffixesPerUnit: 2, tierPool: [1, 2] },
        },
        actScaling: {
          act1: { chanceMultiplier: 1 },
          finalBoss: { chanceMultiplier: 1 },
        },
        exclusions: [],
        bossAffixRules: {
          enabled: true,
          entityOnly: true,
          entityAffixCount: 2,
          entityAffixPool: [
            'regenerator',
            'thorns',
            'venomous',
            'corrosive',
            'shielded',
            'berserker',
            'rally',
            'anchored',
          ],
          excludeFromEntity: ['teleporter', 'deathburst', 'haste'],
        },
      },
    };

    it('assigns affixes to Entity boss from curated pool', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      try {
        const spawns = [{ className: 'Entity', isBoss: true, isEntity: true }];
        const next = assignAffixesToEnemySpawns(spawns, {
          affixConfig: ENTITY_CONFIG,
          difficultyId: 'lunatic',
          act: 'finalBoss',
        });
        expect(Array.isArray(next[0].affixes)).toBe(true);
        expect(next[0].affixes.length).toBe(2);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('excludes banned affixes from Entity', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      try {
        const spawns = [{ className: 'Entity', isBoss: true, isEntity: true }];
        const next = assignAffixesToEnemySpawns(spawns, {
          affixConfig: ENTITY_CONFIG,
          difficultyId: 'lunatic',
          act: 'finalBoss',
        });
        // AffixEngine returns affix IDs as strings, not objects
        const ids = next[0].affixes || [];
        expect(ids).not.toContain('teleporter');
        expect(ids).not.toContain('deathburst');
        expect(ids).not.toContain('haste');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('skips Entity affixes when bossAffixRules disabled', () => {
      const disabledConfig = {
        ...ENTITY_CONFIG,
        config: {
          ...ENTITY_CONFIG.config,
          bossAffixRules: { enabled: false },
        },
      };
      const spawns = [{ className: 'Entity', isBoss: true, isEntity: true }];
      const next = assignAffixesToEnemySpawns(spawns, {
        affixConfig: disabledConfig,
        difficultyId: 'lunatic',
        act: 'finalBoss',
      });
      expect(next[0].affixes).toBeUndefined();
    });
  });
});
