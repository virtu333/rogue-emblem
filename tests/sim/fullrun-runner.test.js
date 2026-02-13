import { describe, it, expect } from 'vitest';
import {
  parseArgsFrom,
  buildSeedList,
  computeSummary,
  evaluateThresholdBreaches,
} from './fullrun-runner.js';

describe('fullrun-runner helpers', () => {
  it('builds a deterministic seed range when start and end are provided', () => {
    const opts = parseArgsFrom(['--seed-start', '5', '--seed-end', '8']);
    const range = buildSeedList(opts);
    expect(range.startSeed).toBe(5);
    expect(range.endSeed).toBe(8);
    expect(range.seeds).toEqual([5, 6, 7, 8]);
  });

  it('uses explicit single seed when provided', () => {
    const opts = parseArgsFrom(['--seed', '77', '--seeds', '200']);
    const range = buildSeedList(opts);
    expect(range.startSeed).toBe(77);
    expect(range.endSeed).toBe(77);
    expect(range.seeds).toEqual([77]);
  });

  it('parses economy window threshold options', () => {
    const opts = parseArgsFrom([
      '--min-avg-gold', '4000',
      '--max-avg-gold', '6500',
      '--min-avg-shop-spent', '1000',
      '--max-avg-shop-spent', '6500',
      '--min-promotion-by-act2-rate', '10',
      '--max-promotion-by-act2-rate', '50',
    ]);
    expect(opts.minAvgGold).toBe(4000);
    expect(opts.maxAvgGold).toBe(6500);
    expect(opts.minAvgShopSpent).toBe(1000);
    expect(opts.maxAvgShopSpent).toBe(6500);
    expect(opts.minPromotionByAct2Rate).toBe(10);
    expect(opts.maxPromotionByAct2Rate).toBe(50);
  });

  it('evaluates metric threshold breaches', () => {
    const summary = computeSummary({
      runs: 10,
      victories: 2,
      defeats: 8,
      timeouts: 1,
      totalNodes: 20,
      totalBattles: 15,
      totalTurns: 120,
      totalGold: 3000,
      totalShopSpent: 1200,
      totalRecruits: 1,
      totalUnitsLost: 10,
      promotionsByAct2Runs: 1,
      totalInvalidShopEntries: 12,
    });

    const breaches = evaluateThresholdBreaches(summary, {
      mode: 'strict',
      timeoutRateThreshold: 8,
      maxTimeoutRate: 5,
      minWinRate: 30,
      maxDefeatRate: 70,
      minAvgNodes: 3,
      maxAvgNodes: null,
      minAvgGold: 500,
      minAvgShopSpent: 200,
      maxAvgShopSpent: 100,
      minAvgRecruits: 0.2,
      maxAvgUnitsLost: 0.8,
      maxAvgTurns: 10,
      minPromotionByAct2Rate: 20,
      maxPromotionByAct2Rate: 5,
      maxAvgInvalidShopEntries: 0.1,
    });

    expect(breaches.length).toBeGreaterThanOrEqual(5);
    expect(breaches.some((line) => line.includes('win_rate_pct'))).toBe(true);
    expect(breaches.some((line) => line.includes('defeat_rate_pct'))).toBe(true);
    expect(breaches.some((line) => line.includes('timeout_rate_pct'))).toBe(true);
    expect(breaches.some((line) => line.includes('avg_shop_spent'))).toBe(true);
    expect(breaches.some((line) => line.includes('promotion_by_act2_rate_pct'))).toBe(true);
    expect(breaches.some((line) => line.includes('avg_invalid_shop_entries'))).toBe(true);
  });
});
