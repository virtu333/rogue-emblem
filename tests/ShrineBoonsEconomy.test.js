// Late Bloom, Dawn Tithe and Lottery Loot (docs/specs/blessings-v3.md §5, PR D4): the three
// §5 cards that pay between battles. Each test is named after a realistic way the rule breaks.
import { afterEach, describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  prepareBattleRewards,
  rerollBattleReward,
  rollBattleRewardChoices,
  rewardDrawParams,
} from '../src/engine/PendingBattleRewards.js';
import { describeActStartGrants } from '../src/engine/ActStartNotice.js';
import { addBurden, burdenOf } from '../src/engine/Burdens.js';
import { dawnTitheGold } from '../src/engine/ShrineBoons.js';
import { lotteryActFor } from '../src/engine/LotteryLoot.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { XP_STAT_NAMES } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

afterEach(() => restoreMathRandom());

function startRun({ seed = 4242, difficultyId = 'dusk' } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  return rm;
}
function hold(rm, ...ids) {
  rm.activeBlessings = ids.map((id) => ({ id, rolledCost: null }));
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return rm;
}
const statsOf = (units) => units.map((u) => ({ name: u.name, ...u.stats, hp: u.currentHP }));

// ── Late Bloom ────────────────────────────────────────────────────────────

describe('Late Bloom: every unit +1 to all stats but Move as each act ends', () => {
  it('does not pay on the take (the act it is taken in counts as paid)', () => {
    const plain = startRun();
    const bloom = hold(startRun(), 'late_bloom');
    expect(statsOf(bloom.roster)).toEqual(statsOf(plain.roster));
  });

  it('pays +1 to the eight stats and never Move, to the roster and the fallen, as Act 2 begins', () => {
    const plain = startRun();
    const bloom = hold(startRun(), 'late_bloom');
    // The fallen keep pace too (a revived ally is not left behind): move one unit to the fallen.
    for (const rm of [plain, bloom]) rm.fallenUnits.push(rm.roster.pop());
    plain.advanceAct();
    const result = bloom.advanceAct();
    for (const [i, unit] of bloom.roster.entries()) {
      for (const stat of XP_STAT_NAMES)
        expect(unit.stats[stat], `${unit.name} ${stat}`).toBe(plain.roster[i].stats[stat] + 1);
      expect(unit.stats.MOV).toBe(plain.roster[i].stats.MOV);
      expect(unit.mov).toBe(plain.roster[i].mov);
      // The act heals everyone first; the +1 HP keeps them full.
      expect(unit.currentHP).toBe(unit.stats.HP);
    }
    for (const stat of XP_STAT_NAMES)
      expect(bloom.fallenUnits[0].stats[stat]).toBe(plain.fallenUnits[0].stats[stat] + 1);
    expect(describeActStartGrants(result.actStartGrants)).toBe(
      'Late Bloom: every unit +1 to all stats but Move',
    );
  });

  it('never pays twice for one act, however often the save is loaded', () => {
    const bloom = hold(startRun(), 'late_bloom');
    bloom.advanceAct();
    const once = statsOf(bloom.roster);
    const back = RunManager.fromJSON(JSON.parse(JSON.stringify(bloom.toJSON())), data);
    expect(back._payActStartGrants('act_transition')).toEqual([]);
    expect(statsOf(back.roster)).toEqual(once);
  });

  it('reaches a recruit who joined during the act', () => {
    const bloom = hold(startRun(), 'late_bloom');
    const recruit = createRecruitUnit(
      { className: 'Fighter', name: 'Newcomer', level: 2 },
      data.classes.find((c) => c.name === 'Fighter'),
      data.weapons,
    );
    bloom.assignUnitUid(recruit);
    bloom.roster.push(recruit);
    const before = { ...recruit.stats };
    bloom.advanceAct();
    const after = bloom.roster.find((u) => u.name === 'Newcomer');
    for (const stat of XP_STAT_NAMES) expect(after.stats[stat]).toBe(before[stat] + 1);
  });

  it('pays again as every later act begins (Act 3: +2 in all)', () => {
    const plain = startRun();
    const bloom = hold(startRun(), 'late_bloom');
    for (const rm of [plain, bloom]) {
      rm.advanceAct();
      rm.advanceAct();
    }
    for (const [i, unit] of bloom.roster.entries())
      expect(unit.stats.STR).toBe(plain.roster[i].stats.STR + 2);
  });
});

