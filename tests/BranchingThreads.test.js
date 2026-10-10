// Branching Threads (Home Base, economy/Supply): N rerolls per run of a battle's loot
// choices, before the first pick. The engine rule is engine/PendingBattleRewards.js
// (rollBattleRewardChoices shared by the first draw and every reroll; rerollBattleReward
// the atomic commit), the count spent rides the run save (`rewardRerollsSpent`), and the
// reward screen's button is ui/rewardRerollButton.js through PendingRewardController.
//
// Ways this can fail, one test (or more) each:
//   - the tiers aggregate as increments, or the upgrade is priced/categorised wrongly
//   - a reroll after a pick, past the last charge, on authored loot or in the prologue
//   - a reroll that touches the gold already earned (vault, skip figure, summary)
//   - a reroll that draws with other parameters than the first draw (count, the
//     Vulnerary bundle, the late-pressure gold multiplier, accessory skills)
//   - the spent count lost or invented by a save/load, or an old save reading garbage
//   - a failed save that keeps the new choices or the spent charge in memory
//   - the button shown to a player without the upgrade, or enabled when it must not be
//   - rendering the status rolling anything
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import {
  prepareBattleRewards,
  finishRewardClaim,
  rerollBattleReward,
  rewardRerollBlock,
  rewardRerollStatus,
  rewardRerollsGranted,
  rewardRerollsLeft,
} from '../src/engine/PendingBattleRewards.js';
import { generateLootChoices } from '../src/engine/LootSystem.js';
import { PendingRewardController } from '../src/ui/PendingRewardController.js';
import { rewardRerollButtonState } from '../src/ui/rewardRerollButton.js';
import { _resetUidCounter } from '../src/utils/itemUid.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

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
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run `fn` with Math.random on a fixed stream and the item uid counter at 0. */
function seeded(seed, fn) {
  const spy = vi.spyOn(Math, 'random').mockImplementation(mulberry32(seed));
  _resetUidCounter();
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

function metaWith(level, key = 'bt-test') {
  const meta = new MetaProgressionManager(data.metaUpgrades, key);
  if (level > 0) meta.purchasedUpgrades.branching_threads = level;
  return meta;
}

/** A standard run whose meta effects carry `level` tiers of Branching Threads. */
function makeRun(level, gameData = data) {
  const run = new RunManager(gameData, metaWith(level).getActiveEffects());
  run.startRun({ runSeed: 11, applyBlessingsAtStart: false });
  return run;
}

const reward = (run, gameData = data, ctx = {}) =>
  prepareBattleRewards(run, gameData, {
    goldEarned: 120,
    completionGoldAward: 80,
    metaEffects: run.metaEffects,
    ...ctx,
  });

/** Game data whose act1 loot draws only the given categories (weights 1 each). */
function onlyCategories(categories, mutate = null) {
  const lootTables = structuredClone(data.lootTables);
  const weights = lootTables.act1.weights;
  for (const k of Object.keys(weights)) weights[k] = categories.includes(k) ? 1 : 0;
  mutate?.(lootTables);
  return { ...data, lootTables };
}

describe('the upgrade', () => {
  it('is Branching Threads: economy (Supply), 4 tiers at 100/200/250/250, no milestone', () => {
    const u = data.metaUpgrades.find((x) => x.id === 'branching_threads');
    expect(u).toMatchObject({ name: 'Branching Threads', category: 'economy', maxLevel: 4 });
    expect(u.costs).toEqual([100, 200, 250, 250]);
    expect(u.requires).toBeUndefined();
    expect(metaWith(0).getCurrencyForUpgrade('branching_threads')).toBe('supply');
  });

  it('tier N grants N rerolls a run (tier effects are totals, never summed)', () => {
    expect(metaWith(0).getActiveEffects().rewardRerolls).toBe(0);
    for (const level of [1, 2, 3, 4])
      expect(metaWith(level, `bt-${level}`).getActiveEffects().rewardRerolls).toBe(level);
  });

  it('a run started with the upgrade has its charges; a no-meta run has none', () => {
    expect(rewardRerollsGranted(makeRun(3))).toBe(3);
    expect(rewardRerollsLeft(makeRun(3))).toBe(3);
    const noMeta = new RunManager(data, null);
    noMeta.startRun({ runSeed: 3, applyBlessingsAtStart: false });
    expect(rewardRerollsGranted(noMeta)).toBe(0);
  });
});

describe('a reroll', () => {
  it('redraws the whole set before a pick, spends one charge and never touches earned gold', () => {
    const run = makeRun(2);
    const record = reward(run);
    const before = {
      gold: run.gold,
      skipGold: record.skipGold,
      summary: record.summary,
      choices: structuredClone(record.choices),
    };
    record.draft = { selected: 1, path: [] };
    const result = seeded(99, () => rerollBattleReward(run, data));
    expect(result.ok).toBe(true);
    expect(run.pendingBattleReward).toBe(record);
    expect(record.choices).toBe(result.choices);
    expect(record.choices).toHaveLength(3);
    // New item instances (fresh uids) in place of the first offer.
    const uids = (cs) => cs.map((c) => c.item?.uid).filter(Boolean);
    for (const uid of uids(record.choices)) expect(uids(before.choices)).not.toContain(uid);
    expect(run.rewardRerollsSpent).toBe(1);
    expect(rewardRerollsLeft(run)).toBe(1);
    expect(run.gold).toBe(before.gold);
    expect(record.skipGold).toBe(before.skipGold);
    expect(record.summary).toBe(before.summary);
    expect(record.claimed).toEqual([]);
    expect(record.picksRemaining).toBe(1);
    expect(record.draft).toEqual({ selected: 0, path: [] });
    expect(record.revealed).toBe(true);
  });

  it('is refused once a pick from the reward is taken (an elite has two picks)', () => {
    const run = makeRun(4);
    const record = reward(run, data, { isElite: true });
    expect(record.choices).toHaveLength(4);
    expect(finishRewardClaim(run, 0)).toBe(true);
    expect(run.pendingBattleReward).toBe(record); // one pick still to take
    const choices = structuredClone(record.choices);
    expect(rewardRerollBlock(run)).toBe('picked');
    expect(rerollBattleReward(run, data)).toMatchObject({ ok: false, reason: 'picked' });
    expect(record.choices).toEqual(choices);
    expect(run.rewardRerollsSpent).toBe(0);
  });

  it('is refused with no charge left, and the last charge can be spent', () => {
    const run = makeRun(1);
    const record = reward(run);
    expect(rerollBattleReward(run, data).ok).toBe(true);
    const choices = structuredClone(record.choices);
    expect(rewardRerollBlock(run)).toBe('spent');
    expect(rerollBattleReward(run, data)).toMatchObject({ ok: false, reason: 'spent' });
    expect(record.choices).toEqual(choices);
    expect(run.rewardRerollsSpent).toBe(1);
  });

  it('charges are per run, shared across battles', () => {
    const run = makeRun(2);
    reward(run);
    expect(rerollBattleReward(run, data).ok).toBe(true);
    run.pendingBattleReward = null;
    reward(run);
    expect(rewardRerollsLeft(run)).toBe(1);
    expect(rerollBattleReward(run, data).ok).toBe(true);
    expect(rerollBattleReward(run, data).ok).toBe(false);
    expect(run.rewardRerollsSpent).toBe(2);
  });

  it('is refused without the upgrade, on authored loot and in the prologue run', () => {
    const none = makeRun(0);
    reward(none);
    expect(rewardRerollBlock(none)).toBe('none');
    expect(rerollBattleReward(none, data).ok).toBe(false);

    const authored = makeRun(4);
    const record = reward(authored, data, { authoredLoot: [{ type: 'gold', gold: 300 }] });
    expect(record.draw).toBeNull();
    expect(rewardRerollBlock(authored)).toBe('fixed');
    expect(rerollBattleReward(authored, data).ok).toBe(false);
    expect(authored.rewardRerollsSpent).toBe(0);

    const prologue = new RunManager(data, metaWith(4).getActiveEffects());
    prologue.startPrologue(data);
    expect(rewardRerollsGranted(prologue)).toBe(0);
    // Even meta effects forced onto a prologue run grant nothing.
    prologue.metaEffects = { rewardRerolls: 4 };
    expect(rewardRerollsGranted(prologue)).toBe(0);
    const chapter = data.prologue.chapters.find((c) => Array.isArray(c.loot));
    reward(prologue, data, { authoredLoot: chapter.loot });
    expect(rerollBattleReward(prologue, data).ok).toBe(false);
  });

  it('is refused for a reward saved before rerolls existed (no draw recorded)', () => {
    const run = makeRun(2);
    const record = reward(run);
    delete record.draw;
    expect(rewardRerollBlock(run)).toBe('fixed');
    expect(rerollBattleReward(run, data).ok).toBe(false);
  });

  it('draws with the first draw’s parameters: the Vulnerary bundle and the pressure gold multiplier', () => {
    const gameData = onlyCategories(['healing', 'gold']);
    const run = makeRun(2, gameData);
    const pressure = { goldMultiplier: 0.5 };
    reward(run, gameData, { victoryPressureState: pressure });
    const rerolled = seeded(5, () => rerollBattleReward(run, gameData)).choices;
    // The same stream through the loot system alone, then the two rules by hand.
    const raw = seeded(5, () =>
      generateLootChoices(
        'act1',
        gameData.lootTables,
        gameData.weapons,
        run.getConsumableCatalog(),
        3,
        0,
        gameData.accessories,
        gameData.whetstones,
        run.roster,
        false,
        null,
        false,
        run.getWeaponArtSpawnConfig(),
        { lootCategoryWeightBonuses: run.metaEffects.lootCategoryWeightBonuses },
      ),
    );
    expect(raw.some((c) => c.item?.name === 'Vulnerary')).toBe(true);
    expect(raw.some((c) => c.type === 'gold')).toBe(true);
    const expected = raw.map((c) =>
      c.item?.name === 'Vulnerary'
        ? { ...c, quantity: 2 }
        : c.type === 'gold'
          ? { ...c, goldAmount: Math.floor(c.goldAmount * 0.5) }
          : c,
    );
    expect(rerolled).toEqual(JSON.parse(JSON.stringify(expected)));
  });

  it('keeps an elite or boss reward’s shape: four choices for an elite', () => {
    const run = makeRun(2);
    reward(run, data, { isElite: true, isBoss: true });
    expect(run.pendingBattleReward.draw).toMatchObject({ isElite: true, isBoss: true });
    expect(rerollBattleReward(run, data).choices).toHaveLength(4);
    expect(run.pendingBattleReward.picksRemaining).toBe(2);
  });

  it('a rerolled accessory may bind a skill exactly as a first-draw one (+50% price)', () => {
    const gameData = onlyCategories(['accessory'], (tables) => {
      tables.accessorySkills.chanceByAct.act1 = 1;
    });
    const run = makeRun(1, gameData);
    reward(run, gameData);
    const rerolled = rerollBattleReward(run, gameData).choices;
    expect(rerolled).toHaveLength(3);
    for (const choice of rerolled.filter((c) => c.type === 'accessory')) {
      const catalog = data.accessories.find((a) => a.name === choice.item.name);
      expect(typeof choice.item._boundSkill).toBe('string');
      expect(choice.item.price).toBe(Math.round(catalog.price * 1.5));
    }
    expect(rerolled.some((c) => c.type === 'accessory')).toBe(true);
  });
});

describe('the saved run', () => {
  it('round-trips the spent count; an old save without it reads 0', () => {
    const run = makeRun(3);
    reward(run);
    rerollBattleReward(run, data);
    rerollBattleReward(run, data);
    const json = JSON.parse(JSON.stringify(run.toJSON()));
    expect(json.rewardRerollsSpent).toBe(2);
    const restored = RunManager.fromJSON(json, data);
    expect(restored.rewardRerollsSpent).toBe(2);
    expect(rewardRerollsLeft(restored)).toBe(1);
    // The draw parameters ride the pending reward, so the restored run can reroll it.
    expect(restored.pendingBattleReward.draw).toEqual(run.pendingBattleReward.draw);
    expect(rerollBattleReward(restored, data).ok).toBe(true);

    const old = structuredClone(json);
    delete old.rewardRerollsSpent;
    expect(RunManager.fromJSON(old, data).rewardRerollsSpent).toBe(0);
    for (const junk of [-3, 'x', null, 2.7]) {
      const bad = { ...structuredClone(json), rewardRerollsSpent: junk };
      expect(RunManager.fromJSON(bad, data).rewardRerollsSpent).toBe(junk === 2.7 ? 2 : 0);
    }
  });

  it('a new run starts with none spent', () => {
    const run = makeRun(2);
    run.rewardRerollsSpent = 2;
    run.startRun({ runSeed: 12, applyBlessingsAtStart: false });
    expect(run.rewardRerollsSpent).toBe(0);
  });
});

function scene(run) {
  return {
    gameData: data,
    runManager: run,
    registry: { get: (k) => (k === 'activeSlot' ? 1 : null) },
    events: { once() {}, off() {} },
  };
}

describe('the reward screen (PendingRewardController)', () => {
  it('a reroll is saved with its charge: a reload shows the rerolled choices, the charge spent', () => {
    const run = makeRun(2);
    reward(run);
    const c = new PendingRewardController(scene(run), { onLeave() {}, onComplete() {} });
    const first = structuredClone(run.pendingBattleReward.choices);
    expect(loadRun(data, 1).pendingBattleReward.choices).toEqual(first);
    const result = c.rerollRewards();
    expect(result.ok).toBe(true);
    expect(c.choices).toBe(run.pendingBattleReward.choices);
    const restored = loadRun(data, 1);
    expect(restored.rewardRerollsSpent).toBe(1);
    expect(restored.pendingBattleReward.choices).toEqual(run.pendingBattleReward.choices);
    expect(restored.pendingBattleReward.choices).not.toEqual(first);
    // The reloaded screen offers what was saved and rolls nothing.
    const reloaded = new PendingRewardController(scene(restored), {
      onLeave() {},
      onComplete() {},
    });
    expect(reloaded.choices).toEqual(run.pendingBattleReward.choices);
    expect(rewardRerollsLeft(restored)).toBe(1);
  });

  it('a failed save changes nothing: same choices, same charges, in memory and on disk', () => {
    const run = makeRun(2);
    reward(run);
    const c = new PendingRewardController(scene(run), { onLeave() {}, onComplete() {} });
    const record = run.pendingBattleReward;
    const choices = record.choices;
    const snapshot = structuredClone(record);
    writesFail = true;
    const result = c.rerollRewards();
    expect(result).toMatchObject({ ok: false, saveFailed: true });
    expect(record.choices).toBe(choices);
    expect(record).toEqual(snapshot);
    expect(c.choices).toBe(choices);
    expect(run.rewardRerollsSpent).toBe(0);
    expect(c.saveError).toContain('Save failed');
    // Blocked behind Retry save; the retry writes the unchanged reward.
    expect(c.rerollRewards().ok).toBe(false);
    writesFail = false;
    c.retrySave();
    const restored = loadRun(data, 1);
    expect(restored.rewardRerollsSpent).toBe(0);
    expect(restored.pendingBattleReward.choices).toEqual(snapshot.choices);
    expect(c.rerollRewards().ok).toBe(true);
    expect(loadRun(data, 1).rewardRerollsSpent).toBe(1);
  });

  it('reading the button status rolls nothing', () => {
    const run = makeRun(2);
    reward(run);
    const c = new PendingRewardController(scene(run), { onLeave() {}, onComplete() {} });
    const random = vi.spyOn(Math, 'random');
    const choices = structuredClone(run.pendingBattleReward.choices);
    rewardRerollButtonState(c.rerollStatus());
    rewardRerollButtonState(rewardRerollStatus(run));
    expect(random).not.toHaveBeenCalled();
    expect(run.pendingBattleReward.choices).toEqual(choices);
  });

  it('the Reroll button: hidden without the upgrade, counts down, disabled after a pick or at 0', () => {
    const state = (run) =>
      rewardRerollButtonState(
        new PendingRewardController(scene(run), { onLeave() {}, onComplete() {} }).rerollStatus(),
      );
    const none = makeRun(0);
    reward(none);
    expect(state(none)).toEqual({ hidden: true });

    const run = makeRun(2);
    reward(run, data, { isElite: true });
    expect(state(run)).toMatchObject({ hidden: false, disabled: false, label: 'Reroll (2)' });
    rerollBattleReward(run, data);
    expect(state(run)).toMatchObject({ hidden: false, disabled: false, label: 'Reroll (1)' });
    expect(finishRewardClaim(run, 0)).toBe(true); // the elite's first of two picks
    expect(run.pendingBattleReward.claimed).toHaveLength(1);
    expect(state(run)).toMatchObject({ hidden: false, disabled: true, label: 'Reroll (1)' });

    const spent = makeRun(1);
    reward(spent);
    rerollBattleReward(spent, data);
    expect(state(spent)).toMatchObject({
      hidden: false,
      disabled: true,
      label: 'No rerolls left',
    });
  });
});
