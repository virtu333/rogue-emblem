// The `join` effect (docs/specs/event-nodes-phase2.md §2A): a unit joins the army from an event
// through the recruit-node builder.
//
// Ways this goes wrong:
//   - the recruit is a lord (the builder's lord roll leaks through), an enemy-only or boss class,
//     or a promoted class an act's pool does not list;
//   - the name is one the run has used: a roster unit's, a fallen or laid-to-rest ally's, a name a
//     recruit node has promised, or the name an earlier join of the same outcome took;
//   - the level ignores the Edric-anchored recruit rule, or `levelOffset`;
//   - a promoted class never promotes or always does (the recruit rules roll it), or the unit's
//     tier and class disagree;
//   - the join reads or consumes the unseeded stream (a refresh would change the recruit);
//   - a join followed by a failure leaves the unit, its name or its uid behind;
//   - a roster cap that does not exist blocks the choice (there is none: the Expanded Ranks
//     upgrade retired it).
// Expected levels are derived by hand: the recruit node's rule is the average effective level of
// the strongest squad (roster levels 6, 4 and 5 below: floor(15 / 3) = 5).
import { describe, expect, it, vi } from 'vitest';
import { arriveAtEvent, chooseEventOption, eventChoiceBlock } from '../src/engine/EventCommands.js';
import { buildRecruitNodeUnit } from '../src/engine/RecruitNodeSystem.js';
import { joinClassBlock } from '../src/engine/EventJoin.js';
import { everFallenUnits } from '../src/engine/LaidToRest.js';
import {
  addUnit,
  arriveAs,
  baseData,
  eventNode,
  fallAlly,
  runWithEvents,
  soloEvent,
} from './eventKit.js';
import { roundTrip } from './eventPhase2Kit.js';

const join = (effect, extra = {}) => ({ type: 'join', ...effect, ...extra });

/** A run with a known roster (Edric 6, Sera 4, a level 5 Fighter), standing at a solo event. */
function setup(effects, { seed = 41, act = 0, event = null } = {}) {
  const run = runWithEvents([event || soloEvent(effects)], { seed });
  run.actSequence = ['act1', 'act2', 'act3', 'act4'];
  run.actIndex = act;
  run.roster = run.roster.filter((u) => u.name !== 'Gaspar');
  run.roster.find((u) => u.name === 'Edric').level = 6;
  run.roster.find((u) => u.name === 'Sera').level = 4;
  addUnit(run, 'Fighter', { name: 'Brant', level: 5 });
  const node = arriveAs(run, 'solo');
  return { run, node };
}

const joined = (run, before) => run.roster.slice(before);

