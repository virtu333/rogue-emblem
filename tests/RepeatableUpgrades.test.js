// A repeatable Home Base upgrade (engine/RepeatableUpgrades.js; Branching Threads is the
// first): its listed tiers sell as ever, then each further tier costs `repeatable.cost` and
// adds `repeatable.effect`, forever.
//
// Ways this can fail, one test (or more) each:
//   - the upgrade capped at maxLevel (no tier 5), or tier 5+ priced from the list (undefined)
//   - tiers past the list summed wrong (tier 6 must be 6 rerolls, not 4 or 10)
//   - a refund of a repeat tier paying the list's last price, or nothing
//   - a disk/cloud copy with more repeat tiers lost by the merge
//   - data validation letting a broken repeatable block through
//   - an upgrade without `repeatable` changing at all
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import {
  isRepeatableUpgrade,
  upgradeEffectAtLevel,
  upgradeTierCost,
  validateRepeatableUpgrades,
} from '../src/engine/RepeatableUpgrades.js';
import { REFUND_FEE } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const KEY = 'repeatable-test';
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

const bt = () => data.metaUpgrades.find((u) => u.id === 'branching_threads');
function meta(supply = 10000) {
  const m = new MetaProgressionManager(data.metaUpgrades, KEY);
  m.totalSupply = supply;
  return m;
}

describe('buying', () => {
  it('sells 100/200/300/350, then 400 a tier forever; never maxed', () => {
    const m = meta(100 + 200 + 300 + 350 + 400 * 3);
    const paid = [];
    for (let i = 0; i < 7; i++) {
      paid.push(m.getNextCost('branching_threads'));
      expect(m.purchaseUpgrade('branching_threads')).toBe(true);
      expect(m.isMaxed('branching_threads')).toBe(false);
    }
    expect(paid).toEqual([100, 200, 300, 350, 400, 400, 400]);
    expect(m.getUpgradeLevel('branching_threads')).toBe(7);
    expect(m.totalSupply).toBe(0);
    expect(m.getNextCost('branching_threads')).toBe(400);
    expect(m.canAfford('branching_threads')).toBe(false);
    expect(m.purchaseUpgrade('branching_threads')).toBe(false);
  });

  it('tier N grants N rerolls a run, past the list too (a total, never summed)', () => {
    const m = meta();
    for (const [level, rerolls] of [
      [1, 1],
      [4, 4],
      [5, 5],
      [6, 6],
      [12, 12],
    ]) {
      // prettier-ignore
      m.purchasedUpgrades.branching_threads = level;
      expect(m.getActiveEffects().rewardRerolls).toBe(rerolls);
    }
    expect(upgradeEffectAtLevel(bt(), 6)).toEqual({ rewardRerolls: 6 });
    expect(upgradeEffectAtLevel(bt(), 0)).toBeUndefined();
  });

  it('an upgrade without `repeatable` still stops at maxLevel', () => {
    const plain = data.metaUpgrades.find((u) => u.id !== 'branching_threads' && u.maxLevel === 2);
    const m = meta();
    m.purchasedUpgrades[plain.id] = 2;
    expect(isRepeatableUpgrade(plain)).toBe(false);
    expect(m.isMaxed(plain.id)).toBe(true);
    expect(m.getNextCost(plain.id)).toBeNull();
    expect(upgradeTierCost(plain, 3)).toBeNull();
    // A level past the list never reads out of range: the last tier stands.
    expect(upgradeEffectAtLevel(plain, 3)).toEqual(plain.effects[plain.effects.length - 1]);
    // Only Branching Threads repeats today.
    expect(data.metaUpgrades.filter(isRepeatableUpgrade).map((u) => u.id)).toEqual([
      'branching_threads',
    ]);
  });
});

describe('refunds', () => {
  it('the top tier at its price: a repeat tier 400 less the fee, a listed tier its own', () => {
    const m = meta(1000);
    m.purchasedUpgrades.branching_threads = 6;
    expect(m.canRefund('branching_threads')).toMatchObject({ success: true, refundAmount: 400 });
    expect(m.refundUpgrade('branching_threads').success).toBe(true);
    expect(m.totalSupply).toBe(1000 + 400 - REFUND_FEE);
    expect(m.refundUpgrade('branching_threads').success).toBe(true);
    expect(m.totalSupply).toBe(1000 + 2 * (400 - REFUND_FEE));
    expect(m.getUpgradeLevel('branching_threads')).toBe(4);
    expect(m.canRefund('branching_threads').refundAmount).toBe(350);
  });
});

describe('the save', () => {
  it('a repeat level round-trips and the disk merge keeps the higher level', () => {
    const m = meta();
    m.purchasedUpgrades.branching_threads = 6;
    m._save();
    expect(new MetaProgressionManager(data.metaUpgrades, KEY).getUpgradeLevel('branching_threads')).toBe(6); // prettier-ignore
    // Another writer puts a newer copy with more tiers on disk: the next save adopts it.
    const disk = JSON.parse(store.get(KEY));
    store.set(
      KEY,
      JSON.stringify({
        ...disk,
        savedAt: m.savedAt + 1000,
        purchasedUpgrades: { branching_threads: 9 },
      }),
    );
    m.addSupply(1);
    expect(m.getUpgradeLevel('branching_threads')).toBe(9);
    expect(JSON.parse(store.get(KEY)).purchasedUpgrades.branching_threads).toBe(9);
  });
});

describe('validation', () => {
  it('the shipped data passes; a broken block is refused', () => {
    expect(validateRepeatableUpgrades(data.metaUpgrades)).toEqual([]);
    const base = { ...bt() };
    const errors = (patch) => validateRepeatableUpgrades([{ ...base, ...patch }]);
    expect(errors({ repeatable: { cost: 0, effect: { rewardRerolls: 1 } } })).toHaveLength(1);
    expect(errors({ repeatable: { cost: 400, effect: {} } })).toHaveLength(1);
    expect(errors({ repeatable: { cost: 400, effect: { goldBonus: 1 } } })).toEqual([
      'metaUpgrades.branching_threads.repeatable.effect.goldBonus is not a number the last listed tier carries',
    ]);
    expect(errors({ maxLevel: 5 })).toEqual([
      'metaUpgrades.branching_threads.repeatable: costs, effects and maxLevel must list the same tiers',
    ]);
    expect(errors({ repeatable: { cost: 400, effect: { rewardRerolls: -1 } } })).toHaveLength(1);
  });
});
