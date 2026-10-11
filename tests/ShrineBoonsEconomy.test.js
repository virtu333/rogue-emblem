// Late Bloom, Dawn Tithe and Lottery Loot (docs/specs/blessings-v3.md §5, PR D4): the three
// §5 cards that pay between battles. Each test is named after a realistic way the rule breaks.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
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
import { applyLotteryCards, lotteryActFor, lotteryCardLine } from '../src/engine/LotteryLoot.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
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

describe('Late Bloom: every unit +1 in its two strongest growths as each act ends', () => {
  /**
   * The two stats a unit's growths favour, read independently of the engine: the highest growth
   * first, a tie going to the earlier stat in HP, STR, MAG, SKL, SPD, DEF, RES, LCK. Move never.
   */
  const ORDER = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];
  const topTwo = (growths) => {
    const ranked = [];
    for (const stat of ORDER) {
      const at = ranked.findIndex((s) => (growths[s] || 0) < (growths[stat] || 0));
      if (at < 0) ranked.push(stat);
      else ranked.splice(at, 0, stat);
    }
    return ranked.slice(0, 2);
  };
  const expectBloom = (unit, before, gains, label) => {
    for (const stat of [...ORDER, 'MOV'])
      expect(unit.stats[stat], `${label} ${stat}`).toBe(
        before.stats[stat] + (gains.includes(stat) ? 1 : 0),
      );
  };

  it('does not pay on the take (the act it is taken in counts as paid)', () => {
    const plain = startRun();
    const bloom = hold(startRun(), 'late_bloom');
    expect(statsOf(bloom.roster)).toEqual(statsOf(plain.roster));
    // Another act-start grant paid mid-act (Quartermaster Cache taken at a church pays the
    // current act at once) must not pay Late Bloom for the act it was taken in.
    expect(bloom.addBlessingMidRun('quartermaster_cache')).toBe(true);
    expect(statsOf(bloom.roster)).toEqual(statsOf(plain.roster));
  });

  it("pays +1 in each unit's two highest growths, never Move, to the roster and the fallen", () => {
    const plain = startRun();
    const bloom = hold(startRun(), 'late_bloom');
    // The fallen keep pace too (a revived ally is not left behind): move one unit to the fallen.
    for (const rm of [plain, bloom]) rm.fallenUnits.push(rm.roster.pop());
    plain.advanceAct();
    const result = bloom.advanceAct();
    let hpGains = 0;
    for (const [i, unit] of bloom.roster.entries()) {
      const gains = topTwo(unit.growths);
      expectBloom(unit, plain.roster[i], gains, unit.name);
      expect(unit.mov).toBe(plain.roster[i].mov);
      // The act heals everyone first; a +1 HP keeps them full.
      expect(unit.currentHP).toBe(unit.stats.HP);
      if (gains.includes('HP')) hpGains++;
    }
    const fallen = bloom.fallenUnits[0];
    expectBloom(fallen, plain.fallenUnits[0], topTwo(fallen.growths), 'fallen');
    // The fallen gain no current HP (a revival sets it).
    expect(fallen.currentHP).toBe(plain.fallenUnits[0].currentHP);
    expect(hpGains).toBeGreaterThan(0); // the HP path is really exercised
    expect(describeActStartGrants(result.actStartGrants)).toBe(
      'Late Bloom: every unit +1 in its two strongest growths',
    );
  });

  it('breaks ties in the order HP, STR, MAG, SKL, SPD, DEF, RES, LCK, and never picks Move', () => {
    const bloom = hold(startRun(), 'late_bloom');
    const make = (name, growths) => {
      const unit = createRecruitUnit(
        { className: 'Fighter', name, level: 2 },
        data.classes.find((c) => c.name === 'Fighter'),
        data.weapons,
      );
      unit.growths = growths;
      bloom.assignUnitUid(unit);
      bloom.roster.push(unit);
      return { unit, before: structuredClone(unit) };
    };
    const even = make('Even', { HP: 40, STR: 40, MAG: 40, SKL: 40, SPD: 40, DEF: 40, RES: 40, LCK: 40, MOV: 90 }); // prettier-ignore
    const late = make('Late', { HP: 10, STR: 10, MAG: 10, SKL: 10, SPD: 10, DEF: 10, RES: 55, LCK: 55, MOV: 99 }); // prettier-ignore
    const split = make('Split', { HP: 20, STR: 60, MAG: 5, SKL: 30, SPD: 60, DEF: 60, RES: 5, LCK: 5 }); // prettier-ignore
    installSeed(12);
    bloom.advanceAct();
    const after = (u) => bloom.roster.find((x) => x.name === u.unit.name);
    expectBloom(after(even), even.before, ['HP', 'STR'], 'even');
    expectBloom(after(late), late.before, ['RES', 'LCK'], 'late');
    expectBloom(after(split), split.before, ['STR', 'SPD'], 'split');
  });

  it("reads the class's growths for a unit with none (a promoted class through its base)", () => {
    const bloom = hold(startRun(), 'late_bloom');
    const mid = (range) =>
      range
        .split('-')
        .map(Number)
        .reduce((a, b) => a + b) / 2;
    const classGrowths = (name) => {
      const cls = data.classes.find((c) => c.name === name);
      const base = cls.growthRanges ? cls : data.classes.find((c) => c.name === cls.promotesFrom);
      return Object.fromEntries(
        ORDER.map((s) => [s, mid(base.growthRanges[s]) + (cls.growthBonuses?.[s] || 0)]),
      );
    };
    const units = ['Fighter', 'Swordmaster', 'Hunter', 'Mage'].map((className) => {
      const unit = createRecruitUnit(
        { className: 'Fighter', name: `No ${className}`, level: 2 },
        data.classes.find((c) => c.name === 'Fighter'),
        data.weapons,
      );
      unit.className = className;
      delete unit.growths;
      bloom.assignUnitUid(unit);
      bloom.roster.push(unit);
      return { unit, before: structuredClone(unit), gains: topTwo(classGrowths(className)) };
    });
    // The Hunter's own bonuses (+5 SKL, +5 SPD) move its top two from its base's HP, STR.
    expect(units.find((u) => u.unit.className === 'Hunter').gains).toEqual(['HP', 'SKL']);
    bloom.advanceAct();
    for (const { unit, before, gains } of units)
      expectBloom(
        bloom.roster.find((u) => u.name === unit.name),
        before,
        gains,
        unit.className,
      );
  });

  it('draws nothing from Math.random', () => {
    const plain = startRun();
    const bloom = hold(startRun(), 'late_bloom');
    installSeed(31);
    plain.advanceAct();
    const control = Math.random();
    installSeed(31);
    bloom.advanceAct();
    expect(Math.random()).toBe(control);
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
    const before = structuredClone(recruit);
    bloom.advanceAct();
    const after = bloom.roster.find((u) => u.name === 'Newcomer');
    expectBloom(after, before, topTwo(recruit.growths), 'recruit');
  });

  it('pays again as every later act begins (Act 3: +2 in the same two)', () => {
    const plain = startRun();
    const bloom = hold(startRun(), 'late_bloom');
    for (const rm of [plain, bloom]) {
      rm.advanceAct();
      rm.advanceAct();
    }
    for (const [i, unit] of bloom.roster.entries()) {
      const gains = topTwo(unit.growths);
      for (const stat of ORDER)
        expect(unit.stats[stat], `${unit.name} ${stat}`).toBe(
          plain.roster[i].stats[stat] + (gains.includes(stat) ? 2 : 0),
        );
    }
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

  it("the battle scene's reward context carries Patient Dawn's turns (PostCombatController)", () => {
    const rm = hold(startRun(), 'dawn_tithe', 'patient_dawn');
    const node = rm.nodeMap.nodes.find((n) => n.type === 'battle');
    const battleParams = rm.getBattleParams(node);
    expect(battleParams.blessingParTurns).toBe(2);
    // The scene as victory leaves it: a par of 12 (the map's 10 plus 2), won on turn 6.
    const scene = {
      nodeId: node.id,
      battleParams,
      battleConfig: {},
      isElite: false,
      isBoss: false,
      goldEarned: 0,
      turnPar: 12,
      turnBonusConfig: data.turnBonus,
      turnManager: { turnNumber: 6 },
      runManager: rm,
      _completionGoldAward: 0,
      _battleCompletionAwardedGold: 0,
    };
    const context = new PostCombatController(scene).rewardContext();
    const reward = prepareBattleRewards(rm, data, context);
    expect(reward.summary).toContain('Dawn Tithe: +400 gold');
    expect(reward.summary).not.toContain('Dawn Tithe: +600 gold');
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
      expect(drawn.at(-1).lottery).toEqual({ actId: 'act2', nextAct: true });
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
      expect.objectContaining({ lottery: { actId: 'act3', nextAct: true } }),
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

  // A table that can only pay gold (the final boss's) is no lottery at all.
  const drawsItems = (actId) =>
    Object.entries(data.lootTables[actId]?.weights || {}).some(
      ([category, weight]) => category !== 'gold' && weight > 0,
    );

  it('the last two acts on every rung draw items, never from the gold-only final boss table', () => {
    expect(drawsItems('finalBoss')).toBe(false);
    for (const difficultyId of ['normal', 'dusk', 'hard', 'lunatic']) {
      const rm = hold(startRun({ difficultyId }), 'lottery_loot');
      const last = rm.actSequence.length - 1;
      for (const index of [last - 1, last]) {
        while (rm.actIndex < index) rm.advanceAct();
        const label = `${difficultyId} ${rm.currentAct}`;
        const next = rm.actSequence[index + 1];
        // The next act when its table draws items, else the act's own, else no lottery.
        const expected =
          next && drawsItems(next) ? next : drawsItems(rm.currentAct) ? rm.currentAct : null;
        expect(lotteryActFor(rm), label).toBe(expected);
        if (!expected) {
          expect(drawFor(rm).lotteryActId, label).toBeUndefined();
          continue;
        }
        let items = 0;
        for (let n = 0; n < 12; n++) {
          installSeed(300 + n);
          const card = rollBattleRewardChoices(rm, data, drawFor(rm, { nodeId: `n${n}` })).find(
            (c) => c.lottery,
          );
          expect(card?.lottery.actId, label).toBe(expected);
          if (card.type !== 'gold') items++;
        }
        expect(items, label).toBeGreaterThan(6);
      }
    }
  });

  it('a lottery that only repeats a card already shown keeps the battle own card', () => {
    // A next-act table that is almost all gold: every attempt repeats the battle's gold card.
    const goldHeavy = structuredClone(data);
    goldHeavy.lootTables.act2.weights = { ...goldHeavy.lootTables.act2.weights };
    for (const key of Object.keys(goldHeavy.lootTables.act2.weights))
      goldHeavy.lootTables.act2.weights[key] = key === 'gold' ? 100000 : 0;
    goldHeavy.lootTables.act2.weights.healing = 1;
    const rm = hold(startRun(), 'lottery_loot');
    const own = [
      { type: 'gold', goldAmount: 120 },
      { type: 'weapon', item: { name: 'Iron Sword' } },
      { type: 'weapon', item: { name: 'Iron Axe' } },
    ];
    for (let n = 0; n < 8; n++) {
      const out = applyLotteryCards(rm, goldHeavy, { ...drawFor(rm, { nodeId: `n${n}` }) }, own);
      expect(out.filter((c) => c.type === 'gold')).toHaveLength(1);
      expect(out.at(-1)).toEqual(own.at(-1));
    }
  });

  it("the first reroll draws the lottery's next round, not the first offer's again", () => {
    for (const nodeId of ['act1_2_1', 'act1_3_0', 'act1_4_2']) {
      const rm = hold(startRun(), 'lottery_loot');
      rm.metaEffects = { ...(rm.metaEffects || {}), rewardRerolls: 1 };
      installSeed(41);
      const record = prepareBattleRewards(rm, data, {
        nodeId,
        goldEarned: 0,
        completionGoldAward: 0,
      });
      const first = record.choices.find((c) => c.lottery);
      // The round-1 card, drawn on its own (rolls the same battle cards under the same seed).
      installSeed(41);
      const round1 = rollBattleRewardChoices(rm, data, record.draw, { round: 1 }).find(
        (c) => c.lottery,
      );
      installSeed(41);
      const result = rerollBattleReward(rm, data);
      expect(result.ok).toBe(true);
      const rerolled = result.choices.find((c) => c.lottery);
      expect(sig(rerolled), nodeId).toBe(sig(round1));
      if (sig(round1) !== sig(first)) expect(sig(rerolled), nodeId).not.toBe(sig(first));
    }
  });

  it('the lottery stream is keyed by the node: different nodes in the same round draw apart', () => {
    const rm = hold(startRun(), 'lottery_loot');
    const cards = new Set();
    for (let n = 0; n < 8; n++) {
      installSeed(5);
      cards.add(
        sig(rollBattleRewardChoices(rm, data, drawFor(rm, { nodeId: `act1_${n}_0` })).at(-1)),
      );
    }
    expect(cards.size).toBeGreaterThan(2);
  });

  it("the card's line names the next act only when the card came from it", () => {
    expect(lotteryCardLine({ type: 'gold' })).toBe('');
    expect(lotteryCardLine({ lottery: { actId: 'act2', nextAct: true } })).toBe(
      "Lottery: from the next act's spoils",
    );
    expect(lotteryCardLine({ lottery: { actId: 'act4', nextAct: false } })).toBe('');
    // A Dusk Act IV card is its own act's: no line says "next act".
    const rm = hold(startRun({ difficultyId: 'dusk' }), 'lottery_loot');
    while (rm.actIndex < rm.actSequence.length - 1) rm.advanceAct();
    installSeed(3);
    const card = rollBattleRewardChoices(rm, data, drawFor(rm)).find((c) => c.lottery);
    expect(card.lottery).toEqual({ actId: 'act4', nextAct: false });
    expect(lotteryCardLine(card)).toBe('');
  });
});
