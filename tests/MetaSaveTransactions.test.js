// Save safety for Home Base purchases and run payouts (outside review, Oct 2026):
// - a purchase or refund reports success only once it is on disk, and a failed write changes
//   nothing (no false "tier purchased");
// - two managers on one slot conserve currency and ownership: a stale copy's save never brings
//   back currency the other spent, nor a tier the other refunded (the old adopt-merge took the
//   larger of two balances);
// - a run is paid exactly once even when a second, stale session settles its own copy after
//   the first paid it and committed its NG+ ride.
// Real MetaProgressionManager and RunManager on the shipped data, one shared storage mock.

import { beforeEach, describe, expect, it } from 'vitest';

const store = {};
let failMetaWrites = false;
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      if (failMetaWrites && k.endsWith('_meta')) throw new Error('QuotaExceededError');
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  },
  writable: true,
});

import { loadGameData } from './testData.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { RunManager, loadRun, saveRun } from '../src/engine/RunManager.js';
import { getMetaKey } from '../src/engine/SlotManager.js';
import { NG_PLUS_COST } from '../src/engine/NgPlusState.js';

const data = loadGameData();
const META_KEY = getMetaKey(1);
const freshMeta = () => new MetaProgressionManager(data.metaUpgrades, META_KEY);
const disk = () => JSON.parse(store[META_KEY]);

// Two Valor upgrades with no prerequisites, and their first tier's price (read from the data).
const valorUpgrades = data.metaUpgrades.filter((u) => {
  const m = freshMeta();
  return m.getCurrencyForUpgrade(u.id) === 'valor' && m.meetsPrerequisites(u.id) && !u.requires;
});
const [X, Y] = valorUpgrades;
const tierOneCost = (u) => (Array.isArray(u.costs) ? u.costs[0] : u.cost);

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  failMetaWrites = false;
});

/** A slot holding `valor` Valor (and as much Supply), saved. */
function seed(valor = 1000) {
  const meta = freshMeta();
  meta.addValor(valor);
  meta.addSupply(valor);
  return meta;
}

describe('a purchase reports success only once it is saved', () => {
  it('two Valor upgrades with known prices exist (the fixtures below need them)', () => {
    expect(X && Y).toBeTruthy();
    expect(tierOneCost(X)).toBeGreaterThan(0);
    expect(freshMeta().getNextCost(X.id)).toBe(tierOneCost(X));
  });

  it('a failed write leaves the balance and the tier as they were, and says why', () => {
    // Failure: memory says "tier 1 purchased" and charged while the disk never saw it.
    seed();
    const meta = freshMeta();
    failMetaWrites = true;
    expect(meta.buyUpgrade(X.id)).toEqual({ ok: false, reason: 'save_failed' });
    expect(meta.purchaseUpgrade(X.id)).toBe(false);
    expect(meta.totalValor).toBe(1000);
    expect(meta.getUpgradeLevel(X.id)).toBe(0);

    // Storage comes back: one retry buys exactly one tier, once.
    failMetaWrites = false;
    expect(meta.buyUpgrade(X.id)).toEqual({ ok: true });
    const reloaded = freshMeta();
    expect(reloaded.getUpgradeLevel(X.id)).toBe(1);
    expect(reloaded.totalValor).toBe(1000 - tierOneCost(X));
  });

  it('a refused purchase says why (unaffordable, maxed)', () => {
    const meta = freshMeta();
    expect(meta.buyUpgrade(X.id)).toEqual({ ok: false, reason: 'unaffordable' });
    expect(meta.buyUpgrade('no_such_upgrade')).toEqual({ ok: false, reason: 'unknown_upgrade' });
  });

  it('a failed refund write changes nothing and is not reported as a refund', () => {
    // Failure: the tier is gone and the currency back in memory, but not on disk.
    seed();
    const meta = freshMeta();
    expect(meta.purchaseUpgrade(X.id)).toBe(true);
    const valor = meta.totalValor;
    failMetaWrites = true;
    expect(meta.refundUpgrade(X.id)).toEqual({ success: false, reason: 'save_failed' });
    expect(meta.totalValor).toBe(valor);
    expect(meta.getUpgradeLevel(X.id)).toBe(1);
  });
});

