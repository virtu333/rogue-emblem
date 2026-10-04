// The row-2 roster lesson (engine/PrologueRosterLesson.js; docs/specs/prologue-chapter.md
// §6 "Route map, row 2"): live only in the prologue run at the node Tamsin joined, four
// goals in order, each completed by the real action the roster sheet reports (any
// order: a goal met early counts), a goal the army can't do skipped with its reason,
// Skip step / Skip lesson, never a gate, and the ledger saved with the run.
import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';
import {
  ROSTER_LESSON_STEPS,
  advanceRosterLesson,
  dismissRosterLesson,
  isRosterLessonFinished,
  isRosterLessonLive,
  normalizeRosterLesson,
  observeRosterAction,
  rosterLessonSubject,
  rosterLessonView,
  skipRosterLessonStep,
} from '../src/engine/PrologueRosterLesson.js';
import { rosterItemAction } from '../src/engine/RosterInventory.js';
import { applyTrade, CONVOY_HOLDER, unitHolder } from '../src/engine/ItemTrade.js';
import { rosterTradeEvents } from '../src/ui/PrologueRosterCoach.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

/** A prologue run that won P1 and P2, at the Market with Tamsin joined (the bow in the convoy). */
function atFork({ nodeId = 'prologue_2a', bow = true } = {}) {
  const rm = new RunManager(data, null);
  rm.startPrologue(data, data.prologue);
  rm.completeBattle(rm.roster, 'prologue_0', 0);
  rm.completeBattle(rm.roster, 'prologue_1', 0);
  if (bow) rm.addToConvoy(weapon('Iron Bow'));
  rm.currentNodeId = nodeId;
  rm.arriveAtPrologueNode(nodeId);
  return rm;
}
const named = (rm, name) => rm.roster.find((u) => u.name === name);
const step = (rm) => rosterLessonView(rm)?.step ?? null;

describe('when the lesson runs', () => {
  it('only in the prologue run, at the node its subject joined', () => {
    const rm = atFork();
    expect(rosterLessonSubject(rm)?.name).toBe('Tamsin');
    expect(isRosterLessonLive(rm)).toBe(true);
    // Travel ends it (the party left the node): never a gate on the road.
    rm.currentNodeId = 'prologue_3';
    expect(isRosterLessonLive(rm)).toBe(false);
    rm.currentNodeId = 'prologue_1';
    expect(isRosterLessonLive(rm)).toBe(false);
    const standard = new RunManager(data, null);
    standard.startRun({ difficultyId: 'normal' });
    expect(isRosterLessonLive(standard)).toBe(false);
    expect(advanceRosterLesson(standard)).toBeNull();
  });

  it('at either fork node', () => {
    expect(isRosterLessonLive(atFork({ nodeId: 'prologue_2b' }))).toBe(true);
  });
});

