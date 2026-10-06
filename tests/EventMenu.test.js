// The Event page, played through the real EventController and EventMenu with the
// rendering-only presentation (tests/harness/EventDriver.js; docs/specs/event-nodes.md §10).
// The engine decides everything; these tests hold the page to what it must show and do.
//
// Ways this can fail, a test (or a group) each:
//   1. the page leaks what a choice brings (an outcome's words, an odd or a percentage) before
//      the choice is made, or hides a choice's price or the reason it is greyed;
//   2. a greyed choice can still be pressed, or its reason differs from the engine's;
//   3. a choice that needs a unit offers units who cannot do it as pickable, shows no faces, or
//      applies without the chosen unit;
//   4. backing out of a confirmation changes the run or the save;
//   5. the commit is not saved at once, a refresh re-rolls or re-applies it, or reopens the
//      choices instead of the outcome;
//   6. Continue does not complete the node, does not save, or does not check the act;
//   7. ESC does the wrong thing at a phase (leaves an unchosen event, strands a chosen one, drops
//      a fight that is owed);
//   8. a fight can be walked away from (Continue offered with a battle pending), or Fight does
//      not take the route map's battle locks and path;
//   9. the won fight's spoils apply twice or never across a refresh, or the page does not say them;
//  10. any shipped outcome renders an empty, broken or unfilled page;
//  11. the first-event note shows twice, over a result, in the prologue or with Guidance off.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { JourneyStorage } from './harness/RunDriver.js';
import { EventDriver, nodeText } from './harness/EventDriver.js';
import {
  chooseEventOption,
  eventChoiceBlock,
  eventState,
  eventView,
} from '../src/engine/EventCommands.js';
import { guidanceText } from '../src/engine/Guidance.js';
import { addUnit, arriveAs, baseData, fallAlly, newRun } from './eventKit.js';

// The unit sheet is a DOM view; the page only opens it.
vi.mock('../src/ui/MobileRosterSheet.js', () => ({
  MobileRosterSheet: class {
    constructor(options) {
      Object.assign(this, options);
    }
    destroy() {
      this.destroyed = true;
    }
  },
}));

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

const eventById = (id) => baseData.events.events.find((e) => e.id === id);
/** Every outcome text and every after-victory text of an event, to prove none is on the page. */
const secretsOf = (event) =>
  event.choices.flatMap((choice) =>
    choice.outcomes.flatMap((o) => [o.text, o.fallbackText, ...(o.victoryText ? [o.victoryText] : [])]),
  ).filter(Boolean); // prettier-ignore

function driver(eventId, options = {}) {
  const d = new EventDriver({ eventId, ...options });
  d.open();
  return d;
}

