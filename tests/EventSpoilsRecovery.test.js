// A won event fight owes its spoils (docs/specs/event-nodes.md §16/§17). When taking them
// fails, nothing may be lost: the engine rolls the attempt back, the node still owes them
// (from the saved state alone, never from a marker), the party cannot walk on without them,
// and the page offers Try again, Back to map and a confirmed Give up. The Abandoned Armory's
// door is the fixture: its spoils are a weapon, then 200 G in Act I (two effects, so a fault
// planted in the second proves the first was rolled back).
//
// Ways this can fail, a test (or a group) each:
//   1. a failed settlement clears the owed marker, so the spoils are forfeited, durably;
//   2. the failed attempt leaves its first effect applied (a weapon with no gold), or the
//      retry applies the first effect twice;
//   3. the owed state lives only in `pendingEventNodeId`: a lost marker (an old save, the
//      failure path itself) strands the spoils;
//   4. Continue / Travel is possible while the spoils are owed (they are walked away from);
//   5. the failure page is missing its reason or one of its three ways on, or traps the
//      player: Back to map does not close it, ESC does not, or the route map reopens it
//      again at once;
//   6. Try again with the fault gone does not grant the full reward exactly once;
//   7. Give up is not confirmed, not terminal, not durable, or reachable with nothing owed;
//   8. an event this build cannot read, with spoils owed, deadlocks the node.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { JourneyStorage } from './harness/RunDriver.js';
import { EventDriver, nodeText } from './harness/EventDriver.js';
import { loadRun, saveRun } from '../src/engine/RunManager.js';
import {
  completeEventBattle,
  eventSpoilsOwed,
  eventState,
  eventView,
  forfeitEventSpoils,
  getPendingEventSettlement,
  leaveEvent,
} from '../src/engine/EventCommands.js';
import { sanitizeEventStates } from '../src/engine/EventSystem.js';
import { baseData, newRun } from './eventKit.js';

vi.mock('../src/ui/MobileRosterSheet.js', () => ({
  MobileRosterSheet: class {
    constructor(options) {
      Object.assign(this, options);
    }
    destroy() {}
  },
}));

let storage;
beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { activeElement: null });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const FAULT = 'planted fault';
/** The next gold payment throws once (the spoils' second effect), then the run behaves. */
const plantFault = (run) =>
  vi.spyOn(run, 'addGold').mockImplementationOnce(() => {
    throw new Error(FAULT);
  });
const weaponsCarried = (run) =>
  run.roster.reduce((n, unit) => n + unit.inventory.length, 0) + run.convoy.weapons.length;
const whole = (run) => JSON.stringify(run.toJSON());
const reasonLine = 'The spoils could not be taken (planted fault).';

/** The armory's door, fought and won: the party is back on the route map, spoils owed. */
function wonDoor() {
  const d = new EventDriver({ eventId: 'abandoned_armory' });
  d.open();
  d.choose('door');
  d.fightAndWin();
  return d;
}

