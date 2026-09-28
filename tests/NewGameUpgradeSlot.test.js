// New Game offers the slot that keeps its upgrades (a playtester nearly began
// fresh in an empty slot while Slot 1 held its progression). The choice is read
// from real slot saves (SlotManager.getSlotSummary over MetaProgressionManager's
// payload) and a run in progress is never offered.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SLOTS, getMetaKey, getRunKey, getSlotSummary } from '../src/engine/SlotManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { hasMetaProgression, pickUpgradeSlot } from '../src/ui/titleMenuModel.js';
import { loadGameData } from './testData.js';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
  },
  writable: true,
  configurable: true,
});

const { metaUpgrades } = loadGameData();

// A slot's meta as MetaProgressionManager saves it (the fields the summary reads).
function meta(slot, fields = {}) {
  store[getMetaKey(slot)] = JSON.stringify({
    totalValor: 0,
    totalSupply: 0,
    purchasedUpgrades: {},
    runsCompleted: 0,
    runsStarted: 0,
    milestones: [],
    savedAt: 1000,
    ...fields,
  });
}
const runInProgress = (slot) =>
  (store[getRunKey(slot)] = JSON.stringify({ actIndex: 0, savedAt: 5, roster: [] }));
const summaries = () => Array.from({ length: MAX_SLOTS }, (_, i) => getSlotSummary(i + 1));
const picked = () => pickUpgradeSlot(summaries())?.slot ?? null;

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  vi.restoreAllMocks();
});

describe('the slot New Game offers to keep upgrades', () => {
  it('none: no saves, or only fresh saves with nothing earned', () => {
    expect(picked()).toBeNull();
    meta(1); // a brand-new save (the first-run fast path's kind)
    meta(2, { runsStarted: 2 }); // started runs, earned nothing
    expect(picked()).toBeNull();
  });

  it('one: a slot with bought upgrades and no run in progress', () => {
    meta(2, { purchasedUpgrades: { lord_hp: 2 }, runsStarted: 3, runsCompleted: 1 });
    expect(picked()).toBe(2);
  });

  it('reads a real save: an upgrade bought through MetaProgressionManager', () => {
    const upgrade = metaUpgrades.find((u) => !u.requires && (u.costs?.[0] ?? Infinity) > 0);
    const manager = new MetaProgressionManager(metaUpgrades, getMetaKey(3));
    manager.addValor(100000);
    manager.addSupply(100000);
    expect(manager.purchaseUpgrade(upgrade.id)).toBeTruthy();
    const summary = getSlotSummary(3);
    expect(summary.upgradesOwned).toBe(1);
    expect(summary.metaSavedAt).toBe(manager.savedAt);
    expect(picked()).toBe(3);
  });

  it('several: the most recently saved wins; a tie goes to the lower slot', () => {
    meta(1, { purchasedUpgrades: { lord_hp: 1 }, runsCompleted: 1, savedAt: 2000 });
    meta(2, { purchasedUpgrades: { lord_hp: 3 }, runsCompleted: 4, savedAt: 9000 });
    meta(3, { totalValor: 40, runsCompleted: 1, savedAt: 5000 });
    expect(picked()).toBe(2);
    meta(3, { totalValor: 40, runsCompleted: 1, savedAt: 9000 });
    expect(picked()).toBe(2);
  });

  it('a slot with a run in progress never qualifies, however recent', () => {
    meta(1, { purchasedUpgrades: { lord_hp: 5 }, runsCompleted: 6, savedAt: 99999 });
    runInProgress(1);
    meta(2, { purchasedUpgrades: { lord_hp: 1 }, runsCompleted: 1, savedAt: 10 });
    expect(picked()).toBe(2);
    runInProgress(2);
    expect(picked()).toBeNull();
    // An unreadable run is still a run: never offered for a new one.
    meta(3, { purchasedUpgrades: { lord_hp: 1 }, runsCompleted: 1, savedAt: 50 });
    store[getRunKey(3)] = '{not json';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(picked()).toBeNull();
  });

  it('all three slots full: the one without a run is still offered', () => {
    meta(1, { purchasedUpgrades: { lord_hp: 2 }, runsCompleted: 2, savedAt: 100 });
    runInProgress(1);
    meta(2); // fresh
    meta(3, { milestones: ['beatAct1'], runsCompleted: 1, savedAt: 50 });
    expect(summaries().every(Boolean)).toBe(true);
    expect(picked()).toBe(3);
  });

  it('a slot waiting on a cloud-save choice is skipped', () => {
    const [one, two] = [
      { slot: 1, upgradesOwned: 2, metaSavedAt: 900, cloudConflict: true },
      { slot: 2, upgradesOwned: 1, metaSavedAt: 100 },
    ];
    expect(pickUpgradeSlot([one, two, null])?.slot).toBe(2);
    expect(pickUpgradeSlot([one, null, null])).toBeNull();
  });

  it('what counts as progression: upgrades, Valor, Supply, a finished run, a milestone', () => {
    const base = { slot: 1, hasActiveRun: false, runCorrupt: false };
    expect(hasMetaProgression(base)).toBe(false);
    expect(hasMetaProgression({ ...base, runsStarted: 4 })).toBe(false);
    for (const earned of [
      { upgradesOwned: 1 },
      { valor: 10 },
      { supply: 10 },
      { runsCompleted: 1 },
      { milestones: ['beatAct1'] },
    ])
      expect(hasMetaProgression({ ...base, ...earned }), JSON.stringify(earned)).toBe(true);
    expect(hasMetaProgression({ ...base, upgradesOwned: 3, hasActiveRun: true })).toBe(false);
    expect(hasMetaProgression(null)).toBe(false);
  });
});
