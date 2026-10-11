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
        // Not Battalion: bought at 105 + 150 before revision 3's rise; revision 5 brings
        // the tiers to 90 + 130: 35 Valor.
        lord_spd_growth: 2,
      },
    });
    const m = load();
    expect(m.totalSupply).toBe(10 + 350 + 350 + 1800 + 175 + 300);
    expect(m.totalValor).toBe(40 + 35);
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
      balanceRevision: CURRENT_BALANCE_REVISION,
      totalSupply: 77,
      savedAt: 5000,
      purchasedUpgrades: { deploy_limit: 1, extra_starting_unit_pool: 4 },
    });
    expect(load().totalSupply).toBe(77);
  });

  it('credits once: loading writes nothing, the next save records the current revision, a reload adds nothing', () => {
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
    expect(disk().balanceRevision).toBe(CURRENT_BALANCE_REVISION);
    expect(disk().totalSupply).toBe(350);
    expect(load().totalSupply).toBe(350);
  });

  it('the revision table chains and ends at the prices in metaUpgrades.json', () => {
    expect(CURRENT_BALANCE_REVISION).toBe(6);
    expect(BALANCE_REVISIONS.map((r) => r.revision)).toEqual([1, 2, 3, 4, 5, 6]);
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

describe('October price changes (balance revision 3)', () => {
  it("credits cuts in each upgrade's currency and charges nobody for a rise", () => {
    seed({
      balanceRevision: 2,
      totalValor: 0,
      totalSupply: 0,
      savedAt: 5000,
      purchasedUpgrades: {
        steel_arms: 1, // valor 800 -> 500: 300
        legendary_lord_chance: 2, // valor 300+600 -> 150+300: 450
        trade_contacts: 2, // supply 150+250 -> 60+100: 240
        heros_call: 1, // supply 150 -> 120: 30
        weapon_tier_silver: 1, // valor 600 -> 1000: a rise, nothing owed
        // valor 105 + 150 -> 120 + 175, a rise; then revision 5 cuts to 90 + 130: 35
        lord_spd_growth: 2,
        recruit_spd_flat: 1, // supply, a rise
      },
    });
    const m = load();
    expect(m.totalValor).toBe(750 + 35);
    expect(m.totalSupply).toBe(270);
    m._save();
    expect(disk().balanceRevision).toBe(CURRENT_BALANCE_REVISION);
    expect(load().totalValor).toBe(785);
  });

  it('revision 3 lists its five rises beside its cuts; every other entry is a cut', () => {
    const r3 = BALANCE_REVISIONS.find((r) => r.revision === 3);
    const rises = [
      'weapon_tier_silver',
      'lord_spd_growth',
      'recruit_spd_growth',
      'lord_spd_flat',
      'recruit_spd_flat',
    ];
    for (const [id, from] of Object.entries(r3.from)) {
      if (rises.includes(id))
        from.forEach((price, i) => expect(r3.to[id][i], id).toBeGreaterThan(price));
      else from.forEach((price, i) => expect(r3.to[id][i], id).toBeLessThan(price));
    }
    for (const id of rises) expect(r3.from[id], id).toBeDefined();
  });

  it('a tier bought before a rise records and refunds what it was paid', () => {
    seed({
      balanceRevision: 2,
      totalSupply: 0,
      savedAt: 5000,
      purchasedUpgrades: { recruit_spd_growth: 3, recruit_spd_flat: 1 },
    });
    const m = load();
    // recruit_spd_flat: 150 before the rise (175 now). It has no later cut.
    expect(m.legacyTierCosts.recruit_spd_flat).toEqual({ 1: 150 });
    const before = m.totalSupply;
    expect(m.refundUpgrade('recruit_spd_flat').success).toBe(true);
    expect(m.totalSupply).toBe(before - 20 + 150);
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
    // The settled revision rides along (BalanceRevisionMarker.js); roster_cap is gone.
    expect(saved.purchasedUpgrades).toEqual({
      recruit_skill: 1,
      __balance_revision: CURRENT_BALANCE_REVISION,
      __balance_settled: CURRENT_BALANCE_REVISION,
    });
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
    expect(saved.purchasedUpgrades).toEqual({
      recruit_xp: 1,
      __balance_revision: CURRENT_BALANCE_REVISION,
      __balance_settled: CURRENT_BALANCE_REVISION,
    });
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

describe('Growth tracks at +3% a tier, about 25% off (balance revision 5)', () => {
  it("a revision-4 save is credited old minus new per tier, in each track's currency", () => {
    seed({
      balanceRevision: 4,
      totalValor: 5,
      totalSupply: 7,
      savedAt: 5000,
      purchasedUpgrades: {
        lord_str_growth: 3, // valor 70+105+180 -> 50+80+135: 90
        lord_lck_growth: 5, // valor 50+55+80+110+175 -> 40+45+60+80+130: 115
        recruit_hp_growth: 2, // supply 35+40 -> 25+30: 20
        recruit_spd_growth: 1, // supply 75 -> 55: 20
        lord_str_flat: 1, // not a growth track: nothing
      },
    });
    const m = load();
    expect(m.totalValor).toBe(5 + 90 + 115);
    expect(m.totalSupply).toBe(7 + 20 + 20);
    m._save();
    expect(load().totalValor).toBe(210);
  });

  it('a Swiftness tier bought before revision 3 is credited from its old price, then refunds the new one', () => {
    seed({
      balanceRevision: 2,
      totalValor: 0,
      savedAt: 5000,
      purchasedUpgrades: { lord_spd_growth: 3 },
    });
    const m = load();
    // Paid 105 + 150 + 260 = 515; now 90 + 130 + 225 = 445. Not 120 + 175 + 300 - 445.
    expect(m.totalValor).toBe(70);
    // The cut brought every tier below what it was paid: no legacy price is left.
    expect(m.legacyTierCosts.lord_spd_growth).toBeUndefined();
    expect(m.refundUpgrade('lord_spd_growth').success).toBe(true);
    expect(m.totalValor).toBe(70 - 20 + 225);
  });

  it('the growth tracks give +3 per tier and their descriptions say so', () => {
    for (const upgrade of data.metaUpgrades.filter((u) => /_growth$/.test(u.id))) {
      expect(upgrade.description, upgrade.id).toMatch(/^\+3% [A-Z]+ growth per tier$/);
      expect(
        upgrade.effects.map((e) => e.growthValue),
        upgrade.id,
      ).toEqual([3, 6, 9, 12, 15]);
    }
  });

  it('every revision-5 entry is a growth track cut by 20-30% in all, each tier cheaper', () => {
    const r5 = BALANCE_REVISIONS.find((r) => r.revision === 5);
    const growth = data.metaUpgrades.filter((u) => /_growth$/.test(u.id)).map((u) => u.id);
    expect(Object.keys(r5.from).sort()).toEqual([...growth].sort());
    const sum = (xs) => xs.reduce((a, b) => a + b, 0);
    for (const id of growth) {
      r5.from[id].forEach((price, i) => expect(r5.to[id][i], id).toBeLessThan(price));
      const cut = 1 - sum(r5.to[id]) / sum(r5.from[id]);
      expect(cut, id).toBeGreaterThanOrEqual(0.2);
      expect(cut, id).toBeLessThanOrEqual(0.3);
    }
  });
});

describe('Lucky Finds 25% off after its Legend step was cut (balance revision 6)', () => {
  it('a revision-5 save is credited 120 + 240 -> 90 + 180 per tier bought, in Supply', () => {
    seed({
      balanceRevision: 5,
      totalValor: 3,
      totalSupply: 7,
      savedAt: 5000,
      purchasedUpgrades: { loot_quality: 2, trade_contacts: 2 },
    });
    const m = load();
    expect(m.totalSupply).toBe(7 + 30 + 60);
    expect(m.totalValor).toBe(3);
    m._save();
    expect(disk().balanceRevision).toBe(6);
    expect(load().totalSupply).toBe(97);
  });

  it('a tier bought before revision 3 is credited both cuts: 150 -> 90', () => {
    seed({
      balanceRevision: 2,
      totalSupply: 0,
      savedAt: 5000,
      purchasedUpgrades: { loot_quality: 1 },
    });
    expect(load().totalSupply).toBe(60);
  });

  it('a save already at revision 6 is not credited again', () => {
    seed({
      balanceRevision: 6,
      totalSupply: 0,
      savedAt: 5000,
      purchasedUpgrades: { loot_quality: 2, __balance_revision: 6 },
    });
    expect(load().totalSupply).toBe(0);
  });
});

describe('the settled revision survives a save by an older build (BalanceRevisionMarker)', () => {
  // What a build from before revision 5 does to the save: it loads purchasedUpgrades whole,
  // credits nothing it does not know, and writes its own CURRENT_BALANCE_REVISION (4).
  const olderBuildResaves = () => {
    store[KEY] = JSON.stringify({ ...disk(), balanceRevision: 4, savedAt: disk().savedAt + 1 });
  };

  it('credits revision 5 once across a round trip through an older client', () => {
    seed({
      balanceRevision: 4,
      totalValor: 0,
      totalSupply: 0,
      savedAt: 5000,
      purchasedUpgrades: { lord_str_growth: 3, recruit_hp_growth: 2 },
    });
    const m = load();
    expect([m.totalValor, m.totalSupply]).toEqual([90, 20]);
    m._save();
    expect(disk().purchasedUpgrades.__balance_revision).toBe(CURRENT_BALANCE_REVISION);
    olderBuildResaves();
    const again = load();
    expect([again.totalValor, again.totalSupply]).toEqual([90, 20]);
    expect(again.purchasedUpgrades).toEqual({ lord_str_growth: 3, recruit_hp_growth: 2 });
    again._save();
    olderBuildResaves();
    expect([load().totalValor, load().totalSupply]).toEqual([90, 20]);
  });

  it('a save the older build wrote before ever meeting revision 5 is still credited', () => {
    seed({
      balanceRevision: 4,
      totalValor: 0,
      savedAt: 5000,
      purchasedUpgrades: { lord_str_growth: 1, __balance_revision: 4 },
    });
    expect(load().totalValor).toBe(20);
  });

  it('no purchases, no marker: an empty save still reads as fresh', () => {
    const m = load();
    m._save();
    expect(disk().purchasedUpgrades).toEqual({});
  });

  it('adopting a newer disk copy keeps the marker out of the upgrade levels', () => {
    const m = load();
    m.purchasedUpgrades.recruit_hp_growth = 1;
    m._save();
    store[KEY] = JSON.stringify({
      ...disk(),
      balanceRevision: 4,
      savedAt: disk().savedAt + 10,
      purchasedUpgrades: { recruit_hp_growth: 2, __balance_revision: 5 },
    });
    m._save();
    expect(m.purchasedUpgrades).toEqual({ recruit_hp_growth: 2 });
    expect(disk().purchasedUpgrades).toEqual({
      recruit_hp_growth: 2,
      __balance_revision: CURRENT_BALANCE_REVISION,
      __balance_settled: CURRENT_BALANCE_REVISION,
    });
  });

  it('adopting a disk copy with only the second marker keeps it out of the upgrade levels', () => {
    const m = load();
    m.purchasedUpgrades.loot_quality = 1;
    m._save();
    store[KEY] = JSON.stringify({
      ...disk(),
      balanceRevision: 5,
      savedAt: disk().savedAt + 10,
      purchasedUpgrades: { loot_quality: 2, __balance_revision: 5, __balance_settled: 6 },
    });
    m._save();
    expect(m.purchasedUpgrades).toEqual({ loot_quality: 2 });
    expect(disk().balanceRevision).toBe(CURRENT_BALANCE_REVISION);
  });
});

describe('a revision-5 build between two loads (it knows __balance_revision)', () => {
  // What the revision-5 build (#312) does to the save: it strips `__balance_revision` on load,
  // keeps every other key of purchasedUpgrades, and writes its own revision (5) to both the
  // top-level field and `__balance_revision`.
  const revision5BuildResaves = () => {
    const saved = disk();
    const { __balance_revision: _stripped, ...kept } = saved.purchasedUpgrades;
    store[KEY] = JSON.stringify({
      ...saved,
      balanceRevision: 5,
      savedAt: saved.savedAt + 1,
      purchasedUpgrades: { ...kept, __balance_revision: 5 },
    });
  };

  it('credits revision 6 once however many round trips it makes', () => {
    seed({
      balanceRevision: 5,
      totalSupply: 0,
      savedAt: 5000,
      purchasedUpgrades: { loot_quality: 2, __balance_revision: 5 },
    });
    const supply = [];
    for (let trip = 0; trip < 3; trip++) {
      const m = load();
      supply.push(m.totalSupply);
      m._save();
      revision5BuildResaves();
    }
    expect(supply).toEqual([90, 90, 90]);
    expect(disk().purchasedUpgrades.__balance_settled).toBe(6);
  });

  it('never writes a revision below the one the save was settled at', () => {
    seed({
      balanceRevision: 9,
      totalSupply: 0,
      savedAt: 5000,
      purchasedUpgrades: { loot_quality: 2, __balance_revision: 9, __balance_settled: 9 },
    });
    const m = load();
    expect(m.totalSupply).toBe(0);
    m._save();
    expect(disk().balanceRevision).toBe(9);
    expect(disk().purchasedUpgrades).toEqual({
      loot_quality: 2,
      __balance_revision: 9,
      __balance_settled: 9,
    });
  });
});
