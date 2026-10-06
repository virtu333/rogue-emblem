// The twelve Phase 2D events as shipped (data/events.json; docs/specs/event-nodes-phase2.md §2D):
// the Sunken Mine, the Plague Village, the Mercenary Contract, the Cartographer, the Chained
// Shelf, the Herald of the Hollow Sun, the Wandering Smith, the Turncoat, and the four payoffs
// (Old Faces, the Deserters' Revenge, the Collectors, A Bad Map), plus Black Sun's lying strangers.
// Every figure is worked out by hand from the data's { base, perAct } amounts and costScale, never
// by re-running the engine on itself.
//
// Ways each goes wrong:
//   eligibility   an event in an act it does not belong to; a payoff that shows without its flag, or
//                 for a flag set in this very act (it must be an EARLIER road); a roster gate that
//                 does not gate; an event offered while a contract is open
//   mine          the torches do not count (or not by rung), a draft that never comes, a level that
//                 can be reached with no light, the tell that lies (shown on a road where there is
//                 an ambush), a guardian whose relic never arrives or comes from the wrong table
//   plague        the doses not spent, a reward that does not grow, the Cleric not joining on the third
//                 dose, the staff user's tell shown when the well is not the trouble
//   contract      a contract that pays or punishes the wrong amount, or at the wrong goal
//   cartographer  a map made invalid, a road that costs gold but does nothing and keeps the coin, the
//                 lying answer on a rung below Black Sun
//   shelf         a skill the mage already knows, no price (max HP), a non-caster offered the book
//   herald        shadow moving by the wrong amount, the flag never set, the finale line on the wrong rung
//   smith         wrong odds on a rung, a worn weapon not mended, the wear on a weapon that cannot wear
//   turncoat      a spy below Black Sun, or a Black Sun spy that is not a trap
//   payoffs       a payoff with no flag, or the Phase 1 events not setting the flag it needs
import { describe, expect, it, vi } from 'vitest';
import {
  arriveAtEvent,
  chooseEventOption,
  completeEventBattle,
  eventChoiceBlock,
  eventState,
  eventView,
  leaveEvent,
} from '../src/engine/EventCommands.js';
import {
  eligibleEvents,
  evaluateRequires,
  eventBlock,
  flagEntry,
  flagValue,
  pickEvent,
} from '../src/engine/EventSystem.js';
import { checkNodeMapValidity, roadCandidates } from '../src/engine/RouteEdit.js';
import { heraldHeard } from '../src/engine/FinaleRally.js';
import { applyForge } from '../src/engine/ForgeSystem.js';
import { applyWear, isWorn, wearCount } from '../src/engine/WeaponWear.js';
import { knowsSkill } from '../src/engine/UnitManager.js';
import { addUnit, arriveAs, baseData, eventNode, newRun } from './eventKit.js';
import { pickTargetUid } from './eventWalk.js';

// Seeded sweeps over hundreds of runs: slow on a busy machine, never flaky.
vi.setConfig({ testTimeout: 60000 });

const catalog = baseData.events;
const eventDef = (id) => catalog.events.find((e) => e.id === id);

/**
 * A stocked army: Archer, Fighter, Mage, Cleric (a staff), Knight and Thief of level 3, plus the
 * start's Edric, Sera and Gaspar. `act` 0-3 sets the act; the run starts with `gold`.
 */
function army({ seed = 101, difficulty = 'normal', act = 0, gold = 3000, worn = false } = {}) {
  const run = newRun({ seed, difficulty, gold });
  run.actSequence = ['act1', 'act2', 'act3', 'act4'];
  run.actIndex = act;
  for (const [className, name] of [
    ['Archer', 'Hale'],
    ['Fighter', 'Brant'],
    ['Mage', 'Iona'],
    ['Cleric', 'Mara'],
    ['Knight', 'Dov'],
    ['Thief', 'Tess'],
  ])
    addUnit(run, className, { name, level: 3 });
  if (worn) {
    // A worn spare in Brant's bag (his equipped axe stays whole), for the Smith to mend.
    const spare = run.roster.find((u) => u.name === 'Brant').inventory[1];
    applyWear(spare, 'hit');
  }
  return run;
}

/** Arrive at an event on a row-3 node (so there are rows ahead to redraw) and return the node. */
const at = (run, eventId) =>
  arriveAs(
    run,
    eventId,
    run.nodeMap.nodes.find((n) => n.row === 3 && !n.completed),
  );

/** Choose, with the picker's last qualifying unit as the target when the choice needs one. */
const pick = (run, node, choiceId, extra = {}) =>
  chooseEventOption(run, node.id, choiceId, {
    targetUid: pickTargetUid(run, node.id, choiceId),
    ...extra,
  });

/** The outcome ids a choice rolls over many seeds: { id: count }. */
function tally(eventId, choiceId, { seeds = 120, difficulty = 'normal', act = 0, setup } = {}) {
  const counts = {};
  for (let seed = 1; seed <= seeds; seed++) {
    const run = army({ seed, difficulty, act });
    setup?.(run);
    const node = at(run, eventId);
    const result = pick(run, node, choiceId);
    expect(result.ok, `${eventId}.${choiceId} seed ${seed}: ${result.reason}`).toBe(true);
    counts[result.outcomeId] = (counts[result.outcomeId] || 0) + 1;
  }
  return counts;
}

/** Win the fight a node's event started (the army as it stands) and settle the spoils. */
function winFight(run, node, { turnCount = 5, turnPar = 5, units = null } = {}) {
  expect(run.completeBattle(units || run.getRoster(), node.id, 100, { turnCount, turnPar })).toBe(true); // prettier-ignore
  const settled = completeEventBattle(run, node.id);
  expect(settled.ok, settled.reason).toBe(true);
  return settled;
}

const NEW_EVENTS = [
  'sunken_mine',
  'plague_village',
  'merc_contract',
  'cartographer',
  'chained_shelf',
  'hollow_herald',
  'wandering_smith',
  'turncoat',
  'old_faces',
  'deserters_revenge',
  'collectors',
  'bad_map',
];

// ── Eligibility ─────────────────────────────────────────────────────────

