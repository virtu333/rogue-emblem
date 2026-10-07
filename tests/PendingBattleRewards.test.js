import { generateShopInventory } from '../src/engine/LootSystem.js';
import { applyRewardBundle, applyAccessoryReward } from '../src/engine/LootRewardCommands.js';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
vi.mock('../src/ui/MobileRewards.js', () => ({
  MobileRewards: class {
    constructor() {
      this.steps = [];
    }
    destroy() {}
    open() {}
    render() {}
    renderSaveFailure() {}
  },
}));
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import { prepareBattleRewards } from '../src/engine/PendingBattleRewards.js';
import { PendingRewardController } from '../src/ui/PendingRewardController.js';
import { loadGameData } from './testData.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { rewardRevealPending } from '../src/ui/rewardReveal.js';
import { isSkipDominated } from '../src/ui/rewardDisplay.js';
let writesFail;
beforeEach(() => {
  writesFail = false;
  const storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => {
      if (writesFail) throw Error('quota');
      storage.set(k, v);
    },
    removeItem: (k) => storage.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const gameData = loadGameData(),
    runManager = new RunManager(gameData);
  runManager.startRun();
  const scene = {
    gameData,
    runManager,
    registry: { get: (k) => (k === 'activeSlot' ? 1 : null) },
    events: { once() {}, off() {} },
  };
  prepareBattleRewards(runManager, gameData, {
    isElite: true,
    goldEarned: 100,
    completionGoldAward: 100,
  });
  return scene;
}
describe('durable native rewards', () => {
  it('releases the scene lootGroup when the flow ends, so no canvas loot screen looks open', () => {
    const s = setup(),
      c = new PendingRewardController(s, { onLeave: vi.fn(), onComplete: vi.fn() });
    s.lootGroup = c.lootGroup;
    c.destroy();
    expect(s.lootGroup).toBeNull();
    const legacy = [{}];
    s.lootGroup = legacy;
    c.destroy();
    expect(s.lootGroup).toBe(legacy);
  });
  it('prepares once and survives reload without saving first or rerolling', () => {
    const s = setup(),
      before = JSON.parse(JSON.stringify(s.runManager.pendingBattleReward));
    expect(saveServiceRun(s)).toBe('');
    const gold = s.runManager.gold;
    prepareBattleRewards(s.runManager, s.gameData, { isElite: false });
    expect(s.runManager.gold).toBe(gold);
    const restored = loadRun(s.gameData, 1);
    expect(restored.pendingBattleReward).toEqual(before);
  });
  it('the reveal flag survives reload, so a resumed reward screen never replays it', () => {
    const s = setup();
    expect(rewardRevealPending(s.runManager.pendingBattleReward)).toBe(true);
    s.runManager.pendingBattleReward.revealed = true;
    expect(saveServiceRun(s)).toBe('');
    const restored = loadRun(s.gameData, 1);
    expect(restored.pendingBattleReward.revealed).toBe(true);
    expect(rewardRevealPending(restored.pendingBattleReward)).toBe(false);
  });
  it('persists first elite pick and final claim in the same write as their value', () => {
    const s = setup();
    s.runManager.pendingBattleReward.choices = [
      { type: 'gold', goldAmount: 123 },
      { type: 'gold', goldAmount: 456 },
    ];
    const gold = s.runManager.gold,
      done = vi.fn();
    const c = new PendingRewardController(s, { onLeave: vi.fn(), onComplete: done });
    c.activateReward(0);
    let restored = loadRun(s.gameData, 1);
    expect(restored.gold).toBe(gold + 123);
    expect(restored.pendingBattleReward.claimed).toEqual([0]);
    expect(restored.pendingBattleReward.picksRemaining).toBe(1);
    c.activateReward(0);
    expect(s.runManager.gold).toBe(gold + 123);
    c.activateReward(1);
    restored = loadRun(s.gameData, 1);
    expect(restored.gold).toBe(gold + 579);
    expect(restored.pendingBattleReward).toBeNull();
    expect(done).toHaveBeenCalledOnce();
  });
  it('blocks a newly opened reward flow when the initial checkpoint cannot save', () => {
    const s = setup();
    writesFail = true;
    const c = new PendingRewardController(s, { onLeave: vi.fn(), onComplete: vi.fn() });
    expect(c.saveError).toContain('Save failed');
    expect(c.isRewardAvailable(0)).toBe(false);
    expect(loadRun(s.gameData, 1)).toBeNull();
    writesFail = false;
    c.retrySave();
    expect(c.isRewardAvailable(0)).toBe(true);
    expect(loadRun(s.gameData, 1).pendingBattleReward).toEqual(s.runManager.pendingBattleReward);
  });
  it('failed final save blocks claims and navigation; retry never reapplies gold', () => {
    const s = setup();
    saveServiceRun(s);
    const old = loadRun(s.gameData, 1).gold,
      leave = vi.fn(),
      done = vi.fn();
    const c = new PendingRewardController(s, { onLeave: leave, onComplete: done });
    writesFail = true;
    const skip = c.choices.length,
      bonus = c.record.skipGold;
    c.activateReward(skip);
    expect(s.runManager.gold).toBe(old + bonus);
    expect(loadRun(s.gameData, 1).gold).toBe(old);
    expect(c.saveError).toContain('Save failed');
    c.activateReward(skip);
    c.leave();
    expect(s.runManager.gold).toBe(old + bonus);
    expect(leave).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    writesFail = false;
    c.retrySave();
    expect(loadRun(s.gameData, 1).gold).toBe(old + bonus);
    expect(loadRun(s.gameData, 1).pendingBattleReward).toBeNull();
    expect(done).toHaveBeenCalledOnce();
  });
});

// The skip card ("Take N gold instead") stays on the screen; it is only quieted when a
// gold card still on offer pays at least as much (a gold card also adds team XP).
describe('dominated skip card', () => {
  const gold = (goldAmount) => ({ type: 'gold', goldAmount, xpAmount: 25 });
  const weapon = { type: 'weapon', item: { name: 'Iron Sword', type: 'Sword' } };
  it('is dominated only by a gold card paying at least the skip', () => {
    expect(isSkipDominated([weapon, gold(300)], 200)).toBe(true);
    expect(isSkipDominated([gold(200)], 200)).toBe(true);
    expect(isSkipDominated([weapon, gold(199)], 200)).toBe(false);
    expect(isSkipDominated([weapon, weapon], 200)).toBe(false);
    expect(isSkipDominated([], 200)).toBe(false);
    expect(isSkipDominated(null, 200)).toBe(false);
  });
  it('ignores a gold card that is no longer available', () => {
    const choices = [gold(300), weapon, gold(250)];
    expect(isSkipDominated(choices, 200, (i) => i !== 0)).toBe(true);
    expect(isSkipDominated(choices, 200, (i) => i === 1)).toBe(false);
  });
  it("follows the reward screen's own availability: an elite's claimed gold card no longer counts", () => {
    const s = setup();
    const record = s.runManager.pendingBattleReward;
    record.choices = [gold(record.skipGold + 50), weapon, weapon];
    const c = new PendingRewardController(s, { onLeave: vi.fn(), onComplete: vi.fn() });
    const available = (i) => c.isRewardAvailable(i);
    expect(isSkipDominated(c.choices, record.skipGold, available)).toBe(true);
    c.activateReward(0); // first of the elite's two picks
    expect(s.runManager.pendingBattleReward).toBe(record);
    expect(isSkipDominated(c.choices, record.skipGold, available)).toBe(false);
  });
});

it('boss-reaching payout is once per run, durable, and shared by settlement/preview', () => {
  const s = setup(),
    run = s.runManager;
  run.completedBattles = 4;
  // First Light earns x0.8: floor(4 battles x 15 x 0.8) = 48; the milestone adds floor(15 x 0.8) = 12.
  expect(run.previewEndRunRewards()).toMatchObject({ valor: 48, supply: 48 });
  run.beginBattleInProgress('boss', { isBoss: true });
  run.beginBattleInProgress('boss', { isBoss: true });
  saveServiceRun(s);
  const restored = loadRun(s.gameData, 1);
  expect(restored.previewEndRunRewards()).toMatchObject({ valor: 60, supply: 60 });
  expect(restored.settleEndRunRewards(null, 'defeat')).toMatchObject({ valor: 60, supply: 60 });
  expect(restored.settleEndRunRewards(null, 'defeat')).toMatchObject({ valor: 60, supply: 60 });
});

it('Vulnerary bundle spills to convoy with distinct IDs and cannot partially grant when full', () => {
  const s = setup(),
    run = s.runManager,
    unit = run.roster[0];
  const item = s.gameData.consumables.find((c) => c.name === 'Vulnerary');
  unit.consumables = [structuredClone(item), structuredClone(item)];
  expect(applyRewardBundle(run, item, unit, 3).ok).toBe(true);
  expect(unit.consumables.length).toBe(3);
  expect(run.convoy.consumables.length).toBe(2);
  expect(unit.consumables[2].uid).not.toBe(run.convoy.consumables[0].uid);
  while (run.canAddToConvoy(item)) run.addToConvoy(item);
  const before = JSON.stringify(run.toJSON());
  expect(applyRewardBundle(run, item, unit, 3).ok).toBe(false);
  expect(JSON.stringify(run.toJSON())).toBe(before);
});

it('seen stock falls back to valid repeats instead of unresolvable fresh names', () => {
  const data = loadGameData();
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  try {
    const stock = generateShopInventory(
      'act1',
      data.lootTables,
      data.weapons,
      data.consumables,
      data.accessories,
      null,
      null,
      {
        itemCountRange: { min: 6, max: 6 },
        recentItemNames: [...data.weapons, ...data.consumables, ...data.accessories].map(
          (i) => i.name,
        ),
      },
    );
    expect(stock).toHaveLength(6);
    expect(new Set(stock.map((entry) => entry.item.name)).size).toBe(6);
    expect(stock.some((entry) => entry.item.name === 'Vulnerary')).toBe(true);
  } finally {
    random.mockRestore();
  }
});

it('accessory reward equips and persists exactly once through the claim transaction', () => {
  const s = setup(),
    run = s.runManager,
    unit = run.roster[0];
  const item = s.gameData.accessories[0];
  run.pendingBattleReward.choices[0] = { type: 'accessory', item };
  const c = new PendingRewardController(s, { onLeave() {}, onComplete() {} });
  expect(c.applyNativeReward(0, () => applyAccessoryReward(run, item, unit)).ok).toBe(true);
  expect(unit.accessory.name).toBe(item.name);
  expect(c.applyNativeReward(0, () => applyAccessoryReward(run, item, unit)).ok).toBe(false);
  expect(run.accessories.filter((a) => a.name === item.name)).toHaveLength(0);
});
