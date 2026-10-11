// The earned-pick ledger (engine/EarnedBlessings.js): the act boss's offer is rolled once from
// the run seed, stored per act and saved, so a reload shows the same pair, a taken or skipped
// pick is never offered again and no other stream moves. Each test names a way it goes wrong.
import { describe, expect, it, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  DEFAULT_EARNED_OFFER,
  EARNED_PICK_VERSION,
  actBossPickDue,
  earnedOfferChance,
  earnedOfferConfig,
  earnedPickOwed,
  isActBossVictory,
  prepareEarnedBlessingPick,
  rollActBossEarnedOffer,
  sanitizeEarnedBlessingPicks,
  skipEarnedBlessing,
  takeEarnedBlessing,
} from '../src/engine/EarnedBlessings.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const EARNED_IDS = ['unbroken_banner', 'second_dawn', 'ember_lantern', 'captains_whistle'];
// What Act I's boss may offer (PR D1 re-sourced the cards: Second Dawn is an eclipsed elite's,
// Standard of the Sun is Act I's boss's own, Chronicle Act II's; PR D3 adds the four twisted
// cards, an act boss's only, two of them while the Eclipse is on, as it is in every run here).
const ACT1_BOSS_IDS = [
  'unbroken_banner',
  'ember_lantern',
  'captains_whistle',
  'standard_of_the_sun',
  'darkened_dawn',
  'blood_covenant',
  'kingmakers_oath',
  'hollow_sun_favor',
];
const TWISTED_IDS = ['darkened_dawn', 'blood_covenant', 'kingmakers_oath', 'hollow_sun_favor'];

function freshRun(seed = 7, difficultyId = 'normal') {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  rm.blessingHistory = [];
  return rm;
}
const bossOf = (rm) => rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
/**
 * One run re-rolled across seeds with the given earned blessings held (a seed loop that starts a
 * run per seed would spend its time on map generation, which the offer never reads).
 */
function rollerFor(heldIds = []) {
  const rm = freshRun(1);
  rm.activeBlessings = heldIds.map((id) => ({ id, rolledCost: null, midRun: true }));
  return (seed) => {
    rm.runSeed = seed;
    return rollActBossEarnedOffer(rm);
  };
}
/** A run whose act-1 boss offered a pick. */
function owedRun(seed = 7) {
  for (let s = seed; s < seed + 200; s++) {
    const rm = freshRun(s);
    const entry = prepareEarnedBlessingPick(rm, bossOf(rm));
    if (entry?.status === 'owed') return { rm, entry };
  }
  throw new Error('no owed pick found');
}

