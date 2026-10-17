// Where achievements are kept, and when they are told (docs/specs/achievements.md).
// Real MetaProgressionManager and RunManager on the shipped data, one shared storage mock.
//
// Ways this can fail, each pinned below:
// - an achievement is announced but its write failed (the card shows; a reload has none);
// - a failed write keeps it in memory (a later write would save what was never told);
// - deleting a slot loses what the player earned there;
// - a dev route's meta writes the player's device copy;
// - a stale second manager on a slot writes over an achievement the other earned;
// - the retroactive pass is told achievement by achievement instead of once;
// - a run's end, the prologue's end or a run's save on the route map earns nothing;
// - the run's counters are lost by a save and load, or counted by a battle never won.

import { beforeEach, describe, expect, it } from 'vitest';

const store = {};
let failMetaWrites = false;
let metaWrites = 0;
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      if (k.endsWith('_meta')) metaWrites += 1;
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
import { RunManager, saveRun, loadRun } from '../src/engine/RunManager.js';
import { deleteSlot, getMetaKey } from '../src/engine/SlotManager.js';
import {
  DEVICE_ACHIEVEMENTS_KEY,
  achievementsOnDevice,
  onAchievementsUnlocked,
} from '../src/engine/AchievementStore.js';
import {
  achievementTotals,
  reconcileSlotAchievements,
  recordRunAchievements,
  runAchievementFacts,
  runEndAchievementFacts,
} from '../src/engine/AchievementFacts.js';
import { isEarned } from '../src/engine/Achievements.js';
import { bumpRunFeat, recordVictoryFeats, runFeat } from '../src/engine/RunFeats.js';

const data = loadGameData();
const metaFor = (slot = 1) => new MetaProgressionManager(data.metaUpgrades, getMetaKey(slot));
const disk = (slot = 1) => JSON.parse(store[getMetaKey(slot)]);
const wonBattle = (extra = {}) => ({ standard: true, key: `k${Math.random()}`, ...extra });

let notices;
let unsubscribe = null;
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  failMetaWrites = false;
  metaWrites = 0;
  unsubscribe?.();
  notices = [];
  unsubscribe = onAchievementsUnlocked((ids, info) => notices.push({ ids, ...info }));
});

describe('a record is told only once it is saved', () => {
  it('saved to the slot and the device, then announced', () => {
    const meta = metaFor();
    let toldAfterWrite = null;
    unsubscribe();
    unsubscribe = onAchievementsUnlocked((ids) => {
      toldAfterWrite = isEarned(disk().achievements, 'first_blood');
      notices.push({ ids });
    });
    expect(meta.recordAchievementFacts({ battle: wonBattle() })).toEqual(['first_blood']);
    expect(toldAfterWrite).toBe(true);
    expect(notices).toEqual([{ ids: ['first_blood'] }]);
    expect(isEarned(JSON.parse(store[DEVICE_ACHIEVEMENTS_KEY]), 'first_blood')).toBe(true);
  });

  it('a failed write keeps nothing, tells nothing, and the retry earns it', () => {
    const meta = metaFor();
    meta.addValor(10); // a slot already on disk
    failMetaWrites = true;
    expect(meta.recordAchievementFacts({ battle: wonBattle() })).toEqual([]);
    expect(notices).toEqual([]);
    expect(isEarned(meta.getAchievements(), 'first_blood')).toBe(false);
    expect(isEarned(JSON.parse(store[DEVICE_ACHIEVEMENTS_KEY]), 'first_blood')).toBe(false);
    failMetaWrites = false;
    expect(meta.recordAchievementFacts({ battle: wonBattle() })).toEqual(['first_blood']);
    // Told once: the failed attempt left nothing waiting to be told with it.
    expect(notices).toEqual([{ ids: ['first_blood'], retro: false }]);
  });

  it('a record that changes nothing writes nothing and tells nothing', () => {
    const meta = metaFor();
    meta.recordAchievementFacts({ battle: wonBattle() });
    const writes = metaWrites;
    notices.length = 0;
    expect(meta.recordAchievementFacts({ battle: wonBattle() })).toEqual([]);
    expect(metaWrites).toBe(writes);
    expect(notices).toEqual([]);
  });

  it("the prologue's end earns Banner at Dawn in its own write", () => {
    const meta = metaFor();
    const writes = metaWrites;
    expect(meta.completePrologue({ grant: { valor: 50, supply: 35 } }).ok).toBe(true);
    expect(metaWrites).toBe(writes + 1);
    expect(isEarned(disk().achievements, 'banner_at_dawn')).toBe(true);
    expect(notices).toEqual([{ ids: ['banner_at_dawn'], retro: false }]);
  });

  it('a failed prologue write keeps neither the completion nor its achievement', () => {
    const meta = metaFor();
    meta.addValor(10);
    failMetaWrites = true;
    expect(meta.completePrologue({ grant: null }).ok).toBe(false);
    expect(isEarned(meta.getAchievements(), 'banner_at_dawn')).toBe(false);
    expect(notices).toEqual([]);
  });
});