// ── Dawn Tithe ────────────────────────────────────────────────────────────

describe('Dawn Tithe: +100 gold for each turn under par', () => {
  const ctx = (extra) => ({
    nodeId: 'act1_1_1',
    goldEarned: 0,
    completionGoldAward: 0,
    battleCompletionAwardedGold: 0,
    turnBonusConfig: data.turnBonus,
    ...extra,
  });

  it('pays (par - turns) x 100 and names it in the reward header', () => {
    const rm = hold(startRun(), 'dawn_tithe');
    const plain = startRun();
    const before = rm.gold;
    prepareBattleRewards(plain, data, ctx({ turnPar: 10, turnNumber: 6 }));
    const reward = prepareBattleRewards(rm, data, ctx({ turnPar: 10, turnNumber: 6 }));
    // Four turns under par: 400 gold more than the same victory without the card.
    expect(rm.gold - before - (plain.gold - before)).toBe(400);
    expect(reward.summary).toContain(' · Dawn Tithe: +400 gold');
  });

  it('a Debt never garnishes it (it is paid with the turn bonus, after the victory commit)', () => {
    const rm = hold(startRun(), 'dawn_tithe');
    const plain = startRun();
    expect(addBurden(rm, 'debt', { owed: 3000 }).ok).toBe(true);
    const owed = burdenOf(rm, 'debt').owed;
    const before = rm.gold;
    prepareBattleRewards(plain, data, ctx({ turnPar: 9, turnNumber: 4 }));
    prepareBattleRewards(rm, data, ctx({ turnPar: 9, turnNumber: 4 }));
    expect(rm.gold - before - (plain.gold - before)).toBe(500);
    expect(burdenOf(rm, 'debt').owed).toBe(owed);
  });

  it("counts the map's own par: Patient Dawn's turns never pay", () => {
    // Par 12 is the map's 10 plus Patient Dawn's 2; finishing on turn 6 is 4 under the map's own.
    expect(dawnTitheGold({ perTurn: 100, turnPar: 12, parTurnDelta: 2, turnNumber: 6 })).toBe(400);
    const rm = hold(startRun(), 'dawn_tithe', 'patient_dawn');
    const reward = prepareBattleRewards(
      rm,
      data,
      ctx({ turnPar: 12, turnNumber: 6, blessingParTurns: 2 }),
    );
    expect(reward.summary).toContain('Dawn Tithe: +400 gold');
  });

  it('pays nothing at or over par, on a chapter without par, or without the card', () => {
    expect(dawnTitheGold({ perTurn: 100, turnPar: 6, turnNumber: 6 })).toBe(0);
    expect(dawnTitheGold({ perTurn: 100, turnPar: 6, turnNumber: 9 })).toBe(0);
    expect(dawnTitheGold({ perTurn: 100, turnPar: null, turnNumber: 2 })).toBe(0);
    const rm = hold(startRun(), 'dawn_tithe');
    const before = rm.gold;
    const reward = prepareBattleRewards(rm, data, ctx({ turnPar: null, turnNumber: 2 }));
    expect(rm.gold).toBe(before);
    expect(reward.summary).not.toContain('Dawn Tithe');
    const plain = startRun();
    expect(
      prepareBattleRewards(plain, data, ctx({ turnPar: 10, turnNumber: 2 })).summary,
    ).not.toContain('Dawn Tithe');
  });
});

// ── Lottery Loot ──────────────────────────────────────────────────────────

