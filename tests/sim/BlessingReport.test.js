// The blessing report's statistics (sim/lib/BlessingReport.js): the family-wise cutoff follows
// the number of comparisons actually made, family-wise flags need a real sample, an earned
// card's takers and decliners are compared on one clock, and a card one source hands out alone is
// compared within that source.
import { describe, it, expect } from 'vitest';
import { loadGameData } from '../testData.js';
import {
  MIN_TAKEN_FOR_FAMILY,
  MIN_TAKEN_FOR_FLAG,
  earnedCardRows,
  familyCutoff,
  flagsFor,
  normalQuantile,
} from '../../sim/lib/BlessingReport.js';

describe('familyCutoff', () => {
  it('is the two-sided Bonferroni quantile of the comparisons made', () => {
    // Reference quantiles for alpha / (2 m): 0.025 -> 1.960, 0.05/(2*198) -> 3.66, /(2*390) -> 3.83.
    expect(familyCutoff(1)).toBeCloseTo(1.96, 2);
    expect(familyCutoff(198)).toBeCloseTo(3.66, 2);
    expect(familyCutoff(390)).toBeCloseTo(3.83, 2);
    expect(familyCutoff(390)).toBeGreaterThan(familyCutoff(198));
  });

  it('inverts the normal distribution', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.999)).toBeCloseTo(3.090232, 5);
  });
});

describe('flagsFor', () => {
  const row = (taken, z) => ({
    taken,
    exercise: null,
    diffs: { koBattleRate: { z, delta: -0.1, lo: -0.2, hi: -0.01 } },
  });
  const zFamily = familyCutoff(390);

  it('marks a difference past the cutoff family-wise only with enough takers', () => {
    const level = (taken, z) => flagsFor(row(taken, z), { zFamily })[0]?.level;
    expect(level(MIN_TAKEN_FOR_FAMILY, -(zFamily + 0.1))).toBe('family-wise');
    expect(level(MIN_TAKEN_FOR_FAMILY - 1, -(zFamily + 0.1))).toBe('nominal');
    expect(level(MIN_TAKEN_FOR_FAMILY, -(zFamily - 0.1))).toBe('nominal');
  });

  it('flags nothing below the nominal minimum, and nothing family-wise without a cutoff', () => {
    expect(flagsFor(row(MIN_TAKEN_FOR_FLAG - 1, -9), { zFamily })).toEqual([]);
    expect(flagsFor(row(100, -9))[0].level).toBe('nominal');
  });
});

describe('earnedCardRows: takers and decliners share one clock', () => {
  const gameData = loadGameData();
  const card = gameData.blessings.blessings.find((b) => b.earned && !b.twist);
  const battle = (kos) => ({ commanderKOs: kos, unitDeaths: 0, stalled: false, rewinds: 0 });
  // Ten battles: a KO in the first five, none after, so a window that starts later looks better.
  const log = Array.from({ length: 10 }, (_, i) => battle(i < 5 ? 1 : 0));
  const run = (offers) => ({
    difficulty: 'normal',
    battleLog: log,
    gold: 0,
    heldAtEnd: [],
    offers: offers.map(([battleIndex, taken]) => ({
      id: card.id,
      source: 'act_boss',
      key: 'act1',
      battleIndex,
      act: 1,
      taken,
    })),
  });

  it('counts a taker only at the first offer; a later taker counts with the decliners', () => {
    const results = [
      run([[2, true]]),
      run([[2, true]]),
      run([[2, false]]),
      run([[2, false]]),
      run([
        [2, false],
        [6, true],
      ]),
    ];
    const row = earnedCardRows(results, gameData).find((r) => r.id === card.id);
    expect(row.taken).toBe(2);
    expect(row.laterTakers).toBe(1);
    expect(row.offeredRuns).toBe(5);
    expect(row.diffs.koBattleRate.nA).toBe(2);
    expect(row.diffs.koBattleRate.nB).toBe(3);
    expect(row.sources.act_boss).toBe(3);
    // Every counted run reads its battles from index 2: same window, so no difference here.
    expect(row.diffs.koBattleRate.delta).toBeCloseTo(0, 9);
  });
});

describe('earnedCardRows: a card one source hands out alone', () => {
  const gameData = loadGameData();
  const battle = (kos) => ({ commanderKOs: kos, unitDeaths: 0, stalled: false, rewinds: 0 });
  const log = Array.from({ length: 10 }, (_, i) => battle(i < 5 ? 1 : 0));
  const offer = (id, source, taken) => ({ id, source, key: source, battleIndex: 2, act: 3, taken });
  const run = (offers) => ({
    difficulty: 'normal',
    battleLog: log,
    gold: 0,
    heldAtEnd: [],
    offers,
  });

  it('stays on its source when a few runs pass it in a sanctum pair', () => {
    // Hollow Hourglass is an eclipsed elite's drop; it also turns up, rarely, in a sanctum pair.
    // Two runs passing it there must not turn the elite drops into takers compared with them.
    const results = [
      run([offer('hollow_hourglass', 'eclipsed_elite', true)]),
      run([offer('hollow_hourglass', 'eclipsed_elite', true)]),
      run([offer('hollow_hourglass', 'eclipsed_elite', true)]),
      run([offer('second_dawn', 'eclipsed_elite', true)]),
      run([offer('second_dawn', 'eclipsed_elite', true)]),
      run([offer('hollow_hourglass', 'sanctum', false)]),
      run([offer('hollow_hourglass', 'sanctum', false)]),
    ];
    const row = earnedCardRows(results, gameData).find((r) => r.id === 'hollow_hourglass');
    expect(row.basis).toBe('source');
    expect(row.taken).toBe(3);
    expect(row.offeredRuns).toBe(3);
    // Against the runs whose first elite card was another one; the sanctum runs are left out.
    expect(row.diffs.koBattleRate.nA).toBe(3);
    expect(row.diffs.koBattleRate.nB).toBe(2);
  });

  it('is compared within its pairs when the pairs hand it out more', () => {
    const results = [
      run([offer('hollow_hourglass', 'sanctum', true)]),
      run([offer('hollow_hourglass', 'sanctum', true)]),
      run([offer('hollow_hourglass', 'sanctum', false)]),
      run([offer('hollow_hourglass', 'sanctum', false)]),
      run([offer('hollow_hourglass', 'eclipsed_elite', true)]),
      run([offer('second_dawn', 'eclipsed_elite', true)]),
    ];
    const row = earnedCardRows(results, gameData).find((r) => r.id === 'hollow_hourglass');
    expect(row.basis).toBe('pair');
    // Two pair takers and the elite's taker against the two that passed it in a pair.
    expect(row.diffs.koBattleRate.nA).toBe(3);
    expect(row.diffs.koBattleRate.nB).toBe(2);
  });
});
