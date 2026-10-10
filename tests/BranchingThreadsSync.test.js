// Branching Threads past tier 4 and a price rise, as an older build meets them.
//
// The web deploys on merge while the iOS/Android builds lag, so an old client loads meta the
// new client wrote. Ways this can fail, one test (or more) each:
//   - the synced `branching_threads` level passes the old data's four tiers: the old client
//     reads effects[level - 1] out of range (no rerolls) and a refund there returns
//     costs[level - 1] = undefined, so its Supply becomes NaN, saves as 0 and syncs back
//   - the repeat tiers are lost on the new client's own reload
//   - a refund of a tier bought before tiers 3/4 rose to 300/350 pays the new price (+110)
//   - a tier bought after the rise is refunded at the old price (a tier is paid what it cost)
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { REFUND_FEE } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const KEY = 'bt-sync-test';
let store;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

/** Branching Threads as main ships it: four tiers, 250/250 for the last two, no repeat. */
function oldData() {
  return data.metaUpgrades.map((u) => {
    if (u.id !== 'branching_threads') return u;
    const old = { ...u, costs: [100, 200, 250, 250] };
    old.effects = [1, 2, 3, 4].map((n) => ({ rewardRerolls: n }));
    delete old.repeatable;
    return old;
  });
}
const disk = () => JSON.parse(store.get(KEY));
const reload = (upgrades = data.metaUpgrades) => new MetaProgressionManager(upgrades, KEY);

describe('what an old client sees', () => {
  it('never reads a level past its four tiers, however far the new client climbed', () => {
    const m = new MetaProgressionManager(data.metaUpgrades, KEY);
    m.totalSupply = 100 + 200 + 300 + 350 + 400 * 3;
    for (let i = 0; i < 7; i++)
      expect(m.purchaseUpgrade('branching_threads'), `tier ${i + 1}`).toBe(true);
    expect(m.getUpgradeLevel('branching_threads')).toBe(7);
    // What would sync: the old id never passes the old data's tier count.
    expect(disk().purchasedUpgrades.branching_threads).toBe(4);

    const old = reload(oldData());
    old.totalSupply = 1000;
    expect(old.getUpgradeLevel('branching_threads')).toBe(4);
    expect(old.getActiveEffects().rewardRerolls).toBe(4);
    const check = old.canRefund('branching_threads');
    expect(Number.isFinite(check.refundAmount)).toBe(true);
    const supply = old.totalSupply;
    expect(old.refundUpgrade('branching_threads').success).toBe(true);
    expect(Number.isFinite(old.totalSupply)).toBe(true);
    expect(old.totalSupply).toBeGreaterThanOrEqual(supply - REFUND_FEE);
    // The old client's own save keeps the repeat tiers it does not read.
    expect(disk().purchasedUpgrades.branching_threads__repeat_tiers).toBe(3);
  });

  it('the new client reads the full tier back after a reload', () => {
    const m = new MetaProgressionManager(data.metaUpgrades, KEY);
    m.totalSupply = 100 + 200 + 300 + 350 + 400 * 2;
    for (let i = 0; i < 6; i++) m.purchaseUpgrade('branching_threads');
    const again = reload();
    expect(again.getUpgradeLevel('branching_threads')).toBe(6);
    expect(again.getActiveEffects().rewardRerolls).toBe(6);
    // Refunding back under the list leaves no stray repeat key.
    again.totalSupply = 1000;
    again.refundUpgrade('branching_threads');
    again.refundUpgrade('branching_threads');
    expect(disk().purchasedUpgrades.branching_threads__repeat_tiers).toBeUndefined();
    expect(disk().purchasedUpgrades.branching_threads).toBe(4);
  });
});

describe('the price rise (balance revision 4)', () => {
  const seedAt3 = (level) =>
    store.set(
      KEY,
      JSON.stringify({
        balanceRevision: 3,
        totalSupply: 1000,
        totalValor: 0,
        purchasedUpgrades: { branching_threads: level },
      }),
    );

  it('refunds a tier bought before the rise at what it cost, not at the new price', () => {
    seedAt3(4);
    const m = reload();
    expect(m.canRefund('branching_threads').refundAmount).toBe(250);
    expect(m.refundUpgrade('branching_threads').success).toBe(true);
    expect(m.totalSupply).toBe(1000 + 250 - REFUND_FEE);
    expect(m.refundUpgrade('branching_threads').success).toBe(true);
    expect(m.totalSupply).toBe(1000 + 2 * (250 - REFUND_FEE));
    // Tier 2 was never repriced.
    expect(m.canRefund('branching_threads').refundAmount).toBe(200);
    // The record is spent with the tiers.
    expect(reload().legacyTierCosts).toEqual({});
  });

  it('a tier bought after the rise refunds at the new price; older ones keep theirs', () => {
    seedAt3(3);
    const m = reload();
    m.totalSupply = 1000;
    expect(m.purchaseUpgrade('branching_threads')).toBe(true); // tier 4 at 350
    expect(m.canRefund('branching_threads').refundAmount).toBe(350);
    m.refundUpgrade('branching_threads');
    expect(m.canRefund('branching_threads').refundAmount).toBe(250); // tier 3, bought before
    expect(reload().canRefund('branching_threads').refundAmount).toBe(250);
  });

  it('a save already at revision 4 records nothing', () => {
    store.set(
      KEY,
      JSON.stringify({
        balanceRevision: 4,
        totalSupply: 1000,
        purchasedUpgrades: { branching_threads: 4 },
      }),
    );
    const m = reload();
    expect(m.legacyTierCosts).toEqual({});
    expect(m.canRefund('branching_threads').refundAmount).toBe(350);
  });
});