describe('which events can be picked where', () => {
  const ACTS = {
    sunken_mine: ['act2', 'act3', 'act4'],
    plague_village: ['act1', 'act2', 'act3'],
    merc_contract: ['act1', 'act2', 'act3', 'act4'],
    cartographer: ['act1', 'act2', 'act3'],
    chained_shelf: ['act2', 'act3', 'act4'],
    hollow_herald: ['act2', 'act3', 'act4'],
    wandering_smith: ['act1', 'act2', 'act3', 'act4'],
    turncoat: ['act2', 'act3'],
    old_faces: ['act2', 'act3'],
    deserters_revenge: ['act2', 'act3'],
    collectors: ['act2', 'act3', 'act4'],
    bad_map: ['act2', 'act3', 'act4'],
  };
  /** The flag each payoff needs, set an act earlier. */
  const FLAGS = {
    old_faces: 'spared_deserters',
    deserters_revenge: 'reported_deserters',
    collectors: 'robbed_lender',
    bad_map: 'robbed_cartographer',
  };

  /** A run in act `n` (0-3) with every event's requirement met, so only the act and the data gate. */
  function ready(n) {
    const run = army({ act: n });
    run.eclipse = { ...run.eclipse, shadow: 55 }; // Umbral begins at 50
    run.storyFlags = Object.fromEntries(
      Object.values(FLAGS).map((flag) => [flag, { value: true, act: 'act0' }]),
    );
    return run;
  }

  it.each(NEW_EVENTS)('%s appears in exactly its acts', (id) => {
    for (let n = 0; n < 4; n++) {
      const run = ready(n);
      const node = run.nodeMap.nodes.find((x) => x.row === 3);
      const block = eventBlock(run, eventDef(id), node, catalog);
      const act = `act${n + 1}`;
      expect(block === '', `${id} in ${act}: ${block}`).toBe(ACTS[id].includes(act));
    }
  });

  it('every one of them is a normal once-per-run event with a positive weight (the payoffs 3)', () => {
    for (const id of NEW_EVENTS) {
      const event = eventDef(id);
      expect(event.fallback).toBeUndefined();
      expect(event.oncePerRun).not.toBe(false);
      expect(event.weight).toBe(FLAGS[id] ? 3 : 1);
    }
  });

  it('the Chained Shelf needs someone who can cast', () => {
    const run = army({ act: 1 });
    const node = run.nodeMap.nodes.find((x) => x.row === 3);
    expect(eventBlock(run, eventDef('chained_shelf'), node, catalog)).toBe('');
    // No tome or light user left: not even offered.
    run.roster = run.roster.filter((u) => !['Mage', 'Light Sage'].includes(u.className));
    expect(run.roster.some((u) => u.proficiencies.some((p) => ['Tome', 'Light'].includes(p.type)))).toBe(false); // prettier-ignore
    expect(eventBlock(run, eventDef('chained_shelf'), node, catalog)).toBe('requires');
    expect(evaluateRequires(run, eventDef('chained_shelf').requires, { catalog })).toBe('No one here can cast.'); // prettier-ignore
  });

  it('the Herald waits for the Umbral phase (shadow 50): 49 is not enough, 50 is', () => {
    const run = army({ act: 1 });
    const node = run.nodeMap.nodes.find((x) => x.row === 3);
    run.eclipse = { ...run.eclipse, shadow: 49 };
    expect(eventBlock(run, eventDef('hollow_herald'), node, catalog)).toBe('requires');
    run.eclipse = { ...run.eclipse, shadow: 50 };
    expect(eventBlock(run, eventDef('hollow_herald'), node, catalog)).toBe('');
  });

  describe.each(Object.entries(FLAGS))('the payoff %s (flag %s)', (id, flag) => {
    const open = (run) => {
      const node = run.nodeMap.nodes.find((x) => x.row === 3);
      return eventBlock(run, eventDef(id), node, catalog) === '';
    };
    it('is not offered without the flag, nor for a flag set in the act you are in', () => {
      const run = army({ act: 1 }); // act2
      expect(open(run)).toBe(false);
      run.storyFlags = { [flag]: { value: true, act: 'act2' } };
      expect(open(run)).toBe(false);
    });
    it('is offered for a flag from an earlier act, and for an old save that recorded no act', () => {
      const run = army({ act: 1 });
      run.storyFlags = { [flag]: { value: true, act: 'act1' } };
      expect(open(run)).toBe(true);
      run.storyFlags = { [flag]: true }; // a plain value from before acts were recorded
      expect(open(run)).toBe(true);
      run.storyFlags = { [flag]: { value: false, act: 'act1' } };
      expect(open(run)).toBe(false);
    });
    it('is not offered once seen', () => {
      const run = army({ act: 1 });
      run.storyFlags = { [flag]: { value: true, act: 'act1' } };
      run.eventLog.push({ eventId: id, choiceId: 'x', outcomeId: 'y', act: 'act2' });
      expect(open(run)).toBe(false);
    });
  });

  it('a payoff is picked in proportion to its weight 3 among everything eligible', () => {
    // The pick is weighted: P(payoff) = 3 / (sum of the weights of the eligible events), whatever
    // else is eligible. Worked from the data's weights for one fixed army (the same set every seed).
    const seeds = 800;
    let payoff = 0;
    let weights = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const run = army({ seed, act: 1 });
      run.storyFlags = { spared_deserters: { value: true, act: 'act1' } };
      const node = run.nodeMap.nodes.find((x) => x.row === 3);
      if (seed === 1)
        weights = eligibleEvents(run, node, catalog).reduce((sum, e) => sum + e.weight, 0);
      if (pickEvent(run, node, catalog).id === 'old_faces') payoff++;
    }
    const expected = 3 / weights;
    expect(weights).toBeGreaterThan(10); // a real field to be picked from, not a one-event pool
    expect(Math.abs(payoff / seeds - expected)).toBeLessThan(0.05);
  });

  it('while a contract is open the Mercenary Contract is not even picked', () => {
    const run = army();
    run.contract = { goal: 'noLosses', reward: [], penalty: [], eventId: 'x', nodeId: 'y', act: 'act1' }; // prettier-ignore
    const node = run.nodeMap.nodes.find((x) => x.row === 3);
    expect(eligibleEvents(run, node, catalog).map((e) => e.id)).not.toContain('merc_contract');
    run.contract = null;
    expect(eligibleEvents(run, node, catalog).map((e) => e.id)).toContain('merc_contract');
  });
});

// ── The payoff flags: set by Phase 1, read here ─────────────────────────

describe('the flags the payoffs need are written by the events that promise them', () => {
  const setBy = (eventId, choiceId, flag, { act = 0, fight = false } = {}) => {
    const run = army({ act });
    const node = at(run, eventId);
    const result = pick(run, node, choiceId);
    expect(result.ok, result.reason).toBe(true);
    expect(result.battle).toBe(fight);
    return flagEntry(run.storyFlags, flag);
  };

  it('Deserters Fire: let them go -> spared_deserters; turn them in -> reported_deserters', () => {
    expect(setBy('deserters_fire', 'spare', 'spared_deserters')).toEqual({
      value: true,
      act: 'act1',
    });
    expect(setBy('deserters_fire', 'report', 'reported_deserters')).toEqual({
      value: true,
      act: 'act1',
    });
  });

  it('The Moneylender: rob the cart -> robbed_lender (set at the choice, before the fight)', () => {
    expect(setBy('moneylender', 'rob', 'robbed_lender', { fight: true })).toEqual({
      value: true,
      act: 'act1',
    });
  });

  it('The Cartographer: rob her -> robbed_cartographer', () => {
    expect(setBy('cartographer', 'rob', 'robbed_cartographer')).toEqual({
      value: true,
      act: 'act1',
    });
  });

  it('the other choices of those events leave the flag unset', () => {
    expect(setBy('deserters_fire', 'report', 'spared_deserters')).toBeNull();
    expect(setBy('cartographer', 'guide', 'robbed_cartographer')).toBeNull();
  });

  it('a full chain: sin in Act I, the payoff in Act II (flags survive the act change and read as "earlier")', () => {
    const chains = [
      ['deserters_fire', 'spare', 'old_faces'],
      ['deserters_fire', 'report', 'deserters_revenge'],
      ['moneylender', 'rob', 'collectors'],
      ['cartographer', 'rob', 'bad_map'],
    ];
    for (const [first, choice, payoff] of chains) {
      const run = army({ act: 0 });
      const node = at(run, first);
      expect(pick(run, node, choice).ok).toBe(true);
      // The road is walked: complete the act (a fight, if any, is simply marked won here).
      for (const n of run.nodeMap.nodes) n.completed = true;
      run.advanceAct();
      expect(run.currentAct).toBe('act2');
      const next = run.nodeMap.nodes.find((n) => n.row === 3);
      expect(
        eligibleEvents(run, next, catalog).map((e) => e.id),
        `${first} -> ${payoff}`,
      ).toContain(payoff);
    }
  });
});

// ── The Sunken Mine ─────────────────────────────────────────────────────

