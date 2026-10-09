// Gambler's Toss (docs/specs/blessings-v3.md §5.4): each victory's battle gold is doubled or
// cut to a third on an even toss seeded by the run and the node. Its cost is the variance itself.
//
// Ways this can fail, a test each:
//   1. the toss draws from Math.random (it would shift every battle stream, and a retried
//      battle would toss a different face), or two completions of one node toss differently;
//   2. the odds are off (a coin that is not even, or whose mean is not the about +17% the
//      card is priced on: 2 or 1/3, evenly);
//   3. the toss lands before the elite/Merchant Bane/rung multipliers instead of after, or after
//      a Debt has garnished the gold instead of before;
//   4. a cut gold rounds up, or a negative or fractional amount is paid;
//   5. a run without the card is touched at all (a record, a line, a changed payout);
//   6. the victory band or the reward header does not say what the toss did, or says it for
//      another node's battle, or the toss record is saved;
//   7. a malformed boon, or a saved run, loses or invents the toss.
import { describe, expect, it, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  gambleLines,
  gambleWord,
  parseBattleGoldGamble,
  rollBattleGoldGamble,
  settleBattleGoldGamble,
} from '../src/engine/BattleGoldGamble.js';
import { prepareBattleRewards } from '../src/engine/PendingBattleRewards.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const toss = data.blessings.blessings.find((b) => b.id === 'gamblers_toss');
// The card's own toss, read from the data (a retune moves these tests with it).
const GAMBLE = toss.boons[0].params;

function startRun({ seed = 31, difficultyId = 'normal' } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  return rm;
}
function hold(rm, ...ids) {
  rm.activeBlessings = ids.map((id) => ({
    id,
    rolledCost: { label: 'test', effects: [], kind: 'intrinsic' },
  }));
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return rm;
}
function tossRun(opts) {
  return hold(startRun(opts), 'gamblers_toss');
}
const nextBattle = (rm) => rm.getAvailableNodes().find((n) => n.type === 'battle');

/** Win the next battle node; returns the gold the run was paid for it. */
function win(rm, { kills = 100 } = {}) {
  const node = nextBattle(rm);
  const before = rm.gold;
  expect(rm.completeBattle(rm.getRoster(), node.id, kills, { turnCount: 1, turnPar: 10 })).toBe(
    true,
  );
  return { node, paid: rm.gold - before };
}
/** What the same victory pays a run with no toss (same seed, same node). */
function controlPay(opts, kills) {
  return win(startRun(opts), { kills }).paid;
}

describe("Gambler's Toss: the card", () => {
  it('is a tier III gold card whose price is the variance, and an event never grants it', () => {
    expect(toss).toMatchObject({ tier: 3, tags: ['gold'] });
    expect(toss.boons).toEqual([
      { type: 'battle_gold_gamble', params: { chance: 0.5, win: 2, lose: 0.333 } },
    ]);
    expect(toss.intrinsicPrice.points).toBe(3);
    expect(toss.prices).toBeUndefined();
  });
});

