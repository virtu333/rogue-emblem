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
      setItem: (key, value) => {
        store.set(key, String(value));
      },
      removeItem: (key) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
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
    recordBlessingSelection({ offeredIds: ['iron_oath', 'pilgrim_coin'], chosenId: 'iron_oath' });
    recordBlessingRunOutcome({
      activeBlessings: ['iron_oath'],
      result: 'victory',
      actIndex: 2,
      completedBattles: 7,
    });

    const { snapshot, perBlessing } = getBlessingAnalyticsSummary();
    expect(snapshot.global.runsCompleted).toBe(1);
    expect(snapshot.global.victories).toBe(1);

    const iron = perBlessing.find((x) => x.id === 'iron_oath');
    expect(iron).toBeTruthy();
    expect(iron.wins).toBe(1);
    expect(iron.winRate).toBe(1);
    expect(iron.avgActReached).toBe(3);
    expect(iron.avgBattles).toBe(7);
  });

  it('accepts activeBlessings in object-entry format', () => {
    recordBlessingRunOutcome({
      activeBlessings: [{ id: 'iron_oath', rolledCost: null }],
      result: 'defeat',
      actIndex: 1,
      completedBattles: 3,
    });

    const snapshot = loadBlessingAnalytics();
    expect(snapshot.blessings.iron_oath.runs).toBe(1);
    expect(snapshot.blessings.iron_oath.losses).toBe(1);
  });

  it('counts a gift run as a gift, never a skipped blessing, and its card as a grant, not a pick', () => {
    // Failure: a run that took the shrine's gift reads as "skipped the blessing" (the skip rate
    // swells with every gift taken), or the Reliquary's card counts as picked at the shrine.
    recordBlessingSelection({
      offeredIds: ['steady_hands', 'coin_of_fate', 'merchant_bane'],
      chosenId: null,
      giftOfferedId: 'sealed_reliquary',
      giftId: 'sealed_reliquary',
      grantedBlessingId: 'iron_oath',
    });
    // Offered, not taken: an offer, nothing else.
    recordBlessingSelection({
      offeredIds: ['steady_hands'],
      chosenId: 'steady_hands',
      giftOfferedId: 'fallen_hoard',
    });
    const snapshot = loadBlessingAnalytics();
    expect(snapshot.global.runsSkippedBlessing).toBe(0);
    expect(snapshot.global.runsWithGift).toBe(1);
    expect(snapshot.global.runsWithBlessing).toBe(1);
    expect(snapshot.gifts.sealed_reliquary).toMatchObject({ offers: 1, picks: 1 });
    expect(snapshot.gifts.fallen_hoard).toMatchObject({ offers: 1, picks: 0 });
    expect(snapshot.blessings.iron_oath).toMatchObject({ picks: 0, offers: 0, giftGrants: 1 });

    // The outcome goes to the gift; its card's own record is left alone.
    recordBlessingRunOutcome({
      activeBlessings: ['iron_oath', 'pilgrim_coin'],
      result: 'victory',
      actIndex: 1,
      completedBattles: 4,
      startGift: { id: 'sealed_reliquary', granted: [{ kind: 'blessing', id: 'iron_oath' }] },
    });
    const after = loadBlessingAnalytics();
    expect(after.gifts.sealed_reliquary).toMatchObject({ runs: 1, wins: 1, losses: 0 });
    expect(after.blessings.iron_oath.runs).toBe(0);
    expect(after.blessings.pilgrim_coin.runs).toBe(1);
  });

  it('loads an older snapshot without gift fields', () => {
    // Failure: a device's saved analytics from before gifts throws on the first gift run.
    globalThis.localStorage.setItem(
      'emblem_rogue_blessing_analytics_v1',
      JSON.stringify({
        version: 1,
        global: { selections: 2, runsSkippedBlessing: 1 },
        blessings: { iron_oath: { offers: 1, picks: 1 } },
      }),
    );
    recordBlessingSelection({ chosenId: null, giftId: 'fallen_hoard' });
    const snapshot = loadBlessingAnalytics();
    expect(snapshot.global.runsWithGift).toBe(1);
    expect(snapshot.global.runsSkippedBlessing).toBe(1);
    expect(snapshot.gifts.fallen_hoard.picks).toBe(1);
  });
});
