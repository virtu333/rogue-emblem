// EventSystem: which event a node holds (the pick), who may meet which event
// (eligibility), and how a choice's outcome is selected (docs/specs/event-nodes.md §3-§4).
//
// Ways this goes wrong:
//   - the pick moves between a refresh and the first arrival (it must be a pure function of
//     the run seed, the node and what is eligible), or follows catalog order, or ignores
//     weights, or reads Math.random;
//   - a gate lets an event through that the run cannot play (no fallen ally for the Echo, no
//     Vulnerary for the courier, too little gold, the wrong rung/phase/act), or blocks one it
//     should allow;
//   - an event repeats within a run, or the fallback is ever used up;
//   - the outcome roll uses the wrong seed or key, weightByRung stops at the exact rung (Black
//     Sun silently easier than Nightfall), a check ignores the stats it names, clamps wrongly,
//     or the same stream decides a strong and a weak unit alike.
// Expected values are derived by hand from events.json and the units' stats.
import { describe, expect, it, vi } from 'vitest';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { eclipseHash } from '../src/engine/EclipseSystem.js';
import {
  byRungValue,
  checkChance,
  eligibleEvents,
  evaluateRequires,
  pickEvent,
  pickFallenAlly,
  resolveAmount,
  scaledCost,
  selectOutcome,
} from '../src/engine/EventSystem.js';
import {
  addUnit,
  baseData,
  eventNode,
  fallAlly,
  newRun,
  runWithEvents,
  soloEvent,
} from './eventKit.js';

const catalogOf = (run) => run.gameData.events;
const ids = (events) => events.map((e) => e.id);

describe('amounts and costs', () => {
  it('resolves { base, perAct } by act number', () => {
    expect(resolveAmount({ base: 100, perAct: 100 }, 'act1')).toBe(200);
    expect(resolveAmount({ base: 100, perAct: 100 }, 'act3')).toBe(400);
    expect(resolveAmount(80, 'act4')).toBe(80);
    expect(resolveAmount({ base: -50, perAct: -50 }, 'act2')).toBe(-150);
  });

  it('scales a cost by the rung and rounds to 10 (hand-derived)', () => {
    const run = newRun({ difficulty: 'hard' });
    // act1: 100 + 100 = 200; x1.25 = 250
    expect(scaledCost({ base: 100, perAct: 100 }, run, catalogOf(run))).toBe(250);
    run.actIndex = 1; // act2: 300; x1.25 = 375 -> 380
    expect(scaledCost({ base: 100, perAct: 100 }, run, catalogOf(run))).toBe(380);
    const black = newRun({ difficulty: 'lunatic' });
    expect(scaledCost({ base: 100, perAct: 100 }, black, catalogOf(black))).toBe(300); // 200 x 1.5
    const first = newRun({ difficulty: 'normal' });
    expect(scaledCost({ base: 100, perAct: 100 }, first, catalogOf(first))).toBe(200);
    const dusk = newRun({ difficulty: 'dusk' });
    expect(scaledCost({ base: 100, perAct: 100 }, dusk, catalogOf(dusk))).toBe(200);
  });

  it('byRung takes the highest rung at or below the run (Nightfall values hold on Black Sun)', () => {
    const table = { hard: 45 };
    expect(byRungValue(table, 'normal', 55)).toBe(55);
    expect(byRungValue(table, 'dusk', 55)).toBe(55);
    expect(byRungValue(table, 'hard', 55)).toBe(45);
    expect(byRungValue(table, 'lunatic', 55)).toBe(45);
    expect(byRungValue({ hard: 45, lunatic: 40 }, 'lunatic', 55)).toBe(40);
  });
});

