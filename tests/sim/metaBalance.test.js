import { describe, it, expect } from 'vitest';
import { loadGameData } from '../testData.js';
import {
  PROFILES,
  PR161_PRICES,
  makeMeta,
  activeEffects,
  buildVariant,
  priceSchedule,
  purchaseCost,
  buyBetweenRuns,
  validateLoadout,
  pairedStats,
} from '../../sim/lib/MetaBalance.js';
import {
  campaignSeed,
  simulateRun,
  summarizeAudit,
  OUTCOMES,
} from '../../sim/lib/MetaBalanceExperiment.js';
import { MetaBalanceDriver } from '../../sim/lib/MetaBalanceDriver.js';
import { GameDriver } from '../harness/GameDriver.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { parseOptions, runExperiment } from '../../sim/metaBalance.js';

const data = loadGameData();
describe('meta balance experiment integrity', () => {
  it('validates profiles and charges prerequisite entry costs without inventing milestones', () => {
    for (const p of Object.values(PROFILES))
      expect(() => makeMeta(data.metaUpgrades, p)).not.toThrow();
    const v = buildVariant(data.metaUpgrades, PROFILES.fresh, 'recruit_spd_flat=2');
    expect(v.purchases).toEqual({ recruit_spd_growth: 3, recruit_spd_flat: 2 });
    expect(v.costs).toEqual({ supply: 65 + 85 + 130 + 150 + 365, valor: 0 });
    expect(() => buildVariant(data.metaUpgrades, PROFILES.fresh, 'deploy_limit')).toThrow(
      'Milestone locked',
    );
    expect(() => makeMeta(data.metaUpgrades, { purchases: { recruit_spd_flat: 1 } })).toThrow(
      'Unmet prerequisites',
    );
  });

  it('compares the next cumulative tier, rather than stacking cumulative bonuses', () => {
    const p = { purchases: { recruit_spd_growth: 1 }, milestones: [] };
    const v = buildVariant(data.metaUpgrades, p, 'recruit_spd_growth');
    expect(v.costs.supply).toBe(85);
    const base = activeEffects(makeMeta(data.metaUpgrades, p), data);
    const after = activeEffects(
      makeMeta(data.metaUpgrades, { ...p, purchases: v.purchases }),
      data,
    );
    expect(after.growthBonuses.SPD - base.growthBonuses.SPD).toBe(5);
  });

  it('uses frozen pre-161 Battalion prices and varies deployment independently', () => {
    const current = priceSchedule(data.metaUpgrades, 0.5, 150);
    for (const u of current) {
      const original = data.metaUpgrades.find((x) => x.id === u.id);
      expect(u.costs).toEqual(original.costs);
    }
    const old = priceSchedule(data.metaUpgrades, 1, 500);
    for (const [id, costs] of Object.entries(PR161_PRICES.from))
      expect(old.find((u) => u.id === id).costs).toEqual(costs);
    expect(old.find((u) => u.id === 'recruit_spd_growth').costs).toEqual(
      current.find((u) => u.id === 'recruit_spd_growth').costs,
    );
    expect(
      priceSchedule(data.metaUpgrades, 0.65, 150).find((u) => u.id === 'recruit_skill').costs,
    ).toEqual([325]);
  });

  it('spends separate earned budgets through real prerequisite checks', () => {
    const meta = makeMeta(data.metaUpgrades);
    meta.totalSupply = 800;
    meta.totalValor = 600;
    const bought = buyBetweenRuns(meta, 'battalion');
    const spent = purchaseCost(data.metaUpgrades, meta.purchasedUpgrades);
    expect(spent.supply + meta.totalSupply).toBe(800);
    expect(spent.valor + meta.totalValor).toBe(600);
    expect(meta.getUpgradeLevel('deploy_limit')).toBe(0);
    expect(bought.some((b) => b.id === 'extra_starting_unit_pool')).toBe(true);
    expect(() => validateLoadout(meta)).not.toThrow();
  });

  it('assigns purchased skills exclusively and increases used slots only when available', () => {
    const meta = makeMeta(data.metaUpgrades, {
      purchases: { unlock_guard: 1, unlock_miracle: 1, unlock_luna: 1, extra_skill_slot: 1 },
    });
    const effects = activeEffects(meta, data);
    const skills = Object.values(effects.startingSkills).flat();
    expect(new Set(skills).size).toBe(3);
    expect(skills).toContain('luna');
    expect(Object.values(effects.startingSkills).every((s) => s.length <= 2)).toBe(true);
  });

  it('checks pair identities and withholds an interval for one observation', () => {
    const base = [
      { seed: 1, battles: 2 },
      { seed: 2, battles: 1 },
    ];
    expect(
      pairedStats(
        base,
        [
          { seed: 1, battles: 3 },
          { seed: 2, battles: 0 },
        ],
        'battles',
      ),
    ).toMatchObject({ mean: 0, se: 1, nonzeroPairs: 2 });
    expect(pairedStats(base.slice(0, 1), base.slice(0, 1), 'battles').ci95).toBeNull();
    expect(() => pairedStats(base, [...base].reverse(), 'battles')).toThrow('seed mismatch');
  });

  it('does not price unused deployment capacity as a measured zero', () => {
    const v = buildVariant(data.metaUpgrades, PROFILES.act1, 'deploy_limit');
    const rows = ['baseline', 'deploy_limit'].map((variant) => ({
      ...Object.fromEntries(OUTCOMES.map((key) => [key, 0])),
      seed: 1,
      variant,
      censored: false,
      win: 0,
      battles: 1,
      extraSlotFilled: 0,
      exposure: { ordinaryRecruitDeployments: 0 },
    }));
    const summary = summarizeAudit(rows, [v])[0];
    expect(summary.status).toBe('partially_exercised');
    expect(summary.efficiency).toBeNull();
  });

  it('rejects malformed CLI input instead of silently changing the experiment', () => {
    for (const args of [
      ['--seeds', '0'],
      ['--workers', '1.5'],
      ['--fractions', 'NaN'],
      ['--wat'],
      ['--agent', 'other'],
      ['--variants'],
    ])
      expect(() => parseOptions(args)).toThrow();
  });

  it('saving preserves Supply for a target while spending Valor independently', () => {
    const saver = makeMeta(data.metaUpgrades);
    const shopper = makeMeta(data.metaUpgrades);
    for (const meta of [saver, shopper]) {
      meta.totalSupply = 100;
      meta.totalValor = 100;
    }
    buyBetweenRuns(saver, 'battalion', 'save');
    buyBetweenRuns(shopper, 'battalion', 'affordable');
    expect(saver.totalSupply).toBe(100);
    expect(shopper.totalSupply).toBeLessThan(100);
    expect(saver.totalValor).toBeLessThan(100);
  });

  it('reproduces raw rows across worker counts and price changes do not change fixed ownership', async () => {
    const opts = parseOptions([
      '--seeds',
      '3',
      '--variants',
      'extra_starting_unit_pool',
      '--workers',
      '1',
    ]);
    const one = await runExperiment(opts);
    const two = await runExperiment({ ...opts, workers: 2 });
    expect(two.rows).toEqual(one.rows);
    const a = makeMeta(data.metaUpgrades, PROFILES.act1);
    const b = makeMeta(priceSchedule(data.metaUpgrades, 1, 500), PROFILES.act1);
    const ra = await simulateRun(data, a, 3, opts);
    const rb = await simulateRun(data, b, 3, opts);
    expect(rb.row).toEqual(ra.row);
  }, 30000);

  it('censors timeouts without payouts, purchases, or treating them as player defeats', async () => {
    const opts = { runs: 2, maxActions: 1, agent: 'rescue', route: 'recruit' };
    const c = await campaignSeed(data, opts, 'current', 42);
    expect(c.censored).toBe(true);
    expect(c.history).toHaveLength(1);
    expect(c.history[0]).toMatchObject({
      result: 'timeout',
      bought: [],
      balance: { supply: 0, valor: 0 },
    });
  });

  it('settles real campaign rewards before buying and starts with no paid upgrades', async () => {
    const c = await campaignSeed(
      data,
      { runs: 3, agent: 'rescue', route: 'recruit', buyPolicy: 'battalion' },
      'current',
      7,
    );
    expect(c.history[0].purchasesBefore).toEqual({});
    for (let i = 0; i < c.history.length; i++) {
      const r = c.history[i];
      expect(r.spent.supply + r.balance.supply).toBe(
        c.history.slice(0, i + 1).reduce((n, row) => n + row.supply, 0),
      );
      expect(r.spent.valor + r.balance.valor).toBe(
        c.history.slice(0, i + 1).reduce((n, row) => n + row.valor, 0),
      );
      if (i > 0) expect(r.purchasesBefore).toEqual(c.history[i - 1].purchasesAfter);
    }
  }, 30000);

  it('claims rewards and joins a real post-boss recruit before advancing the act', () => {
    installSeed(123);
    try {
      const driver = new MetaBalanceDriver(data);
      driver.init();
      const run = driver.runManager;
      const boss = run.nodeMap.nodes.find((n) => n.type === 'boss');
      const battle = new GameDriver(data, run.getBattleParams(boss), structuredClone(run.roster));
      battle.init();
      battle.battle.goldEarned = 100;
      battle.battle.getTurnPressureState = () => ({ goldMultiplier: 1 });
      const before = run.roster.length;
      expect(driver._completeBattle(battle, structuredClone(run.roster), boss)).toBe(true);
      expect(run.roster.length).toBe(before + 1);
      expect(driver.exposure.bossRecruits).toBe(1);
      expect(run.pendingBattleReward).toBeNull();
      expect(run.pendingBossRecruit).toBeNull();
      expect(run.gold).toBeGreaterThan(100);
    } finally {
      restoreMathRandom();
    }
  });
});
