// Roster tells (docs/specs/event-nodes-phase2.md §2A): a unit who knows better speaks under a
// choice and reveals one hidden outcome, or tilts a check.
//
// Ways this goes wrong:
//   - a tell shows with nobody matching, for a unit that is fallen or at 0 HP, or the wrong
//     unit speaks (a lord when anyone else matches);
//   - the speaker changes on refresh (the voice is seeded from the run, the node and the page);
//   - the view leaks what a tell reveals or tilts (the UI would then draw an odds line), or a
//     number;
//   - a tilting tell does not change the check, changes it when its speaker is absent, tilts by the
//     wrong amount or twice;
//   - tells keep showing once the choice is made.
// The tilt is tested seed by seed against the documented key and chance (0.5 + 0.1 band).
import { describe, expect, it } from 'vitest';
import { arriveAtEvent, chooseEventOption, eventView } from '../src/engine/EventCommands.js';
import { choiceTells, tellMatches, tellTilt, TELL_TILT } from '../src/engine/EventTells.js';
import { eventRng } from '../src/engine/EventSystem.js';
import { addUnit, eventNode, fallAlly, runWithEvents } from './eventKit.js';
import { roundTrip } from './eventPhase2Kit.js';

const trapEvent = () => ({
  id: 'trap',
  title: 'The Trap',
  weight: 1,
  intro: 'A corridor, too tidy.',
  choices: [
    {
      id: 'search',
      label: 'Search',
      tells: [
        { when: { class: 'Thief' }, line: '{name}: That is a tripwire.', reveals: 'tripwire' },
        {
          when: { classes: ['Archer', 'Sniper'] },
          line: '{name}: Someone watches the door.',
          reveals: 'cache',
        },
        { when: { weaponType: 'Axe' }, line: '{name}: Good wall for an axe.', reveals: 'cache' },
        { when: { trait: 'hardy' }, line: '{name}: I have had worse.', reveals: 'cache' },
        { when: { skill: 'vantage' }, line: '{name}: High ground.', reveals: 'cache' },
      ],
      outcomes: [
        { id: 'cache', weight: 55, text: 'A cache.', effects: [] },
        { id: 'tripwire', weight: 45, text: 'A wire.', effects: [] },
      ],
    },
    {
      id: 'bluff',
      label: 'Bluff',
      check: {
        stats: ['LCK'],
        of: 'bestInArmy',
        base: 0.5,
        perPoint: 0,
        against: 0,
        min: 0.05,
        max: 0.95,
      },
      tells: [{ when: { class: 'Thief' }, line: '{name}: Let me do the talking.', tilts: 'pass' }],
      outcomes: [
        { id: 'pass', text: 'They wave you through.', effects: [] },
        { id: 'fail', text: 'They do not.', effects: [] },
      ],
    },
    {
      id: 'leave',
      label: 'Leave',
      outcomes: [{ id: 'gone', weight: 100, text: 'Gone.', effects: [] }],
    },
  ],
});

function standAt(options = {}) {
  const run = runWithEvents([trapEvent()], options);
  const node = eventNode(run);
  expect(arriveAtEvent(run, node.id).eventId).toBe('trap');
  return { run, node };
}

const tellsOf = (run, nodeId, choiceId = 'search') =>
  eventView(run, nodeId).choices.find((c) => c.id === choiceId).tells;