describe('the steps, each done by its real action', () => {
  it('Withdraw, Equip, Trade, Store in order, through the roster commands the sheet runs', () => {
    const rm = atFork();
    expect(advanceRosterLesson(rm)).toMatchObject({
      step: 'withdraw',
      index: 1,
      total: 4,
      subject: 'Tamsin',
      target: { available: true, unit: 'Tamsin', item: 'Iron Bow' },
    });
    const tamsin = named(rm, 'Tamsin');
    // Withdraw: the bow from the convoy to Tamsin (rosterItemAction auto-equips it).
    const bow = rm.getConvoyItems().weapons.find((w) => w.name === 'Iron Bow');
    expect(rosterItemAction(rm, tamsin, bow, 'withdraw')).toBe('');
    expect(tamsin.weapon?.name).toBe('Iron Bow');
    expect(observeRosterAction(rm, { action: 'withdraw', unit: 'Tamsin', item: 'Iron Bow' })).toEqual(['withdraw']); // prettier-ignore
    // Equip: the auto-equip is not the practice; Gaspar's spare is the target.
    expect(rosterLessonView(rm)).toMatchObject({
      step: 'equip',
      target: { available: true, unit: 'Gaspar', item: 'Iron Sword' },
    });
    const gaspar = named(rm, 'Gaspar');
    const sword = gaspar.inventory.find((w) => w.name === 'Iron Sword');
    expect(rosterItemAction(rm, gaspar, sword, 'equip')).toBe('');
    expect(observeRosterAction(rm, { action: 'equip', unit: 'Gaspar', item: 'Iron Sword' })).toEqual(['equip']); // prettier-ignore
    // Trade: Edric's Vulnerary to Tamsin, unit to unit.
    expect(rosterLessonView(rm)).toMatchObject({
      step: 'trade',
      target: { available: true, unit: 'Tamsin', giver: 'Edric', item: 'Vulnerary' },
    });
    const edric = named(rm, 'Edric');
    const vulnerary = edric.consumables[0];
    const from = { holder: unitHolder(edric), bag: 'consumables', item: vulnerary };
    const to = { holder: unitHolder(tamsin), bag: 'consumables' };
    expect(applyTrade({ context: 'roster', run: rm }, from, to).ok).toBe(true);
    for (const event of rosterTradeEvents(from, to, vulnerary)) observeRosterAction(rm, event);
    expect(tamsin.consumables.map((c) => c.name)).toEqual(['Vulnerary']);
    // Store: a spare in the convoy.
    expect(rosterLessonView(rm)).toMatchObject({ step: 'store', target: { available: true } });
    const spare = gaspar.inventory.find((w) => w !== gaspar.weapon);
    expect(rosterItemAction(rm, gaspar, spare, 'store')).toBe('');
    expect(observeRosterAction(rm, { action: 'store', unit: 'Gaspar', item: spare.name })).toEqual(['store']); // prettier-ignore
    expect(rosterLessonView(rm)).toBeNull();
    expect(isRosterLessonFinished(rm)).toBe(true);
    expect(isRosterLessonLive(rm)).toBe(false);
    expect(rm.prologueRosterLesson).toEqual({
      completed: ['withdraw', 'equip', 'trade', 'store'],
      skipped: [],
      dismissed: false,
    });
  });

  it('a step only completes on its own action: browsing, using an item or the wrong unit never counts', () => {
    const rm = atFork();
    advanceRosterLesson(rm);
    expect(observeRosterAction(rm, { action: 'use', unit: 'Edric', item: 'Vulnerary' })).toEqual([]); // prettier-ignore
    expect(observeRosterAction(rm, { action: 'withdraw', unit: 'Edric', item: 'Iron Lance' })).toEqual([]); // prettier-ignore
    expect(observeRosterAction(rm, { action: 'trade', from: 'Edric', to: 'Edric' })).toEqual([]);
    expect(step(rm)).toBe('withdraw');
  });

  it('a goal met early counts, in any order', () => {
    const rm = atFork();
    advanceRosterLesson(rm);
    expect(observeRosterAction(rm, { action: 'store', unit: 'Gaspar', item: 'Iron Sword' })).toEqual(['store']); // prettier-ignore
    expect(step(rm)).toBe('withdraw');
    observeRosterAction(rm, { action: 'withdraw', unit: 'Tamsin', item: 'Iron Bow' });
    expect(step(rm)).toBe('equip');
    expect(rm.prologueRosterLesson.completed).toEqual(['store', 'withdraw']);
  });

  it('a trade, a withdraw and a store made in the trade menu are read as such', () => {
    const tamsin = { name: 'Tamsin' };
    const edric = { name: 'Edric' };
    const item = { name: 'Vulnerary' };
    expect(rosterTradeEvents({ holder: unitHolder(edric) }, { holder: unitHolder(tamsin) }, item)).toEqual([{ action: 'trade', from: 'Edric', to: 'Tamsin', item: 'Vulnerary' }]); // prettier-ignore
    expect(rosterTradeEvents({ holder: CONVOY_HOLDER }, { holder: unitHolder(tamsin) }, item)).toEqual([{ action: 'withdraw', unit: 'Tamsin', item: 'Vulnerary' }]); // prettier-ignore
    expect(rosterTradeEvents({ holder: unitHolder(edric) }, { holder: CONVOY_HOLDER }, item)).toEqual([{ action: 'store', unit: 'Edric', item: 'Vulnerary' }]); // prettier-ignore
    expect(rosterTradeEvents({ holder: unitHolder(edric) }, { holder: unitHolder(edric) }, item)).toEqual([]); // prettier-ignore
  });
});

