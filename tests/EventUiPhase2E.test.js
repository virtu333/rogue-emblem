// The words and surfaces of the Phase 2 event UI (docs/specs/event-nodes-phase2.md §2E): the model
// that turns engine records into lines, the contract chip and pause list, the route map's ring on
// a changed place, the colosseum's bouts, and the Dark Omen's medal. The engine decides; these read
// what it says.
//
// Ways this can fail, a test (or a group) each:
//   1. a result record of a new kind draws nothing, or says a number the record does not hold;
//   2. a sentence loses its stop, doubles it, or runs two clauses together;
//   3. the contract the run holds has no chip, the chip's terms differ from the engine's words, or
//      the pause list drops it (and a run with only a contract loses the row);
//   4. a route edit's ring lands on the wrong node, shows twice, never clears, or pulses for a
//      player who asked for less motion;
//   5. the Omen's medal is worn by an event that fell to a fight, or not worn by one that did not;
//   6. the colosseum's bouts line is missing on a screen that costs a fee, or says another number.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { NodeMapMenu } from '../src/ui/NodeMapMenu.js';
import { pauseBurdenList } from '../src/ui/MobilePauseMenu.js';
import { EventController } from '../src/ui/EventController.js';
import { nodeFrame, nodeLabel } from '../src/ui/RouteGraph.js';
import { describeLoomNode, loomShortLabel } from '../src/ui/loomModel.js';
import { eclipseNode } from '../src/engine/EclipseSystem.js';
import { describeContract } from '../src/engine/Contracts.js';
import { addBurden } from '../src/engine/Burdens.js';
import {
  contractChipModel,
  eventChosenLine,
  eventCounterModel,
  eventResultLines,
  eventTellModel,
  eventTrailModel,
  pauseBurdenEntries,
  routeChangeModel,
  sentence,
} from '../src/ui/eventMenuModel.js';
import { baseData, eventNode, newRun, runWithEvents } from './eventKit.js';
import { contractEvent } from './eventPhase2Kit.js';
import { arriveAtEvent, chooseEventOption } from '../src/engine/EventCommands.js';

const only = (record, context) => eventResultLines([record], context)[0];

describe('sentence', () => {
  it('raises the first letter and ends with one stop, never two', () => {
    expect(sentence('the lender takes a share')).toBe('The lender takes a share.');
    expect(sentence('Already a sentence.')).toBe('Already a sentence.');
    expect(sentence('Ends in a question?')).toBe('Ends in a question?');
    expect(sentence('  spaced out  ')).toBe('Spaced out.');
    expect(sentence('')).toBe('');
    expect(sentence(null)).toBe('');
  });
});