describe('who speaks', () => {
  it('nobody matching: no tell; a Thief on the roster: one tell, in their name', () => {
    const { run, node } = standAt();
    expect(tellsOf(run, node.id)).toEqual([]);
    const thief = addUnit(run, 'Thief', { name: 'Wick' });
    const tells = tellsOf(run, node.id);
    expect(tells).toEqual([
      { speaker: { uid: thief.unitUid, name: 'Wick' }, line: 'Wick: That is a tripwire.' },
    ]);
  });

  it('the view gives the UI only the speaker and the line (no outcome, no odds)', () => {
    const { run, node } = standAt();
    addUnit(run, 'Thief', { name: 'Wick' });
    addUnit(run, 'Archer', { name: 'Hale' });
    for (const tell of tellsOf(run, node.id)) {
      expect(Object.keys(tell).sort()).toEqual(['line', 'speaker']);
      expect(Object.keys(tell.speaker).sort()).toEqual(['name', 'uid']);
      expect(tell.line).not.toMatch(/\d/);
    }
    expect(tellsOf(run, node.id, 'bluff')[0]).toEqual({
      speaker: expect.objectContaining({ name: 'Wick' }),
      line: 'Wick: Let me do the talking.',
    });
    expect(tellsOf(run, node.id, 'leave')).toEqual([]);
  });

  it('each `when` key matches: class, classes, weaponType, trait and skill (equipped or benched)', () => {
    const { run, node } = standAt();
    const lines = () => tellsOf(run, node.id).map((t) => t.line);
    expect(lines()).toEqual([]);
    addUnit(run, 'Archer', { name: 'Hale' });
    expect(lines()).toEqual(['Hale: Someone watches the door.']); // classes
    addUnit(run, 'Fighter', { name: 'Brant' });
    expect(lines()).toContain('Brant: Good wall for an axe.'); // weaponType
    const cleric = addUnit(run, 'Cleric', { name: 'Mara' });
    expect(lines()).not.toContain('Mara: I have had worse.');
    cleric.traits = ['hardy'];
    expect(lines()).toContain('Mara: I have had worse.'); // trait
    const kay = addUnit(run, 'Myrmidon', { name: 'Kay' });
    expect(lines()).not.toContain('Kay: High ground.');
    kay.skills = ['vantage'];
    expect(lines()).toContain('Kay: High ground.'); // skill, equipped
    kay.skills = [];
    kay.benchedSkills = ['vantage'];
    expect(lines()).toContain('Kay: High ground.'); // skill, benched
    kay.benchedSkills = [];
    expect(lines()).not.toContain('Kay: High ground.');
  });

  it('only the living speak: a fallen ally and a unit at 0 HP stay silent', () => {
    const { run, node } = standAt();
    const hale = addUnit(run, 'Archer', { name: 'Hale' });
    const thief = addUnit(run, 'Thief', { name: 'Wick' });
    fallAlly(run, hale);
    expect(tellsOf(run, node.id).map((t) => t.speaker.name)).toEqual(['Wick']);
    thief.currentHP = 0;
    expect(tellsOf(run, node.id)).toEqual([]);
  });

  it('lords last: a lord speaks only when no one else matches', () => {
    const { run, node } = standAt();
    const swordTell = {
      when: { weaponType: 'Sword' },
      line: '{name}: Steel rings.',
      reveals: 'cache',
    };
    const choice = { id: 'search', tells: [swordTell] };
    const lords = new Set(run.roster.filter((u) => u.isLord).map((u) => u.name));
    expect(lords.has('Edric')).toBe(true);
    // Edric (a lord) and Gaspar both wield a sword: Gaspar always speaks, Edric never
    const speakers = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      run.runSeed = seed;
      for (const tell of choiceTells(run, node.id, 'start', choice))
        speakers.add(tell.speaker.name);
    }
    expect([...speakers]).toEqual(['Gaspar']);
    // Only lords match: the lord speaks
    const lordTell = {
      id: 'search',
      tells: [{ when: { class: 'Lord' }, line: '{name}: Mine.', reveals: 'cache' }],
    };
    expect(choiceTells(run, node.id, 'start', lordTell)[0].speaker.name).toBe('Edric');
  });

  it('is seeded: the same voice on every view, after a reload, and a spread across seeds', () => {
    const { run, node } = standAt({ seed: 17 });
    addUnit(run, 'Archer', { name: 'Hale' });
    addUnit(run, 'Archer', { name: 'Finn' });
    const first = tellsOf(run, node.id);
    expect(tellsOf(run, node.id)).toEqual(first);
    expect(tellsOf(roundTrip(run), node.id)).toEqual(first);
    const voices = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const r = standAt({ seed });
      addUnit(r.run, 'Archer', { name: 'Hale' });
      addUnit(r.run, 'Archer', { name: 'Finn' });
      voices.add(tellsOf(r.run, r.node.id)[0].speaker.name);
    }
    expect([...voices].sort()).toEqual(['Finn', 'Hale']);
  });

  it('tells stop once the choice is made (the outcome page has none)', () => {
    const { run, node } = standAt();
    addUnit(run, 'Thief', { name: 'Wick' });
    expect(chooseEventOption(run, node.id, 'leave').ok).toBe(true);
    for (const choice of eventView(run, node.id).choices) expect(choice.tells).toEqual([]);
  });

  it('tellMatches: one key, an exact match', () => {
    const unit = {
      className: 'Thief',
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      traits: ['hardy'],
      skills: ['vantage'],
    };
    expect(tellMatches(unit, { class: 'Thief' })).toBe(true);
    expect(tellMatches(unit, { class: 'Archer' })).toBe(false);
    expect(tellMatches(unit, { classes: ['Archer', 'Thief'] })).toBe(true);
    expect(tellMatches(unit, { weaponType: 'Sword' })).toBe(true);
    expect(tellMatches(unit, { weaponType: 'Bow' })).toBe(false);
    expect(tellMatches(unit, { trait: 'hardy' })).toBe(true);
    expect(tellMatches(unit, { skill: 'vantage' })).toBe(true);
    expect(tellMatches(unit, {})).toBe(false);
    expect(tellMatches(null, { class: 'Thief' })).toBe(false);
  });
});