describe('the choosing page', () => {
  it('shows the kicker, the title, the intro and one button per choice with its hint', () => {
    const d = driver('old_swordmaster');
    const event = eventById('old_swordmaster');
    const text = d.text();
    expect(text).toContain('EVENT');
    expect(text).toContain(event.title);
    expect(text).toContain(event.intro);
    for (const choice of event.choices) {
      const b = d.choice(choice.id);
      expect(b, choice.id).toBeTruthy();
      expect(nodeText(b)).toContain(choice.label);
      if (choice.hint) expect(nodeText(b)).toContain(choice.hint);
      expect(b.disabled).toBe(false);
    }
    // The header button keeps the event open.
    expect(d.menu.closeButton.textContent).toBe('Close');
  });

  it('never shows an outcome, an odd or a percentage before the choice (every event)', () => {
    for (const event of baseData.events.events) {
      const run = newRun({ gold: 2000 });
      addUnit(run, 'Cleric', { name: 'Mara' });
      const fallen = addUnit(run, 'Cavalier', { name: 'Rook', level: 5 });
      fallAlly(run, fallen);
      const d = new EventDriver({ run, eventId: event.id });
      d.open();
      const text = d.text();
      for (const secret of secretsOf(event))
        expect(text, `${event.id}: ${secret}`).not.toContain(secret);
      expect(text, event.id).not.toMatch(/\d+\s?%|odds|chance|probab/i);
      d.controller.destroy();
    }
  });

  it('a cost is a seal on the choice, in gold the engine scaled', () => {
    // The data's { base: 100, perAct: 100 } in Act I is 200 G; Nightfall's costScale 1.25 makes
    // it 250 (rounded to 10). Derived from the catalog here, never from the engine.
    const cost = eventById('twin_altar').choices[0].cost.gold;
    const act1 = cost.base + cost.perAct;
    const d = driver('twin_altar');
    expect(nodeText(d.choice('dawn'))).toContain(`${act1} G`);
    expect(eventView(d.run, d.node.id).choices.find((c) => c.id === 'dawn').cost).toBe(act1);
    expect(nodeText(d.choice('shadow'))).not.toMatch(/\d+ G/);
    const hard = new EventDriver({
      run: newRun({ difficulty: 'hard', gold: 1000 }),
      eventId: 'twin_altar',
    });
    hard.open();
    expect(nodeText(hard.choice('dawn'))).toContain(`${Math.round((act1 * 1.25) / 10) * 10} G`);
  });

  it("a greyed choice is disabled and says the engine's reason", () => {
    const d = new EventDriver({ run: newRun({ gold: 50 }), eventId: 'twin_altar' });
    d.open();
    const dawn = d.choice('dawn');
    const reason = eventChoiceBlock(d.run, d.node.id, 'dawn');
    expect(reason).toBe('Not enough gold.');
    expect(dawn.disabled).toBe(true);
    expect(nodeText(dawn)).toContain(reason);
    // The other choices stay open.
    expect(d.choice('shadow').disabled).toBe(false);
    expect(() => d.press(dawn)).toThrow('Disabled');
  });

  it("a choice with no one who can do it is greyed with the choice's own reason", () => {
    const run = newRun({ gold: 500 });
    run.roster[0].consumables = [];
    for (const unit of run.roster) unit.consumables = [];
    run.convoy.consumables = [];
    const d = new EventDriver({ run, eventId: 'wounded_courier' });
    d.open();
    const tend = d.choice('tend');
    expect(tend.disabled).toBe(true);
    expect(nodeText(tend)).toContain(eventChoiceBlock(run, d.node.id, 'tend'));
    expect(nodeText(tend)).not.toContain('undefined');
  });

  it('a room-for-an-item reason shows when nothing can carry one', () => {
    const run = newRun({ gold: 500 });
    const sword = run.gameData.weapons.find((w) => w.name === 'Iron Sword');
    for (const unit of run.roster) {
      unit.inventory = Array.from({ length: 5 }, () => ({ ...sword }));
      unit.consumables = Array.from({ length: 3 }, () => run.getConsumableTemplate('Vulnerary'));
    }
    const caps = run.getConvoyCapacities();
    run.convoy.weapons = Array.from({ length: caps.weapons }, () => ({ ...sword }));
    run.convoy.consumables = Array.from({ length: caps.consumables }, () =>
      run.getConsumableTemplate('Vulnerary'),
    );
    const d = new EventDriver({ run, eventId: 'abandoned_armory' });
    d.open();
    expect(nodeText(d.choice('racks'))).toContain(
      'Nowhere to carry anything more. Make room in the convoy.',
    );
    expect(d.choice('racks').disabled).toBe(true);
    // The always-open choice is still there, so the node can be left.
    expect(d.choice('leave').disabled).toBe(false);
  });

  it('offers the Roster, so a full bag can be made room for', () => {
    const d = driver('abandoned_armory');
    d.press('Roster');
    expect(d.menu.child.units).toBe(d.run.roster);
    d.menu.child.onClose();
    expect(d.menu.child).toBeNull();
    // The page was redrawn and the roster's changes saved.
    expect(d.text()).toContain('EVENT');
    expect(d.saved().roster.length).toBe(d.run.roster.length);
  });
});

