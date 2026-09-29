// 2026-09-29 playtest (Wave A): the Battalion tab at half price, credited to past
// buyers as balance revision 2, and Expanded Ranks retired with a one-time refund.
// Expected amounts are worked out by hand from the old and new price lists.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadGameData } from './testData.js';
import {
  MetaProgressionManager,
  BALANCE_REVISIONS,
  CURRENT_BALANCE_REVISION,
} from '../src/engine/MetaProgressionManager.js';

const data = loadGameData();
const KEY = 'emblem_rogue_slot_1_meta';

let store;
let writes;
beforeEach(() => {
  store = {};
  writes = 0;
  vi.stubGlobal('localStorage', {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      writes += 1;
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const seed = (saved) => {
  store[KEY] = JSON.stringify(saved);
};
const disk = () => JSON.parse(store[KEY]);
const load = () => new MetaProgressionManager(data.metaUpgrades, KEY);

describe('Battalion price cut (balance revision 2)', () => {
  it('a revision-1 save is credited the old price minus the new, per tier bought', () => {
    seed({
      balanceRevision: 1,
      totalValor: 40,
      totalSupply: 10,
      savedAt: 5000,
      purchasedUpgrades: {
        deploy_limit: 1, // 500 -> 150: 350
        veteran_recruits: 2, // 250 + 450 -> 125 + 225: 350
        extra_starting_unit_pool: 4, // 400+700+1000+1500 -> 200+350+500+750: 1800
        recruit_xp: 1, // 350 -> 175: 175
        lethal_armory_killer: 1, // 600 -> 300: 300
        lord_spd_growth: 2, // not Battalion: nothing
      },
    });
    const m = load();
    expect(m.totalSupply).toBe(10 + 350 + 350 + 1800 + 175 + 300);
    expect(m.totalValor).toBe(40);
  });

  it('a save from before revision 1 gets both cuts, never the first one twice', () => {
    // Paid 900 + 1400 + 600 + 375 = 3275; the same four now cost 300 + 450 + 175 + 125
    // = 1050. Revision 1 must credit its own 1100 (not "old - today's price" = 2225),
    // then revision 2 the remaining 1125: 2225 in all.
    seed({
      totalSupply: 0,
      savedAt: 5000,
      purchasedUpgrades: {
        lethal_armory_killer: 1,
        lethal_armory_silver: 1,
        master_of_arms: 1,
        recruit_field_supplies: 1,
      },
    });
    expect(load().totalSupply).toBe(3275 - 1050);
  });

  it('a save already at the current revision is not credited', () => {
    seed({
      balanceRevision: 2,
      totalSupply: 77,
      savedAt: 5000,
      purchasedUpgrades: { deploy_limit: 1, extra_starting_unit_pool: 4 },
    });
    expect(load().totalSupply).toBe(77);
  });

  it('credits once: loading writes nothing, the next save records revision 2, a reload adds nothing', () => {
    seed({
      balanceRevision: 1,
      totalSupply: 0,
      savedAt: 5000,
      purchasedUpgrades: { deploy_limit: 1 },
    });
    const m = load();
    expect(m.totalSupply).toBe(350);
    // A read-only load must not look newer than a pending cloud merge.
    expect(writes).toBe(0);
    expect(m.savedAt).toBe(5000);
    expect(disk().totalSupply).toBe(0);
    m._save();
    expect(disk().balanceRevision).toBe(2);
    expect(disk().totalSupply).toBe(350);
    expect(load().totalSupply).toBe(350);
  });

  it('the revision table chains and ends at the prices in metaUpgrades.json', () => {
    expect(CURRENT_BALANCE_REVISION).toBe(2);
    expect(BALANCE_REVISIONS.map((r) => r.revision)).toEqual([1, 2]);
    const byId = new Map(data.metaUpgrades.map((u) => [u.id, u]));
    const latest = BALANCE_REVISIONS[BALANCE_REVISIONS.length - 1];
    for (const [id, costs] of Object.entries(latest.to)) {
      expect(byId.get(id)?.costs, id).toEqual(costs);
    }
    // A price a revision starts from is the price the previous one set.
    for (let i = 1; i < BALANCE_REVISIONS.length; i++) {
      const prev = BALANCE_REVISIONS[i - 1];
      for (const [id, from] of Object.entries(BALANCE_REVISIONS[i].from)) {
        if (prev.to[id]) expect(from, `${id} revision ${i + 1}`).toEqual(prev.to[id]);
      }
    }
    for (const { from, to } of BALANCE_REVISIONS)
      for (const id of Object.keys(from)) expect(to[id]?.length, id).toBe(from[id].length);
  });
});

describe('Expanded Ranks retired (the roster has no cap)', () => {
  it('refunds 175 Supply per level bought and drops the key, without writing at load', () => {
    seed({
      balanceRevision: 2,
      totalSupply: 100,
      totalValor: 9,
      savedAt: 5000,
      purchasedUpgrades: { roster_cap: 1, recruit_skill: 1 },
    });
    const m = load();
    expect(m.totalSupply).toBe(275);
    expect(m.totalValor).toBe(9);
    expect(m.purchasedUpgrades).toEqual({ recruit_skill: 1 });
    expect(m.retiredUpgradeRefunds).toEqual({ roster_cap: 1 });
    expect(writes).toBe(0);
    expect(m.savedAt).toBe(5000);

    m._save();
    const saved = disk();
    expect(saved.purchasedUpgrades).toEqual({ recruit_skill: 1 });
    expect(saved.retiredUpgradeRefunds).toEqual({ roster_cap: 1 });
    expect(saved.totalSupply).toBe(275);
    expect(load().totalSupply).toBe(275);
  });

  it('a stale newer copy that brings the key back through the merge is not paid again', () => {
    seed({
      balanceRevision: 2,
      totalSupply: 100,
      savedAt: 5000,
      purchasedUpgrades: { roster_cap: 1 },
    });
    const m = load();
    m._save(); // refunded: 275 on disk, with the ledger
    // Another writer (a cloud fetch of an old copy) puts a newer payload on disk.
    seed({
      balanceRevision: 2,
      totalSupply: 150,
      savedAt: m.savedAt + 1000,
      purchasedUpgrades: { roster_cap: 1, recruit_xp: 1 },
    });
    m.addSupply(5); // saves: adopts the disk copy by max-merge first
    const saved = disk();
    expect(saved.purchasedUpgrades).toEqual({ recruit_xp: 1 });
    expect(saved.retiredUpgradeRefunds).toEqual({ roster_cap: 1 });
    // max(275, 150) + 5; no second 175.
    expect(saved.totalSupply).toBe(280);
    expect(load().totalSupply).toBe(280);
  });

  it("the ledger from the disk copy is kept, so its refund isn't paid on this side either", () => {
    seed({ balanceRevision: 2, totalSupply: 10, savedAt: 5000, purchasedUpgrades: {} });
    const m = load();
    // This in-memory copy still holds the key (as if loaded before the retirement).
    m.purchasedUpgrades.roster_cap = 1;
    seed({
      balanceRevision: 2,
      totalSupply: 185,
      savedAt: 9000,
      purchasedUpgrades: {},
      retiredUpgradeRefunds: { roster_cap: 1 },
    });
    m.addSupply(0);
    const saved = disk();
    expect(saved.totalSupply).toBe(185);
    expect(saved.purchasedUpgrades).toEqual({});
    expect(saved.retiredUpgradeRefunds).toEqual({ roster_cap: 1 });
  });

  it('a level bought on the merged copy and refunded on neither is paid once', () => {
    seed({ balanceRevision: 2, totalSupply: 10, savedAt: 5000, purchasedUpgrades: {} });
    const m = load();
    seed({
      balanceRevision: 2,
      totalSupply: 60,
      savedAt: 9000,
      purchasedUpgrades: { roster_cap: 1 },
    });
    m.addSupply(0);
    expect(disk().totalSupply).toBe(60 + 175);
    expect(disk().purchasedUpgrades).toEqual({});
    expect(load().totalSupply).toBe(235);
  });

  it('the ledger rides the payout snapshot and never enters purchasedUpgrades', () => {
    seed({
      balanceRevision: 2,
      totalSupply: 0,
      savedAt: 5000,
      purchasedUpgrades: { roster_cap: 1 },
    });
    const m = load();
    expect(m._captureState().retiredUpgradeRefunds).toEqual({ roster_cap: 1 });
    m.retiredUpgradeRefunds = {};
    m._restoreState({ ...m._captureState(), retiredUpgradeRefunds: { roster_cap: 1 } });
    expect(m.retiredUpgradeRefunds).toEqual({ roster_cap: 1 });
    expect(Object.keys(m.purchasedUpgrades)).not.toContain('roster_cap');
    expect(m.getUpgradeLevel('roster_cap')).toBe(0);
  });

  it('old saves with both the price cut and the retired upgrade get both, once', () => {
    seed({
      balanceRevision: 1,
      totalSupply: 0,
      savedAt: 5000,
      purchasedUpgrades: { roster_cap: 1, deploy_limit: 1 },
    });
    const m = load();
    expect(m.totalSupply).toBe(175 + 350);
    m._save();
    expect(load().totalSupply).toBe(525);
  });
});