describe('result lines of the new kinds', () => {
  it('a counter says what moved and what is left; none to spend is said plainly', () => {
    expect(
      only({ kind: 'counter', key: 'torches', label: 'Torches', delta: -1, value: 2 }),
    ).toMatchObject({ chip: 'COUNT', tone: 'plain', text: 'Torches −1', detail: '2 left' });
    expect(
      only({ kind: 'counter', key: 'torches', label: 'Torches', delta: 2, value: 5 }),
    ).toMatchObject({ tone: 'good', text: 'Torches +2', detail: '5 left' });
    const none = only({ kind: 'counter', key: 'torches', label: 'Torches', delta: 0, value: 0 });
    expect(none.text).toBe('Torches: none to spend');
    expect(none.text).not.toMatch(/[−+]0/);
    // A record with no label falls back to its key.
    expect(only({ kind: 'counter', key: 'favours', delta: -1, value: 0 }).text).toBe('favours −1');
  });

  it('a join names who, their class and level, and carries the unit for a face', () => {
    expect(
      only({ kind: 'join', name: 'Hale', className: 'Archer', level: 4, unitUid: 'u9' }),
    ).toEqual({
      kind: 'join',
      chip: 'JOIN',
      tone: 'good',
      text: 'Hale joins the army',
      detail: 'Archer · Lv 4',
      unit: { uid: 'u9', name: 'Hale' },
    });
    // A level that is missing or 0 reads as 1, never "Lv 0" or "Lv NaN".
    expect(only({ kind: 'join', name: 'Hale', className: 'Archer' }).detail).toBe('Archer · Lv 1');
  });

  it('a contract says the goal, what keeping it pays and what breaking it costs', () => {
    const line = only({
      kind: 'contract',
      goal: 'noLosses',
      label: 'Contract',
      short: 'No losses',
      line: 'Win the next battle without losing anyone.',
      reward: ['+400 G'],
      penalty: ['Wound 10%'],
    });
    expect(line).toMatchObject({ chip: 'CONTRACT', tone: 'plain', text: 'Contract: No losses' });
    expect(line.detail).toBe(
      'Win the next battle without losing anyone. Kept: +400 G. Broken: Wound 10%.',
    );
    // Terms with nothing to keep or break leave those parts out.
    expect(
      only({
        kind: 'contract',
        label: 'Contract',
        short: 'Under par',
        line: 'Be quick.',
        reward: [],
      }).detail,
    ).toBe('Be quick.');
  });

  it('a road drawn and a place redrawn say where and what it was', () => {
    expect(
      only({ kind: 'route', op: 'addRoad', from: 'a', to: 'b', row: 3, col: 1, type: 'shop' }),
    ).toMatchObject({
      chip: 'ROAD',
      tone: 'good',
      text: 'A new road opens to a village',
      detail: 'The route map shows it. Row 4 of the route.',
    });
    expect(only({ kind: 'route', op: 'addRoad', row: 3, type: 'battle' }).text).toBe(
      'A new road opens to a battle',
    );
    const redrawn = only({
      kind: 'route',
      op: 'redraw',
      node: 'n',
      row: 4,
      fromType: 'church',
      type: 'battle',
    });
    expect(redrawn).toMatchObject({
      tone: 'bad',
      text: 'A place ahead is now a battle',
      detail: 'It was a church. Row 5 of the route.',
    });
    expect(
      only({ kind: 'route', op: 'redraw', row: 4, fromType: 'battle', type: 'shop' }).tone,
    ).toBe('good');
    // The articles: an "event" and an "ironworks" take "an"/"a" by their first letter.
    expect(
      only({ kind: 'route', op: 'redraw', row: 4, fromType: 'event', type: 'shop' }).detail,
    ).toMatch(/^It was an event\./);
    // No row on the record: no row in the words.
    expect(only({ kind: 'route', op: 'addRoad', type: 'shop' }).detail).toBe(
      'The route map shows it.',
    );
  });

  it('a note is its own words; a burden is its line and its count as sentences', () => {
    expect(only({ kind: 'note', text: 'The road stays as it was.' })).toMatchObject({
      chip: 'NOTE',
      text: 'The road stays as it was.',
    });
    expect(eventResultLines([{ kind: 'note', text: '' }])).toEqual([]);
    const burden = only({
      kind: 'burden',
      id: 'hunted',
      label: 'Hunted',
      line: 'Something follows your trail.',
      detail: '2 battles left: an extra wave of 2 foes on turn 3, boss maps spared',
    });
    expect(burden.detail).toBe(
      'Something follows your trail. 2 battles left: an extra wave of 2 foes on turn 3, boss maps spared.',
    );
    const sworn = only({
      kind: 'burden',
      id: 'sworn_enemy',
      label: 'Sworn Enemy',
      line: 'The boss has sworn to end you.',
      detail: 'the act boss carries an extra affix until it falls',
    });
    expect(sworn.detail).toBe(
      'The boss has sworn to end you. The act boss carries an extra affix until it falls.',
    );
  });

  it('bookkeeping still draws no line, and an unknown kind never draws a blank chip', () => {
    expect(
      eventResultLines([
        { kind: 'flag', key: 'x', value: true },
        { kind: 'battle' },
        { kind: 'mystery' },
      ]),
    ).toEqual([]);
  });
});