describe('The Sunken Mine', () => {
  const stand = (opts = {}) => {
    const run = army({ act: 1, ...opts });
    const node = at(run, 'sunken_mine');
    return { run, node };
  };
  const torches = (run, node) => eventView(run, node.id).counters.find((c) => c.key === 'torches');

  it('starts with three torches (two on Black Sun)', () => {
    for (const [difficulty, n] of [
      ['normal', 3],
      ['dusk', 3],
      ['hard', 3],
      ['lunatic', 2],
    ]) {
      const { run, node } = stand({ difficulty });
      expect(torches(run, node)).toMatchObject({ label: 'Torches', value: n, max: n });
    }
  });

  it("taking the ore forges the target's weapon for free and ends the event, keeping the torches", () => {
    const { run, node } = stand();
    const gold = run.gold;
    const target = run.roster.find((u) => u.name === 'Hale');
    const bow = target.weapon;
    const result = chooseEventOption(run, node.id, 'take_ore', { targetUid: target.unitUid });
    expect(result.ok, result.reason).toBe(true);
    expect(result.next).toBeNull();
    expect(bow._forgeLevel).toBe(1);
    expect(run.gold).toBe(gold);
    expect(torches(run, node).value).toBe(3);
    expect(leaveEvent(run, node.id).ok).toBe(true);
  });

  it('only a unit whose weapon can still be forged can work the ore', () => {
    const { run, node } = stand();
    const mara = run.roster.find((u) => u.name === 'Mara'); // a staff
    const view = eventView(run, node.id);
    const row = view.choices
      .find((c) => c.id === 'take_ore')
      .target.candidates.find((c) => c.name === 'Mara');
    expect(row).toMatchObject({ ok: false, reason: 'Their weapon cannot take more.' });
    expect(eventChoiceBlock(run, node.id, 'take_ore', mara.unitUid)).toBe(
      'Their weapon cannot take more.',
    );
  });

  it('going deeper spends a torch and moves to the next level; a draft takes a second', () => {
    const seen = { steady: 0, draft: 0 };
    for (let seed = 1; seed <= 80; seed++) {
      const { run, node } = stand({ seed });
      const result = pick(run, node, 'deeper');
      expect(result.ok, result.reason).toBe(true);
      expect(result.next).toBe('level_two');
      expect(eventView(run, node.id)).toMatchObject({ page: 'level_two', phase: 'choosing' });
      // 3 torches: one spent, and a draft takes one more (by hand).
      const left = torches(run, node).value;
      if (result.outcomeId === 'steady') expect(left).toBe(2);
      else expect(left).toBe(1);
      seen[result.outcomeId]++;
    }
    expect(seen.steady).toBeGreaterThan(0);
    expect(seen.draft).toBeGreaterThan(0);
  });

  it('drafts come about 25% of the time, 40% on Black Sun', () => {
    const rate = async (difficulty, seeds) => {
      const counts = tally('sunken_mine', 'deeper', { seeds, difficulty, act: 1 });
      return (counts.draft || 0) / seeds;
    };
    const normal = tally('sunken_mine', 'deeper', { seeds: 240, difficulty: 'normal', act: 1 });
    const black = tally('sunken_mine', 'deeper', { seeds: 240, difficulty: 'lunatic', act: 1 });
    expect(normal.draft / 240).toBeGreaterThan(0.17);
    expect(normal.draft / 240).toBeLessThan(0.34);
    expect(black.draft / 240).toBeGreaterThan(0.31);
    expect(black.draft / 240).toBeLessThan(0.5);
    void rate;
  });

  it('with no torch left only the dark way out is open', () => {
    // Black Sun: 2 torches, a draft on the first descent leaves none.
    let found = null;
    for (let seed = 1; seed <= 200 && !found; seed++) {
      const { run, node } = stand({ seed, difficulty: 'lunatic' });
      const result = pick(run, node, 'deeper');
      if (result.outcomeId === 'draft') found = { run, node };
    }
    expect(found, 'no draft in 200 seeds').toBeTruthy();
    const { run, node } = found;
    expect(torches(run, node).value).toBe(0);
    expect(eventChoiceBlock(run, node.id, 'deeper')).toBe('The last torch is gone.');
    expect(eventChoiceBlock(run, node.id, 'take_chest')).toBe('No light left to climb by.');
    expect(eventChoiceBlock(run, node.id, 'blind')).toBe('');
  });

  it("level two's chest pays 150 + 100 per act: 350 G in Act II, and ends the event", () => {
    const { run, node } = stand();
    expect(pick(run, node, 'deeper').ok).toBe(true);
    const gold = run.gold;
    const result = pick(run, node, 'take_chest');
    expect(result.ok, result.reason).toBe(true);
    expect(result.next).toBeNull();
    expect(run.gold - gold).toBe(350);
  });

  it('feeling your way out is an even coin: out with nothing, or an ambush that pays 100 + 50 per act', () => {
    const counts = tally('sunken_mine', 'blind', { seeds: 200, act: 1 });
    expect(counts.found / 200).toBeGreaterThan(0.4);
    expect(counts.found / 200).toBeLessThan(0.6);
    expect(counts.found + counts.ambush).toBe(200);
    // The ambush: a fight whose spoils are 200 G in Act II (100 + 50 x 2), by hand.
    for (let seed = 1; seed <= 100; seed++) {
      const { run, node } = stand({ seed });
      const result = pick(run, node, 'blind');
      if (result.outcomeId !== 'ambush') continue;
      expect(result.battle).toBe(true);
      const before = run.gold;
      const settled = winFight(run, node);
      const spoil = settled.results.find((r) => r.kind === 'gold');
      expect(spoil.value).toBe(200);
      expect(run.gold - before).toBeGreaterThanOrEqual(200);
      return;
    }
    throw new Error('no ambush in 100 seeds');
  });

  describe('the tell: "There\'s a way out"', () => {
    const lineFor = (run, node) =>
      eventView(run, node.id).choices.find((c) => c.id === 'blind').tells;

    it('a Thief says it only when the dark way out really is clear, and stays quiet before an ambush', () => {
      let said = 0;
      let quiet = 0;
      for (let seed = 1; seed <= 120; seed++) {
        const run = army({ seed, act: 1 });
        const node = at(run, 'sunken_mine');
        const tells = lineFor(run, node);
        const result = pick(run, node, 'blind');
        if (tells.length) {
          said++;
          expect(result.outcomeId, `seed ${seed}`).toBe('found');
          expect(tells[0].speaker.name).toBe('Tess');
          expect(tells[0].line).toBe("Tess: This tunnel breathes. There's a way out.");
        } else {
          quiet++;
          expect(result.outcomeId, `seed ${seed}`).toBe('ambush');
        }
      }
      expect(said).toBeGreaterThan(30);
      expect(quiet).toBeGreaterThan(30);
    });

    it('with no Thief and no Pathfinder aboard there is never a tell', () => {
      for (let seed = 1; seed <= 40; seed++) {
        const run = army({ seed, act: 1 });
        run.roster = run.roster.filter((u) => u.className !== 'Thief');
        const node = at(run, 'sunken_mine');
        expect(lineFor(run, node)).toEqual([]);
      }
    });

    it('a unit with Pathfinder speaks too (the skill, not the class)', () => {
      for (let seed = 1; seed <= 60; seed++) {
        const run = army({ seed, act: 1 });
        run.roster = run.roster.filter((u) => u.className !== 'Thief');
        const hale = run.roster.find((u) => u.name === 'Hale');
        hale.skills = [...(hale.skills || []), 'pathfinder'];
        expect(knowsSkill(hale, 'pathfinder')).toBe(true);
        const node = at(run, 'sunken_mine');
        const tells = lineFor(run, node);
        if (!tells.length) continue;
        expect(tells[0].line).toBe('Hale: The air moves left. Left is up.');
        expect(pick(run, node, 'blind').outcomeId).toBe('found');
        return;
      }
      throw new Error('no clear road in 60 seeds');
    });
  });

  it("level three: the guardian is a fight whose relic is one accessory from the next act's table", () => {
    const ACT3 = ['Seraph Robe', 'Magic Ring', 'Boots', 'Delphi Shield', 'Wrath Band', 'Counter Seal', 'Pursuit Ring', 'Blood Gem', 'Recoil Guard', 'Phoenix Brooch', "Duelist's Glove", 'Warding Charm', "Mentor's Band", 'Mercury Sandals', 'Phalanx Band']; // prettier-ignore
    const { run, node } = stand(); // act2: one tier up is act3's table
    expect(pick(run, node, 'deeper').ok).toBe(true);
    expect(pick(run, node, 'deeper').ok).toBe(true);
    expect(eventView(run, node.id).page).toBe('level_three');
    const fight = pick(run, node, 'guardian');
    expect(fight.battle).toBe(true);
    expect(node.type).toBe('event');
    expect(run.accessories).toHaveLength(0); // not before the fight is won
    const settled = winFight(run, node);
    const relic = settled.results.find((r) => r.kind === 'item');
    expect(relic).toMatchObject({ itemType: 'Accessory', pooled: true });
    expect(ACT3).toContain(relic.name);
    expect(run.accessories.map((a) => a.name)).toEqual([relic.name]);
  });

  it('level three with a torch can also be left standing, with nothing taken', () => {
    const { run, node } = stand();
    pick(run, node, 'deeper');
    pick(run, node, 'deeper');
    const gold = run.gold;
    const result = pick(run, node, 'climb');
    expect(result).toMatchObject({ ok: true, next: null });
    expect(run.gold).toBe(gold);
    expect(run.accessories).toEqual([]);
  });

  it('a refresh reopens the page it was on, torches as they were', () => {
    const { run, node } = stand({ difficulty: 'hard' });
    pick(run, node, 'deeper');
    const view = eventView(run, node.id);
    const loaded = run.constructor.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);
    expect(eventView(loaded, node.id)).toEqual(view);
  });
});

// ── The Plague Village ──────────────────────────────────────────────────