describe('who is owed a pick', () => {
  it('the act boss of an ordinary act is; any other node is not', () => {
    const rm = freshRun();
    const boss = bossOf(rm);
    expect(isActBossVictory(rm, boss)).toBe(true);
    expect(actBossPickDue(rm, boss)).toBe(true);
    for (const node of rm.nodeMap.nodes.filter((n) => n.id !== boss.id)) {
      expect(actBossPickDue(rm, node), `${node.type} ${node.id}`).toBe(false);
    }
  });

  it('completeBattle pays the boss Vision on exactly the node the pick predicate names', () => {
    // One predicate: the Vision grant in completeBattle reads isActBossVictory, so the two
    // cannot disagree about which victory is the act boss's.
    const visionAfter = (pickNode) => {
      const rm = freshRun(33);
      const node = pickNode(rm);
      rm.currentNodeId = node.id;
      const before = rm.visionChargesRemaining;
      rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 5, turnPar: 7 });
      return { gained: rm.visionChargesRemaining - before, boss: isActBossVictory(rm, node) };
    };
    expect(visionAfter(bossOf)).toEqual({ gained: 1, boss: true });
    const plain = visionAfter((rm) => rm.nodeMap.nodes.find((n) => n.type === 'battle'));
    expect(plain).toEqual({ gained: 0, boss: false });
  });

  it('an elite captain, an event battle and an ambush are not a boss node', () => {
    const rm = freshRun();
    const first = rm.nodeMap.nodes.find((n) => n.type === 'battle');
    const elite = { ...first, battleParams: { ...first.battleParams, isElite: true } };
    expect(actBossPickDue(rm, elite)).toBe(false);
    const eventBattle = { ...first, type: 'event', eventBattle: { id: 'x' } };
    expect(actBossPickDue(rm, eventBattle)).toBe(false);
    // A node that merely claims the boss's type but is not the act's boss node.
    expect(actBossPickDue(rm, { ...first, type: 'boss' })).toBe(false);
  });

  it.each(['normal', 'dusk', 'hard', 'lunatic'])(
    '%s: every act boss but the run-ending one (the final act on that rung)',
    (difficultyId) => {
      const rm = freshRun(11, difficultyId);
      const boss = bossOf(rm);
      const last = rm.actSequence.length - 1;
      for (let i = 0; i <= last; i++) {
        rm.actIndex = i;
        expect(actBossPickDue(rm, boss), `${rm.actSequence[i]} on ${difficultyId}`).toBe(i < last);
      }
    },
  );

  it('the rungs end where they should: First Light at the Lieutenant, Dusk at the Emperor', () => {
    expect(freshRun(1, 'normal').actSequence).toEqual(['act1', 'act2', 'act3', 'finalBoss']);
    expect(freshRun(1, 'dusk').actSequence).toEqual(['act1', 'act2', 'act3', 'act4']);
    expect(freshRun(1, 'hard').actSequence.at(-1)).toBe('finalBoss');
  });

  it('the prologue never owes one, whatever its last node is', () => {
    const rm = new RunManager(data);
    rm.startPrologue(data);
    expect(rm.earnedBlessingPicks).toEqual({});
    const boss = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
    expect(actBossPickDue(rm, boss)).toBe(false);
    expect(prepareEarnedBlessingPick(rm, boss)).toBeNull();
  });

  it('an act whose pick is already on the ledger is not due again', () => {
    const { rm } = owedRun();
    expect(actBossPickDue(rm, bossOf(rm))).toBe(false);
  });
});

describe('rolling the offer', () => {
  it('is the same pair every time for a seed, act and holding (never re-rolled)', () => {
    const rm = freshRun(5);
    const a = rollActBossEarnedOffer(rm);
    const b = rollActBossEarnedOffer(rm);
    expect(b).toEqual(a);
    expect(rollActBossEarnedOffer(freshRun(5))).toEqual(a);
  });

  it('never calls Math.random and never touches the node map', () => {
    const rm = freshRun(5);
    const mapBefore = JSON.stringify(rm.nodeMap);
    const spy = vi.spyOn(Math, 'random');
    spy.mockClear();
    rollActBossEarnedOffer(rm);
    prepareEarnedBlessingPick(rm, bossOf(rm));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(JSON.stringify(rm.nodeMap)).toBe(mapBefore);
  });

  it('draws two distinct earned cards the run does not hold', () => {
    const roller = rollerFor(['ember_lantern']);
    for (let seed = 1; seed <= 300; seed++) {
      const roll = roller(seed);
      if (roll.status !== 'owed') continue;
      expect(roll.offered).toHaveLength(2);
      expect(new Set(roll.offered).size).toBe(2);
      for (const id of roll.offered) {
        expect(ACT1_BOSS_IDS).toContain(id);
        expect(id).not.toBe('ember_lantern');
      }
      // D-3: never two twisted cards in one pair.
      expect(roll.offered.filter((id) => TWISTED_IDS.includes(id)).length).toBeLessThanOrEqual(1);
    }
  });

  it('is a different pair for a different act of the same run, and varies across seeds', () => {
    const pairs = new Set();
    const roller = rollerFor();
    for (let seed = 1; seed <= 200; seed++) pairs.add(roller(seed).offered.join());
    expect(pairs.size).toBeGreaterThan(3);
    // The stream is keyed by the act: the same seed offers a different pair in another act.
    const rm = freshRun(9);
    let differs = 0;
    for (let seed = 1; seed <= 100; seed++) {
      rm.runSeed = seed;
      rm.actIndex = 0;
      const act1 = rollActBossEarnedOffer(rm);
      rm.actIndex = 1;
      if (JSON.stringify(act1) !== JSON.stringify(rollActBossEarnedOffer(rm))) differs++;
    }
    expect(differs).toBeGreaterThan(30);
  });

  it('offers a lone card when one is left and nothing when none is', () => {
    // All of Act I's boss cards held but one: the odds are 0.7 and one card is left. (Re-sourced in
    // PR D1: Second Dawn left the boss's pool and Standard of the Sun joined it, so the lone card
    // and the full set are Act I's boss pool, not PR C's four; PR D3's twisted cards joined it.)
    const three = rollerFor(ACT1_BOSS_IDS.filter((id) => id !== 'standard_of_the_sun'));
    const rolls = [];
    for (let seed = 1; seed <= 300; seed++) rolls.push(three(seed));
    expect(
      rolls
        .filter((r) => r.status === 'owed')
        .every((r) => r.offered.join() === 'standard_of_the_sun'),
    ).toBe(true);
    expect(rolls.some((r) => r.status === 'owed')).toBe(true);
    const all = rollerFor(ACT1_BOSS_IDS);
    for (let seed = 1; seed <= 50; seed++)
      expect(all(seed)).toEqual({ status: 'none', offered: [] });
  });

  it('never offers a card whose weight is 0', () => {
    // (PR D1: Second Dawn is an eclipsed elite's now, so a boss card keeps its weight here.)
    const copy = structuredClone(data);
    for (const b of copy.blessings.blessings)
      if (b.earned && b.id !== 'captains_whistle') b.weight = 0;
    const rm = freshRun(5);
    rm.gameData = copy;
    let owed = 0;
    for (let seed = 1; seed <= 100; seed++) {
      rm.runSeed = seed;
      const roll = rollActBossEarnedOffer(rm);
      if (roll.status === 'owed') {
        owed++;
        expect(roll.offered).toEqual(['captains_whistle']);
      }
    }
    expect(owed).toBeGreaterThan(0);
  });
});

