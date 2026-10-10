// The Event page's Phase 2 surfaces (docs/specs/event-nodes-phase2.md §2E), played through the real
// EventController and EventMenu with the rendering-only presentation (tests/harness/EventDriver.js).
// The engine decides; these hold the page to what it must show of pages, counters, tells and the
// new result kinds. Events are plain fixtures (tests/eventPhase2Kit.js); no shipped content.
//
// Ways this can fail, a test (or a group) each:
//   1. a step's news is only behind the closed toggle, or an older step is shown open by default;
//   2. a refresh shows the step as "just now" again, drops a step, or opens the toggle;
//   3. a stale tap (the page moved on) is taken as a step of the new page, or leaves the picker
//      stuck on a choice that is gone;
//   4. the counters on the page differ from the event's, or a spent torch is not lit off;
//   5. a tell shows under the wrong choice, with the wrong face, after the choice is made, or for
//      a roster that has no one who could speak;
//   6. a new result kind (counter, join, contract, route, note) draws no line, the wrong chip, or
//      says a number the run does not have;
//   7. a route edit is not handed to the route map to show;
//   8. any page of any shipped event (every page, its dark face, every outcome) reads "undefined".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { JourneyStorage } from './harness/RunDriver.js';
import { EventDriver, nodeText } from './harness/EventDriver.js';
import { chooseEventOption, eventView } from '../src/engine/EventCommands.js';
import { PAGE_MOVED_ON_LINE } from '../src/ui/eventMenuModel.js';
import { addUnit, arriveAs, baseData, newRun, runWithEvents } from './eventKit.js';
import { contractEvent } from './eventPhase2Kit.js';

vi.mock('../src/ui/MobileRosterSheet.js', () => ({
  MobileRosterSheet: class {
    constructor(options) {
      Object.assign(this, options);
    }
    destroy() {}
  },
}));
// A face is decoration: here it is a node that says whose it is.
vi.mock('../src/ui/unitPortrait.js', async () => {
  const { element: node } = await import('./harness/JourneyPresentation.js');
  return {
    unitPortrait: (scene, gameData, unit, className) => {
      const face = node('img', '', className);
      face.dataset.face = unit.name;
      return face;
    },
    withUnitFace: (row) => row,
  };
});