describe('what the engine owes', () => {
  it('owes the spoils from the saved state alone: a fight won, nothing taken, whatever the marker says', () => {
    const d = new EventDriver({ eventId: 'abandoned_armory' });
    d.open();
    d.choose('door');
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(false); // the fight is not won yet
    d.fightAndWin();
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(true);
    d.run.pendingEventNodeId = null; // a lost marker (an old save)
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(true);
    expect(getPendingEventSettlement(d.run)).toBe(d.node.id);
    expect(completeEventBattle(d.run, d.node.id).ok).toBe(true);
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(false);
    expect(getPendingEventSettlement(d.run)).toBeNull();
  });

  it('a failed settlement changes nothing, keeps the spoils owed and keeps the party here', () => {
    const d = wonDoor();
    const before = whole(d.run);
    const weapons = weaponsCarried(d.run);
    plantFault(d.run);
    const result = completeEventBattle(d.run, d.node.id);
    expect(result).toEqual({ ok: false, reason: reasonLine });
    // The first effect (the weapon) was rolled back with the second (the gold).
    expect(weaponsCarried(d.run)).toBe(weapons);
    expect(whole(d.run)).toBe(before);
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(true);
    expect(d.run.pendingEventNodeId).toBe(d.node.id);
    expect(leaveEvent(d.run, d.node.id)).toEqual({ ok: false, reason: 'Settle the battle first.' });
    // Walking on would leave them behind for good: only this node can be entered.
    expect(d.run.getAvailableNodes().map((n) => n.id)).toEqual([d.node.id]);
    expect(d.run.canReenterService(d.node.id)).toBe(true);
  });

  it('keeps them owed through a save and a load, even with the marker gone; a retry then grants the whole reward once', () => {
    const d = wonDoor();
    const gold = d.run.gold;
    const weapons = weaponsCarried(d.run);
    plantFault(d.run);
    expect(completeEventBattle(d.run, d.node.id).ok).toBe(false);
    d.run.pendingEventNodeId = null;
    saveRun(d.run, null, 1);
    const loaded = loadRun(baseData, 1);
    expect(eventSpoilsOwed(loaded, d.node.id)).toBe(true);
    expect(getPendingEventSettlement(loaded)).toBe(d.node.id);
    expect(loaded.getAvailableNodes().map((n) => n.id)).toEqual([d.node.id]);
    // The fault is gone: the full reward, exactly once.
    const retry = completeEventBattle(loaded, d.node.id);
    expect(retry.ok).toBe(true);
    expect(loaded.gold).toBe(gold + 200);
    expect(weaponsCarried(loaded)).toBe(weapons + 1);
    expect(retry.results.map((r) => r.kind)).toEqual(['item', 'gold']);
    // Again, and after another reload: nothing more.
    expect(completeEventBattle(loaded, d.node.id)).toMatchObject({ ok: false, already: true });
    saveRun(loaded, null, 1);
    const again = loadRun(baseData, 1);
    expect(completeEventBattle(again, d.node.id)).toMatchObject({ ok: false, already: true });
    expect(again.gold).toBe(gold + 200);
    expect(weaponsCarried(again)).toBe(weapons + 1);
    expect(eventSpoilsOwed(again, d.node.id)).toBe(false);
    // Settled: the party may walk on once the page is left.
    expect(leaveEvent(again, d.node.id).ok).toBe(true);
    expect(again.getAvailableNodes().map((n) => n.id)).not.toContain(d.node.id);
  });

  it('Give up is terminal, durable, applies nothing and lets Continue complete the node', () => {
    const d = wonDoor();
    const gold = d.run.gold;
    const weapons = weaponsCarried(d.run);
    plantFault(d.run);
    expect(completeEventBattle(d.run, d.node.id).ok).toBe(false);
    expect(forfeitEventSpoils(d.run, d.node.id)).toEqual({ ok: true });
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(false);
    expect(d.run.pendingEventNodeId).toBeNull();
    expect(eventState(d.run, d.node.id)).toMatchObject({ battle: 'won', spoilsForfeited: true });
    expect(d.run.gold).toBe(gold);
    expect(weaponsCarried(d.run)).toBe(weapons);
    // Nothing can take them afterwards, and the view says they were given up.
    expect(completeEventBattle(d.run, d.node.id)).toMatchObject({ ok: false, already: true });
    expect(eventView(d.run, d.node.id)).toMatchObject({
      phase: 'victory',
      spoilsOwed: false,
      canLeave: true,
      victory: { forfeited: true, text: '' },
    });
    // It survives a reload; Continue completes the node and the party can walk on.
    saveRun(d.run, null, 1);
    const loaded = loadRun(baseData, 1);
    expect(eventState(loaded, d.node.id)).toMatchObject({ battle: 'won', spoilsForfeited: true });
    expect(eventSpoilsOwed(loaded, d.node.id)).toBe(false);
    expect(completeEventBattle(loaded, d.node.id).ok).toBe(false);
    expect(leaveEvent(loaded, d.node.id).ok).toBe(true);
    expect(loaded.gold).toBe(gold);
    expect(loaded.getAvailableNodes().length).toBeGreaterThan(0);
    expect(loaded.getAvailableNodes().map((n) => n.id)).not.toContain(d.node.id);
  });

  it('Give up is refused when nothing is owed: before the fight, after the spoils, twice', () => {
    const d = new EventDriver({ eventId: 'abandoned_armory' });
    d.open();
    expect(forfeitEventSpoils(d.run, d.node.id).ok).toBe(false); // nothing chosen
    d.choose('door');
    expect(forfeitEventSpoils(d.run, d.node.id).ok).toBe(false); // the fight is not won
    expect(eventState(d.run, d.node.id).battle).toBe('pending');
    d.fightAndWin();
    expect(completeEventBattle(d.run, d.node.id).ok).toBe(true);
    const gold = d.run.gold;
    expect(forfeitEventSpoils(d.run, d.node.id).ok).toBe(false); // already taken
    expect(eventState(d.run, d.node.id).spoilsForfeited).toBeUndefined();
    expect(d.run.gold).toBe(gold);
    // A node that is not an event at all.
    const other = d.run.nodeMap.nodes.find((n) => n.type !== 'event');
    expect(forfeitEventSpoils(d.run, other.id).ok).toBe(false);
  });

  it('an old save (no forfeit field) loads unchanged; the forfeit field survives the sanitizer', () => {
    const state = {
      eventId: 'abandoned_armory',
      results: [],
      victoryResults: [],
      battle: 'won',
      afterVictory: [],
    };
    expect(sanitizeEventStates({ n1: state }).n1).not.toHaveProperty('spoilsForfeited');
    expect(sanitizeEventStates({ n1: { ...state, spoilsForfeited: true } }).n1).toMatchObject({
      spoilsForfeited: true,
    });
    expect(sanitizeEventStates({ n1: { ...state, spoilsForfeited: 'yes' } }).n1).not.toHaveProperty(
      'spoilsForfeited',
    );
  });
});