describe("Gambler's Toss: the toss", () => {
  it('draws nothing from Math.random, in the roll or in a whole victory', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      spy.mockClear();
      rollBattleGoldGamble({ runSeed: 31, nodeId: 'act1_2_1', gamble: GAMBLE });
      expect(spy).not.toHaveBeenCalled();

      // A victory spends exactly as many Math.random draws with the card as without it.
      const control = startRun();
      spy.mockClear();
      win(control);
      const without = spy.mock.calls.length;
      const held = tossRun();
      spy.mockClear();
      win(held);
      expect(spy.mock.calls.length).toBe(without);
    } finally {
      spy.mockRestore();
    }
  });

  it('is the same face for the same run and node: a reloaded or replayed completion', () => {
    const first = tossRun();
    const saved = JSON.parse(JSON.stringify(first.toJSON()));
    const a = win(first);
    const replay = RunManager.fromJSON(saved, data); // the save from before the victory
    const b = win(replay);
    expect(b.node.id).toBe(a.node.id);
    expect(b.paid).toBe(a.paid);
    expect(replay.lastBattleGoldGamble.face).toBe(first.lastBattleGoldGamble.face);
    // And a fresh run on the same seed, from scratch.
    const again = win(tossRun());
    expect(again.paid).toBe(a.paid);
  });

  it('pays exactly double or a third of what the same victory pays without the card', () => {
    const faces = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const control = controlPay({ seed }, 100);
      const held = tossRun({ seed });
      const { paid } = win(held, { kills: 100 });
      const record = held.lastBattleGoldGamble;
      faces.add(record.face);
      expect(paid, `seed ${seed}`).toBe(
        record.face === 'win' ? control * 2 : Math.floor(control * 0.333),
      );
      expect(record).toMatchObject({
        goldBefore: control,
        goldAfter: paid,
        multiplier: expect.any(Number),
      });
    }
    // Both faces really come up.
    expect([...faces].sort()).toEqual(['lose', 'win']);
  });

  it('is an even toss whose mean is the about +17% the card is priced on', () => {
    let doubled = 0;
    let total = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const { multiplier } = rollBattleGoldGamble({
        runSeed: 12345,
        nodeId: `act1_${i % 9}_${Math.floor(i / 9)}`,
        gamble: GAMBLE,
      });
      if (multiplier === 2) doubled++;
      total += multiplier;
    }
    expect(doubled / N).toBeGreaterThan(0.47);
    expect(doubled / N).toBeLessThan(0.53);
    // 0.5 × 2 + 0.5 × 0.333 = 1.1665.
    expect(GAMBLE).toEqual({ chance: 0.5, win: 2, lose: 0.333 });
    expect(total / N).toBeGreaterThan(1.14);
    expect(total / N).toBeLessThan(1.19);
  });

  it('floors a gold cut to a third, never rounds up or pays a fraction', () => {
    // Find a node that tosses tails for this seed, then cut an amount that doesn't divide.
    let node = null;
    for (let i = 0; i < 200 && !node; i++) {
      const id = `act1_1_${i}`;
      if (rollBattleGoldGamble({ runSeed: 9, nodeId: id, gamble: GAMBLE }).face === 'lose')
        node = id;
    }
    const settled = settleBattleGoldGamble({ runSeed: 9, nodeId: node, gamble: GAMBLE, gold: 301 });
    expect(settled.goldAfter).toBe(100); // floor(301 × 0.333) = floor(100.233)
    expect(Number.isInteger(settled.goldAfter)).toBe(true);
    expect(
      settleBattleGoldGamble({ runSeed: 9, nodeId: node, gamble: GAMBLE, gold: 0 }).goldAfter,
    ).toBe(0);
    expect(
      settleBattleGoldGamble({ runSeed: 9, nodeId: node, gamble: GAMBLE, gold: -5 }).goldAfter,
    ).toBe(0);
  });
});

describe("Gambler's Toss: where it sits in the payout", () => {
  it('tosses the gold after Merchant Bane and the rung multipliers', () => {
    for (const difficultyId of ['normal', 'hard']) {
      let checked = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const opts = { seed, difficultyId };
        const bane = hold(startRun(opts), 'merchant_bane');
        const baneGold = win(bane, { kills: 137 }).paid;
        const both = hold(startRun(opts), 'merchant_bane', 'gamblers_toss');
        const { paid } = win(both, { kills: 137 });
        const { multiplier } = both.lastBattleGoldGamble;
        expect(paid, `${difficultyId} seed ${seed}`).toBe(Math.floor(baneGold * multiplier));
        checked++;
      }
      expect(checked).toBe(12);
    }
  });

  it('tosses before a Debt garnishes: the Debt takes its share of the tossed gold', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const rm = tossRun({ seed });
      rm.burdens = [{ id: 'debt', owed: 100000, garnish: 0.5 }];
      const control = controlPay({ seed }, 100);
      const { paid } = win(rm, { kills: 100 });
      const tossed = rm.lastBattleGoldGamble.goldAfter;
      expect(tossed, `seed ${seed}`).toBe(
        rm.lastBattleGoldGamble.face === 'win' ? control * 2 : Math.floor(control * 0.333),
      );
      expect(paid, `seed ${seed}`).toBe(tossed - Math.floor(tossed * 0.5));
      expect(rm.lastBurdenSettlement.goldBefore).toBe(tossed);
    }
  });
});