describe('The Plague Village', () => {
  /** A run with `uses` Vulnerary uses (two to a flask) in Hale's bag, everyone hurt to half. */
  const stand = (uses = 4, opts = {}) => {
    const run = army({ ...opts });
    for (const u of run.roster) u.consumables = []; // every other flask goes: only Hale's count
    run.convoy.consumables = [];
    const hale = run.roster.find((u) => u.name === 'Hale');
    while (uses > 0) {
      const flask = { ...run.getConsumableTemplate('Vulnerary') };
      flask.uses = Math.min(2, uses);
      hale.consumables.push(flask);
      uses -= flask.uses;
    }
    for (const u of run.roster) {
      u.stats.HP = 20;
      u.currentHP = 10;
    }
    const node = at(run, 'plague_village');
    const left = () =>
      run.roster.flatMap((u) => u.consumables || []).reduce((n, c) => n + c.uses, 0);
    return { run, node, hale, left };
  };

  it('medicine needs a Vulnerary; without one the choice is greyed with its reason', () => {
    const { run, node, hale } = stand(0);
    expect(hale.consumables).toEqual([]);
    expect(eventChoiceBlock(run, node.id, 'medicine')).toBe('You have no medicine left to give.');
    expect(eventChoiceBlock(run, node.id, 'walk')).toBe('');
  });

  it('the first dose spends one use; the reward grows with each dose (10%, 15%, then a Cleric)', () => {
    // A seed where the first dose is not wasted on the well.
    for (let seed = 1; seed <= 60; seed++) {
      const { run, node, left } = stand(4, { seed });
      const first = pick(run, node, 'medicine');
      if (first.outcomeId !== 'eased') continue;
      expect(first.next).toBe('ward');
      expect(left()).toBe(3);
      // 10% of 20 max HP = 2, for everyone: 10 -> 12 (hand).
      expect(run.roster.every((u) => u.currentHP === 12)).toBe(true);
      const second = pick(run, node, 'second');
      expect(second).toMatchObject({ ok: true, next: 'fever_breaks', outcomeId: 'second_dose' });
      expect(left()).toBe(2);
      // 15% of 20 = 3: 12 -> 15.
      expect(run.roster.every((u) => u.currentHP === 15)).toBe(true);
      const rosterBefore = run.roster.length;
      const third = pick(run, node, 'last');
      expect(third).toMatchObject({ ok: true, next: null, outcomeId: 'owes' });
      expect(left()).toBe(1);
      expect(run.roster).toHaveLength(rosterBefore + 1);
      const healer = run.roster.at(-1);
      expect(healer.className).toBe('Cleric');
      expect(third.results.find((r) => r.kind === 'join')).toMatchObject({
        className: 'Cleric',
        name: healer.name,
      });
      expect(leaveEvent(run, node.id).ok).toBe(true);
      return;
    }
    throw new Error('the first dose was always wasted');
  });

  it('you can stop after any dose: that is all you can spare', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { run, node, left } = stand(4, { seed });
      if (pick(run, node, 'medicine').outcomeId !== 'eased') continue;
      const stop = pick(run, node, 'enough');
      expect(stop).toMatchObject({ ok: true, next: null });
      expect(left()).toBe(3);
      const roster = run.roster.length;
      expect(run.roster).toHaveLength(roster); // no one joined
      return;
    }
    throw new Error('no eased first dose');
  });

  it('a second dose needs a use left: with one Vulnerary use only, the page offers only the way out', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { run, node } = stand(1, { seed });
      if (pick(run, node, 'medicine').outcomeId !== 'eased') continue;
      expect(eventChoiceBlock(run, node.id, 'second')).toBe('You have no medicine left to give.');
      expect(eventChoiceBlock(run, node.id, 'enough')).toBe('');
      return;
    }
    throw new Error('no eased first dose');
  });

  it('three in four first doses take; one in four is wasted on a well that was the trouble', () => {
    const counts = {};
    for (let seed = 1; seed <= 240; seed++) {
      const { run, node, left } = stand(4, { seed });
      const result = pick(run, node, 'medicine');
      counts[result.outcomeId] = (counts[result.outcomeId] || 0) + 1;
      expect(left()).toBe(3); // the dose is spent either way
      if (result.outcomeId === 'well') {
        expect(result.next).toBeNull();
        expect(run.roster.every((u) => u.currentHP === 10)).toBe(true); // no heal
      }
    }
    expect(counts.eased / 240).toBeGreaterThan(0.66);
    expect(counts.eased / 240).toBeLessThan(0.84);
  });

  it('the staff user\'s tell ("It is the well") appears exactly when the well is the trouble', () => {
    let said = 0;
    let quiet = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const { run, node } = stand(4, { seed });
      const tells = eventView(run, node.id).choices.find((c) => c.id === 'medicine').tells;
      const result = pick(run, node, 'medicine');
      if (tells.length) {
        said++;
        expect(result.outcomeId).toBe('well');
        expect(tells[0].line.endsWith("It isn't catching. It's the well.")).toBe(true);
        expect(['Mara', 'Sera']).toContain(tells[0].speaker.name); // staff and light users: Mara has a staff
      } else {
        quiet++;
        expect(result.outcomeId).toBe('eased');
      }
    }
    expect(said).toBeGreaterThan(10);
    expect(quiet).toBeGreaterThan(60);
  });

  it('with no staff user aboard there is no tell, whatever the well', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { run, node } = stand(4, { seed });
      run.roster = run.roster.filter((u) => !u.proficiencies.some((p) => p.type === 'Staff'));
      expect(eventView(run, node.id).choices.find((c) => c.id === 'medicine').tells).toEqual([]);
    }
  });

  it('looting pays 200 + 100 per act and leaves an Ill Omen (3 victories, 2 on First Light)', () => {
    for (const [difficulty, battles] of [
      ['normal', 2],
      ['hard', 3],
    ]) {
      const { run, node } = stand(0, { difficulty });
      const gold = run.gold;
      const result = pick(run, node, 'loot');
      expect(result.ok, result.reason).toBe(true);
      expect(run.gold - gold).toBe(300); // act1: 200 + 100
      expect(run.burdens).toMatchObject([{ id: 'ill_omen', battles }]);
    }
  });

  it('walking around changes nothing', () => {
    const { run, node } = stand(0);
    const gold = run.gold;
    const hp = run.roster.map((u) => u.currentHP);
    expect(pick(run, node, 'walk')).toMatchObject({ ok: true, next: null });
    expect(run.gold).toBe(gold);
    expect(run.roster.map((u) => u.currentHP)).toEqual(hp);
    expect(run.burdens).toEqual([]);
  });
});

// ── The Mercenary Contract ──────────────────────────────────────────────