describe('the odds an act boss offers anything (D4)', () => {
  it('1 with none held, 0.85 with one, 0.7 with two or more', () => {
    const config = earnedOfferConfig(data.blessings);
    expect([0, 1, 2, 3, 9].map((n) => earnedOfferChance(n, config))).toEqual([
      1, 0.85, 0.7, 0.7, 0.7,
    ]);
    expect(earnedOfferChance(-4, config)).toBe(1);
    expect(earnedOfferChance(Number.NaN, config)).toBe(1);
  });

  it('with none held a boss always offers; with one it skips about 15%; with two about 30%', () => {
    const skipRate = (held) => {
      let none = 0;
      const N = 4000;
      const roller = rollerFor(EARNED_IDS.slice(0, held));
      for (let seed = 1; seed <= N; seed++) if (roller(seed).status === 'none') none++;
      return none / N;
    };
    expect(skipRate(0)).toBe(0);
    expect(skipRate(1)).toBeGreaterThan(0.12);
    expect(skipRate(1)).toBeLessThan(0.18);
    expect(skipRate(2)).toBeGreaterThan(0.26);
    expect(skipRate(2)).toBeLessThan(0.34);
  });

  it('counts only earned blessings: a tiered one does not thin the offer', () => {
    const roller = rollerFor(['steady_hands', 'field_medic']);
    for (let seed = 1; seed <= 300; seed++) expect(roller(seed).status).toBe('owed');
  });

  it('the data can retune the cards and the odds; a malformed block falls back', () => {
    expect(earnedOfferConfig({ earnedOffer: { actBoss: 3, weightByHeld: [1, 0.5] } })).toEqual({
      actBoss: 3,
      weightByHeld: [1, 0.5],
    });
    for (const bad of [
      undefined,
      {},
      { actBoss: 0, weightByHeld: [] },
      { actBoss: 'x', weightByHeld: [9, -1] },
    ])
      expect(earnedOfferConfig({ earnedOffer: bad })).toEqual({
        actBoss: DEFAULT_EARNED_OFFER.actBoss,
        weightByHeld: [...DEFAULT_EARNED_OFFER.weightByHeld],
      });
  });

  it('one bad weight rejects the whole array (dropping it would shift the odds a place)', () => {
    // [1, 'x', 0.5] must not read as [1, 0.5]: that would make "two held" the 0.5 odds.
    for (const bad of [
      [1, 'x', 0.5],
      [1, null, 0.5],
      [1, 2, 0.5],
      [1, -0.1, 0.5],
      [1, NaN, 0.5],
    ])
      expect(earnedOfferConfig({ earnedOffer: { actBoss: 2, weightByHeld: bad } })).toEqual({
        actBoss: 2,
        weightByHeld: [...DEFAULT_EARNED_OFFER.weightByHeld],
      });
  });
});