let storage;
beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { activeElement: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const has = (n, cls) => n.classList?.contains(cls);
const byClass = (d, cls) => d.body.all().filter((n) => has(n, cls));
const textOf = (n) =>
  n
    .all()
    .map((x) => x.textContent)
    .filter(Boolean)
    .join(' | ');

/**
 * A three-level mine with no dice (every outcome is certain): torches 3 (Black Sun 2), "Go deeper"
 * spends one, the last level ends the event. Written out so each step's words are known by hand.
 */
const deepMine = () => {
  const needTorch = {
    counterAtLeast: { key: 'torches', n: 1 },
    reason: 'The last torch is gone.',
  };
  const torch = [{ type: 'counter', key: 'torches', delta: -1 }];
  const out = (text, effects = []) => ({
    id: 'climb',
    label: 'Climb out',
    outcomes: [{ id: 'out', weight: 100, text, effects }],
  });
  return {
    id: 'mine',
    title: 'The Mine',
    weight: 1,
    intro: 'A shaft, a rope and three torches.',
    counters: { torches: 3 },
    countersByRung: { torches: { lunatic: 2 } },
    counterLabels: { torches: 'Torches' },
    choices: [
      {
        id: 'deeper',
        label: 'Go deeper',
        requires: needTorch,
        effects: torch,
        outcomes: [
          {
            id: 'ore',
            weight: 100,
            text: 'Ore, glinting.',
            next: 'level_two',
            effects: [{ type: 'gold', value: 10 }],
          },
        ],
      },
      out('Daylight.'),
    ],
    pages: {
      level_two: {
        text: 'The tunnel narrows.',
        choices: [
          {
            id: 'deeper',
            label: 'Deeper still',
            requires: needTorch,
            effects: torch,
            outcomes: [
              {
                id: 'chest',
                weight: 100,
                text: 'An old pay chest.',
                next: 'level_three',
                effects: [{ type: 'gold', value: 100 }],
              },
            ],
          },
          out('Daylight, with a coin.', [{ type: 'gold', value: 5 }]),
        ],
      },
      level_three: {
        text: 'Something sleeps here.',
        choices: [
          {
            id: 'take',
            label: 'Take the hoard and run',
            outcomes: [{ id: 'hoard', weight: 100, text: 'It does not wake.', effects: [] }],
          },
          out('You leave it be.'),
        ],
      },
    },
  };
};

/** The mine, standing at its node with the page open. */
function mine({ seed = 101, difficulty = 'normal', extra = null } = {}) {
  const run = runWithEvents([extra ? extra(deepMine()) : deepMine()], { seed, difficulty });
  const d = new EventDriver({ run, eventId: 'mine' });
  d.open();
  return d;
}

describe('counters', () => {
  it('say what is left: "Torches 3/3", three lit pips and a spoken line', () => {
    const d = mine();
    const [torches] = byClass(d, 'ev-counter');
    expect(torches.dataset.counter).toBe('torches');
    expect(torches.attributes['aria-label']).toBe('Torches: 3 of 3');
    expect(textOf(torches)).toContain('Torches 3/3');
    const pips = byClass(d, 'ev-pip');
    expect(pips).toHaveLength(3);
    expect(pips.every((p) => has(p, 'is-lit'))).toBe(true);
  });

  it('a spent torch goes dark, on the next page, and the page matches the saved event', () => {
    const d = mine();
    d.choose('deeper');
    const pips = byClass(d, 'ev-pip');
    expect(pips.map((p) => has(p, 'is-lit'))).toEqual([true, true, false]);
    expect(byClass(d, 'ev-counter')[0].attributes['aria-label']).toBe('Torches: 2 of 3');
    expect(d.saved().eventStateByNodeId[d.node.id].counters).toEqual({ torches: 2 });
  });

  it('Black Sun starts with two (the rung is fixed on arrival), and a spent counter reads empty', () => {
    // A level-three choice that also needs a torch, so the greyed choice can be seen on a page.
    const d = mine({
      difficulty: 'lunatic',
      extra: (event) => {
        event.pages.level_three.choices.unshift({
          ...event.pages.level_two.choices[0],
          outcomes: [
            { id: 'dark', weight: 100, text: 'Darkness.', next: 'level_three', effects: [] },
          ],
        });
        return event;
      },
    });
    expect(byClass(d, 'ev-pip')).toHaveLength(2);
    d.choose('deeper');
    d.choose('deeper');
    const [torches] = byClass(d, 'ev-counter');
    expect(torches.attributes['aria-label']).toBe('Torches: 0 of 2');
    expect(has(torches, 'is-empty')).toBe(true);
    // The engine greys the choice that needs a torch, with its own reason.
    expect(d.choice('deeper').disabled).toBe(true);
    expect(nodeText(d.choice('deeper'))).toContain('The last torch is gone.');
  });

  it('a counter with many points is a number alone (no row of pips), and an event with none shows none', () => {
    const d = mine({
      extra: (event) => ({ ...event, counters: { torches: 12 }, countersByRung: undefined }),
    });
    expect(byClass(d, 'ev-pip')).toHaveLength(0);
    expect(textOf(byClass(d, 'ev-counter')[0])).toContain('Torches 12/12');
    const plain = new EventDriver({ run: newRun({ gold: 500 }), eventId: 'drill_yard' });
    plain.open();
    expect(byClass(plain, 'ev-counter')).toHaveLength(0);
  });
});

describe('the steps behind a page', () => {
  it('the step just taken is told in full above the new page, with its results; no toggle yet', () => {
    const d = mine();
    d.choose('deeper');
    expect(d.text()).toContain('The tunnel narrows.');
    const [recent] = byClass(d, 'ev-recent');
    const words = textOf(recent);
    expect(words).toContain('Just now');
    expect(words).toContain('You chose: Go deeper');
    expect(words).toContain('Ore, glinting.');
    // The spent torch is a result line (its news is never only a tap away).
    const kinds = recent.all().filter((n) => has(n, 'ev-result')).map((n) => n.dataset.kind); // prettier-ignore
    expect(kinds).toEqual(['counter', 'gold']);
    expect(words).toContain('Torches −1');
    expect(words).toContain('2 left');
    expect(byClass(d, 'ev-trail-toggle')).toHaveLength(0);
  });

  it('a second step puts the first behind a closed toggle; opening it shows the step in words', () => {
    const d = mine();
    d.choose('deeper');
    d.choose('deeper'); // "Deeper still" on page two
    expect(d.text()).toContain('Something sleeps here.');
    expect(textOf(byClass(d, 'ev-recent')[0])).toContain('An old pay chest.');
    const [toggle] = byClass(d, 'ev-trail-toggle');
    expect(textOf(toggle)).toContain('Earlier on this road · 1 step');
    expect(toggle.attributes['aria-expanded']).toBe('false');
    expect(byClass(d, 'ev-step')).toHaveLength(0);
    d.press(toggle);
    expect(byClass(d, 'ev-trail-toggle')[0].attributes['aria-expanded']).toBe('true');
    const [step] = byClass(d, 'ev-step');
    expect(textOf(step)).toContain('You chose: Go deeper');
    expect(textOf(step)).toContain('Ore, glinting.');
    expect(textOf(step)).toContain('Gained 10 G');
    // Closing it again hides the step.
    d.press(byClass(d, 'ev-trail-toggle')[0]);
    expect(byClass(d, 'ev-step')).toHaveLength(0);
  });

  it('a new step collapses an open toggle (collapsed by default on every page)', () => {
    const d = mine();
    d.choose('deeper');
    d.choose('deeper');
    d.press(byClass(d, 'ev-trail-toggle')[0]);
    expect(byClass(d, 'ev-step')).toHaveLength(1);
    d.choose('take'); // the last page's choice ends the event
    expect(textOf(byClass(d, 'ev-trail-toggle')[0])).toContain('2 steps');
    expect(byClass(d, 'ev-step')).toHaveLength(0);
  });

  it('the final outcome keeps the trail above it; the choices are gone and Continue is the way on', () => {
    const d = mine();
    d.choose('deeper');
    d.choose('deeper');
    d.choose('take');
    expect(d.text()).toContain('You chose: Take the hoard and run');
    expect(textOf(byClass(d, 'ev-trail-toggle')[0])).toContain('Earlier on this road · 2 steps');
    expect(byClass(d, 'ev-recent')).toHaveLength(0);
    expect(d.choice('take')).toBeUndefined();
    expect(d.button('Continue')).toBeTruthy();
  });

  it('a refresh reopens the same page with every step behind the closed toggle, nothing re-rolled', () => {
    const d = mine();
    d.choose('deeper');
    d.choose('deeper');
    const before = d.saved().eventStateByNodeId[d.node.id];
    d.reload();
    d.open();
    expect(d.text()).toContain('Something sleeps here.');
    expect(byClass(d, 'ev-recent')).toHaveLength(0);
    expect(textOf(byClass(d, 'ev-trail-toggle')[0])).toContain('Earlier on this road · 2 steps');
    expect(byClass(d, 'ev-trail-toggle')[0].attributes['aria-expanded']).toBe('false');
    expect(d.saved().eventStateByNodeId[d.node.id]).toEqual(before);
    d.press(byClass(d, 'ev-trail-toggle')[0]);
    expect(byClass(d, 'ev-step')).toHaveLength(2);
  });

  it('a choice carries the page it was shown on, and the engine sees it', () => {
    const d = mine();
    const seen = [];
    const original = d.menu.commit.bind(d.menu);
    d.menu.commit = (choice, target, page) => {
      seen.push(page);
      return original(choice, target, page);
    };
    d.choose('deeper'); // page one
    d.choose('deeper'); // page two: a choice with the same id
    expect(seen).toEqual(['start', 'level_two']);
  });

  it('a stale tap (the page moved on) is not taken twice: the picker closes, the page is re-read', () => {
    const d = mine();
    d.press(d.choice('deeper'));
    const stale = d.picker.apply; // the confirmation of page one, still open
    d.confirm(0); // the step is taken; the event is on page two
    expect(eventView(d.run, d.node.id).page).toBe('level_two');
    const torches = d.saved().eventStateByNodeId[d.node.id].counters;
    // The second activation of the same confirmation: refused by the engine, never a second step.
    const result = stale(d.picker?.choices?.[0] ?? { id: 'deeper' });
    expect(result).toMatchObject({ ok: true, movedOn: true });
    expect(d.menu.status).toBe(PAGE_MOVED_ON_LINE);
    expect(eventView(d.run, d.node.id).page).toBe('level_two');
    expect(d.saved().eventStateByNodeId[d.node.id].counters).toEqual(torches);
    expect(d.run.eventLog).toHaveLength(1);
  });

  it('a refusal that is not a moved page stays a refusal (the picker shows the reason)', () => {
    const d = mine();
    d.press(d.choice('deeper'));
    d.run.gold = 0;
    const result = d.picker.apply(d.picker.choices[0]);
    expect(result.ok).toBe(true); // a free choice; nothing refuses it
    const run = newRun({ gold: 250 });
    const paid = new EventDriver({ run, eventId: 'twin_altar' });
    paid.open();
    paid.press(paid.choice('dawn'));
    run.gold = 20;
    expect(paid.picker.apply(paid.picker.choices[0])).toEqual({
      ok: false,
      reason: 'Not enough gold.',
    });
  });
});

describe('tells under a choice', () => {
  const trap = (tells) => ({
    id: 'trap',
    title: 'The Trap',
    weight: 1,
    intro: 'A corridor, too tidy.',
    choices: [
      {
        id: 'search',
        label: 'Search',
        tells,
        outcomes: [{ id: 'cache', weight: 100, text: 'A cache.', effects: [] }],
      },
      {
        id: 'leave',
        label: 'Leave',
        outcomes: [{ id: 'gone', weight: 100, text: 'Gone.', effects: [] }],
      },
    ],
  });
  const stand = (tells, units = []) => {
    const run = runWithEvents([trap(tells)], { seed: 101 });
    for (const [className, name] of units) addUnit(run, className, { name });
    const d = new EventDriver({ run, eventId: 'trap' });
    d.open();
    return d;
  };
  const thief = [
    { when: { class: 'Thief' }, line: '{name}: That is a tripwire.', reveals: 'cache' },
  ];

  it("a matching unit's face and line stand under the choice they speak to, and only there", () => {
    const d = stand(thief, [['Thief', 'Mira']]);
    const tells = byClass(d, 'ev-tell');
    expect(tells).toHaveLength(1);
    expect(textOf(tells[0])).toContain('Mira: That is a tripwire.');
    // The face is the speaker's own.
    expect(tells[0].all().find((n) => n.tag === 'img').dataset.face).toBe('Mira');
    // The tell sits in the row of "Search", after its button, not "Leave".
    const rows = byClass(d, 'ev-choice-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].children[0].dataset.choice).toBe('search');
    expect(rows[0].children[1]).toBe(byClass(d, 'ev-tells')[0]);
    expect(d.choice('leave')).toBeTruthy();
    // It is still one button per choice: the tell is not a second control.
    expect(d.buttons().filter((b) => b.dataset?.choice)).toHaveLength(2);
  });

  it('shows nothing when no one could speak, and nothing once the choice is made', () => {
    const none = stand(thief);
    expect(byClass(none, 'ev-tell')).toHaveLength(0);
    expect(byClass(none, 'ev-choice-row')).toHaveLength(0);
    const d = stand(thief, [['Thief', 'Mira']]);
    d.choose('search');
    expect(byClass(d, 'ev-tell')).toHaveLength(0);
  });

  it('a line that does not name its speaker gets the name beside the face', () => {
    const d = stand(
      [{ when: { class: 'Thief' }, line: 'That is a tripwire.', reveals: 'cache' }],
      [['Thief', 'Mira']],
    );
    const [tell] = byClass(d, 'ev-tell');
    expect(textOf(tell)).toContain('That is a tripwire.');
    expect(textOf(tell)).toContain('Mira');
    // A line that names them says it once.
    const named = stand(thief, [['Thief', 'Mira']]);
    expect(byClass(named, 'ev-tell-name')).toHaveLength(0);
  });

  it('never shows the outcome a tell reveals, a number, or the word odds', () => {
    const d = stand(thief, [['Thief', 'Mira']]);
    const text = d.text();
    expect(text).not.toContain('A cache.');
    expect(text).not.toMatch(/\d+\s?%|odds|chance|probab/i);
  });
});

describe('the new result kinds', () => {
  const resultsOf = (d) => byClass(d, 'ev-result');
  const play = (event, choiceId, { seed = 101, setup = null } = {}) => {
    const run = runWithEvents([event], { seed });
    run.roster = run.roster.filter((u) => u.name !== 'Gaspar');
    setup?.(run);
    const d = new EventDriver({ run, eventId: event.id });
    d.open();
    d.choose(choiceId);
    return d;
  };

  it('a contract says its goal, what keeping it pays and what breaking it costs', () => {
    const d = play(contractEvent(), 'sign');
    const [line] = resultsOf(d);
    expect(line.dataset.kind).toBe('contract');
    const words = textOf(line);
    expect(words).toContain('CONTRACT');
    expect(words).toContain('Contract: Under par');
    expect(words).toContain('Win the next battle by turn par or sooner.');
    expect(words).toContain('Kept: +600 G. Broken: Debt 300 G.');
    expect(d.run.contract).toMatchObject({ goal: 'underPar' });
  });

  it('someone joining: their face, name and class, and the roster really has them', () => {
    const event = {
      id: 'volunteer',
      title: 'The Volunteer',
      weight: 1,
      intro: 'An archer at the roadside.',
      choices: [
        {
          id: 'take',
          label: 'Take her on',
          outcomes: [
            {
              id: 'joined',
              weight: 100,
              text: 'She falls in.',
              effects: [{ type: 'join', class: 'Archer' }],
            },
          ],
        },
      ],
    };
    const d = play(event, 'take');
    const before = d.run.roster.length - 1;
    const [line] = resultsOf(d);
    expect(line.dataset.kind).toBe('join');
    const joined = d.run.roster.at(-1);
    expect(d.run.roster).toHaveLength(before + 1);
    expect(textOf(line)).toContain(`${joined.name} joins the army`);
    expect(textOf(line)).toContain(`${joined.className} · Lv ${joined.level}`);
    expect(line.all().find((n) => n.tag === 'img').dataset.face).toBe(joined.name);
    expect(joined.className).toBe('Archer');
  });

  it('a road drawn and a place redrawn say where and what, and the map is told which places to ring', () => {
    const event = (effect) => ({
      id: 'cartographer',
      title: 'The Cartographer',
      weight: 1,
      intro: 'A woman with a pen.',
      choices: [
        {
          id: 'draw',
          label: 'Hire her',
          outcomes: [
            {
              id: 'drawn',
              weight: 100,
              text: 'She draws.',
              effects: [effect],
              fallback: [{ type: 'gold', value: 5 }],
            },
          ],
        },
      ],
    });
    // A seed on which each edit finds a place to change (the engine's own answer, read back).
    let road = null;
    let redrawn = null;
    for (let seed = 1; seed <= 60 && !(road && redrawn); seed++) {
      for (const [effect, kind] of [
        [{ type: 'routeEdit', op: 'addRoad' }, 'road'],
        [{ type: 'routeEdit', op: 'redraw', toType: 'shop' }, 'redraw'],
      ]) {
        const run = runWithEvents([event(effect)], { seed });
        const node = arriveAs(run, 'cartographer');
        const probe = chooseEventOption(run, node.id, 'draw');
        const hit = probe.results.find((r) => r.kind === 'route');
        if (hit && kind === 'road' && !road) road = { seed, effect, hit };
        if (hit && kind === 'redraw' && !redrawn) redrawn = { seed, effect, hit };
      }
    }
    expect(road, 'a seed with a new road').toBeTruthy();
    expect(redrawn, 'a seed with a redrawn place').toBeTruthy();

    for (const [found, words, change] of [
      [road, 'A new road opens to a', 'A new road opens ahead.'],
      [redrawn, 'A place ahead is now a village', 'A place ahead has changed.'],
    ]) {
      const run = runWithEvents([event(found.effect)], { seed: found.seed });
      const d = new EventDriver({ run, eventId: null });
      d.node = arriveAs(run, 'cartographer');
      d.scene.nodeView = { noteRouteChange: vi.fn() };
      d.open();
      d.choose('draw');
      const [line] = resultsOf(d);
      expect(line.dataset.kind).toBe('route');
      expect(textOf(line)).toContain('ROAD');
      expect(textOf(line)).toContain(words);
      // The route map is handed the place to ring and the line to say.
      const target = found.hit.op === 'addRoad' ? found.hit.to : found.hit.node;
      expect(d.scene.nodeView.noteRouteChange).toHaveBeenCalledWith({
        nodeIds: [target],
        text: change,
      });
    }
  });

  it('an outcome with no route edit hands the map nothing to ring', () => {
    const run = newRun({ gold: 500 });
    const d = new EventDriver({ run, eventId: 'drill_yard' });
    d.scene.nodeView = { noteRouteChange: vi.fn() };
    d.open();
    d.choose('rest');
    expect(d.scene.nodeView.noteRouteChange).not.toHaveBeenCalled();
  });

  it('a counter spent with nothing left says so plainly, never "−0"', () => {
    const d = mine({ difficulty: 'lunatic' });
    d.choose('deeper');
    d.choose('deeper');
    const text = d.text();
    expect(text).not.toContain('−0');
    expect(text).not.toMatch(/undefined|NaN|\[object/);
  });
});

describe('the burdens an outcome hands over, in words', () => {
  it('say the line and the count as sentences, with their stops', () => {
    const run = newRun({ gold: 500, difficulty: 'hard' });
    const d = new EventDriver({ run, eventId: 'moneylender' });
    d.open();
    d.choose('borrow');
    const burden = byClass(d, 'ev-result').find((n) => n.dataset.kind === 'burden');
    const detail = burden.all().find((n) => has(n, 'ev-result-detail')).textContent;
    expect(detail).toMatch(
      /^The lender takes a share of each victory's gold until the debt is paid\./,
    );
    expect(detail).toMatch(/\d+ G owed\.$/);
    expect(detail).not.toMatch(/\.\./);
  });
});

describe('every page of every shipped event reads cleanly', () => {
  // Each event's every page (the first, the later ones and the dark face's), drawn as a page with
  // the state forced onto it, then every choice taken through the page: no unfilled token, no
  // "undefined", a label on every button, one way on.
  const events = baseData.events.events;
  const facesOf = (event) => [
    { event, face: event, dark: false },
    ...(event.dark ? [{ event, face: { ...event, ...event.dark }, dark: true }] : []),
  ];
  const pagesOf = (face) => ['start', ...Object.keys(face.pages || {})];
  const cases = events.flatMap((event) =>
    facesOf(event).flatMap(({ face, dark }) =>
      pagesOf(face).map((page) => [event.id, dark ? 'dark' : 'plain', page]),
    ),
  );

  const army = (seed) => {
    const run = newRun({ seed, gold: 2000 });
    run.actSequence = ['act1', 'act2', 'act3', 'act4'];
    run.actIndex = 1;
    for (const [className, name] of [
      ['Archer', 'Hale'],
      ['Thief', 'Mira'],
      ['Mage', 'Iona'],
      ['Cleric', 'Mara'],
    ])
      addUnit(run, className, { name, level: 3 });
    run.roster[0].consumables = [{ ...run.getConsumableTemplate('Vulnerary') }];
    return run;
  };

  it.each(cases)('%s (%s face), page %s', (eventId, which, pageId) => {
    for (let seed = 1; seed <= 6; seed++) {
      const run = army(seed);
      const node = arriveAs(run, eventId);
      const state = run.eventStateByNodeId[node.id];
      if (which === 'dark') state.dark = true;
      if (pageId !== 'start') state.page = pageId;
      const d = new EventDriver({ run, eventId: null });
      d.node = node;
      d.open();
      const text = d.text();
      expect(text, `${eventId}/${pageId}`).not.toMatch(/undefined|NaN|\[object|\{[a-z]+\}/);
      const buttons = d.buttons().filter((b) => b.dataset?.choice);
      expect(buttons.length, `${eventId}/${pageId} has choices`).toBeGreaterThan(0);
      for (const b of buttons) expect(nodeText(b).trim().length).toBeGreaterThan(0);
      // Every open choice, taken through the page, ends on a clean page.
      for (const b of buttons.filter((x) => !x.disabled)) {
        const fork = army(seed);
        const forkNode = arriveAs(fork, eventId);
        const forkState = fork.eventStateByNodeId[forkNode.id];
        if (which === 'dark') forkState.dark = true;
        if (pageId !== 'start') forkState.page = pageId;
        const f = new EventDriver({ run: fork, eventId: null });
        f.node = forkNode;
        f.open();
        const view = eventView(fork, forkNode.id);
        const choice = view.choices.find((c) => c.id === b.dataset.choice);
        if (choice.target) {
          const ok = choice.target.candidates.filter((c) => c.ok);
          if (!ok.length) continue;
        }
        try {
          f.choose(choice.id, { target: choice.target ? 0 : undefined });
        } catch {
          continue; // a target row that is not pickable: the engine's own tests walk those
        }
        expect(f.text(), `${eventId}/${pageId}/${choice.id}`).not.toMatch(
          /undefined|NaN|\[object|\{[a-z]+\}/,
        );
        f.controller.destroy();
      }
      d.controller.destroy();
    }
  });
});