describe('they belong to the player, not the slot', () => {
  it('deleting the slot keeps them: a new slot shows them', () => {
    metaFor(1).recordAchievementFacts({ battle: wonBattle({ turn: 1 }) });
    deleteSlot(1);
    expect(store[getMetaKey(1)]).toBeUndefined();
    const other = metaFor(2);
    expect(isEarned(other.getAchievements(), 'dawn_strike')).toBe(true);
    expect(isEarned(achievementsOnDevice(), 'dawn_strike')).toBe(true);
  });

  it('every slot shows the union, and a slot save carries it back', () => {
    metaFor(1).recordAchievementFacts({ battle: wonBattle({ turn: 1 }) });
    metaFor(2).recordAchievementFacts({ battle: wonBattle({ maxStrike: 60 }) });
    const one = metaFor(1);
    expect(isEarned(one.getAchievements(), 'heavy_hand')).toBe(true);
    one.addValor(1);
    expect(isEarned(disk(1).achievements, 'heavy_hand')).toBe(true);
  });

  it("a dev route's meta never writes the device copy nor takes it in", () => {
    metaFor(1).recordAchievementFacts({ battle: wonBattle() });
    const before = store[DEVICE_ACHIEVEMENTS_KEY];
    const dev = new MetaProgressionManager(data.metaUpgrades, 'emblem_rogue_dev_meta');
    expect(isEarned(dev.getAchievements(), 'first_blood')).toBe(false);
    dev.recordAchievementFacts({ battle: wonBattle({ turn: 1 }) });
    expect(store[DEVICE_ACHIEVEMENTS_KEY]).toBe(before);
  });

  it('a stale second manager on the slot keeps what the first one earned', () => {
    const a = metaFor(1);
    const b = metaFor(1);
    a.recordAchievementFacts({ battle: wonBattle({ turn: 1 }) });
    b.recordAchievementFacts({ battle: wonBattle({ maxStrike: 60 }) });
    const saved = disk(1).achievements;
    expect(isEarned(saved, 'dawn_strike')).toBe(true);
    expect(isEarned(saved, 'heavy_hand')).toBe(true);
  });
});

describe('the retroactive pass', () => {
  it("is quiet in the manager and told once, as a summary, by the slot's opening", () => {
    const meta = metaFor();
    meta.recordMilestone('beatAct1');
    meta.recordMilestone('beatAct3');
    meta.recordMilestone('beatDusk');
    notices.length = 0;
    const ids = reconcileSlotAchievements(metaFor(), data);
    expect(ids).toEqual(
      expect.arrayContaining([
        'first_blood',
        'past_the_first_gate',
        'deeper_roads',
        'into_the_dusk',
      ]),
    );
    expect(notices).toEqual([{ ids, retro: true }]);
    // Opening it again finds nothing new and says nothing.
    expect(reconcileSlotAchievements(metaFor(), data)).toEqual([]);
    expect(notices).toHaveLength(1);
  });

  it('a slain boss on an older save fills the ledger and earns The Sleeper Falls', () => {
    const meta = metaFor();
    meta.recordBossSlain('The Entity');
    expect(meta.getBossSlainCount('The Entity')).toBe(1);
    // As a build before the achievements left it: the ledger, and no achievements anywhere.
    const older = disk();
    delete older.achievements;
    store[getMetaKey(1)] = JSON.stringify(older);
    delete store[DEVICE_ACHIEVEMENTS_KEY];
    const ids = reconcileSlotAchievements(metaFor(), data);
    expect(ids).toContain('the_sleeper_falls');
  });
});

describe('a boss however it fell', () => {
  // A ballista bolt, poison or Deathburst fells a boss without a battle kill record; the
  // bosses' ledger still names it, and the achievements read the ledger.
  it('slaying the Entity earns The Sleeper Falls at once, with its card', () => {
    const meta = metaFor();
    meta.recordBossSlain('The Entity');
    expect(isEarned(disk().achievements, 'the_sleeper_falls')).toBe(true);
    expect(notices).toEqual([{ ids: ['the_sleeper_falls'], retro: false }]);
    expect(meta.getBossSlainCount('The Entity')).toBe(1);
  });

  it("the ledger completes Kingslayer's Ledger at the next record", () => {
    const meta = metaFor();
    const totals = achievementTotals(data);
    for (const name of totals.bosses) meta.recordBossSlain(name);
    expect(isEarned(disk().achievements, 'kingslayers_ledger')).toBe(false); // no totals yet
    meta.recordAchievementFacts({ totals });
    expect(isEarned(disk().achievements, 'kingslayers_ledger')).toBe(true);
  });
});