describe('The Mercenary Contract', () => {
  const stand = (opts = {}) => {
    const run = army(opts);
    return { run, node: at(run, 'merc_contract') };
  };
  const winAs = (run, node, options) => {
    // A battle node of the same map: complete it as the victory the contract waits for.
    const battle = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed && n.id !== node.id); // prettier-ignore
    expect(run.completeBattle(run.getRoster(), battle.id, 100, options)).toBe(true);
    return run.lastContractSettlement;
  };

  it('"under par" opens a contract: 300 + 200 per act if kept, a Debt of 200 + 150 per act if broken', () => {
    const { run, node } = stand();
    const result = pick(run, node, 'par');
    expect(result.ok, result.reason).toBe(true);
    expect(run.contract).toMatchObject({
      goal: 'underPar',
      eventId: 'merc_contract',
      reward: [{ type: 'gold', value: { base: 300, perAct: 200 } }],
      penalty: [{ type: 'burden', id: 'debt', params: { owed: { base: 200, perAct: 150 } } }],
    });
    expect(result.results.find((r) => r.kind === 'contract')).toMatchObject({ goal: 'underPar' });
  });

  it('kept: the next victory by par pays 500 G in Act I and the contract is closed', () => {
    const { run, node } = stand();
    pick(run, node, 'par');
    const settlement = winAs(run, node, { turnCount: 5, turnPar: 5 });
    expect(settlement).toMatchObject({ goal: 'underPar', kept: true });
    expect(settlement.results.find((r) => r.kind === 'gold').value).toBe(500);
    expect(run.contract).toBeNull();
    expect(run.burdens).toEqual([]);
  });

  it('broken: a victory past par leaves a Debt of 350 G in Act I (200 + 150), and no reward', () => {
    const { run, node } = stand();
    pick(run, node, 'par');
    const settlement = winAs(run, node, { turnCount: 6, turnPar: 5 });
    expect(settlement.kept).toBe(false);
    expect(run.contract).toBeNull();
    expect(run.burdens).toMatchObject([{ id: 'debt', owed: 350 }]);
  });

  it('"lose no one" opens a contract: a finer weapon if kept, the Hunted burden if not', () => {
    const { run, node } = stand();
    const result = pick(run, node, 'clean');
    expect(result.ok, result.reason).toBe(true);
    expect(run.contract).toMatchObject({
      goal: 'noLosses',
      reward: [{ type: 'item', pool: { kind: 'weapon', weaponTypes: '$army', tierOffset: 1 } }],
      penalty: [{ type: 'burden', id: 'hunted' }],
    });
    const carried = () => run.roster.reduce((n, u) => n + u.inventory.length, 0) + run.convoy.weapons.length; // prettier-ignore
    const before = carried();
    const settlement = winAs(run, node, { turnCount: 5, turnPar: 5 });
    expect(settlement.kept).toBe(true);
    expect(carried()).toBe(before + 1);
    expect(run.burdens).toEqual([]);
  });

  it('losing someone breaks the "no one" contract and Hunted starts (2 battles on Black Sun too)', () => {
    const { run, node } = stand();
    pick(run, node, 'clean');
    const battle = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed && n.id !== node.id); // prettier-ignore
    const survivors = run.getRoster().filter((u) => u.name !== 'Dov');
    expect(run.completeBattle(survivors, battle.id, 100, { turnCount: 5, turnPar: 5 })).toBe(true);
    expect(run.lastContractSettlement).toMatchObject({ goal: 'noLosses', kept: false, losses: 1 });
    expect(run.burdens.map((b) => b.id)).toEqual(['hunted']);
    expect(run.burdens[0].battles).toBe(2);
  });

  it('only one contract at a time: the other is greyed, declining is always open', () => {
    const { run, node } = stand();
    // The page offers both until one is signed; after signing, a second event is not offered.
    expect(eventChoiceBlock(run, node.id, 'par')).toBe('');
    expect(eventChoiceBlock(run, node.id, 'clean')).toBe('');
    pick(run, node, 'par');
    const again = at(army(), 'merc_contract'); // a different run entirely
    void again;
    const other = run.nodeMap.nodes.find((n) => n.row === 4 && !n.completed);
    arriveAs(run, 'merc_contract', other);
    expect(eventChoiceBlock(run, other.id, 'par')).toBe('You are already bound by a contract.');
    expect(eventChoiceBlock(run, other.id, 'clean')).toBe('You are already bound by a contract.');
    expect(eventChoiceBlock(run, other.id, 'decline')).toBe('');
  });

  it('declining costs nothing', () => {
    const { run, node } = stand();
    const gold = run.gold;
    expect(pick(run, node, 'decline')).toMatchObject({ ok: true, next: null });
    expect(run.contract).toBeNull();
    expect(run.gold).toBe(gold);
  });

  it('the reward grows with the act (Act III: 300 + 3 x 200 = 900 G)', () => {
    const { run, node } = stand({ act: 2 });
    pick(run, node, 'par');
    const settlement = winAs(run, node, { turnCount: 3, turnPar: 5 });
    expect(settlement.results.find((r) => r.kind === 'gold').value).toBe(900);
  });
});

// ── The Cartographer ────────────────────────────────────────────────────

describe('The Cartographer', () => {
  const stand = (opts = {}) => {
    const run = army(opts);
    return { run, node: at(run, 'cartographer') };
  };

  it('hiring her costs 100 + 50 per act (150 G; 190 on Nightfall: 150 x 1.25 = 187.5, to 10)', () => {
    for (const [difficulty, cost] of [
      ['normal', 150],
      ['hard', 190],
      ['lunatic', 230], // 225 -> 230
    ]) {
      const { run, node } = stand({ difficulty });
      const view = eventView(run, node.id);
      expect(view.choices.find((c) => c.id === 'guide').cost).toBe(cost);
    }
  });

  it('a guide is only on offer where there is a road to find (greyed, with her reason, elsewhere)', () => {
    let open = 0;
    let shut = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const { run, node } = stand({ seed });
      const block = eventChoiceBlock(run, node.id, 'guide');
      const candidates = roadCandidates(run.nodeMap, node.id);
      if (candidates.length) {
        expect(block, `seed ${seed}`).toBe('');
        open++;
      } else {
        expect(block, `seed ${seed}`).toBe('She walks the road a while and finds no road to add.');
        shut++;
      }
    }
    expect(open).toBeGreaterThan(5);
    expect(shut).toBeGreaterThan(5);
  });

  it('a new road keeps the map valid and costs the coin: 150 G in Act I', () => {
    let drawn = 0;
    for (let seed = 1; seed <= 150 && drawn < 12; seed++) {
      const { run, node } = stand({ seed });
      if (eventChoiceBlock(run, node.id, 'guide')) continue;
      const gold = run.gold;
      const edges = [...node.edges];
      const result = pick(run, node, 'guide');
      expect(result.ok, result.reason).toBe(true);
      expect(checkNodeMapValidity(run.nodeMap), `seed ${seed}`).toEqual([]);
      const route = result.results.find((r) => r.kind === 'route');
      expect(route, `seed ${seed}`).toMatchObject({ op: 'addRoad', from: node.id });
      expect(run.gold).toBe(gold - 150);
      expect(node.edges).toHaveLength(edges.length + 1);
      expect(node.edges).toContain(route.to);
      drawn++;
    }
    expect(drawn).toBeGreaterThanOrEqual(12);
  });

  it('asking about the road ahead is free and, below Black Sun, always honest', () => {
    for (const difficulty of ['normal', 'dusk', 'hard']) {
      const counts = tally('cartographer', 'ask', { seeds: 60, difficulty });
      expect(counts.lied, difficulty).toBeUndefined();
      expect(counts.true_map).toBe(60);
    }
  });

  it('on Black Sun about 30% of answers are lies, and a lie makes a battle ahead (an honest hint on the choice)', () => {
    const counts = tally('cartographer', 'ask', { seeds: 240, difficulty: 'lunatic' });
    expect(counts.lied / 240).toBeGreaterThan(0.22);
    expect(counts.lied / 240).toBeLessThan(0.38);
    expect(eventDef('cartographer').choices.find((c) => c.id === 'ask').hint).toContain(
      'Free answers are worth what you pay',
    );
    // The truth turns a node ahead into a shop; the lie into a battle.
    let sawShop = false;
    let sawLie = false;
    for (let seed = 1; seed <= 120 && !(sawShop && sawLie); seed++) {
      const { run, node } = stand({ seed, difficulty: 'lunatic' });
      const result = pick(run, node, 'ask');
      const route = result.results.find((r) => r.kind === 'route');
      expect(checkNodeMapValidity(run.nodeMap)).toEqual([]);
      if (!route) continue;
      expect(route.op).toBe('redraw');
      expect(route.type).toBe(result.outcomeId === 'lied' ? 'battle' : 'shop');
      if (result.outcomeId === 'lied') sawLie = true;
      else sawShop = true;
    }
    expect(sawShop && sawLie).toBe(true);
  });

  it('robbing her pays 150 + 100 per act (250 G), +2 shadow, and sets the flag', () => {
    const { run, node } = stand();
    const gold = run.gold;
    const shadow = run.eclipse.shadow;
    const result = pick(run, node, 'rob');
    expect(result.ok, result.reason).toBe(true);
    expect(run.gold - gold).toBe(250);
    expect(run.eclipse.shadow - shadow).toBe(2);
    expect(flagEntry(run.storyFlags, 'robbed_cartographer')).toEqual({ value: true, act: 'act1' });
  });
});

// ── A Bad Map ───────────────────────────────────────────────────────────