describe('the trail, the counters and the tells as models', () => {
  const steps = [
    {
      page: 'start',
      choiceLabel: 'Go deeper',
      text: 'Ore.',
      targetName: null,
      results: [{ kind: 'gold', value: 40 }],
    },
    {
      page: 'level_two',
      choiceLabel: 'Deeper still',
      text: 'A chest.',
      targetName: 'Hale',
      results: [],
    },
  ];

  it('the step just taken is in full, the others behind the toggle (counted in words)', () => {
    const fresh = eventTrailModel(steps, { justNow: true });
    expect(fresh.recent).toMatchObject({
      page: 'level_two',
      chosen: 'You chose: Deeper still · Hale',
      text: 'A chest.',
    });
    expect(fresh.steps.map((s) => s.page)).toEqual(['start']);
    expect(fresh.toggle).toBe('Earlier on this road · 1 step');
    expect(fresh.steps[0].lines[0]).toMatchObject({ kind: 'gold', text: 'Gained 40 G' });
    // After a refresh nothing is "just now": every step is behind the toggle.
    const reopened = eventTrailModel(steps);
    expect(reopened.recent).toBeNull();
    expect(reopened.steps).toHaveLength(2);
    expect(reopened.toggle).toBe('Earlier on this road · 2 steps');
    // No trail, no toggle; a lone recent step leaves nothing behind the toggle.
    expect(eventTrailModel([])).toEqual({ steps: [], recent: null, toggle: '' });
    expect(eventTrailModel(steps.slice(0, 1), { justNow: true })).toMatchObject({
      steps: [],
      toggle: '',
    });
    expect(eventTrailModel(undefined)).toEqual({ steps: [], recent: null, toggle: '' });
  });

  it('a chosen line names the target, and tolerates a step with no label', () => {
    expect(eventChosenLine({ choiceLabel: 'Train', targetName: 'Brant' })).toBe(
      'You chose: Train · Brant',
    );
    expect(eventChosenLine({})).toBe('You chose: something');
  });

  it('a counter reads value/max, with a pip each up to eight, and lights what it has', () => {
    expect(eventCounterModel({ key: 't', label: 'Torches', value: 2, max: 3 })).toMatchObject({
      text: 'Torches 2/3',
      speech: 'Torches: 2 of 3',
      pips: [true, true, false],
      empty: false,
    });
    expect(eventCounterModel({ key: 't', label: 'Torches', value: 0, max: 2 })).toMatchObject({
      pips: [false, false],
      empty: true,
    });
    // Grown past its start: the maximum is what it has; many points: a number alone.
    expect(eventCounterModel({ key: 't', label: 'T', value: 5, max: 3 }).text).toBe('T 5/5');
    expect(eventCounterModel({ key: 't', label: 'T', value: 9, max: 9 }).pips).toEqual([]);
    // A malformed counter never reads NaN.
    expect(eventCounterModel({ key: 'x', value: 'many', max: undefined }).text).toBe('x 0/0');
  });

  it('a tell shows the speaker name only when the line leaves it out', () => {
    expect(eventTellModel({ speaker: { uid: 'u1', name: 'Mira' }, line: 'Mira: A wire.' })).toEqual(
      {
        uid: 'u1',
        name: 'Mira',
        line: 'Mira: A wire.',
        caption: '',
      },
    );
    expect(eventTellModel({ speaker: { uid: null, name: 'Mira' }, line: 'A wire.' }).caption).toBe(
      'Mira',
    );
    expect(eventTellModel({ speaker: { name: 'Mira' }, line: '   ' })).toBeNull();
    expect(eventTellModel(undefined)).toBeNull();
  });

  it('a route edit names the places to ring and one line, or nothing', () => {
    expect(routeChangeModel([{ kind: 'route', op: 'addRoad', from: 'a', to: 'b' }])).toEqual({
      nodeIds: ['b'],
      text: 'A new road opens ahead.',
    });
    expect(routeChangeModel([{ kind: 'route', op: 'redraw', node: 'c' }])).toEqual({
      nodeIds: ['c'],
      text: 'A place ahead has changed.',
    });
    expect(
      routeChangeModel([
        { kind: 'route', op: 'addRoad', to: 'b' },
        { kind: 'route', op: 'redraw', node: 'c' },
        { kind: 'route', op: 'redraw', node: 'c' },
      ]),
    ).toEqual({ nodeIds: ['b', 'c'], text: 'A new road opens, and a place ahead has changed.' });
    expect(
      routeChangeModel([
        { kind: 'gold', value: 5 },
        { kind: 'note', text: 'x' },
      ]),
    ).toEqual({ nodeIds: [], text: '' });
    expect(routeChangeModel(undefined)).toEqual({ nodeIds: [], text: '' });
  });
});