describe("Lottery Loot: one loot card from the next act's table", () => {
  const sig = (c) => `${c.type}:${c.item?.name ?? c.goldAmount}`;
  const drawFor = (rm, extra = {}) =>
    rewardDrawParams(rm, { nodeId: 'act1_2_1', isElite: false, isBoss: false, ...extra });

  it("the battle's own draws do not move (same cards before the last, same Math.random cursor)", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const plain = startRun();
      const lottery = hold(startRun(), 'lottery_loot');
      installSeed(900 + seed);
      const base = rollBattleRewardChoices(plain, data, drawFor(plain));
      const cursorPlain = Math.random();
      installSeed(900 + seed);
      const drawn = rollBattleRewardChoices(lottery, data, drawFor(lottery));
      const cursorLottery = Math.random();
      expect(cursorLottery).toBe(cursorPlain);
      expect(drawn).toHaveLength(base.length);
      expect(drawn.slice(0, -1).map(sig)).toEqual(base.slice(0, -1).map(sig));
      expect(drawn.at(-1).lottery).toEqual({ actId: 'act2' });
      expect(drawn.filter((c) => c.lottery)).toHaveLength(1);
    }
  });

  it("the card really comes from the next act: Act 1 has no stat boosters, Act 2's lottery does", () => {
    // act1's table lists no stat booster, act2's lists eight (data/lootTables.json): only a draw
    // from the next act can produce one in Act 1.
    expect(data.lootTables.act1.statBooster).toEqual([]);
    const boosters = new Set(data.lootTables.act2.statBooster);
    let lotteryBoosters = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rm = hold(startRun({ seed }), 'lottery_loot');
      installSeed(seed);
      const choices = rollBattleRewardChoices(rm, data, drawFor(rm));
      for (const choice of choices.slice(0, -1))
        expect(boosters.has(choice.item?.name), `seed ${seed}`).toBe(false);
      if (boosters.has(choices.at(-1).item?.name)) lotteryBoosters++;
    }
    expect(lotteryBoosters).toBeGreaterThan(0);
  });

  it('is the same card on the same node every time (its own stream), and a new one each reroll', () => {
    const a = hold(startRun(), 'lottery_loot');
    const b = hold(startRun(), 'lottery_loot');
    installSeed(5);
    const first = rollBattleRewardChoices(a, data, drawFor(a)).at(-1);
    installSeed(77); // a different battle stream: the lottery card does not care
    const again = rollBattleRewardChoices(b, data, drawFor(b)).at(-1);
    expect(sig(again)).toBe(sig(first));
    const rounds = new Set();
    for (let round = 0; round < 6; round++) {
      installSeed(5);
      rounds.add(sig(rollBattleRewardChoices(a, data, drawFor(a), { round }).at(-1)));
    }
    expect(rounds.size).toBeGreaterThan(1);
  });

  it('a Branching Threads reroll keeps the lottery card, drawn from the saved table', () => {
    const rm = hold(startRun(), 'lottery_loot');
    rm.metaEffects = { ...(rm.metaEffects || {}), rewardRerolls: 2 };
    const record = prepareBattleRewards(rm, data, {
      nodeId: 'act1_2_1',
      goldEarned: 0,
      completionGoldAward: 0,
    });
    expect(record.draw).toMatchObject({ lotteryActId: 'act2', lotteryCards: 1 });
    // The run moves on (say a test forgot the act): the record's table still rules the reroll.
    record.draw.lotteryActId = 'act3';
    const result = rerollBattleReward(rm, data);
    expect(result.ok).toBe(true);
    expect(result.choices.filter((c) => c.lottery)).toEqual([
      expect.objectContaining({ lottery: { actId: 'act3' } }),
    ]);
  });

  it('a saved draw carries the lottery; a run without the card writes no lottery key', () => {
    const plain = startRun();
    expect(Object.keys(drawFor(plain))).not.toContain('lotteryActId');
    const rm = hold(startRun(), 'lottery_loot');
    prepareBattleRewards(rm, data, { nodeId: 'act1_2_1', goldEarned: 0, completionGoldAward: 0 });
    const back = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(back.pendingBattleReward.draw.lotteryActId).toBe('act2');
    expect(back.pendingBattleReward.choices.filter((c) => c.lottery)).toHaveLength(1);
  });

  it('authored (prologue) loot is never touched', () => {
    const rm = new RunManager(data);
    rm.startPrologue(data);
    rm.blessingRuntimeModifiers.nextActLootCards = 1; // as if it were held
    const record = prepareBattleRewards(rm, data, {
      nodeId: rm.nodeMap.startNodeId,
      authoredLoot: data.prologue.chapters.find((c) => c.loot)?.loot,
      goldEarned: 0,
      completionGoldAward: 0,
    });
    expect(record.draw).toBeNull();
    expect(record.choices.some((c) => c.lottery)).toBe(false);
    expect(rewardDrawParams(rm, { nodeId: 'x' }).lotteryActId).toBeUndefined();
  });

  it("draws from the next act in the run's sequence, and the last act from its own table", () => {
    const rm = hold(startRun(), 'lottery_loot');
    expect(lotteryActFor(rm)).toBe('act2');
    while (rm.actIndex < rm.actSequence.length - 1) rm.advanceAct();
    expect(lotteryActFor(rm)).toBe(rm.currentAct);
  });
});