describe('the pick', () => {
  it('is the same event for the same run seed and node, however often it is asked', () => {
    const a = newRun({ seed: 321 });
    const b = newRun({ seed: 321 });
    const node = eventNode(a);
    const nodeB = b.nodeMap.nodes.find((n) => n.id === node.id);
    nodeB.type = 'event';
    const first = pickEvent(a, node, catalogOf(a)).id;
    expect(pickEvent(a, node, catalogOf(a)).id).toBe(first);
    expect(pickEvent(b, nodeB, catalogOf(b)).id).toBe(first);
  });

  it('varies with the seed and the node (a spread, not one event)', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const run = newRun({ seed });
      seen.add(pickEvent(run, eventNode(run), catalogOf(run)).id);
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
    expect(seen.has('quiet_road')).toBe(false);
    expect(seen.has('the_echo')).toBe(false); // no fallen ally: never eligible
  });

  it('does not depend on catalog order', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const run = newRun({ seed });
      const node = eventNode(run);
      const forward = pickEvent(run, node, catalogOf(run)).id;
      const reversed = { ...catalogOf(run), events: [...catalogOf(run).events].reverse() };
      expect(pickEvent(run, node, reversed).id).toBe(forward);
    }
  });

  it('follows weights: a 9:1 pair is picked about 9 to 1', () => {
    const heavy = soloEvent([], { id: 'heavy' });
    const light = soloEvent([], { id: 'light' });
    heavy.weight = 9;
    light.weight = 1;
    let heavyWins = 0;
    const total = 400;
    for (let seed = 1; seed <= total; seed++) {
      const run = runWithEvents([heavy, light], { seed });
      if (pickEvent(run, eventNode(run), catalogOf(run)).id === 'heavy') heavyWins++;
    }
    expect(heavyWins / total).toBeGreaterThan(0.84);
    expect(heavyWins / total).toBeLessThan(0.96);
  });

  it('never reads Math.random (the surrounding stream is untouched)', () => {
    const run = newRun({ seed: 55 });
    const node = eventNode(run);
    const spy = vi.spyOn(Math, 'random');
    try {
      pickEvent(run, node, catalogOf(run));
      pickFallenAlly(run, node.id);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('excludes an event already met when it is once-per-run, until none is left, then the fallback', () => {
    const run = newRun({ seed: 9 });
    const node = eventNode(run);
    const normal = catalogOf(run).events.filter((e) => !e.fallback && e.id !== 'the_echo');
    const met = [];
    // Meet every eligible event in turn: each pick is a new one.
    for (let i = 0; i < normal.length; i++) {
      const picked = pickEvent(run, node, catalogOf(run));
      if (picked.fallback) break;
      expect(met).not.toContain(picked.id);
      met.push(picked.id);
      run.eventLog.push({ eventId: picked.id, choiceId: 'x', outcomeId: 'y', act: 'act1' });
    }
    // act1 has no echo (no fallen) and some events are act-gated: the list ends in the fallback.
    expect(pickEvent(run, node, catalogOf(run)).id).toBe('quiet_road');
    // The fallback is never used up: met twice, it is still the fallback.
    run.eventLog.push({
      eventId: 'quiet_road',
      choiceId: 'rest',
      outcomeId: 'rested',
      act: 'act1',
    });
    expect(pickEvent(run, node, catalogOf(run)).id).toBe('quiet_road');
  });

  it('a non-once-per-run event may repeat', () => {
    const repeater = soloEvent([], { id: 'repeater' });
    repeater.oncePerRun = false;
    const run = runWithEvents([repeater]);
    run.eventLog.push({ eventId: 'repeater', choiceId: 'go', outcomeId: 'only', act: 'act1' });
    expect(ids(eligibleEvents(run, eventNode(run), catalogOf(run)))).toEqual(['repeater']);
  });

  it('only offers an event in its own acts (and none in an act it does not list)', () => {
    const act2only = soloEvent([], { id: 'act2only' });
    act2only.acts = ['act2'];
    const run = runWithEvents([act2only]);
    expect(ids(eligibleEvents(run, eventNode(run), catalogOf(run)))).toEqual([]);
    run.actIndex = 1;
    expect(ids(eligibleEvents(run, run.nodeMap.nodes[3], catalogOf(run)))).toEqual(['act2only']);
  });

  it('never offers an event in a prologue run', () => {
    const run = newRun();
    run.mode = 'prologue';
    expect(eligibleEvents(run, eventNode(run), catalogOf(run))).toEqual([]);
  });

  it('the Echo names one fallen ally, a lord first when a lord has fallen', () => {
    const run = newRun({ seed: 14 });
    const archer = addUnit(run, 'Archer', { name: 'Hale' });
    const knight = addUnit(run, 'Knight', { name: 'Brant' });
    fallAlly(run, archer);
    fallAlly(run, knight);
    const node = eventNode(run);
    const named = pickFallenAlly(run, node.id);
    expect(['Hale', 'Brant']).toContain(named.name);
    expect(pickFallenAlly(run, node.id)).toEqual(named); // stable
    // A fallen lord takes precedence over recruits.
    const sera = run.roster.find((u) => u.name === 'Sera');
    fallAlly(run, sera);
    expect(pickFallenAlly(run, node.id).name).toBe('Sera');
  });
});

describe('eligibility gates (each key, positive and negative)', () => {
  const gate = (run, requires, node = eventNode(run)) =>
    evaluateRequires(run, requires, { catalog: catalogOf(run), node });

  it('acts, minRow, maxRow', () => {
    const run = newRun();
    const node = eventNode(run);
    expect(gate(run, { acts: ['act1', 'act2'] })).toBe('');
    expect(gate(run, { acts: ['act3'] })).not.toBe('');
    expect(gate(run, { minRow: node.row }, node)).toBe('');
    expect(gate(run, { minRow: node.row + 1 }, node)).not.toBe('');
    expect(gate(run, { maxRow: node.row }, node)).toBe('');
    expect(gate(run, { maxRow: node.row - 1 }, node)).not.toBe('');
  });

  it('difficultyAtLeast / difficultyAtMost compare rungs, never id lists', () => {
    const hard = newRun({ difficulty: 'hard' });
    expect(gate(hard, { difficultyAtLeast: 'dusk' })).toBe('');
    expect(gate(hard, { difficultyAtLeast: 'hard' })).toBe('');
    expect(gate(hard, { difficultyAtLeast: 'lunatic' })).not.toBe('');
    expect(gate(hard, { difficultyAtMost: 'hard' })).toBe('');
    expect(gate(hard, { difficultyAtMost: 'dusk' })).not.toBe('');
  });

  it('phaseAtLeast / phaseAtMost read the Eclipse phase (Pale at the start)', () => {
    const run = newRun();
    expect(gate(run, { phaseAtMost: 'pale' })).toBe('');
    expect(gate(run, { phaseAtLeast: 'pale' })).toBe('');
    expect(gate(run, { phaseAtLeast: 'waning' })).not.toBe('');
    run.eclipse = { ...run.eclipse, shadow: 30 }; // Waning begins at 25
    expect(gate(run, { phaseAtLeast: 'waning' })).toBe('');
    expect(gate(run, { phaseAtMost: 'pale' })).not.toBe('');
  });

  it('goldAtLeast counts after costScale', () => {
    const run = newRun({ difficulty: 'hard', gold: 249 });
    // 200 x 1.25 = 250 on Nightfall
    expect(gate(run, { goldAtLeast: { base: 100, perAct: 100 } })).not.toBe('');
    run.gold = 250;
    expect(gate(run, { goldAtLeast: { base: 100, perAct: 100 } })).toBe('');
  });

  it('roster: weapon types, magic, staff, minUnits', () => {
    const run = newRun(); // Edric (Sword), Sera (Light, Staff), Gaspar (Lance, Sword)
    expect(gate(run, { roster: { weaponTypes: ['Axe'] } })).not.toBe('');
    expect(gate(run, { roster: { weaponTypes: ['Axe', 'Lance'] } })).toBe('');
    expect(gate(run, { roster: { magic: true } })).toBe('');
    expect(gate(run, { roster: { staff: true } })).toBe('');
    expect(gate(run, { roster: { minUnits: 3 } })).toBe('');
    expect(gate(run, { roster: { minUnits: 4 } })).not.toBe('');
    const sera = run.roster.find((u) => u.name === 'Sera');
    sera.proficiencies = [{ type: 'Sword', rank: 'Prof' }];
    expect(gate(run, { roster: { magic: true } })).not.toBe('');
    expect(gate(run, { roster: { staff: true } })).not.toBe('');
  });

  it('fallen needs a fallen, unrevived ally', () => {
    const run = newRun();
    expect(gate(run, { fallen: true })).not.toBe('');
    fallAlly(run, addUnit(run, 'Archer'));
    expect(gate(run, { fallen: true })).toBe('');
  });

  it('consumable needs a Vulnerary with a use left, in a bag or the convoy', () => {
    const run = newRun();
    for (const unit of run.roster) unit.consumables = [];
    run.convoy.consumables = [];
    expect(gate(run, { consumable: 'Vulnerary' })).not.toBe('');
    const gaspar = run.roster.find((u) => u.name === 'Gaspar');
    gaspar.consumables = [{ ...run.getConsumableTemplate('Vulnerary'), uses: 0 }];
    expect(gate(run, { consumable: 'Vulnerary' })).not.toBe('');
    gaspar.consumables = [{ ...run.getConsumableTemplate('Vulnerary'), uses: 1 }];
    expect(gate(run, { consumable: 'Vulnerary' })).toBe('');
    gaspar.consumables = [];
    run.convoy.consumables = [run.getConsumableTemplate('Vulnerary')];
    expect(gate(run, { consumable: 'Vulnerary' })).toBe('');
  });

  it('flag, notFlag, notBurden', () => {
    const run = newRun();
    expect(gate(run, { flag: 'sold_dispatch' })).not.toBe('');
    expect(gate(run, { notFlag: 'sold_dispatch' })).toBe('');
    run.storyFlags = { sold_dispatch: true };
    expect(gate(run, { flag: 'sold_dispatch' })).toBe('');
    expect(gate(run, { notFlag: 'sold_dispatch' })).not.toBe('');
    expect(gate(run, { notBurden: 'debt' })).toBe('');
    run.burdens = [{ id: 'debt', owed: 100, garnish: 0.5 }];
    expect(gate(run, { notBurden: 'debt' })).not.toBe('');
  });

  it('blessingTier needs a mid-run-safe blessing of that tier the run does not hold', () => {
    const run = newRun();
    expect(gate(run, { blessingTier: 1 })).toBe('');
    // Hold all three safe tier-1 blessings: steady_hands, blessed_vigor, field_medic.
    run.activeBlessings = ['steady_hands', 'blessed_vigor', 'field_medic'].map((id) => ({ id }));
    expect(gate(run, { blessingTier: 1 })).not.toBe('');
    // Tier 4 has nothing safe to give (its blessings are run-start grants or carry a pact).
    expect(gate(newRun(), { blessingTier: 4 })).not.toBe('');
  });

  it('a custom reason replaces the default line, and an unknown key fails closed', () => {
    const run = newRun();
    expect(gate(run, { fallen: true, reason: 'Nobody has fallen.' })).toBe('Nobody has fallen.');
    expect(gate(run, { moonPhase: 1 })).not.toBe('');
  });

  it('shipped events gate as the spec says', () => {
    const run = newRun();
    for (const unit of run.roster) unit.consumables = [];
    run.convoy.consumables = [];
    // act1, no fallen, no Vulnerary, no debt:
    const eligible = ids(eligibleEvents(run, eventNode(run), catalogOf(run)));
    expect(eligible).not.toContain('the_echo');
    expect(eligible).toContain('moneylender');
    expect(eligible).toContain('old_swordmaster');
    run.actSequence = ['act1', 'act2', 'act3', 'act4'];
    run.actIndex = 3; // act4: the act-gated events drop out
    const late = ids(
      eligibleEvents(
        run,
        run.nodeMap.nodes.find((n) => n.row === 3),
        catalogOf(run),
      ),
    );
    for (const id of [
      'old_swordmaster',
      'abandoned_armory',
      'deserters_fire',
      'toll_bridge',
      'moneylender',
      'drill_yard',
    ])
      expect(late).not.toContain(id);
    expect(late).toEqual(expect.arrayContaining(['twin_altar', 'wounded_courier']));
    // The debtor is not offered another loan.
    run.actIndex = 0;
    run.burdens = [{ id: 'debt', owed: 50, garnish: 0.5 }];
    expect(ids(eligibleEvents(run, eventNode(run), catalogOf(run)))).not.toContain('moneylender');
  });
});

describe('outcome selection', () => {
  const swordsman = (run) => run.roster.find((u) => u.name === 'Edric');
  const rollFor = (run, nodeId, choiceId) =>
    createSeededRng(eclipseHash(`event:${run.runSeed}:${nodeId}:${choiceId}`))();

  it('draws one number from event:${runSeed}:${nodeId}:${choiceId} (the seed contract)', () => {
    const run = newRun({ seed: 808 });
    const node = eventNode(run);
    const choice = baseData.events.events.find((e) => e.id === 'old_swordmaster').choices[0];
    const roll = rollFor(run, node.id, 'train');
    // taught 70 / refused 30 on Nightfall-below rungs: below 0.7 -> taught.
    const { outcome } = selectOutcome(run, node.id, choice, { target: swordsman(run) });
    expect(outcome.id).toBe(roll < 0.7 ? 'taught' : 'refused');
    // The same call is the same answer.
    expect(selectOutcome(run, node.id, choice, { target: swordsman(run) }).outcome.id).toBe(
      outcome.id,
    );
  });

  it('is stable across save and load', () => {
    const run = newRun({ seed: 808 });
    const node = eventNode(run);
    const choice = baseData.events.events.find((e) => e.id === 'old_swordmaster').choices[0];
    const before = selectOutcome(run, node.id, choice, { target: swordsman(run) }).outcome.id;
    const loaded = run.constructor.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);
    expect(selectOutcome(loaded, node.id, choice, { target: loaded.roster[0] }).outcome.id).toBe(
      before,
    );
  });

  it('weights split the roll: hand-computed cumulative thresholds', () => {
    const run = runWithEvents([]);
    const node = eventNode(run);
    const choice = {
      id: 'split',
      outcomes: [
        { id: 'a', weight: 20 },
        { id: 'b', weight: 30 },
        { id: 'c', weight: 50 },
      ],
    };
    const roll = rollFor(run, node.id, 'split');
    const expected = roll < 0.2 ? 'a' : roll < 0.5 ? 'b' : 'c';
    expect(selectOutcome(run, node.id, choice).outcome.id).toBe(expected);
    // Sweep seeds: each outcome occurs at its weight (20/30/50 +- 5 points of 600).
    const counts = { a: 0, b: 0, c: 0 };
    for (let seed = 1; seed <= 600; seed++) {
      const r = newRun({ seed });
      counts[selectOutcome(r, 'some_node', choice).outcome.id]++;
    }
    expect(counts.a / 600).toBeGreaterThan(0.15);
    expect(counts.a / 600).toBeLessThan(0.25);
    expect(counts.c / 600).toBeGreaterThan(0.44);
    expect(counts.c / 600).toBeLessThan(0.56);
  });

  it('weightByRung shifts the odds from its rung up (Black Sun inherits Nightfall)', () => {
    const choice = {
      id: 'shifty',
      outcomes: [
        { id: 'good', weight: 55, weightByRung: { hard: 45 } },
        { id: 'bad', weight: 45, weightByRung: { hard: 55 } },
      ],
    };
    const goodShare = (difficulty) => {
      let good = 0;
      for (let seed = 1; seed <= 500; seed++) {
        const run = newRun({ seed, difficulty });
        if (selectOutcome(run, 'n', choice).outcome.id === 'good') good++;
      }
      return good / 500;
    };
    const first = goodShare('normal');
    const nightfall = goodShare('hard');
    const blackSun = goodShare('lunatic');
    expect(first).toBeGreaterThan(0.49); // 55% base
    expect(nightfall).toBeLessThan(0.51); // 45%
    expect(blackSun).toBe(nightfall); // same table, same seeds: identical
    expect(first).toBeGreaterThan(nightfall);
  });

  describe('checks', () => {
    const spar = baseData.events.events.find((e) => e.id === 'old_swordmaster').choices[1];
    const bluff = baseData.events.events.find((e) => e.id === 'toll_bridge').choices[1];

    it('chance = clamp(base + (sum - against) x perPoint + rung): hand-derived', () => {
      const run = newRun(); // Edric SKL 7 + SPD 8 = 15; Gaspar SKL 12 + SPD 10 = 22
      const edric = swordsman(run);
      const gaspar = run.roster.find((u) => u.name === 'Gaspar');
      // Gaspar: .30 + (22 - 24) x .025 = .25
      expect(checkChance(run, spar.check, gaspar)).toBeCloseTo(0.25, 10);
      // Edric: .30 + (15 - 24) x .025 = .075, clamped up to min .15
      expect(checkChance(run, spar.check, edric)).toBeCloseTo(0.15, 10);
      // A very strong unit clamps to max .85
      gaspar.stats.SKL = 40;
      gaspar.stats.SPD = 40;
      expect(checkChance(run, spar.check, gaspar)).toBeCloseTo(0.85, 10);
    });

    it('Black Sun takes .10 off (and only Black Sun)', () => {
      const lunatic = newRun({ difficulty: 'lunatic' });
      const gaspar = lunatic.roster.find((u) => u.name === 'Gaspar');
      expect(checkChance(lunatic, spar.check, gaspar)).toBeCloseTo(0.15, 10); // .25 - .10
      const hard = newRun({ difficulty: 'hard' });
      expect(
        checkChance(
          hard,
          spar.check,
          hard.roster.find((u) => u.name === 'Gaspar'),
        ),
      ).toBeCloseTo(0.25, 10);
    });

    it('bestInArmy reads the army best, not the target', () => {
      const run = newRun(); // LCK 6, 6, 3
      // .35 + (6 - 8) x .03 = .29
      expect(checkChance(run, bluff.check, null)).toBeCloseTo(0.29, 10);
      addUnit(run, 'Archer').stats.LCK = 12; // .35 + (12 - 8) x .03 = .47
      expect(checkChance(run, bluff.check, null)).toBeCloseTo(0.47, 10);
    });

    it('two units, one seed, different odds: the roll is the same, the verdict differs', () => {
      // Find a seed whose spar roll lies between Edric's .15 and Gaspar's .25.
      let found = null;
      for (let seed = 1; seed <= 4000 && !found; seed++) {
        const run = newRun({ seed });
        const node = eventNode(run);
        const roll = rollFor(run, node.id, 'spar');
        if (roll >= 0.15 && roll < 0.25) found = { seed, node: node.id };
      }
      expect(found).not.toBeNull();
      const run = newRun({ seed: found.seed });
      const edric = swordsman(run);
      const gaspar = run.roster.find((u) => u.name === 'Gaspar');
      expect(selectOutcome(run, found.node, spar, { target: edric }).outcome.id).toBe('fail');
      expect(selectOutcome(run, found.node, spar, { target: gaspar }).outcome.id).toBe('pass');
    });
  });
});
