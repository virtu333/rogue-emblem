import { describe, expect, it } from 'vitest';
import {
  BLESSINGS_CONTRACT_VERSION,
  validateBlessingsConfig,
  assertValidBlessingsConfig,
  buildBlessingIndex,
  createSeededRng,
  rollCostForBlessing,
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
    expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('rejects missing costPools entries in v2', () => {
    const gameData = loadGameData();
    const copy = JSON.parse(JSON.stringify(gameData.blessings));
    delete copy.costPools['3'];
    const result = validateBlessingsConfig(copy);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('costPools.3'))).toBe(true);
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

  it('rollCostForBlessing avoids boon/cost type overlap when possible', () => {
    const blessing = {
      id: 'test',
      boons: [{ type: 'battle_gold_multiplier_delta', params: { value: 0.1 } }],
    };
    const pool = [
      {
        label: '-10% battle gold',
        effects: [{ type: 'battle_gold_multiplier_delta', params: { value: -0.1 } }],
      },
      {
        label: '-1 deploy',
        effects: [{ type: 'deploy_cap_delta', params: { value: -1 } }],
      },
    ];
    const picked = rollCostForBlessing(pool, blessing, () => 0);
    expect(picked?.label).toBe('-1 deploy');
  });

  it('rollCostForBlessing falls back to full pool if all costs conflict', () => {
    const blessing = {
      id: 'test',
      boons: [{ type: 'battle_gold_multiplier_delta', params: { value: 0.1 } }],
    };
    const pool = [
      {
        label: '-10% battle gold',
        effects: [{ type: 'battle_gold_multiplier_delta', params: { value: -0.1 } }],
      },
      {
        label: '-15% battle gold',
        effects: [{ type: 'battle_gold_multiplier_delta', params: { value: -0.15 } }],
      },
    ];
    const picked = rollCostForBlessing(pool, blessing, () => 0.75);
    expect(['-10% battle gold', '-15% battle gold']).toContain(picked?.label);
  });

  it('selectBlessingOptions is deterministic for same seed and includes rolled costs for T2+', () => {
    const gameData = loadGameData();
    const rngA = createSeededRng(1337);
    const rngB = createSeededRng(1337);
    const a = selectBlessingOptions(gameData.blessings, rngA, { count: 4 });
    const b = selectBlessingOptions(gameData.blessings, rngB, { count: 4 });
    expect(a.map((x) => ({ id: x.id, cost: x.rolledCost?.label || null }))).toEqual(
      b.map((x) => ({ id: x.id, cost: x.rolledCost?.label || null })),
    );
    expect(a.some((x) => x.tier >= 2 && x.rolledCost)).toBe(true);
  });

  it('selectBlessingOptions includes at least one tier-1 by default', () => {
    const gameData = loadGameData();
    const rng = createSeededRng(7);
    const selected = selectBlessingOptions(gameData.blessings, rng, { count: 3 });
    expect(selected.some((x) => x.tier === 1)).toBe(true);
  });

  it('respects excludes rules when selecting options', () => {
    const config = {
      version: 2,
      blessings: [
        {
          id: 'a',
          name: 'A',
          tier: 1,
          description: 'A',
          boons: [{ type: 'noop', params: {} }],
          costs: [],
          excludes: ['b'],
        },
        {
          id: 'b',
          name: 'B',
          tier: 2,
          description: 'B',
          boons: [{ type: 'noop', params: {} }],
          costs: [],
        },
        {
          id: 'c',
          name: 'C',
          tier: 2,
          description: 'C',
          boons: [{ type: 'noop', params: {} }],
          costs: [],
        },
      ],
      costPools: {
        2: [{ label: '-1 deploy', effects: [{ type: 'deploy_cap_delta', params: { value: -1 } }] }],
        3: [
          {
            label: '-2 DEF act1',
            effects: [
              { type: 'act_stat_delta_all_units', params: { act: 'act1', stat: 'DEF', value: -2 } },
            ],
          },
        ],
        4: [
          {
            label: '-30% gold',
            effects: [{ type: 'battle_gold_multiplier_delta', params: { value: -0.3 } }],
          },
        ],
      },
    };
    const selected = selectBlessingOptions(config, createSeededRng(1), { count: 3 });
    const ids = selected.map((x) => x.id);
    expect(ids.includes('a') && ids.includes('b')).toBe(false);
  });
});
