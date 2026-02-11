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
      totalRecruits: 1,
      totalUnitsLost: 10,
    });

    const breaches = evaluateThresholdBreaches(summary, {
      mode: 'strict',
      timeoutRateThreshold: 8,
      maxTimeoutRate: 5,
      minWinRate: 30,
      maxDefeatRate: 70,
      minAvgNodes: 3,
      maxAvgNodes: null,
      minAvgRecruits: 0.2,
      maxAvgUnitsLost: 0.8,
      maxAvgTurns: 10,
    });

    expect(breaches.length).toBeGreaterThanOrEqual(5);
    expect(breaches.some((line) => line.includes('win_rate_pct'))).toBe(true);
    expect(breaches.some((line) => line.includes('defeat_rate_pct'))).toBe(true);
    expect(breaches.some((line) => line.includes('timeout_rate_pct'))).toBe(true);
  });
});