describe('two managers on one slot conserve currency and ownership', () => {
  it('A buys, then stale B saves for any reason: A’s spend stands', () => {
    // Failure (the review's repro): B's save took max(1000, 700) and kept A's upgrade too.
    seed();
    const a = freshMeta();
    const b = freshMeta();
    expect(a.purchaseUpgrade(X.id)).toBe(true);
    b.recordMilestone('beatAct1'); // a passive save
    const reloaded = freshMeta();
    expect(reloaded.totalValor).toBe(1000 - tierOneCost(X));
    expect(reloaded.getUpgradeLevel(X.id)).toBe(1);
    expect(reloaded.hasMilestone('beatAct1')).toBe(true);
  });

  it('A buys one, then stale B buys another: both are paid for', () => {
    // Failure: B's purchase was priced against its stale 1000, then max-merged to 900-ish.
    seed();
    const a = freshMeta();
    const b = freshMeta();
    expect(a.purchaseUpgrade(X.id)).toBe(true);
    expect(b.purchaseUpgrade(Y.id)).toBe(true);
    const reloaded = freshMeta();
    expect(reloaded.totalValor).toBe(1000 - tierOneCost(X) - tierOneCost(Y));
    expect(reloaded.getUpgradeLevel(X.id)).toBe(1);
    expect(reloaded.getUpgradeLevel(Y.id)).toBe(1);
  });

  it('stale B cannot buy what A already spent the currency on', () => {
    // Failure: B checks affordability against its stale balance and overdraws the slot.
    seed(tierOneCost(X));
    const a = freshMeta();
    const b = freshMeta();
    expect(a.purchaseUpgrade(X.id)).toBe(true);
    expect(b.buyUpgrade(Y.id).reason).toBe('unaffordable');
    expect(freshMeta().totalValor).toBe(0);
  });

  it('A refunds a tier, then stale B saves: the tier stays refunded', () => {
    // Failure: B's save took the larger tier back, so the refund was paid and the tier kept.
    seed();
    const buyer = freshMeta();
    expect(buyer.purchaseUpgrade(X.id)).toBe(true);
    const a = freshMeta();
    const b = freshMeta();
    const refund = a.refundUpgrade(X.id);
    expect(refund.success).toBe(true);
    b.recordMilestone('beatAct1');
    const reloaded = freshMeta();
    expect(reloaded.getUpgradeLevel(X.id)).toBe(0);
    expect(reloaded.totalValor).toBe(
      1000 - tierOneCost(X) - refund.refundFee + refund.refundAmount,
    );
  });

  it('what only grows (milestones, lords met) is still kept from either copy', () => {
    // Failure: taking the disk copy whole would drop what the stale copy learned.
    seed();
    const a = freshMeta();
    const b = freshMeta();
    a.recordMilestone('beatAct2');
    b.recordMilestone('beatAct1');
    a.recordLordsMet(['Kira']);
    const reloaded = freshMeta();
    expect(reloaded.hasMilestone('beatAct1')).toBe(true);
    expect(reloaded.hasMilestone('beatAct2')).toBe(true);
    expect(reloaded.hasMetLord('Kira')).toBe(true);
  });
});

describe('a run is paid once across sessions', () => {
  function nightfallWinSaved() {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 11, applyBlessingsAtStart: false, difficultyId: 'hard' });
    rm.actIndex = rm.actSequence.length - 1;
    rm.status = 'victory';
    expect(saveRun(rm, null, 1).ok).toBe(true);
  }

  it('a stale second session settling the same run changes nothing after A picked its ride', () => {
    // Failure (the review's third P1): B's receipt check read its stale memory, then the NG+
    // end adopted A's state mid-payout and stored the ride again over A's committed pick.
    const unlocked = seed(5000);
    unlocked.recordMilestone('beatLunatic');
    expect(unlocked.unlockNgPlus().ok).toBe(true);
    nightfallWinSaved();

    const metaA = freshMeta();
    const metaB = freshMeta();
    const runA = loadRun(data, 1);
    const runB = loadRun(data, 1);

    runA.settleEndRunRewards(metaA, 'victory');
    expect(metaA.getNgPlus().pendingRide).not.toBeNull();
    expect(metaA.passNgPlusRide().ok).toBe(true);
    const after = disk();
    expect(after.totalValor).toBeGreaterThan(5000 - NG_PLUS_COST.valor);
    expect(after.ngPlus.pendingRide).toBeNull();

    runB.settleEndRunRewards(metaB, 'victory');
    const final = disk();
    expect(final.totalValor).toBe(after.totalValor);
    expect(final.totalSupply).toBe(after.totalSupply);
    expect(final.runsCompleted).toBe(after.runsCompleted);
    expect(final.ngPlus).toEqual(after.ngPlus);
    expect(final.settledRunIds).toEqual(after.settledRunIds);
    expect(runB.endRunRewards.appliedToMeta).toBe(true);
  });
});