describe('choosing', () => {
  it('a choice asks for a unit through the picker: faces, greyed rows with their reason', () => {
    const run = newRun({ gold: 500 });
    const mage = addUnit(run, 'Mage', { name: 'Iona' });
    addUnit(run, 'Fighter', { name: 'Brant' });
    const d = new EventDriver({ run, eventId: 'old_swordmaster' });
    d.open();
    d.press(d.choice('train'));
    const picker = d.picker;
    expect(picker.title).toBe('Who trains with her?');
    expect(picker.confirmation).toBeFalsy();
    const names = picker.choices.map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining(['Edric', 'Iona', 'Brant']));
    // Greyed rows carry the engine's reason; pickable ones do not.
    const iona = picker.choices.find((row) => row.name === 'Iona');
    expect(iona.unit).toBe(mage);
    expect(iona.ok).toBe(false);
    expect(picker.blocked(iona)).toBe(iona.reason);
    expect(picker.blocked(iona)).not.toBe('');
    const brant = picker.choices.find((row) => row.name === 'Brant');
    expect(picker.blocked(brant)).toBe('');
    // It opens on someone who can, and each row has a face slot.
    expect(picker.initialChoice.ok).toBe(true);
    expect(typeof picker.face).toBe('function');
    expect(picker.describe(brant)).toBe('Fighter · Lv 1');
    expect(picker.confirmLabel).toBe('Choose');
    // A greyed row cannot be confirmed (the picker's own guard), and nothing was chosen.
    expect(() => d.confirm(picker.choices.indexOf(iona))).toThrow(iona.reason);
    expect(eventState(d.run, d.node.id).choiceId).toBeUndefined();
  });

  it('applies to the chosen unit, and the outcome page names them', () => {
    const run = newRun({ gold: 500 });
    addUnit(run, 'Fighter', { name: 'Brant' });
    const d = new EventDriver({ run, eventId: 'old_swordmaster' });
    d.open();
    d.press(d.choice('train'));
    const index = d.picker.choices.findIndex((row) => row.name === 'Brant');
    const result = d.confirm(index);
    expect(result.ok).toBe(true);
    expect(eventState(d.run, d.node.id)).toMatchObject({ choiceId: 'train', targetName: 'Brant' });
    expect(d.text()).toContain('You chose: Ask her to teach · Brant');
  });

  it('a choice with no unit to pick opens a plain confirmation that says it cannot be undone', () => {
    const d = driver('twin_altar');
    d.press(d.choice('dawn'));
    const picker = d.picker;
    expect(picker.confirmation).toBe(true);
    expect(picker.title).toBe('Pray to the Dawn');
    expect(picker.confirmLabel).toBe('Choose · 200 G');
    const words = picker.describe(picker.choices[0]);
    expect(words).toContain('It costs 200 G.');
    expect(words).toContain('This cannot be undone.');
    expect(words).toContain(eventById('twin_altar').choices[0].hint);
  });

  it('backing out of the confirmation changes nothing, in the run or the save', () => {
    const d = driver('twin_altar');
    const before = JSON.stringify(d.saved().eventStateByNodeId);
    const gold = d.run.gold;
    d.press(d.choice('dawn'));
    d.menu.child.close(); // ESC / Close on the picker
    expect(d.menu.child).toBeNull();
    expect(d.run.gold).toBe(gold);
    expect(d.run.eventLog).toEqual([]);
    expect(eventState(d.run, d.node.id).choiceId).toBeUndefined();
    expect(JSON.stringify(d.saved().eventStateByNodeId)).toBe(before);
    // The page is as it was, choices still pressable.
    expect(d.choice('dawn').disabled).toBe(false);
  });

  it('a refused commit shows its reason and applies nothing', () => {
    const run = newRun({ gold: 250 });
    const d = new EventDriver({ run, eventId: 'twin_altar' });
    d.open();
    d.press(d.choice('dawn'));
    run.gold = 20; // the purse emptied while the confirmation was open
    const result = d.picker.apply(d.picker.choices[0]);
    expect(result).toEqual({ ok: false, reason: 'Not enough gold.' });
    expect(run.gold).toBe(20);
    expect(run.eventLog).toEqual([]);
  });

  it('the commit is saved at once, with the outcome page next', () => {
    const d = driver('drill_yard');
    expect(d.saved().eventStateByNodeId[d.node.id].choiceId).toBeUndefined();
    d.choose('rest');
    const saved = d.saved().eventStateByNodeId[d.node.id];
    expect(saved).toMatchObject({ choiceId: 'rest', outcomeId: 'rested' });
    expect(saved.text).toBe(eventState(d.run, d.node.id).text);
    expect(d.menu.closeButton.textContent).toBe('Continue');
    const text = d.text();
    expect(text).toContain('You chose: Rest in the barracks');
    expect(text).toContain('Real beds. Lumpy, but real.');
    // The choices are gone: nothing to choose twice.
    expect(d.choice('rest')).toBeUndefined();
  });
});