describe('preparing, saving and reloading the pick', () => {
  it('stores the roll on the act and returns the same entry on every later call', () => {
    const { rm, entry } = owedRun();
    expect(rm.earnedBlessingPicks[rm.currentAct]).toBe(entry);
    expect(entry).toMatchObject({
      version: EARNED_PICK_VERSION, // 2 since PR D1's keyed ledger (a v1 entry loads as it was)
      source: 'act_boss',
      actId: 'act1',
      nodeId: rm.nodeMap.bossNodeId,
      status: 'owed',
      chosen: null,
    });
    expect(entry.offered).toHaveLength(2);
    expect(prepareEarnedBlessingPick(rm, bossOf(rm))).toBe(entry);
  });

  it('a reload between the boss and the pick shows the same pair (not a re-roll)', () => {
    const { rm, entry } = owedRun();
    const back = roundTrip(rm);
    expect(back.earnedBlessingPicks.act1).toEqual(entry);
    expect(earnedPickOwed(back).offered).toEqual(entry.offered);
    // Even if the player then took something else that thins the pool.
    back.addBlessingMidRun('second_dawn', { earned: true });
    expect(prepareEarnedBlessingPick(back, bossOf(back)).offered).toEqual(entry.offered);
  });

  it('a taken pick survives a save and load as taken, never offered again', () => {
    const { rm, entry } = owedRun();
    const pick = entry.offered[0];
    expect(takeEarnedBlessing(rm, 'act1', pick).ok).toBe(true);
    const back = roundTrip(rm);
    expect(back.earnedBlessingPicks.act1).toMatchObject({ status: 'taken', chosen: pick });
    expect(earnedPickOwed(back)).toBeNull();
    expect(prepareEarnedBlessingPick(back, bossOf(back)).status).toBe('taken');
    expect(back.getActiveBlessingIds()).toEqual([pick]);
  });

  it('a skipped pick survives as skipped and a "none" boss as none', () => {
    const { rm } = owedRun();
    expect(skipEarnedBlessing(rm, 'act1').ok).toBe(true);
    expect(roundTrip(rm).earnedBlessingPicks.act1.status).toBe('skipped');
    const none = freshRun(3);
    for (const id of ACT1_BOSS_IDS) none.addBlessingMidRun(id, { earned: true });
    expect(prepareEarnedBlessingPick(none, bossOf(none)).status).toBe('none');
    expect(roundTrip(none).earnedBlessingPicks.act1.status).toBe('none');
  });

  it('a new run starts with an empty ledger, whatever the last one held', () => {
    const { rm } = owedRun();
    expect(rm.earnedBlessingPicks.act1).toBeDefined();
    rm.startRun({ runSeed: 99, applyBlessingsAtStart: false });
    expect(rm.earnedBlessingPicks).toEqual({});
    expect(new RunManager(data).earnedBlessingPicks).toEqual({});
  });
});