describe('the contract on the route map and in the pause list', () => {
  let dom;
  beforeEach(() => {
    vi.useFakeTimers();
    dom = installFakeDom(vi);
    _resetInputFocus();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetInputFocus();
  });

  /** A run that signed the standard contract through the engine (under par: +600 G, Debt 300 G). */
  function signed({ goal = 'underPar' } = {}) {
    const run = runWithEvents([contractEvent({ goal })], { seed: 101 });
    const node = eventNode(run);
    arriveAtEvent(run, node.id);
    expect(chooseEventOption(run, node.id, 'sign').ok).toBe(true);
    return run;
  }
  const rowFor = (run, state = { _burdenOpen: null }) => {
    const row = NodeMapMenu.prototype._burdenRow.call({
      ...state,
      scene: { runManager: run, gameData: run.gameData },
    });
    return row;
  };

  it('a run with no contract and no burden has no row', () => {
    expect(rowFor(newRun())).toBeNull();
  });

  it("a contract is a chip of its own: name, short goal, and the engine's terms on title and tap", () => {
    const run = signed();
    const row = rowFor(run);
    const chips = row.querySelectorAll('.re-burden');
    expect(chips).toHaveLength(1);
    const [chip] = chips;
    expect(chip.classList.contains('re-contract')).toBe(true);
    expect(chip.dataset.burden).toBe('contract');
    expect(chip.textContent).toBe('ContractUnder par');
    const terms = 'Win the next battle by turn par or sooner. Kept: +600 G. Broken: Debt 300 G.';
    expect(chip.title).toBe(`Contract: ${terms}`);
    expect(row.attributes['aria-label']).toBe('Burdens and contract');
    // A tap shows the terms under the row; a second tap hides them again.
    const state = { _burdenOpen: null };
    const open = rowFor(run, state);
    open.querySelectorAll('.re-burden')[0].onclick();
    const note = open.querySelectorAll('.re-burden-note')[0];
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe(terms);
    expect(note.classList.contains('is-contract')).toBe(true);
    open.querySelectorAll('.re-burden')[0].onclick();
    expect(note.hidden).toBe(true);
    expect(dom).toBeTruthy();
  });

  it("the words are the engine's (describeContract), whatever the goal and the terms", () => {
    const run = signed({ goal: 'noLosses' });
    const chip = contractChipModel(describeContract(run));
    expect(chip.short).toBe('No losses');
    expect(chip.line).toBe('Win the next battle without losing anyone.');
    expect(chip.terms).toContain('Kept: +600 G.');
    expect(contractChipModel(null)).toBeNull();
    // Terms with nothing named (an empty penalty) say only what is there.
    const bare = contractChipModel({
      short: 'Under par',
      line: 'be quick',
      reward: ['+10 G'],
      penalty: [],
    });
    expect(bare.terms).toBe('Be quick. Kept: +10 G.');
  });

  it('burdens come first and the contract last, in one row, whatever order they were taken', () => {
    const run = signed();
    addBurden(run, 'ill_omen');
    addBurden(run, 'debt', { owed: 450 });
    const row = rowFor(run);
    expect(row.querySelectorAll('.re-burden').map((c) => c.dataset.burden)).toEqual([
      'ill_omen',
      'debt',
      'contract',
    ]);
  });

  it('the pause list carries it, as its terms, with a mark of its own', () => {
    const run = signed();
    addBurden(run, 'ill_omen');
    const entries = pauseBurdenEntries(run, run.gameData.events);
    expect(entries.map((e) => e.id)).toEqual(['ill_omen', 'contract']);
    const list = pauseBurdenList(entries);
    expect(list.getAttribute('aria-label')).toBe('Burdens and contract');
    const items = list.querySelectorAll('li');
    expect(items[0].classList.contains('is-contract')).toBe(false);
    expect(items[1].classList.contains('is-contract')).toBe(true);
    expect(items[1].querySelector('strong').textContent).toBe('Contract · Under par');
    expect(items[1].querySelector('span').textContent).toBe(
      'Win the next battle by turn par or sooner. Kept: +600 G. Broken: Debt 300 G.',
    );
    // Nothing held, nothing listed; a contract alone is a list of one.
    expect(pauseBurdenEntries(newRun())).toEqual([]);
    expect(pauseBurdenEntries(signed())).toHaveLength(1);
  });
});