describe('the army decides what can be taught', () => {
  it('Tamsin armed before the lesson (a bow bought at the Market) has withdrawn: the goal is met', () => {
    const rm = atFork();
    named(rm, 'Tamsin').inventory.push(weapon('Iron Bow'));
    expect(advanceRosterLesson(rm).step).toBe('equip');
    expect(rm.prologueRosterLesson.completed).toEqual(['withdraw']);
  });

  it('no bow anywhere for her: Withdraw is skipped with its reason', () => {
    const rm = atFork();
    rm.convoy.weapons = rm.convoy.weapons.filter((w) => w.name !== 'Iron Bow');
    expect(rosterLessonView(rm).target).toMatchObject({ available: false, reason: 'no_weapon_in_convoy' }); // prettier-ignore
    expect(advanceRosterLesson(rm).step).toBe('equip');
    expect(rm.prologueRosterLesson.skipped).toEqual(['withdraw']);
  });

  it('Edric spent his Vulnerary in P1 or P2: the trade points at any carried item, else it is skipped', () => {
    const rm = atFork();
    advanceRosterLesson(rm);
    observeRosterAction(rm, { action: 'withdraw', unit: 'Tamsin' });
    observeRosterAction(rm, { action: 'equip', unit: 'Gaspar' });
    named(rm, 'Edric').consumables = [];
    named(rm, 'Gaspar').consumables = [{ name: 'Vulnerary', type: 'Consumable', uses: 3 }];
    expect(rosterLessonView(rm).target).toMatchObject({ giver: 'Gaspar', item: 'Vulnerary' });
    for (const u of rm.roster) u.consumables = [];
    expect(rosterLessonView(rm).target).toMatchObject({ available: false, reason: 'no_spare_consumable' }); // prettier-ignore
    expect(advanceRosterLesson(rm).step).toBe('store');
    expect(rm.prologueRosterLesson.skipped).toEqual(['trade']);
  });
});

describe('skip and leave', () => {
  it('Skip step moves on; Skip lesson ends it; neither ever blocks travel', () => {
    const rm = atFork();
    advanceRosterLesson(rm);
    expect(skipRosterLessonStep(rm)).toBe('withdraw');
    expect(step(rm)).toBe('equip');
    expect(dismissRosterLesson(rm)).toBe(true);
    expect(rosterLessonView(rm)).toBeNull();
    expect(isRosterLessonLive(rm)).toBe(false);
    expect(isRosterLessonFinished(rm)).toBe(true);
    // Travel was available the whole time: the fork's next node.
    rm.markNodeComplete('prologue_2a');
    expect(rm.getAvailableNodes().map((n) => n.id)).toEqual(['prologue_3']);
  });

  it('the ledger is saved with the run and shows once: a finished lesson never comes back', () => {
    const rm = atFork();
    advanceRosterLesson(rm);
    observeRosterAction(rm, { action: 'withdraw', unit: 'Tamsin' });
    const loaded = RunManager.fromJSON(rm.toJSON(), data);
    expect(loaded.prologueRosterLesson).toEqual({ completed: ['withdraw'], skipped: [], dismissed: false }); // prettier-ignore
    expect(step(loaded)).toBe('equip');
    dismissRosterLesson(loaded);
    const again = RunManager.fromJSON(loaded.toJSON(), data);
    expect(isRosterLessonLive(again)).toBe(false);
    expect(advanceRosterLesson(again)).toBeNull();
  });

  it('a saved ledger is cleaned on load', () => {
    expect(normalizeRosterLesson(null)).toBeNull();
    expect(normalizeRosterLesson([])).toBeNull();
    expect(normalizeRosterLesson({ completed: ['withdraw', 'bogus', 'withdraw'], skipped: 'x', dismissed: 1 })).toEqual({ completed: ['withdraw'], skipped: [], dismissed: false }); // prettier-ignore
    expect(ROSTER_LESSON_STEPS).toEqual(['withdraw', 'equip', 'trade', 'store']);
  });
});
