import { beforeEach, describe, expect, it } from 'vitest';
import {
  getBlessingAnalyticsSummary,
  loadBlessingAnalytics,
  recordBlessingRunOutcome,
  recordBlessingSelection,
} from '../src/utils/blessingAnalytics.js';

function installMemoryStorage() {
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); },
      clear: () => { store.clear(); },
    },
  });
}

describe('blessingAnalytics', () => {
  beforeEach(() => {
    installMemoryStorage();
    globalThis.localStorage.clear();
  });

  it('records offer and pick counts for a selected blessing', () => {
    recordBlessingSelection({
      offeredIds: ['steady_hands', 'coin_of_fate', 'merchant_bane'],
      chosenId: 'coin_of_fate',
    });

    const snapshot = loadBlessingAnalytics();
    expect(snapshot.global.selections).toBe(1);
    expect(snapshot.global.runsWithBlessing).toBe(1);
    expect(snapshot.blessings.steady_hands.offers).toBe(1);
    expect(snapshot.blessings.coin_of_fate.offers).toBe(1);
    expect(snapshot.blessings.coin_of_fate.picks).toBe(1);
  });

  it('records skipped blessing selections', () => {
    recordBlessingSelection({
      offeredIds: ['steady_hands', 'coin_of_fate', 'merchant_bane'],
      chosenId: null,
    });

    const snapshot = loadBlessingAnalytics();
    expect(snapshot.global.runsSkippedBlessing).toBe(1);
    expect(snapshot.global.runsWithBlessing).toBe(0);
  });

  it('records run outcomes and computes summary rates', () => {
    recordBlessingSelection({ offeredIds: ['iron_oath', 'worldly_stride'], chosenId: 'iron_oath' });
    recordBlessingRunOutcome({
      activeBlessings: ['iron_oath'],
      result: 'victory',
      actIndex: 2,
      completedBattles: 7,
    });

    const { snapshot, perBlessing } = getBlessingAnalyticsSummary();
    expect(snapshot.global.runsCompleted).toBe(1);
    expect(snapshot.global.victories).toBe(1);

    const iron = perBlessing.find(x => x.id === 'iron_oath');
    expect(iron).toBeTruthy();
    expect(iron.wins).toBe(1);
    expect(iron.winRate).toBe(1);
    expect(iron.avgActReached).toBe(3);
    expect(iron.avgBattles).toBe(7);
  });
});