describe('taking and skipping', () => {
  it('takes an offered card: it joins the run, applies, is recorded, and the pick is closed', () => {
    const { rm, entry } = owedRun();
    const [first] = entry.offered;
    const result = takeEarnedBlessing(rm, 'act1', first);
    expect(result.ok).toBe(true);
    expect(result.blessing.id).toBe(first);
    expect(entry).toMatchObject({ status: 'taken', chosen: first });
    expect(rm.getActiveBlessingIds()).toEqual([first]);
    // One 'earned_pick' record for the take; the boon it applies is a mid-run grant's record.
    const picks = rm.blessingHistory.filter((r) => r.eventType === 'earned_pick');
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ blessingId: first, stage: 'mid_run', effectType: null });
    expect(picks[0].details).toMatchObject({ actId: 'act1', offered: entry.offered });
    const applied = rm.blessingHistory.filter((r) => r.eventType === 'effect_applied');
    expect(applied.length).toBeGreaterThan(0);
    for (const record of applied) expect(record.stage, record.effectType).toBe('mid_run');
    expect(rm.blessingHistory.some((r) => r.stage === 'run_start')).toBe(false);
  });

  it('a second take (a double tap, a stale menu) is refused and changes nothing', () => {
    const { rm, entry } = owedRun();
    const [first, second] = entry.offered;
    expect(takeEarnedBlessing(rm, 'act1', first).ok).toBe(true);
    const held = [...rm.getActiveBlessingIds()];
    const history = rm.blessingHistory.length;
    expect(takeEarnedBlessing(rm, 'act1', first).ok).toBe(false);
    expect(takeEarnedBlessing(rm, 'act1', second).ok).toBe(false);
    expect(rm.getActiveBlessingIds()).toEqual(held);
    expect(rm.blessingHistory).toHaveLength(history);
    expect(entry.chosen).toBe(first);
  });

  it('refuses a card that was not offered, an unknown act, a tiered card and a skipped pick', () => {
    const { rm, entry } = owedRun();
    const notOffered = EARNED_IDS.find((id) => !entry.offered.includes(id));
    expect(takeEarnedBlessing(rm, 'act1', notOffered).ok).toBe(false);
    expect(takeEarnedBlessing(rm, 'act1', 'steady_hands').ok).toBe(false);
    expect(takeEarnedBlessing(rm, 'act9', entry.offered[0]).ok).toBe(false);
    expect(rm.getActiveBlessingIds()).toEqual([]);
    expect(entry.status).toBe('owed');
    expect(skipEarnedBlessing(rm, 'act1').ok).toBe(true);
    expect(takeEarnedBlessing(rm, 'act1', entry.offered[0]).ok).toBe(false);
    expect(skipEarnedBlessing(rm, 'act1').ok).toBe(false);
    expect(rm.getActiveBlessingIds()).toEqual([]);
  });

  it('refuses a card the run came to hold another way, and leaves the pick owed', () => {
    const { rm, entry } = owedRun();
    rm.addBlessingMidRun(entry.offered[0], { earned: true });
    expect(takeEarnedBlessing(rm, 'act1', entry.offered[0]).ok).toBe(false);
    expect(entry.status).toBe('owed');
    expect(takeEarnedBlessing(rm, 'act1', entry.offered[1]).ok).toBe(true);
  });

  it('nothing is taken before a pick exists', () => {
    const rm = freshRun();
    expect(takeEarnedBlessing(rm, 'act1', 'second_dawn').ok).toBe(false);
    expect(skipEarnedBlessing(rm, 'act1').ok).toBe(false);
    expect(rm.getActiveBlessingIds()).toEqual([]);
  });

  it('earnedPickOwed names the current act first, then any other, then nothing', () => {
    const rm = freshRun();
    expect(earnedPickOwed(rm)).toBeNull();
    rm.earnedBlessingPicks = {
      act1: { status: 'owed', offered: ['second_dawn'], actId: 'act1' },
      act2: { status: 'owed', offered: ['ember_lantern'], actId: 'act2' },
    };
    expect(earnedPickOwed(rm).actId).toBe('act1');
    rm.actIndex = 1;
    expect(earnedPickOwed(rm).actId).toBe('act2');
    rm.earnedBlessingPicks.act2.status = 'taken';
    expect(earnedPickOwed(rm).actId).toBe('act1');
    rm.earnedBlessingPicks.act1.status = 'skipped';
    expect(earnedPickOwed(rm)).toBeNull();
  });
});

