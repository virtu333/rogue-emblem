import { describe, expect, it } from 'vitest';
import { assignAffixesToEnemySpawns } from '../src/engine/AffixEngine.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { loadGameData } from './testData.js';

const { affixes } = loadGameData();

function spawns(n = 8) {
  const list = [{ className: 'Fighter', level: 5, isBoss: true }];
  for (let i = 0; i < n; i++)
    list.push({ className: i % 2 ? 'Knight' : 'Myrmidon', level: 4, col: i, row: 0 });
  return list;
}

function seeded(seed, fn) {
  const prev = Math.random;
  Math.random = createSeededRng(seed);
  try {
    return fn();
  } finally {
    Math.random = prev;
  }
}

const count = (list) => list.filter((s) => !s.isBoss && s.affixes?.length).length;
const tierOf = (id) => affixes.affixes.find((a) => a.id === id)?.tier;

describe('AffixEngine · Eclipse overrides', () => {
  it('without an eclipse option behaves exactly as before', () => {
    const a = seeded(3, () =>
      assignAffixesToEnemySpawns(spawns(), {
        affixConfig: affixes,
        difficultyId: 'hard',
        act: 'act2',
      }),
    );
    const b = seeded(3, () =>
      assignAffixesToEnemySpawns(spawns(), {
        affixConfig: affixes,
        difficultyId: 'hard',
        act: 'act2',
        eclipse: null,
      }),
    );
    expect(b).toEqual(a);
  });

  it('guarantees tier-1 affixes on eclipsed battles even where gating gives none', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const out = seeded(seed, () =>
        assignAffixesToEnemySpawns(spawns(), {
          affixConfig: affixes,
          difficultyId: 'normal',
          act: 'act1', // Normal excludes Act 1 from rolled affixes entirely
          eclipse: { guaranteedCount: 2, guaranteedTier: 1 },
        }),
      );
      expect(count(out)).toBe(2);
      for (const s of out.filter((x) => x.affixes)) {
        expect(s.isBoss).toBeFalsy();
        expect(s.affixes).toHaveLength(1);
        expect(tierOf(s.affixes[0])).toBe(1);
        // Normal's own exclusions still hold (haste is tier 1 but excluded on Normal).
        expect(s.affixes[0]).not.toBe('haste');
      }
    }
  });

  it('never exceeds the available enemies and never touches bosses', () => {
    const out = seeded(4, () =>
      assignAffixesToEnemySpawns(
        [{ className: 'Fighter', isBoss: true }, { className: 'Knight' }],
        {
          affixConfig: affixes,
          difficultyId: 'normal',
          act: 'act1',
          eclipse: { guaranteedCount: 2, guaranteedTier: 1 },
        },
      ),
    );
    expect(out[0].affixes).toBeUndefined();
    expect(out[1].affixes).toHaveLength(1);
  });

  it('Normal uses Hard gating from Umbral (affixes appear in Act 1 and more often)', () => {
    let plain = 0;
    let umbral = 0;
    for (let seed = 1; seed <= 60; seed++) {
      plain += count(
        seeded(seed, () =>
          assignAffixesToEnemySpawns(spawns(), {
            affixConfig: affixes,
            difficultyId: 'normal',
            act: 'act3',
          }),
        ),
      );
      umbral += count(
        seeded(seed, () =>
          assignAffixesToEnemySpawns(spawns(), {
            affixConfig: affixes,
            difficultyId: 'normal',
            act: 'act3',
            eclipse: { gatingDifficultyId: 'hard', extraMaxAffixes: 0, guaranteedCount: 0 },
          }),
        ),
      );
    }
    expect(umbral).toBeGreaterThan(plain);
  });

  it('Totality allows one more affix per unit', () => {
    let maxBefore = 0;
    let maxAfter = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const base = { affixConfig: affixes, difficultyId: 'lunatic', act: 'act3' };
      const a = seeded(seed, () => assignAffixesToEnemySpawns(spawns(12), base));
      const b = seeded(seed, () =>
        assignAffixesToEnemySpawns(spawns(12), {
          ...base,
          eclipse: { gatingDifficultyId: null, extraMaxAffixes: 1, guaranteedCount: 0 },
        }),
      );
      for (const s of a) maxBefore = Math.max(maxBefore, s.affixes?.length || 0);
      for (const s of b) maxAfter = Math.max(maxAfter, s.affixes?.length || 0);
    }
    expect(maxBefore).toBeLessThanOrEqual(2);
    expect(maxAfter).toBe(3);
  });
});