describe('A Bad Map', () => {
  const stand = (opts = {}) => {
    const run = army({ act: 1, ...opts });
    run.storyFlags = { robbed_cartographer: { value: true, act: 'act1' } };
    return { run, node: at(run, 'bad_map') };
  };

  it('trusting it turns a node ahead into a battle, and the map stays valid', () => {
    let changed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { run, node } = stand({ seed });
      const types = run.nodeMap.nodes.map((n) => [n.id, n.type]);
      const result = pick(run, node, 'trust');
      expect(result.ok, result.reason).toBe(true);
      expect(checkNodeMapValidity(run.nodeMap)).toEqual([]);
      const route = result.results.find((r) => r.kind === 'route');
      if (!route) {
        expect(result.text).toContain('wrong in all the places that do not matter');
        continue;
      }
      changed++;
      expect(route).toMatchObject({ op: 'redraw', type: 'battle' });
      const now = run.nodeMap.nodes.find((n) => n.id === route.node);
      expect(now.type).toBe('battle');
      expect(now.battleParams).toBeTruthy();
      expect(types.find(([id]) => id === route.node)[1]).not.toBe('battle');
    }
    expect(changed).toBeGreaterThan(20);
  });

  it('a true map costs 200 + 100 per act (400 G in Act II) and adds a road; greyed where there is none', () => {
    let paid = 0;
    let shut = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const { run, node } = stand({ seed });
      const block = eventChoiceBlock(run, node.id, 'pay');
      if (block) {
        expect(block).toBe('The crossroads has no road a true map could add.');
        expect(roadCandidates(run.nodeMap, node.id)).toEqual([]);
        shut++;
        continue;
      }
      const gold = run.gold;
      const result = pick(run, node, 'pay');
      expect(result.ok, result.reason).toBe(true);
      expect(result.results.find((r) => r.kind === 'route')).toMatchObject({ op: 'addRoad' });
      expect(run.gold).toBe(gold - 400);
      expect(checkNodeMapValidity(run.nodeMap)).toEqual([]);
      paid++;
    }
    expect(paid).toBeGreaterThan(5);
    expect(shut).toBeGreaterThan(5);
  });

  it("tearing it down costs 10% of everyone's health and nothing else", () => {
    const { run, node } = stand();
    for (const u of run.roster) {
      u.stats.HP = 20;
      u.currentHP = 20;
    }
    const gold = run.gold;
    expect(pick(run, node, 'tear').ok).toBe(true);
    expect(run.roster.every((u) => u.currentHP === 18)).toBe(true); // 10% of 20
    expect(run.gold).toBe(gold);
  });
});

// ── The Chained Shelf ───────────────────────────────────────────────────

describe('The Chained Shelf', () => {
  const POOL = ['fiendish_blow', 'drain', 'luna', 'wrath'];
  const stand = (opts = {}) => {
    const run = army({ act: 1, ...opts });
    return { run, node: at(run, 'chained_shelf') };
  };
  const reader = (run) => run.roster.find((u) => u.name === 'Iona'); // the Mage

  it('only a spellcaster can read it; the rest are greyed with a reason', () => {
    const { run, node } = stand();
    const rows = Object.fromEntries(
      eventView(run, node.id)
        .choices.find((c) => c.id === 'read')
        .target.candidates.map((c) => [c.name, c]),
    );
    expect(rows.Iona.ok).toBe(true);
    expect(rows.Sera.ok).toBe(true); // a Light Sage casts
    expect(rows.Brant).toMatchObject({ ok: false, reason: 'Not a spellcaster.' });
  });

  it('reading teaches one skill of the pool and costs 3 max HP', () => {
    const { run, node } = stand();
    const iona = reader(run);
    iona.skills = [];
    const hp = iona.stats.HP;
    const now = iona.currentHP;
    const result = chooseEventOption(run, node.id, 'read', { targetUid: iona.unitUid });
    expect(result.ok, result.reason).toBe(true);
    const learned = result.results.find((r) => r.kind === 'skill');
    expect(POOL).toContain(learned.skillId);
    expect(knowsSkill(iona, learned.skillId)).toBe(true);
    expect(iona.stats.HP).toBe(hp - 3);
    expect(iona.currentHP).toBe(now - 3);
    expect(result.results.find((r) => r.kind === 'stat')).toMatchObject({
      unit: 'Iona',
      stat: 'HP',
      value: -3,
    });
  });

  it('never teaches a skill the reader knows; the four skills are all reachable', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 80; seed++) {
      const { run, node } = stand({ seed });
      const iona = reader(run);
      iona.skills = ['drain'];
      const result = chooseEventOption(run, node.id, 'read', { targetUid: iona.unitUid });
      const learned = result.results.find((r) => r.kind === 'skill').skillId;
      expect(learned).not.toBe('drain');
      seen.add(learned);
    }
    expect([...seen].sort()).toEqual(['fiendish_blow', 'luna', 'wrath']);
  });

  it('a reader who knows all four learns nothing and loses nothing: the book lets them go', () => {
    const { run, node } = stand();
    const iona = reader(run);
    iona.skills = [...POOL];
    const hp = iona.stats.HP;
    const result = chooseEventOption(run, node.id, 'read', { targetUid: iona.unitUid });
    expect(result.ok, result.reason).toBe(true);
    expect(result.text).toContain('lets them go');
    expect(result.results).toEqual([]);
    expect(iona.stats.HP).toBe(hp);
  });

  it('at the skill cap the skill is benched, not lost', () => {
    const { run, node } = stand();
    const iona = reader(run);
    iona.skills = ['pavise', 'guard', 'vantage', 'cancel', 'adept']; // five equipped
    const result = chooseEventOption(run, node.id, 'read', { targetUid: iona.unitUid });
    expect(result.results.find((r) => r.kind === 'skill').benched).toBe(true);
    expect(iona.skills).toHaveLength(5);
  });

  it('burning it lifts 4 shadow; selling it pays 250 + 150 per act (550 G in Act II)', () => {
    const burn = stand();
    burn.run.eclipse = { ...burn.run.eclipse, shadow: 10 };
    expect(pick(burn.run, burn.node, 'burn').ok).toBe(true);
    expect(burn.run.eclipse.shadow).toBe(6);
    const sell = stand();
    const gold = sell.run.gold;
    expect(pick(sell.run, sell.node, 'sell').ok).toBe(true);
    expect(sell.run.gold - gold).toBe(550);
  });
});

// ── The Herald of the Hollow Sun ────────────────────────────────────────

describe('The Herald of the Hollow Sun', () => {
  const stand = (opts = {}) => {
    const run = army({ act: 1, ...opts });
    run.eclipse = { ...run.eclipse, shadow: 55 };
    return { run, node: at(run, 'hollow_herald') };
  };

  it("feeding the dark: +2 to the unit's best stat and +8 shadow", () => {
    const { run, node } = stand();
    const iona = run.roster.find((u) => u.name === 'Iona');
    iona.stats = { HP: 20, STR: 2, MAG: 12, SKL: 5, SPD: 6, DEF: 3, RES: 7, LCK: 4, MOV: 5 };
    const result = chooseEventOption(run, node.id, 'feed', { targetUid: iona.unitUid });
    expect(result.ok, result.reason).toBe(true);
    expect(result.results.find((r) => r.kind === 'stat')).toEqual({
      kind: 'stat',
      unit: 'Iona',
      stat: 'MAG',
      value: 2,
    });
    expect(iona.stats.MAG).toBe(14);
    expect(run.eclipse.shadow).toBe(63);
  });

  it('breaking the rite is a fight (+1 level) whose victory lifts 8 shadow', () => {
    const { run, node } = stand();
    const result = pick(run, node, 'break');
    expect(result.battle).toBe(true);
    expect(node.battleParams.eventEnemyLevelBonus).toBe(1);
    expect(run.completeBattle(run.getRoster(), node.id, 100, { turnCount: 5, turnPar: 5 })).toBe(true); // prettier-ignore
    const before = run.eclipse.shadow;
    const settled = completeEventBattle(run, node.id);
    expect(settled.ok, settled.reason).toBe(true);
    expect(before - run.eclipse.shadow).toBe(8);
    expect(settled.results.find((r) => r.kind === 'shadow').value).toBe(-8);
  });

  it('listening sets the flag and lifts 2 shadow; the finale remembers it on Black Sun only', () => {
    for (const [difficulty, plays] of [
      ['normal', false],
      ['hard', false],
      ['lunatic', true],
    ]) {
      const { run, node } = stand({ difficulty });
      const result = pick(run, node, 'listen');
      expect(result.ok, result.reason).toBe(true);
      expect(run.eclipse.shadow).toBe(53);
      expect(flagEntry(run.storyFlags, 'heard_herald')).toEqual({ value: true, act: 'act2' });
      expect(heraldHeard(run.storyFlags, run.difficultyId), difficulty).toBe(plays);
    }
  });

  it('refusing everything is impossible and nothing is a dead end: listening is always open', () => {
    const { run, node } = stand();
    expect(eventChoiceBlock(run, node.id, 'listen')).toBe('');
  });
});

// ── The Wandering Smith ─────────────────────────────────────────────────