describe('the unit that joins', () => {
  it('joins the roster as a player unit of the class asked, at the recruit-node level, with a uid', () => {
    const { run, node } = setup([join({ class: 'Archer' })]);
    const before = run.roster.length;
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.ok).toBe(true);
    const [unit] = joined(run, before);
    expect(run.roster).toHaveLength(before + 1);
    expect(unit).toMatchObject({ className: 'Archer', faction: 'player', level: 5 });
    expect(unit.isLord).toBeFalsy();
    expect(unit.unitUid).toBeTruthy();
    expect(unit.currentHP).toBeGreaterThan(0);
    expect(result.results).toEqual([
      { kind: 'join', name: unit.name, className: 'Archer', level: 5, unitUid: unit.unitUid },
    ]);
    // a recruit's name is recorded as used
    expect(run.usedRecruitNames.Archer).toContain(unit.name);
    expect(run.getTakenUnitNames().has(unit.name)).toBe(true);
  });

  it('levelOffset moves the level (+2 -> 7, -2 -> 3)', () => {
    for (const [levelOffset, level] of [
      [2, 7],
      [-2, 3],
      [0, 5],
    ]) {
      const { run, node } = setup([join({ class: 'Archer', levelOffset })]);
      chooseEventOption(run, node.id, 'go');
      expect(run.roster.at(-1).level).toBe(level);
    }
  });

  it('a recruit-level blessing counts, as it does for a recruit node', () => {
    const { run, node } = setup([join({ class: 'Archer' })]);
    run.blessingRuntimeModifiers.recruitLevelBonus = 1;
    chooseEventOption(run, node.id, 'go');
    expect(run.roster.at(-1).level).toBe(6);
  });

  it('is never a lord, even on the seeds where the recruit-node builder would roll one', () => {
    // sanity: the same stream with the real lords does produce a lord on some seeds, so the
    // sweep below can only pass because the join switches the roll off
    let lordsWithLords = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const run = setup([join({ class: 'Archer' })], { seed }).run;
      const ctx = run.getRecruitBattleContext({ id: 'probe' });
      const built = buildRecruitNodeUnit({
        ...ctx,
        nodeId: `probe:${seed}`,
        preview: { className: 'Archer', name: 'Probe' },
        gameData: run.gameData,
      });
      if (built?.isLord) lordsWithLords++;
    }
    expect(lordsWithLords).toBeGreaterThan(3);

    const lordNames = new Set(baseData.lords.map((l) => l.name));
    for (let seed = 1; seed <= 120; seed++) {
      const { run, node } = setup([join({ class: 'Archer' })], { seed });
      const before = run.roster.length;
      expect(chooseEventOption(run, node.id, 'go').ok).toBe(true);
      const unit = run.roster.at(-1);
      expect(run.roster).toHaveLength(before + 1);
      expect(unit.isLord).toBeFalsy();
      expect(lordNames.has(unit.name)).toBe(false);
      expect(unit.className).toBe('Archer');
    }
  });

  it('is seeded: the same run seed and node build the same recruit, other seeds differ', () => {
    const build = (seed) => {
      const { run, node } = setup([join({ class: 'Fighter' })], { seed });
      chooseEventOption(run, node.id, 'go');
      const unit = run.roster.at(-1);
      return JSON.stringify([
        unit.name,
        unit.stats,
        unit.traits,
        unit.skills,
        unit.inventory.map((i) => i.name),
      ]);
    };
    expect(build(12)).toBe(build(12));
    const seen = new Set();
    for (let seed = 1; seed <= 25; seed++) seen.add(build(seed));
    expect(seen.size).toBeGreaterThan(15);
  });

  it('never reads or consumes the unseeded stream', () => {
    const { run, node } = setup([join({ class: 'Archer' }), join({ class: 'Fighter' })]);
    const spy = vi.fn(() => 0.5);
    const original = Math.random;
    Math.random = spy;
    try {
      expect(chooseEventOption(run, node.id, 'go').ok).toBe(true);
      expect(Math.random).toBe(spy); // restored to what the caller had
      expect(spy).not.toHaveBeenCalled();
    } finally {
      Math.random = original;
    }
  });

  it('survives a save and a load', () => {
    const { run, node } = setup([join({ class: 'Mage' })]);
    chooseEventOption(run, node.id, 'go');
    const loaded = roundTrip(run);
    expect(loaded.roster.at(-1)).toEqual(run.roster.at(-1));
    expect(loaded.usedRecruitNames.Mage).toEqual(run.usedRecruitNames.Mage);
    expect(loaded.getTakenUnitNames().has(run.roster.at(-1).name)).toBe(true);
  });

  it('a trait asked for restricts the trait roll to it', () => {
    const { run, node } = setup([join({ class: 'Fighter', trait: 'hardy' })]);
    chooseEventOption(run, node.id, 'go');
    expect(run.roster.at(-1).traits).toEqual(['hardy']);
  });
});