describe('a tilting tell', () => {
  /** Outcome of the bluff on a run of this seed, with or without a Thief aboard. */
  const bluff = (seed, withThief) => {
    const { run, node } = standAt({ seed });
    if (withThief) addUnit(run, 'Thief', { name: 'Wick' });
    const roll = eventRng(`event:${run.runSeed}:${node.id}:bluff`)();
    return { roll, outcome: chooseEventOption(run, node.id, 'bluff').outcomeId };
  };

  it('raises the chance of passing by 0.1 only while its speaker is aboard: seed by seed', () => {
    // chance 0.5 without the Thief, 0.6 with; a roll in [0.5, 0.6) is the band that changes
    let band = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const without = bluff(seed, false);
      const withThief = bluff(seed, true);
      expect(without.roll).toBe(withThief.roll); // the Thief changes the odds, never the dice
      expect(without.outcome).toBe(without.roll < 0.5 ? 'pass' : 'fail');
      expect(withThief.outcome).toBe(withThief.roll < 0.6 ? 'pass' : 'fail');
      if (without.roll >= 0.5 && without.roll < 0.6) band++;
    }
    expect(band).toBeGreaterThan(5);
  });

  it('tellTilt is TELL_TILT once, however many tilting tells speak', () => {
    expect(TELL_TILT).toBe(0.1);
    expect(tellTilt([])).toBe(0);
    expect(tellTilt([{ tilts: null }, { reveals: 'x' }])).toBe(0);
    expect(tellTilt([{ tilts: 'pass' }])).toBe(0.1);
    expect(tellTilt([{ tilts: 'pass' }, { tilts: 'pass' }])).toBe(0.1);
  });

  it('a revealing tell on a plain choice changes no odds (the outcome is the weighted roll)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const a = standAt({ seed });
      const b = standAt({ seed });
      addUnit(b.run, 'Thief', { name: 'Wick' });
      expect(chooseEventOption(b.run, b.node.id, 'search').outcomeId).toBe(
        chooseEventOption(a.run, a.node.id, 'search').outcomeId,
      );
    }
  });
});