describe('the outcome page', () => {
  it('lists every result as a line with its chip, tone and detail (gold, item, hp, shadow, burden)', () => {
    const run = newRun({ gold: 0 });
    // Debt: gold in hand and a burden; chosen through the page.
    const d = new EventDriver({ run, eventId: 'moneylender' });
    d.open();
    d.choose('borrow');
    const lines = d.body.all().filter((n) => n.classList?.contains('ev-result'));
    const kinds = lines.map((l) => l.dataset.kind);
    expect(kinds).toEqual(['gold', 'burden']);
    const text = lines.map((l) => l.all().map((n) => n.textContent).join(' ')).join(' | '); // prettier-ignore
    // Borrowed { base: 300, perAct: 200 } in Act I: 500 G (the data's, by hand).
    expect(text).toMatch(/Gained 500 G/);
    expect(text).toContain('Burden: Debt');
    expect(lines[0].classList.contains('is-good')).toBe(true);
    expect(lines[1].classList.contains('is-bad')).toBe(true);
    // The numbers are the run's own.
    expect(run.gold).toBe(500);
    expect(run.burdens.map((b) => b.id)).toEqual(['debt']);
  });

  it('an outcome with no effects says nothing more, and Continue is the way on', () => {
    const d = driver('old_swordmaster');
    d.choose('leave');
    expect(d.body.all().some((n) => n.classList?.contains('ev-result'))).toBe(false);
    expect(d.text()).toContain('She nods at the woodpile as you go.');
    expect(d.button('Continue')).toBeTruthy();
  });

  it("shows the first event's note once, on the choosing page only, never over a result", () => {
    const d = driver('quiet_road');
    expect(d.menu.status).toBe(guidanceText('guide_first_event'));
    expect(d.text()).toContain(guidanceText('guide_first_event'));
    expect(d.hints.markSeen).toHaveBeenCalledWith('guide_first_event');
    d.choose('rest');
    expect(d.text()).not.toContain(guidanceText('guide_first_event'));
  });
});