describe('names are never reused', () => {
  const withNames = (run, names) => {
    run.gameData = {
      ...run.gameData,
      recruits: {
        ...run.gameData.recruits,
        namePool: { ...run.gameData.recruits.namePool, Archer: names },
      },
    };
  };

  it("skips every taken name: the roster, the fallen, the laid-to-rest and a recruit node's promise", () => {
    const { run, node } = setup([join({ class: 'Archer' })]);
    withNames(run, ['Rook', 'Wick', 'Hale', 'Dov', 'Free']);
    addUnit(run, 'Archer', { name: 'Rook' }); // on the roster
    const fallen = addUnit(run, 'Archer', { name: 'Wick' });
    fallAlly(run, fallen); // fallen
    const rested = addUnit(run, 'Archer', { name: 'Hale' });
    fallAlly(run, rested);
    run.laidToRest = [run.fallenUnits.pop()]; // laid to rest
    expect(
      everFallenUnits(run)
        .map((u) => u.name)
        .sort(),
    ).toEqual(['Hale', 'Wick']);
    // a recruit node ahead has promised "Dov"
    const ahead = run.nodeMap.nodes.find(
      (n) => n.type === 'battle' && !n.completed && n.id !== node.id,
    );
    ahead.type = 'recruit';
    ahead.recruitPreview = { v: 1, className: 'Archer', name: 'Dov' };
    chooseEventOption(run, node.id, 'go');
    expect(run.roster.at(-1).name).toBe('Free');
  });

  it('with every pool name taken it makes a unique one (never a duplicate)', () => {
    const { run, node } = setup([join({ class: 'Archer' })]);
    withNames(run, ['Rook']);
    addUnit(run, 'Archer', { name: 'Rook' });
    chooseEventOption(run, node.id, 'go');
    const names = run.roster.map((u) => u.name);
    expect(new Set(names).size).toBe(names.length);
    expect(run.roster.at(-1).name).toMatch(/^Rook \S+/);
  });

  it('two joins in one outcome get two different names', () => {
    const { run, node } = setup([join({ class: 'Archer' }), join({ class: 'Archer' })]);
    withNames(run, ['Only', 'Other']);
    const before = run.roster.length;
    chooseEventOption(run, node.id, 'go');
    expect(
      joined(run, before)
        .map((u) => u.name)
        .sort(),
    ).toEqual(['Only', 'Other']);
  });

  it('a name asked for is used when free and made unique when not', () => {
    const free = setup([join({ class: 'Archer', name: 'Corin' })]);
    chooseEventOption(free.run, free.node.id, 'go');
    expect(free.run.roster.at(-1).name).toBe('Corin');
    const taken = setup([join({ class: 'Archer', name: 'Brant' })]);
    chooseEventOption(taken.run, taken.node.id, 'go');
    expect(taken.run.roster.at(-1).name).not.toBe('Brant');
    expect(taken.run.roster.at(-1).name).toMatch(/^Brant /);
  });
});