describe('the route map rings what an event changed', () => {
  let dom;
  beforeEach(() => {
    vi.useFakeTimers();
    dom = installFakeDom(vi);
    _resetInputFocus();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetInputFocus();
  });

  /** The menu's own state and a root of three route buttons (the loom's `.re-node`s). */
  function menu({ reduced = false, overlay = null } = {}) {
    const root = dom.doc.createElement('div');
    const buttons = ['a', 'b', 'c'].map((id) => {
      const b = dom.doc.createElement('button');
      b.className = 're-node';
      b.dataset.node = id;
      root.append(b);
      return b;
    });
    const state = {
      root,
      selected: 'a',
      scene: { eventOverlay: overlay },
      _reducedMotion: () => reduced,
      _showToast: vi.fn(),
    };
    return {
      state,
      buttons,
      apply: () => NodeMapMenu.prototype._applyRouteChange.call(state),
      note: (c) => NodeMapMenu.prototype.noteRouteChange.call(state, c),
    };
  }

  it('selects the first changed place, rings each once and says the line once', () => {
    const m = menu();
    m.note({ nodeIds: ['b', 'c'], text: 'A place ahead has changed.' });
    expect(m.state.selected).toBe('b');
    m.apply();
    m.apply(); // a second draw of the same map: still one ring each
    const rings = m.buttons.map((b) => b.querySelectorAll('.re-loom-changed').length);
    expect(rings).toEqual([0, 1, 1]);
    expect(m.buttons[1].classList.contains('is-changed')).toBe(true);
    expect(m.buttons[0].classList.contains('is-changed')).toBe(false);
    expect(m.state._showToast).toHaveBeenCalledTimes(1);
    expect(m.state._showToast).toHaveBeenCalledWith('A place ahead has changed.');
    expect(
      m.buttons[1].querySelectorAll('.re-loom-changed')[0].classList.contains('is-pulsing'),
    ).toBe(true);
  });

  it('a player who asked for less motion gets the ring without the pulse', () => {
    const m = menu({ reduced: true });
    m.note({ nodeIds: ['b'], text: 'x' });
    m.apply();
    const ring = m.buttons[1].querySelectorAll('.re-loom-changed')[0];
    expect(ring).toBeTruthy();
    expect(ring.classList.contains('is-pulsing')).toBe(false);
  });

  it('waits while the event page is still open, and clears itself after a few seconds', () => {
    const m = menu({ overlay: [] });
    m.note({ nodeIds: ['b'], text: 'x' });
    m.apply();
    expect(m.buttons[1].querySelectorAll('.re-loom-changed')).toHaveLength(0);
    expect(m.state._showToast).not.toHaveBeenCalled();
    m.state.scene.eventOverlay = null; // the page closed: the map is drawn again
    m.apply();
    expect(m.buttons[1].querySelectorAll('.re-loom-changed')).toHaveLength(1);
    vi.advanceTimersByTime(8000);
    expect(m.buttons[1].querySelectorAll('.re-loom-changed')).toHaveLength(0);
    expect(m.buttons[1].classList.contains('is-changed')).toBe(false);
    // A later draw has nothing left to ring.
    m.apply();
    expect(m.buttons[1].querySelectorAll('.re-loom-changed')).toHaveLength(0);
  });

  it('a change that names no place does nothing', () => {
    const m = menu();
    m.note({ nodeIds: [], text: '' });
    m.note(null);
    m.apply();
    expect(m.state._routeChange).toBeUndefined();
    expect(m.state.selected).toBe('a');
  });

  it('the event controller hands the map only what a route edit changed', () => {
    const nodeView = { noteRouteChange: vi.fn() };
    const controller = new EventController({ nodeView });
    controller.noteRouteChange([{ kind: 'gold', value: 5 }]);
    expect(nodeView.noteRouteChange).not.toHaveBeenCalled();
    controller.noteRouteChange([{ kind: 'route', op: 'addRoad', to: 'n7' }]);
    expect(nodeView.noteRouteChange).toHaveBeenCalledWith({
      nodeIds: ['n7'],
      text: 'A new road opens ahead.',
    });
    // No map view (the canvas fallback): nothing throws.
    expect(() =>
      new EventController({}).noteRouteChange([{ kind: 'route', op: 'addRoad', to: 'n7' }]),
    ).not.toThrow();
  });
});