describe('The Wandering Smith', () => {
  const stand = (opts = {}) => {
    const run = army(opts);
    return { run, node: at(run, 'wandering_smith') };
  };
  const wornSpare = (run, name = 'Brant') => {
    const unit = run.roster.find((u) => u.name === name);
    const [iron, hand] = unit.inventory;
    applyWear(iron, 'might');
    applyWear(hand, 'hit');
    applyWear(hand, 'crit');
    return { unit, iron, hand };
  };

  it('mending costs 100 + 50 per act (150 G) and repairs every worn step the unit carries', () => {
    const { run, node } = stand();
    const { unit, iron, hand } = wornSpare(run);
    expect(unit.weapon).toBe(iron);
    const gold = run.gold;
    const result = chooseEventOption(run, node.id, 'mend', { targetUid: unit.unitUid });
    expect(result.ok, result.reason).toBe(true);
    expect(gold - run.gold).toBe(150);
    expect([isWorn(iron), isWorn(hand)]).toEqual([false, false]);
    expect(result.results.find((r) => r.kind === 'mend').steps).toBe(3);
  });

  it('is greyed out when nothing anyone carries is worn, and when the purse is short', () => {
    const { run, node } = stand();
    expect(eventChoiceBlock(run, node.id, 'mend')).toBe('Nothing anyone carries is worn.');
    wornSpare(run);
    expect(eventChoiceBlock(run, node.id, 'mend')).toBe('');
    run.gold = 149;
    expect(eventChoiceBlock(run, node.id, 'mend')).toBe('Not enough gold.');
  });

  it('tempering goes well 7 times in 10 (6 in 10 on Nightfall and Black Sun)', () => {
    for (const [difficulty, good] of [
      ['normal', 0.7],
      ['dusk', 0.7],
      ['hard', 0.6],
      ['lunatic', 0.6],
    ]) {
      const counts = tally('wandering_smith', 'temper', { seeds: 200, difficulty });
      expect(Math.abs(counts.tempered / 200 - good), difficulty).toBeLessThan(0.11);
    }
  });

  it('well tempered: one free forge step; too hot: one wear step, never both', () => {
    let good = 0;
    let bad = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const { run, node } = stand({ seed });
      const unit = run.roster.find((u) => u.name === 'Brant');
      const gold = run.gold;
      const result = chooseEventOption(run, node.id, 'temper', { targetUid: unit.unitUid });
      expect(result.ok, result.reason).toBe(true);
      expect(run.gold).toBe(gold);
      if (result.outcomeId === 'tempered') {
        good++;
        expect(unit.weapon._forgeLevel).toBe(1);
        expect(isWorn(unit.weapon)).toBe(false);
        expect(result.results.map((r) => r.kind)).toEqual(['forge']);
      } else {
        bad++;
        expect(unit.weapon._forgeLevel || 0).toBe(0);
        expect(wearCount(unit.weapon)).toBe(1);
        expect(result.results.map((r) => r.kind)).toEqual(['wear']);
      }
    }
    expect(good).toBeGreaterThan(0);
    expect(bad).toBeGreaterThan(0);
  });

  it('too hot on a weapon that is already forged cannot wear it: the sparks burn the hand (15%)', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const { run, node } = stand({ seed });
      const unit = run.roster.find((u) => u.name === 'Brant');
      applyForge(unit.weapon, 'might'); // forged: it cannot wear
      unit.stats.HP = 20;
      unit.currentHP = 20;
      const result = chooseEventOption(run, node.id, 'temper', { targetUid: unit.unitUid });
      if (result.outcomeId !== 'too_hot') continue;
      expect(result.text).toContain('sparks find the hand');
      expect(isWorn(unit.weapon)).toBe(false);
      expect(unit.currentHP).toBe(17); // 15% of 20 = 3
      return;
    }
    throw new Error('never too hot in 120 seeds');
  });

  it('a staff cannot be tempered: the unit is greyed out with its reason', () => {
    const { run, node } = stand();
    const row = eventView(run, node.id)
      .choices.find((c) => c.id === 'temper')
      .target.candidates.find((c) => c.name === 'Mara');
    expect(row).toMatchObject({ ok: false, reason: 'Their weapon cannot take more.' });
  });

  it('leaving is free', () => {
    const { run, node } = stand();
    const gold = run.gold;
    expect(pick(run, node, 'leave')).toMatchObject({ ok: true, next: null });
    expect(run.gold).toBe(gold);
  });
});

// ── The Turncoat ────────────────────────────────────────────────────────

describe('The Turncoat', () => {
  const stand = (opts = {}) => {
    const run = army({ act: 1, ...opts });
    return { run, node: at(run, 'turncoat') };
  };

  it('below Black Sun a man taken in always joins: a Mercenary, Fighter or Archer', () => {
    for (const difficulty of ['normal', 'dusk', 'hard']) {
      const counts = tally('turncoat', 'take', { seeds: 50, difficulty, act: 1 });
      expect(counts.joined, difficulty).toBe(50);
      expect(counts.spy).toBeUndefined();
    }
    for (let seed = 1; seed <= 30; seed++) {
      const { run, node } = stand({ seed });
      const before = run.roster.length;
      const result = pick(run, node, 'take');
      expect(run.roster).toHaveLength(before + 1);
      const joined = run.roster.at(-1);
      expect(['Mercenary', 'Fighter', 'Archer']).toContain(joined.className);
      expect(result.results.find((r) => r.kind === 'join')).toMatchObject({ name: joined.name, className: joined.className }); // prettier-ignore
      expect(joined.level).toBeGreaterThanOrEqual(3); // never behind an army of level 3s
      expect(run.burdens).toEqual([]);
    }
  });

  it('on Black Sun about 35% are spies: no one joins, Hunted starts (the hint says it honestly)', () => {
    const counts = tally('turncoat', 'take', { seeds: 240, difficulty: 'lunatic', act: 1 });
    expect(counts.spy / 240).toBeGreaterThan(0.27);
    expect(counts.spy / 240).toBeLessThan(0.43);
    expect(eventDef('turncoat').choices.find((c) => c.id === 'take').hint).toContain(
      'changed sides once',
    );
    for (let seed = 1; seed <= 80; seed++) {
      const { run, node } = stand({ seed, difficulty: 'lunatic' });
      const before = run.roster.length;
      const result = pick(run, node, 'take');
      if (result.outcomeId !== 'spy') continue;
      expect(run.roster).toHaveLength(before); // no one joined
      expect(run.burdens.map((b) => b.id)).toEqual(['hunted']);
      // Black Sun's Hunted: a wave of 2-3, for 2 battles (data/events.json burdens.hunted onRung).
      expect(run.burdens[0].battles).toBe(2);
      expect(run.burdens[0].wave.count).toEqual([2, 3]);
      return;
    }
    throw new Error('no spy in 80 seeds');
  });

  it('sending him off costs nothing and joins no one', () => {
    const { run, node } = stand();
    const before = run.roster.length;
    const gold = run.gold;
    expect(pick(run, node, 'send')).toMatchObject({ ok: true, next: null });
    expect(run.roster).toHaveLength(before);
    expect(run.gold).toBe(gold);
  });
});

// ── Black Sun's other lying stranger: the Twin Altar's Dawn ─────────────

describe('The Twin Altar on Black Sun', () => {
  it('the Dawn answers with an Ill Omen about a quarter of the time on Black Sun, never below', () => {
    const lunatic = tally('twin_altar', 'dawn', { seeds: 300, difficulty: 'lunatic' });
    expect(lunatic.omen / 300).toBeGreaterThan(0.17);
    expect(lunatic.omen / 300).toBeLessThan(0.33);
    expect(lunatic.answered / 300).toBeGreaterThan(0.5);
    for (const difficulty of ['normal', 'dusk', 'hard']) {
      const counts = tally('twin_altar', 'dawn', { seeds: 80, difficulty });
      expect(counts.omen, difficulty).toBeUndefined();
      expect(counts.answered + counts.silence).toBe(80);
    }
  });

  it('the omen leaves the burden and the hint on the choice is honest about it', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const run = army({ seed, difficulty: 'lunatic' });
      const node = at(run, 'twin_altar');
      const result = pick(run, node, 'dawn');
      if (result.outcomeId !== 'omen') continue;
      expect(run.burdens.map((b) => b.id)).toEqual(['ill_omen']);
      expect(result.results.find((r) => r.kind === 'blessing')).toBeUndefined();
      expect(eventDef('twin_altar').choices.find((c) => c.id === 'dawn').hint).toContain(
        'or to mean it',
      );
      return;
    }
    throw new Error('no omen in 100 seeds');
  });
});

// ── The payoffs ─────────────────────────────────────────────────────────