describe('classes follow the recruit rules', () => {
  it('an enemy-only, boss or lord-only class cannot be handed out (nothing joins, nothing changes)', () => {
    for (const className of ['Zombie', 'Dragon', 'Entity', 'Lord', 'Great Lord']) {
      const { run, node } = setup([join({ class: className })]);
      const before = run.roster.length;
      expect(chooseEventOption(run, node.id, 'go')).toEqual({
        ok: false,
        reason: 'No one of that kind can join the army here.',
      });
      expect(run.roster).toHaveLength(before);
    }
  });

  it('a promoted class only joins in an act whose recruit pool lists it', () => {
    // Act I's pool has no Hero: a pool of [Hero, Fighter] always gives the Fighter
    for (let seed = 1; seed <= 40; seed++) {
      const { run, node } = setup([join({ classPool: ['Hero', 'Fighter'] })], { seed });
      chooseEventOption(run, node.id, 'go');
      expect(run.roster.at(-1).className).toBe('Fighter');
    }
    // Act III's does
    const classes = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const { run, node } = setup([join({ classPool: ['Hero', 'Fighter'] })], { seed, act: 2 });
      chooseEventOption(run, node.id, 'go');
      classes.add(run.roster.at(-1).className);
    }
    // Hero joins, or its base class Mercenary when the promotion roll fails (the recruit rule)
    expect([...classes].sort()).toEqual(['Fighter', 'Hero', 'Mercenary']);
  });

  it('a promoted class rolls its promotion like a recruit: Hero or its base class Mercenary, tier to match', () => {
    const seen = { Hero: 0, Mercenary: 0 };
    for (let seed = 1; seed <= 120; seed++) {
      const { run, node } = setup([join({ class: 'Hero' })], { seed, act: 2 });
      chooseEventOption(run, node.id, 'go');
      const unit = run.roster.at(-1);
      expect(['Hero', 'Mercenary']).toContain(unit.className);
      expect(unit.tier).toBe(unit.className === 'Hero' ? 'promoted' : 'base');
      seen[unit.className]++;
    }
    // the recruit-node promotion chance is 65%: both happen, promotion more often
    expect(seen.Mercenary).toBeGreaterThan(10);
    expect(seen.Hero).toBeGreaterThan(seen.Mercenary);
  });

  it('joinClassBlock: the reason a class is refused', () => {
    const data = { classes: baseData.classes, recruits: baseData.recruits };
    expect(joinClassBlock(data, 'Fighter', ['act1', 'act2', 'act3', 'act4'])).toBe('');
    expect(joinClassBlock(data, 'Hero', ['act3', 'act4'])).toBe('');
    expect(joinClassBlock(data, 'Hero', ['act2', 'act3'])).toContain("not in act2's recruit pool");
    expect(joinClassBlock(data, 'Zombie', ['act1'])).toContain('enemy-only');
    expect(joinClassBlock(data, 'Entity', ['act1'])).toContain('boss');
    expect(joinClassBlock(data, 'Bard', ['act1'])).toContain('cannot be recruited');
    expect(joinClassBlock(data, 'Lord', ['act1'])).toContain("no act's recruit pool");
    expect(joinClassBlock(data, 'Wizard', ['act1'])).toContain('unknown class');
  });
});

describe('the army can always take a recruit', () => {
  it('is never blocked: there is no roster cap', () => {
    const { run, node } = setup([join({ class: 'Archer' })]);
    for (let i = 0; i < 25; i++) addUnit(run, 'Soldier', { name: `Pike ${i}` });
    expect(eventChoiceBlock(run, node.id, 'go')).toBe('');
    const before = run.roster.length;
    expect(chooseEventOption(run, node.id, 'go').ok).toBe(true);
    expect(run.roster).toHaveLength(before + 1);
  });
});

describe('plan, then apply', () => {
  it('a failure after the join leaves no unit, no used name and no uid taken', () => {
    const { run, node } = setup([join({ class: 'Archer' }), { type: 'gold', value: 10 }]);
    const snapshot = JSON.stringify({
      roster: run.roster,
      used: run.usedRecruitNames,
      next: run.nextUnitUid,
      log: run.eventLog,
    });
    const spy = vi.spyOn(run, 'addGold').mockImplementation(() => {
      throw new Error('boom');
    });
    const result = chooseEventOption(run, node.id, 'go');
    spy.mockRestore();
    expect(result.ok).toBe(false);
    expect(
      JSON.stringify({
        roster: run.roster,
        used: run.usedRecruitNames,
        next: run.nextUnitUid,
        log: run.eventLog,
      }),
    ).toBe(snapshot);
    // and the same choice succeeds afterwards with the same recruit a fresh try gives
    expect(chooseEventOption(run, node.id, 'go').ok).toBe(true);
  });

  it('an outcome whose later effect cannot be planned joins no one', () => {
    const { run, node } = setup([
      join({ class: 'Archer' }),
      { type: 'item', name: 'No Such Blade' },
    ]);
    const before = run.roster.length;
    expect(chooseEventOption(run, node.id, 'go')).toEqual({
      ok: false,
      reason: 'Unknown item "No Such Blade".',
    });
    expect(run.roster).toHaveLength(before);
  });

  it('arriving does not build anyone: the pick draws no recruit', () => {
    const run = runWithEvents([soloEvent([join({ class: 'Archer' })])]);
    const node = eventNode(run);
    const before = run.roster.length;
    expect(arriveAtEvent(run, node.id).eventId).toBe('solo');
    expect(run.roster).toHaveLength(before);
  });
});