describe("Gambler's Toss: a run without the card", () => {
  it('has no record and pays what it always paid', () => {
    const rm = startRun();
    expect(rm.getBattleGoldGamble()).toBeNull();
    win(rm);
    expect(rm.lastBattleGoldGamble).toBeNull();
    expect(gambleLines(rm.lastBattleGoldGamble)).toEqual([]);
  });
});

describe("Gambler's Toss: what the player is told", () => {
  it('the victory band line and the reward header say doubled or cut to a third, for this node only', () => {
    const rm = tossRun({ seed: 5 });
    const { node, paid } = win(rm);
    const record = rm.lastBattleGoldGamble;
    const delta = record.goldAfter - record.goldBefore;
    expect(gambleLines(record)).toEqual([
      `Gambler's Toss: ${record.face === 'win' ? 'doubled' : 'cut to a third'} (${delta < 0 ? '−' : '+'}${Math.abs(delta)} G)`,
    ]);
    const reward = prepareBattleRewards(rm, data, {
      nodeId: node.id,
      goldEarned: 100,
      completionGoldAward: 100,
      battleCompletionAwardedGold: paid,
    });
    expect(reward.summary).toBe(
      `Battle and completion: ${paid} gold · Gambler's Toss: ${record.face === 'win' ? 'doubled' : 'cut to a third'}`,
    );

    // A record from another node's victory is never printed on this one.
    const other = tossRun({ seed: 5 });
    win(other);
    other.lastBattleGoldGamble = { ...other.lastBattleGoldGamble, nodeId: 'somewhere_else' };
    expect(
      prepareBattleRewards(other, data, {
        nodeId: node.id,
        goldEarned: 100,
        completionGoldAward: 100,
        battleCompletionAwardedGold: paid,
      }).summary,
    ).not.toContain('Toss');
  });

  it('words a non-standard multiplier plainly', () => {
    expect(gambleWord({ multiplier: 2 })).toBe('doubled');
    expect(gambleWord({ multiplier: 0.5 })).toBe('halved');
    expect(gambleWord({ multiplier: 0.333 })).toBe('cut to a third');
    expect(gambleWord({ multiplier: 3 })).toBe('×3');
  });
});

describe("Gambler's Toss: saves and malformed boons", () => {
  it('survives a save and load; the last toss record is not saved', () => {
    const rm = tossRun();
    expect(rm.toJSON().blessingRuntimeModifiers.battleGoldGamble).toEqual(GAMBLE);
    win(rm);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    expect(JSON.stringify(saved)).not.toContain('lastBattleGoldGamble');
    const restored = RunManager.fromJSON(saved, data);
    expect(restored.getBattleGoldGamble()).toEqual(GAMBLE);
    expect(restored.lastBattleGoldGamble ?? null).toBeNull();
  });

  it('refuses an unusable toss and a saved one that is garbage', () => {
    for (const params of [
      { chance: 0, win: 2, lose: 0.5 },
      { chance: 1, win: 2, lose: 0.5 },
      { chance: 0.5, win: 0, lose: 0.5 },
      { chance: 0.5, win: 2, lose: -1 },
      { chance: 'x', win: 2, lose: 0.5 },
    ])
      expect(parseBattleGoldGamble(params), JSON.stringify(params)).toBeNull();
    const rm = startRun();
    rm._applySingleRunStartBlessingEffect('gamblers_toss', {
      type: 'battle_gold_gamble',
      params: { chance: 2, win: 2, lose: 0.5 },
    });
    expect(rm.getBattleGoldGamble()).toBeNull();
    const saved = JSON.parse(JSON.stringify(tossRun().toJSON()));
    saved.blessingRuntimeModifiers.battleGoldGamble = { chance: 'a' };
    expect(RunManager.fromJSON(saved, data).getBattleGoldGamble()).toBeNull();
  });
});