describe('Old Faces', () => {
  const stand = (opts = {}) => {
    const run = army({ act: 1, ...opts });
    run.storyFlags = { spared_deserters: { value: true, act: 'act1' } };
    return { run, node: at(run, 'old_faces') };
  };

  it('riding to his side is a fight with a green deserter in it, and nothing is paid', () => {
    const { run, node } = stand();
    const gold = run.gold;
    const result = pick(run, node, 'ride');
    expect(result.battle).toBe(true);
    expect(run.gold).toBe(gold);
    const preview = node.recruitPreview;
    expect(['Mercenary', 'Soldier', 'Fighter', 'Archer']).toContain(preview.className);
    const params = run.getBattleParams(node);
    expect(params.isRecruitBattle).toBe(true);
    expect(params.recruitPreview).toMatchObject({
      className: preview.className,
      name: preview.name,
    });
  });

  it('if he is Talked into the army he joins the roster, and the spoils (80 + 40 per act) are paid', () => {
    const { run, node } = stand();
    pick(run, node, 'ride');
    const npc = run.getRecruitNodeUnit(node).unit;
    run.assignUnitUid(npc);
    npc.faction = 'player';
    const before = run.gold;
    const settled = winFight(run, node, { units: [...run.getRoster(), npc] });
    expect(run.roster.map((u) => u.name)).toContain(node.recruitPreview.name);
    expect(settled.results.find((r) => r.kind === 'gold').value).toBe(160); // 80 + 40 x 2
    expect(run.gold).toBeGreaterThan(before + 160);
  });

  it('if the fight is won without him he is simply not in the army', () => {
    const { run, node } = stand();
    pick(run, node, 'ride');
    winFight(run, node);
    expect(run.roster.map((u) => u.name)).not.toContain(node.recruitPreview.name);
  });

  it('tossing coin costs 100 + 50 per act (200 G) and lifts 3 shadow; waving on costs nothing', () => {
    const toss = stand();
    toss.run.eclipse = { ...toss.run.eclipse, shadow: 10 };
    const gold = toss.run.gold;
    expect(pick(toss.run, toss.node, 'coin').ok).toBe(true);
    expect(gold - toss.run.gold).toBe(200);
    expect(toss.run.eclipse.shadow).toBe(7);
    const wave = stand();
    const before = wave.run.gold;
    expect(pick(wave.run, wave.node, 'wave')).toMatchObject({ ok: true, next: null });
    expect(wave.run.gold).toBe(before);
  });
});

describe("The Deserters' Revenge", () => {
  const stand = (opts = {}) => {
    const run = army({ act: 1, ...opts });
    run.storyFlags = { reported_deserters: { value: true, act: 'act1' } };
    return { run, node: at(run, 'deserters_revenge') };
  };

  it('standing and fighting is a fight one level harder, paying 250 + 150 per act (550 G in Act II)', () => {
    const { run, node } = stand();
    const result = pick(run, node, 'fight');
    expect(result.battle).toBe(true);
    expect(node.battleParams.eventEnemyLevelBonus).toBe(1);
    const settled = winFight(run, node);
    expect(settled.results.find((r) => r.kind === 'gold').value).toBe(550);
  });

  it('repaying costs 200 + 100 per act (400 G) and lifts 2 shadow', () => {
    const { run, node } = stand();
    run.eclipse = { ...run.eclipse, shadow: 10 };
    const gold = run.gold;
    expect(pick(run, node, 'repay').ok).toBe(true);
    expect(gold - run.gold).toBe(400);
    expect(run.eclipse.shadow).toBe(8);
  });

  it("slipping away costs 15% of everyone's health and no gold", () => {
    const { run, node } = stand();
    for (const u of run.roster) {
      u.stats.HP = 20;
      u.currentHP = 20;
    }
    const gold = run.gold;
    expect(pick(run, node, 'slip').ok).toBe(true);
    expect(run.roster.every((u) => u.currentHP === 17)).toBe(true);
    expect(run.gold).toBe(gold);
  });
});

describe('The Collectors', () => {
  const stand = (opts = {}) => {
    const run = army({ act: 1, ...opts });
    run.storyFlags = { robbed_lender: { value: true, act: 'act1' } };
    return { run, node: at(run, 'collectors') };
  };

  it('paying costs 400 + 200 per act (800 G in Act II; 1000 on Nightfall) and settles it', () => {
    for (const [difficulty, cost] of [
      ['normal', 800],
      ['hard', 1000],
    ]) {
      const { run, node } = stand({ difficulty });
      const gold = run.gold;
      const result = pick(run, node, 'pay');
      expect(result.ok, result.reason).toBe(true);
      expect(gold - run.gold).toBe(cost);
      expect(run.burdens).toEqual([]);
    }
  });

  it('fighting is an ELITE battle one level harder, paying 300 + 150 per act (600 G in Act II)', () => {
    const { run, node } = stand();
    const result = pick(run, node, 'fight');
    expect(result.battle).toBe(true);
    expect(node.battleParams).toMatchObject({ isElite: true, eventEnemyLevelBonus: 1 });
    const settled = winFight(run, node);
    expect(settled.results.find((r) => r.kind === 'gold').value).toBe(600);
  });

  it('slipping away puts a Debt of 500 + 250 per act (1000 G in Act II) on the army', () => {
    const { run, node } = stand();
    expect(pick(run, node, 'slip').ok).toBe(true);
    expect(run.burdens).toMatchObject([{ id: 'debt', owed: 1000 }]);
  });

  it('with too little gold the payment is greyed, and the other two ways stay open', () => {
    const { run, node } = stand();
    run.gold = 799;
    expect(eventChoiceBlock(run, node.id, 'pay')).toBe('Not enough gold.');
    expect(eventChoiceBlock(run, node.id, 'fight')).toBe('');
    expect(eventChoiceBlock(run, node.id, 'slip')).toBe('');
  });
});

describe('every one of them can be played to the end and left', () => {
  it('each first-page choice resolves on a stocked army, and the node can then be left or fought', () => {
    const FLAGS = {
      old_faces: 'spared_deserters',
      deserters_revenge: 'reported_deserters',
      collectors: 'robbed_lender',
      bad_map: 'robbed_cartographer',
    };
    for (const id of NEW_EVENTS)
      for (const first of eventDef(id).choices) {
        const run = army({ act: 1, worn: true });
        run.eclipse = { ...run.eclipse, shadow: 55 };
        if (FLAGS[id]) run.storyFlags = { [FLAGS[id]]: { value: true, act: 'act1' } };
        const node = at(run, id);
        const result = pick(run, node, first.id);
        expect(result.ok, `${id}.${first.id}: ${result.reason}`).toBe(true);
        if (result.next) continue; // a page deeper: the pages are walked in tests/EventEveryChoice.test.js
        if (result.battle) {
          expect(run.completeBattle(run.getRoster(), node.id, 100, { turnCount: 4, turnPar: 5 })).toBe(true); // prettier-ignore
          expect(completeEventBattle(run, node.id).ok).toBe(true);
        }
        expect(leaveEvent(run, node.id).ok, `${id}.${first.id}`).toBe(true);
        expect(node.completed).toBe(true);
      }
  });

  it('an event seen once is not met again in the run', () => {
    const run = army({ act: 1 });
    const node = at(run, 'wandering_smith');
    pick(run, node, 'leave');
    leaveEvent(run, node.id);
    const other = run.nodeMap.nodes.find((n) => n.row === 4 && !n.completed);
    expect(eligibleEvents(run, other, catalog).map((e) => e.id)).not.toContain('wandering_smith');
  });

  it('arriving through the real pick (not arriveAs) can land on each new event', () => {
    // Over many seeded arrivals every new event is picked at least once somewhere in its acts.
    const landed = new Set();
    for (let seed = 1; seed <= 900 && landed.size < NEW_EVENTS.length; seed++) {
      for (const act of [0, 1, 2, 3]) {
        const run = army({ seed, act });
        run.eclipse = { ...run.eclipse, shadow: 55 };
        run.storyFlags = {
          spared_deserters: { value: true, act: 'act0' },
          reported_deserters: { value: true, act: 'act0' },
          robbed_lender: { value: true, act: 'act0' },
          robbed_cartographer: { value: true, act: 'act0' },
        };
        const node = eventNode(run);
        const state = arriveAtEvent(run, node.id);
        if (NEW_EVENTS.includes(state.eventId)) landed.add(state.eventId);
        expect(eventState(run, node.id).eventId).toBe(state.eventId);
      }
    }
    expect([...landed].sort()).toEqual([...NEW_EVENTS].sort());
  });
});

void flagValue;