describe('the failure page', () => {
  /** The route map's return: the controller settles, the fault bites, the page opens failed. */
  function failedPage() {
    const d = wonDoor();
    plantFault(d.run);
    d.gold = d.run.gold;
    d.weapons = weaponsCarried(d.run);
    expect(d.controller.handleEvent(d.nodeNow)).toBe(true);
    return d;
  }
  const labels = (d) => d.buttons().map(nodeText);

  it('opens in its failed state with the reason and its ways on; nothing is cleared, nothing granted', () => {
    const d = failedPage();
    const text = d.text();
    expect(text).toContain('The fight is won.');
    expect(text).toContain('The spoils could not be taken.');
    expect(text).toContain(reasonLine);
    expect(text).toContain('Nothing was lost');
    expect(labels(d)).toEqual(
      expect.arrayContaining(['Try again', 'Back to map', 'Give up the spoils', 'Roster']),
    );
    expect(labels(d)).not.toContain('Continue');
    expect(d.menu.closeButton.textContent).toBe('Back to map');
    // Try again is the primary action (focused first); the destructive one is not.
    expect(d.menu.primary).toBe(d.button('Try again'));
    // Neither the marker nor the state was touched, in memory or in the saved slot.
    expect(d.run.pendingEventNodeId).toBe(d.node.id);
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(true);
    expect(d.run.gold).toBe(d.gold);
    expect(weaponsCarried(d.run)).toBe(d.weapons);
    expect(eventSpoilsOwed(d.saved(), d.node.id)).toBe(true);
  });

  it('Try again with the fault gone grants the whole reward once and shows the victory page', () => {
    const d = failedPage();
    d.press('Try again');
    expect(d.run.gold).toBe(d.gold + 200);
    expect(weaponsCarried(d.run)).toBe(d.weapons + 1);
    const text = d.text();
    expect(text).toContain('Gained 200 G');
    expect(text).not.toContain('The spoils could not be taken.');
    expect(labels(d)).toContain('Continue');
    expect(labels(d)).not.toContain('Try again');
    expect(d.menu.closeButton.textContent).toBe('Continue');
    expect(eventSpoilsOwed(d.saved(), d.node.id)).toBe(false);
    // A reload on the victory page, then Continue: nothing more is paid.
    d.reload();
    expect(d.controller.handleEvent(d.nodeNow)).toBe(true);
    d.press('Continue');
    expect(d.run.gold).toBe(d.gold + 200);
    expect(weaponsCarried(d.run)).toBe(d.weapons + 1);
    expect(d.scene.checkActComplete).toHaveBeenCalledTimes(1);
  });

  it('Try again while it still fails says so and keeps everything owed', () => {
    const d = failedPage();
    plantFault(d.run);
    d.press('Try again');
    expect(d.text()).toContain(`Still could not be taken: ${reasonLine}`);
    expect(labels(d)).toContain('Try again');
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(true);
    expect(d.run.gold).toBe(d.gold);
    d.press('Try again'); // the fault was one-time: now it works
    expect(d.text()).toContain('Gained 200 G');
    expect(d.run.gold).toBe(d.gold + 200);
    expect(weaponsCarried(d.run)).toBe(d.weapons + 1);
  });

  it('Back to map closes it without trapping: the route map does not reopen it by itself, a click does', () => {
    const d = failedPage();
    d.press('Back to map');
    expect(d.scene.eventOverlay).toBeNull();
    expect(d.scene.drawMap).toHaveBeenCalled();
    // Everything is still owed and saved.
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(true);
    expect(d.run.pendingEventNodeId).toBe(d.node.id);
    expect(eventSpoilsOwed(d.saved(), d.node.id)).toBe(true);
    // The map's own opening (a scene start, the loot screen's end) leaves it closed.
    expect(d.controller.handleEvent(d.nodeNow, { auto: true })).toBe(false);
    expect(d.scene.eventOverlay).toBeNull();
    // Re-entering the node (a click) tries again: the fault is gone, the spoils arrive.
    expect(d.controller.handleEvent(d.nodeNow)).toBe(true);
    expect(d.text()).toContain('Gained 200 G');
    expect(d.run.gold).toBe(d.gold + 200);
  });

  it('ESC is Back to map too: it closes the page and keeps everything owed', () => {
    const d = failedPage();
    d.esc();
    expect(d.scene.eventOverlay).toBeNull();
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(true);
    expect(d.run.gold).toBe(d.gold);
    expect(d.controller.handleEvent(d.nodeNow, { auto: true })).toBe(false);
  });

  it('a reload tries again: the map reopens the owed page by itself on the next scene start', () => {
    const d = failedPage();
    d.press('Back to map');
    d.reload();
    plantFault(d.run);
    // The new scene's automatic opening: it fails again and opens the failed page ...
    expect(d.controller.handleEvent(d.nodeNow, { auto: true })).toBe(true);
    expect(d.text()).toContain('The spoils could not be taken.');
    // ... which can be closed, and which does not come back by itself.
    d.press('Back to map');
    expect(d.controller.handleEvent(d.nodeNow, { auto: true })).toBe(false);
    // Another scene start with the fault gone settles it.
    d.reload();
    expect(d.controller.handleEvent(d.nodeNow, { auto: true })).toBe(true);
    expect(d.text()).toContain('Gained 200 G');
  });

  it('Give up asks first: declining changes nothing, confirming is final', () => {
    const d = failedPage();
    d.press('Give up the spoils');
    expect(d.picker.title).toBe('Give up the spoils?');
    expect(d.picker.confirmation).toBe(true);
    expect(d.picker.closeLabel).toBe('Keep them owed');
    expect(d.picker.describe()).toContain('This cannot be undone.');
    // Declined (the picker's close): still owed, still the failed page.
    d.menu.child.close();
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(true);
    expect(d.text()).toContain('The spoils could not be taken.');
    // Confirmed.
    d.press('Give up the spoils');
    d.confirm();
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(false);
    const text = d.text();
    expect(text).toContain('The fight is won.');
    expect(text).toContain('You gave up the spoils.');
    expect(text).not.toContain('cellar cache'); // the fight's own words promise what nobody took
    expect(text).not.toContain('The spoils could not be taken.');
    expect(d.run.gold).toBe(d.gold);
    expect(weaponsCarried(d.run)).toBe(d.weapons);
    expect(d.run.pendingEventNodeId).toBeNull();
    // Saved at once: a refresh reopens the victory page, never the failure.
    d.reload();
    expect(d.run.canReenterService(d.node.id)).toBe(true);
    expect(d.controller.handleEvent(d.nodeNow, { auto: true })).toBe(true);
    expect(d.text()).toContain('You gave up the spoils.');
    // Continue completes the node; nothing reopens after it.
    d.press('Continue');
    expect(d.run.gold).toBe(d.gold);
    expect(d.scene.checkActComplete).toHaveBeenCalledTimes(1);
    expect(d.run.canReenterService(d.node.id)).toBe(false);
    d.reload();
    expect(d.controller.handleEvent(d.nodeNow, { auto: true })).toBe(false);
    expect(d.run.getAvailableNodes().map((n) => n.id)).not.toContain(d.node.id);
  });

  it('an event this build cannot read, with spoils owed, can still be walked past (no deadlock)', () => {
    const d = wonDoor();
    d.run.eventStateByNodeId[d.node.id].eventId = 'from_a_later_build';
    saveRun(d.run, null, 1);
    d.reload();
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(true);
    expect(d.controller.handleEvent(d.nodeNow)).toBe(true);
    expect(d.text()).toContain('Whatever waited here has gone from the road.');
    d.press('Walk on');
    expect(eventSpoilsOwed(d.run, d.node.id)).toBe(false);
    expect(d.nodeNow.completed).toBe(true);
    expect(d.scene.checkActComplete).toHaveBeenCalled();
    expect(d.run.getAvailableNodes().map((n) => n.id)).not.toContain(d.node.id);
  });
});