describe('reading a saved ledger back', () => {
  const good = {
    version: 1,
    source: 'act_boss',
    actId: 'act1',
    nodeId: 'act1_r8_0',
    offered: ['second_dawn', 'ember_lantern'],
    status: 'owed',
    chosen: null,
  };

  it('keeps a well-formed ledger as it was', () => {
    const raw = {
      act1: good,
      act2: { ...good, actId: 'act2', status: 'taken', chosen: 'second_dawn' },
    };
    expect(sanitizeEarnedBlessingPicks(raw)).toEqual(raw);
  });

  it('drops entries that are not usable instead of keeping a pick the menu cannot show', () => {
    const out = sanitizeEarnedBlessingPicks({
      a: 'x',
      b: null,
      c: { ...good, status: 'weird' },
      d: { ...good, offered: [] },
      f: { ...good, offered: 'second_dawn' },
      ok: good,
    });
    expect(Object.keys(out)).toEqual(['ok']);
  });

  it('a taken pick with no recorded choice stays taken: never prepared a second time', () => {
    const out = sanitizeEarnedBlessingPicks({ act1: { ...good, status: 'taken', chosen: null } });
    expect(out.act1).toMatchObject({ status: 'taken', chosen: null });
  });

  describe('read against the catalog and the run', () => {
    const known = { earnedIds: EARNED_IDS, actSequence: ['act1', 'act2', 'act3', 'finalBoss'] };

    it('an offered id the catalog does not know as an earned blessing is dropped', () => {
      const out = sanitizeEarnedBlessingPicks(
        {
          act1: { ...good, offered: ['second_dawn', 'iron_oath', 'gone', 'ember_lantern'] },
        },
        known,
      );
      expect(out.act1.offered).toEqual(['second_dawn', 'ember_lantern']);
      expect(out.act1.status).toBe('owed');
    });

    it('an owed pick with nothing left to offer becomes none, and is not rolled again', () => {
      const out = sanitizeEarnedBlessingPicks(
        { act1: { ...good, offered: ['gone', 'iron_oath'] } },
        known,
      );
      expect(out.act1).toMatchObject({ status: 'none', offered: [], chosen: null });
    });

    it('a taken pick keeps its record even if the catalog lost the card', () => {
      const out = sanitizeEarnedBlessingPicks(
        { act1: { ...good, offered: ['gone'], status: 'taken', chosen: 'gone' } },
        known,
      );
      expect(out.act1).toMatchObject({ status: 'taken', chosen: 'gone' });
    });

    it('an act the run does not have has no entry', () => {
      const out = sanitizeEarnedBlessingPicks(
        { act1: good, act9: { ...good, actId: 'act9' }, act4: { ...good, actId: 'act4' } },
        known,
      );
      expect(Object.keys(out)).toEqual(['act1']);
    });

    it('a fromJSON load reads the saved ledger against its own catalog and acts', () => {
      const { rm, entry } = owedRun();
      const saved = JSON.parse(JSON.stringify(rm.toJSON()));
      saved.earnedBlessingPicks.act1.offered = ['iron_oath', entry.offered[0], 'gone'];
      saved.earnedBlessingPicks.act9 = { ...saved.earnedBlessingPicks.act1, actId: 'act9' };
      const back = RunManager.fromJSON(saved, data);
      expect(Object.keys(back.earnedBlessingPicks)).toEqual(['act1']);
      expect(back.earnedBlessingPicks.act1.offered).toEqual([entry.offered[0]]);

      saved.earnedBlessingPicks.act1.offered = ['iron_oath'];
      const none = RunManager.fromJSON(saved, data);
      expect(none.earnedBlessingPicks.act1.status).toBe('none');
      expect(earnedPickOwed(none)).toBeNull();
      expect(prepareEarnedBlessingPick(none, bossOf(none)).status).toBe('none');
    });

    it('a corrupt taken entry is not re-prepared after a load (no second pick)', () => {
      const { rm } = owedRun();
      const saved = JSON.parse(JSON.stringify(rm.toJSON()));
      Object.assign(saved.earnedBlessingPicks.act1, { status: 'taken', chosen: null });
      const back = RunManager.fromJSON(saved, data);
      expect(back.earnedBlessingPicks.act1).toMatchObject({ status: 'taken', chosen: null });
      expect(actBossPickDue(back, bossOf(back))).toBe(false);
      expect(earnedPickOwed(back)).toBeNull();
    });
  });

  it('cleans what it keeps: duplicate and non-string offers go, a stray chosen goes', () => {
    const out = sanitizeEarnedBlessingPicks({
      act1: {
        ...good,
        offered: ['second_dawn', 'second_dawn', 7, '', 'ember_lantern'],
        chosen: 'second_dawn',
        nodeId: 5,
      },
    });
    expect(out.act1.offered).toEqual(['second_dawn', 'ember_lantern']);
    expect(out.act1.chosen).toBeNull();
    expect(out.act1.nodeId).toBeNull();
  });

  it('anything that is not an object is an empty ledger', () => {
    for (const raw of [undefined, null, 'x', 4, []])
      expect(sanitizeEarnedBlessingPicks(raw)).toEqual({});
  });

  it('a save with a corrupt ledger loads, and the act is simply prepared again to the same pair', () => {
    const { rm, entry } = owedRun();
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    saved.earnedBlessingPicks.act1.offered = [];
    const back = RunManager.fromJSON(saved, data);
    expect(back.earnedBlessingPicks).toEqual({});
    expect(prepareEarnedBlessingPick(back, bossOf(back)).offered).toEqual(entry.offered);
  });
});