describe('a run', () => {
  function startedRun(difficultyId = 'normal') {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 21, applyBlessingsAtStart: false, difficultyId });
    return rm;
  }

  it('its counters survive a save and a load, and old saves read zero', () => {
    const rm = startedRun();
    expect(runFeat(rm, 'battlesWon')).toBe(0);
    recordVictoryFeats(rm, { fallen: 2, turnCount: 9, turnPar: 8 });
    recordVictoryFeats(rm, { fallen: 0, turnCount: 8, turnPar: 8 });
    expect(saveRun(rm, null, 1).ok).toBe(true);
    const loaded = loadRun(data, 1);
    expect(runFeat(loaded, 'battlesWon')).toBe(2);
    expect(runFeat(loaded, 'allyFalls')).toBe(2);
    expect(runFeat(loaded, 'overPar')).toBe(1);
    const raw = JSON.parse(store['emblem_rogue_slot_1_run']);
    delete raw.feats;
    store['emblem_rogue_slot_1_run'] = JSON.stringify(raw);
    expect(runFeat(loadRun(data, 1), 'battlesWon')).toBe(0);
  });

  it('a run started on this build counts from its start; one saved before never does', () => {
    const rm = startedRun();
    expect(runEndAchievementFacts(rm, { result: 'victory' }).fromStart).toBe(true);
    expect(saveRun(rm, null, 1).ok).toBe(true);
    expect(runEndAchievementFacts(loadRun(data, 1), { result: 'victory' }).fromStart).toBe(true);
    const raw = JSON.parse(store['emblem_rogue_slot_1_run']);
    delete raw.feats;
    store['emblem_rogue_slot_1_run'] = JSON.stringify(raw);
    const old = loadRun(data, 1);
    old.status = 'victory';
    // A purchase after the upgrade creates the counters; they still did not count from the start.
    bumpRunFeat(old, 'shopBuys', 0);
    expect(runEndAchievementFacts(old, { result: 'victory' }).fromStart).toBe(false);
    old.settleEndRunRewards(metaFor(), 'victory');
    expect(isEarned(disk().achievements, 'self_reliant')).toBe(false);
    expect(isEarned(disk().achievements, 'first_light')).toBe(true);
  });

  it('the route map reads it: nothing while a battle is open', () => {
    const rm = startedRun();
    rm.gold = 12_000;
    rm.battleInProgress = { nodeId: 'x' };
    expect(runAchievementFacts(rm, data)).toBeNull();
    const meta = metaFor();
    expect(recordRunAchievements(meta, rm, data)).toEqual([]);
    rm.battleInProgress = null;
    expect(recordRunAchievements(meta, rm, data)).toContain('deep_pockets');
  });

  it("a won run's end earns its rung, its commander and the challenge it met", () => {
    const rm = startedRun();
    const meta = metaFor();
    rm.status = 'victory';
    rm.settleEndRunRewards(meta, 'victory');
    const saved = disk().achievements;
    expect(isEarned(saved, 'first_light')).toBe(true);
    expect(isEarned(saved, 'self_reliant')).toBe(true); // nothing bought
    expect(saved.sets.rungs).toEqual(['normal']);
    expect(saved.sets.commanders).toEqual(['Edric']);
  });

  it('a lost run adds no rung; a bought item spoils Self-Reliant', () => {
    const lost = startedRun();
    lost.settleEndRunRewards(metaFor(), 'defeat');
    expect(disk().achievements.sets.rungs).toEqual([]);
    const facts = runEndAchievementFacts(lost, { result: 'defeat' });
    expect(facts.victory).toBe(false);
    const bought = startedRun();
    bought.runRecordId = 'other-run';
    bought.feats = { shopBuys: 1, fromStart: true };
    bought.settleEndRunRewards(metaFor(), 'victory');
    expect(isEarned(disk().achievements, 'self_reliant')).toBe(false);
    expect(isEarned(disk().achievements, 'first_light')).toBe(true);
  });

  it('the totals come from the shipped data', () => {
    const totals = achievementTotals(data);
    expect(totals.rungs).toEqual(['normal', 'dusk', 'hard', 'lunatic']);
    expect(totals.lords).toHaveLength(7);
    expect(totals.commanders).toEqual(totals.lords);
    expect(totals.marks).toHaveLength(5);
    expect(totals.bosses).toContain('The Entity');
    expect(totals.bosses).not.toContain('Varro');
    expect(totals.events.length).toBeGreaterThan(20);
    expect(totals.epics.length).toBeGreaterThan(5);
    expect(totals.deeds.length).toBeGreaterThan(5);
  });
});