describe("the Dark Omen medal is the Omen's alone", () => {
  const ctx = (darkOmen) => ({
    runSeed: 7,
    config: baseData.eclipse,
    actId: 'act2',
    mapTemplates: baseData.mapTemplates,
    shadow: 30,
    darkOmen,
  });
  const fallen = (darkOmen) => {
    const node = { id: 'act2_4_1', row: 4, col: 1, type: 'event', edges: [], battleParams: null };
    return eclipseNode(node, ctx(darkOmen));
  };

  it('an event that kept its story wears frame 10, labelled and carded as an Omen', () => {
    const omen = fallen(() => true);
    expect(omen.darkOmen).toBe(true);
    expect(nodeFrame(omen, 'act2')).toBe(10);
    expect(nodeLabel(omen)).toBe('Dark Omen');
    expect(loomShortLabel(omen)).toBe('OMEN');
    expect(describeLoomNode(omen, { state: 'live', actId: 'act2' }).kind).toBe('DARK OMEN');
  });

  it('an event that fell to a fight looks like any eclipsed battle: elite frame, Swallowed road', () => {
    const swallowed = fallen(() => false);
    expect(swallowed.darkOmen).toBeUndefined();
    expect(swallowed.type).toBe('battle');
    expect(nodeFrame(swallowed, 'act2')).toBe(7);
    expect(nodeFrame(swallowed, 'act2')).not.toBe(10);
    expect(nodeLabel(swallowed)).toBe('Swallowed road');
    expect(loomShortLabel(swallowed)).toBe('ECLIPSED');
    expect(describeLoomNode(swallowed, { state: 'live', actId: 'act2' }).kind).toBe('ECLIPSED');
    // Asked nothing (no question given), it falls as in Phase 1.
    expect(nodeFrame(fallen(null), 'act2')).toBe(7);
  });

  it('an unfallen event keeps the event medal, and a fallen village its own silhouette', () => {
    expect(nodeFrame({ type: 'event' }, 'act2')).toBe(9);
    const village = {
      type: 'battle',
      eclipse: { fromType: 'shop' },
      battleParams: { isElite: true },
    };
    expect(nodeFrame(village, 'act2')).toBe(3);
  });
});