describe('every shipped outcome renders a clean page', () => {
  // The engine's own test walks the outcomes; here each is drawn as a page.
  const triples = baseData.events.events.flatMap((event) =>
    event.choices.flatMap((choice) => choice.outcomes.map((o) => [event.id, choice.id, o.id])),
  );
  const army = (seed) => {
    const run = newRun({ seed, gold: 2000 });
    run.actSequence = ['act1', 'act2', 'act3', 'act4'];
    for (const [className, name] of [
      ['Archer', 'Hale'],
      ['Fighter', 'Brant'],
      ['Mage', 'Iona'],
      ['Cleric', 'Mara'],
      ['Knight', 'Dov'],
    ])
      addUnit(run, className, { name, level: 3 });
    const rook = addUnit(run, 'Cavalier', { name: 'Rook', level: 5 });
    rook.skills = ['pavise', 'wrath', 'guard'];
    fallAlly(run, rook);
    run.roster[0].consumables = [{ ...run.getConsumableTemplate('Vulnerary') }];
    return run;
  };

  it.each(triples)('%s / %s / %s', (eventId, choiceId, outcomeId) => {
    for (let seed = 1; seed <= 400; seed++) {
      const run = army(seed);
      const node = arriveAs(run, eventId);
      const view = eventView(run, node.id);
      const choice = view.choices.find((c) => c.id === choiceId);
      const target = choice.target
        ? choice.target.candidates.filter((c) => c.ok).at(-1)?.uid
        : null;
      const probe = chooseEventOption(run, node.id, choiceId, { targetUid: target });
      expect(probe.ok, probe.reason).toBe(true);
      if (probe.outcomeId !== outcomeId) continue;
      // The page, opened over the run as it now stands (the refresh path of a real one).
      const d = new EventDriver({ run, eventId: null });
      d.node = node;
      d.open();
      const text = d.text();
      expect(text).toContain(eventById(eventId).title);
      expect(text).toContain(probe.text);
      expect(text).not.toMatch(/undefined|NaN|\[object|\{[a-z]+\}/);
      const lines = d.body.all().filter((n) => n.classList?.contains('ev-result'));
      // A line for every record that is news (a flag and a battle marker are not).
      const news = probe.results.filter((r) => !['flag', 'battle'].includes(r.kind));
      const silent = news.filter(
        (r) =>
          (r.kind === 'shadow' && !r.value && !r.actValue) || (r.kind === 'vision' && !r.value),
      );
      expect(lines.length, `${eventId}/${choiceId}/${outcomeId}`).toBe(news.length - silent.length);
      // One way on: Fight while a battle is owed, else Continue.
      const owed = d.buttons().filter((b) => ['Fight', 'Continue'].includes(nodeText(b)));
      expect(owed.map(nodeText)).toEqual([probe.battle ? 'Fight' : 'Continue']);
      expect(d.menu.closeButton.textContent).toBe(probe.battle ? 'Close' : 'Continue');
      d.controller.destroy();
      return;
    }
    throw new Error(`no seed in 400 produced ${eventId}/${choiceId}/${outcomeId}`);
  });
});

describe('Continue and ESC', () => {
  it('Continue completes the node, saves, closes the page and checks the act', () => {
    const d = driver('drill_yard');
    d.choose('rest');
    expect(d.nodeNow.completed).toBe(false);
    d.press('Continue');
    expect(d.nodeNow.completed).toBe(true);
    expect(d.scene.eventOverlay).toBeNull();
    expect(d.scene.checkActComplete).toHaveBeenCalledTimes(1);
    expect(d.saved().nodeMap.nodes.find((n) => n.id === d.node.id).completed).toBe(true);
    expect(eventState(d.run, d.node.id).left).toBe(true);
    // The forward edges opened.
    const next = d.run.getAvailableNodes().map((n) => n.id);
    expect(next).toEqual(d.nodeNow.edges);
  });

  it('ESC before choosing returns to the map with the event still current; re-entry reopens it', () => {
    const d = driver('old_swordmaster');
    d.esc();
    expect(d.scene.eventOverlay).toBeNull();
    expect(d.nodeNow.completed).toBe(false);
    expect(d.run.currentNodeId).toBe(d.node.id);
    expect(d.scene.drawMap).toHaveBeenCalled();
    expect(d.scene.checkActComplete).not.toHaveBeenCalled();
    expect(eventState(d.run, d.node.id).choiceId).toBeUndefined();
    const picked = eventState(d.run, d.node.id).eventId;
    d.open();
    expect(d.text()).toContain(eventById('old_swordmaster').intro);
    expect(eventState(d.run, d.node.id).eventId).toBe(picked);
  });

  it('ESC on the picker only closes the picker', () => {
    const d = driver('old_swordmaster');
    d.press(d.choice('train'));
    d.esc();
    expect(d.menu.child).toBeNull();
    expect(d.scene.eventOverlay).not.toBeNull();
    expect(d.text()).toContain(eventById('old_swordmaster').intro);
  });

  it('ESC after choosing is Continue', () => {
    const d = driver('quiet_road');
    d.choose('rest');
    d.esc();
    expect(d.scene.eventOverlay).toBeNull();
    expect(d.nodeNow.completed).toBe(true);
    expect(d.scene.checkActComplete).toHaveBeenCalledTimes(1);
  });

  it('the header button follows the page: Close, then Continue', () => {
    const d = driver('quiet_road');
    expect(d.menu.closeButton.textContent).toBe('Close');
    d.choose('press_on');
    expect(d.menu.closeButton.textContent).toBe('Continue');
    d.menu.closeButton.onclick();
    expect(d.nodeNow.completed).toBe(true);
  });

  it('a second Continue (a double tap) changes nothing', () => {
    const d = driver('quiet_road');
    d.choose('rest');
    const continueButton = d.button('Continue');
    d.press(continueButton);
    const gold = d.run.gold;
    expect(d.controller.continueEvent()).toBe(false);
    expect(continueButton.onclick()).toBe(false);
    expect(d.run.gold).toBe(gold);
    expect(d.scene.checkActComplete).toHaveBeenCalledTimes(1);
  });
});

describe('a refresh at each step', () => {
  it('while choosing: the same event reopens on its choices, nothing re-picked', () => {
    const d = driver('old_swordmaster');
    const state = eventState(d.run, d.node.id);
    d.reload();
    d.open();
    expect(eventState(d.run, d.node.id)).toEqual(state);
    expect(d.text()).toContain(eventById('old_swordmaster').intro);
    expect(d.choice('train')).toBeTruthy();
  });

  it('at the outcome: the outcome page, the same text and lines, nothing applied twice', () => {
    const d = driver('moneylender');
    d.choose('borrow');
    const text = d.text();
    const gold = d.run.gold;
    const burdens = structuredClone(d.run.burdens);
    d.reload();
    d.open();
    expect(d.text()).toBe(text);
    expect(d.run.gold).toBe(gold);
    expect(d.run.burdens).toEqual(burdens);
    expect(d.run.eventLog).toHaveLength(1);
    expect(d.choice('borrow')).toBeUndefined(); // never the choices again
    expect(d.menu.closeButton.textContent).toBe('Continue');
  });

  it('with a fight owed: the outcome page with only Fight', () => {
    const d = driver('abandoned_armory');
    d.choose('door');
    d.reload();
    d.open();
    expect(d.buttons().map(nodeText)).toEqual(expect.arrayContaining(['Fight', 'Roster']));
    expect(d.menu.closeButton.textContent).toBe('Close');
    expect(d.buttons().map(nodeText)).not.toContain('Continue');
    expect(d.text()).toContain('There is no way around this fight.');
  });
});

describe('a fight', () => {
  it('shows only Fight (no Continue), and ESC leaves the fight owed', () => {
    const d = driver('abandoned_armory');
    d.choose('door');
    expect(d.text()).toContain('Someone was still home.');
    expect(d.buttons().map(nodeText)).not.toContain('Continue');
    expect(d.menu.closeButton.textContent).toBe('Close');
    // The engine will not let the node be left either.
    expect(d.controller.continueEvent()).toBe(false);
    d.esc();
    expect(d.scene.eventOverlay).toBeNull();
    expect(d.nodeNow.completed).toBe(false);
    expect(eventState(d.run, d.node.id).battle).toBe('pending');
    expect(d.nodeNow.type).toBe('event');
    d.open();
    expect(d.buttons().map(nodeText)).toContain('Fight');
  });

  it("Fight takes the route map's battle locks and goes through handleBattle", () => {
    const d = driver('abandoned_armory');
    d.choose('door');
    d.press('Fight');
    expect(d.scene.battleLaunchInFlight).toBe(true);
    expect(d.scene.isTransitioning).toBe(true);
    expect(d.scene.isSceneReady).toBe(false);
    expect(d.scene.input.enabled).toBe(false);
    expect(d.scene.handleBattle).toHaveBeenCalledWith(d.nodeNow, 1);
    expect(d.scene.eventOverlay).toBeNull();
    expect(d.nodeNow.type).toBe('event');
    expect(d.nodeNow.eventBattle).toBe(true);
  });

  it('a won fight opens its spoils once; Continue then completes; a refresh in between keeps both', () => {
    const d = driver('abandoned_armory');
    d.choose('door');
    d.fightAndWin();
    const goldBefore = d.run.gold;
    // Back on the route map: the controller settles the spoils and opens the victory page.
    expect(d.controller.handleEvent(d.nodeNow)).toBe(true);
    // The door's spoils: { base: 100, perAct: 100 } in Act I is 200 G, and a weapon.
    expect(d.run.gold).toBe(goldBefore + 200);
    const text = d.text();
    expect(text).toContain('The fight is won.');
    expect(text).toContain(
      'The door gives way to a cellar cache nobody had touched. Weapons, and a strongbox.',
    );
    expect(text).toContain('Gained 200 G');
    expect(d.menu.closeButton.textContent).toBe('Continue');
    expect(d.run.pendingEventNodeId).toBeNull();
    // A refresh on the victory page: it reopens (Continue was not pressed), nothing is paid again.
    d.reload();
    expect(d.run.gold).toBe(goldBefore + 200);
    expect(d.run.canReenterService(d.node.id)).toBe(true);
    expect(d.controller.handleEvent(d.nodeNow)).toBe(true);
    expect(d.text()).toContain('Gained 200 G');
    expect(d.run.gold).toBe(goldBefore + 200);
    d.press('Continue');
    expect(d.run.gold).toBe(goldBefore + 200);
    expect(d.scene.checkActComplete).toHaveBeenCalledTimes(1);
    // Left: nothing more to reopen, here or after another refresh.
    expect(d.run.canReenterService(d.node.id)).toBe(false);
    expect(d.controller.handleEvent(d.nodeNow)).toBe(false);
    d.reload();
    expect(d.controller.handleEvent(d.nodeNow)).toBe(false);
  });

  it('the victory is settled once even if the page is opened twice', () => {
    const d = driver('abandoned_armory');
    d.choose('door');
    d.fightAndWin();
    const gold = d.run.gold;
    d.controller.handleEvent(d.nodeNow);
    d.controller.closeEventOverlay();
    d.controller.handleEvent(d.nodeNow); // e.g. a second return to the map
    expect(d.run.gold).toBe(gold + 200);
  });

  it('a refresh before the spoils are taken reopens as owed: the spoils apply once, on opening', () => {
    const d = driver('abandoned_armory');
    d.choose('door');
    d.fightAndWin();
    const gold = d.run.gold;
    d.reload();
    // The saved run has the battle won and the spoils owed.
    expect(d.run.pendingEventNodeId).toBe(d.node.id);
    expect(d.run.canReenterService(d.node.id)).toBe(true);
    d.controller.handleEvent(d.nodeNow);
    expect(d.run.gold).toBe(gold + 200);
    expect(d.text()).toContain('The fight is won.');
  });

  it('a revert (Continue from Map) reopens the outcome with only Fight, the choice unchanged', () => {
    const d = driver('abandoned_armory');
    d.choose('door');
    const state = eventState(d.run, d.node.id);
    d.press('Fight'); // the battle is entered, then abandoned: the run reloads at its entry
    d.reload();
    expect(d.nodeNow.completed).toBe(false);
    d.open();
    expect(d.buttons().map(nodeText)).toContain('Fight');
    expect(d.buttons().map(nodeText)).not.toContain('Continue');
    expect(d.choice('racks')).toBeUndefined();
    expect(eventState(d.run, d.node.id)).toEqual(state);
  });
});

describe('the unknown event', () => {
  it('an event this build does not know can only be walked past, and the node completes', () => {
    const run = newRun();
    const node = arriveAs(run, 'quiet_road');
    run.eventStateByNodeId[node.id].eventId = 'from_a_later_build';
    const d = new EventDriver({ run });
    d.node = node;
    d.open();
    expect(d.text()).toContain('Whatever waited here has gone from the road.');
    d.press('Walk on');
    expect(node.completed).toBe(true);
    expect(d.scene.eventOverlay).toBeNull();
    expect(d.scene.checkActComplete).toHaveBeenCalled();
  });

  it('a node the engine cannot arrive at (no catalog, a prologue map) never traps the route', () => {
    const run = newRun();
    const node = arriveAs(run, 'quiet_road');
    delete run.eventStateByNodeId[node.id];
    run.gameData = { ...run.gameData, events: null };
    const d = new EventDriver({ run });
    d.node = node;
    expect(d.open()).toBe(false);
    expect(node.completed).toBe(true);
    expect(d.scene.checkActComplete).toHaveBeenCalled();
    expect(d.scene.eventOverlay).toBeFalsy();
  });
});

describe('the first-event note', () => {
  it('shows once per slot', () => {
    const first = driver('quiet_road');
    expect(first.menu.status).toBe(guidanceText('guide_first_event'));
    const seen = first.seen;
    first.controller.destroy();
    const run = newRun({ seed: 7 });
    const second = new EventDriver({ run, eventId: 'quiet_road', hints: { seen } });
    second.open();
    expect(second.menu.status).toBe('');
    expect(second.text()).not.toContain(guidanceText('guide_first_event'));
  });

  it('is off with Guidance Off, and never in the prologue', () => {
    const off = new EventDriver({ eventId: 'quiet_road', guidance: 'off' });
    off.open();
    expect(off.menu.status).toBe('');
    const run = newRun();
    run.mode = 'prologue';
    const prologue = new EventDriver({ run, eventId: 'quiet_road' });
    prologue.open();
    // The engine has no events in the prologue, and the note stays unseen.
    expect(prologue.hints.markSeen).not.toHaveBeenCalled();
  });

  it('shows on the choosing page after a reload only if still unseen (a seen note stays seen)', () => {
    const d = driver('quiet_road');
    expect(d.seen.has('guide_first_event')).toBe(true);
    d.controller.destroy();
    d.bind();
    d.open();
    expect(d.menu.status).toBe('');
  });
});
