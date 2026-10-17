// A church revives at most two of the fallen, and the route map's card names the price of each
// revival before the party arrives. Each test targets one way this could break: a third revival
// at the same church, a limit a save or another church forgets, a refused revival that still
// spends gold, or a card whose price differs from what the altar charges.
import { describe, it, expect, beforeEach } from 'vitest';
import { RunManager, getReviveCost } from '../src/engine/RunManager.js';
import { createUnit } from '../src/engine/UnitManager.js';
import {
  churchReviveBlock,
  churchRevivesLeft,
  reviveAtChurch,
} from '../src/engine/ChurchCommands.js';
import { chooseRuinsPath, reviveAtRuins } from '../src/engine/RuinsCommands.js';
import { reviveNodeNotes } from '../src/engine/RevivePreview.js';
import { CHURCH_REVIVE_LIMIT } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
let run;

function addFallen(name, level = 3, className = 'Fighter') {
  const unit = createUnit(
    data.classes.find((c) => c.name === className),
    level,
    data.weapons,
    { name },
  );
  unit.currentHP = 0;
  run.fallenUnits.push(unit);
  return unit;
}
const roundTrip = (r) => RunManager.fromJSON(JSON.parse(JSON.stringify(r.toJSON())), data);
const node = (type, id) => ({ id, type, completed: false });

beforeEach(() => {
  run = new RunManager(data);
  run.startRun({ runSeed: 77 });
  run.gold = 50000;
  // This act's discounted revival is spent, so every price here is the full one
  // (RevivePricing; the discount has tests of its own in RevivePricing.test.js).
  run.reviveDiscountAct = run.currentAct;
});

describe('Church: two revivals per church', () => {
  it('the limit is two', () => expect(CHURCH_REVIVE_LIMIT).toBe(2));

  it('revives two, then refuses the third without spending gold', () => {
    const [a, b, c] = ['A', 'B', 'C'].map((n) => addFallen(n));
    expect(reviveAtChurch(run, a, 'church_1').ok).toBe(true);
    expect(churchRevivesLeft(run, 'church_1')).toBe(1);
    expect(reviveAtChurch(run, b, 'church_1').ok).toBe(true);
    const gold = run.gold;
    expect(reviveAtChurch(run, c, 'church_1')).toEqual({
      ok: false,
      reason: 'This church has revived all it can (2).',
    });
    expect(churchReviveBlock(run, c, 'church_1')).toBe('This church has revived all it can (2).');
    expect(run.gold).toBe(gold);
    expect(run.fallenUnits).toContain(c);
    // Another church starts with its own two.
    expect(reviveAtChurch(run, c, 'church_2').ok).toBe(true);
  });

  it('keeps the count across a save and reload', () => {
    const [a, b] = ['A', 'B'].map((n) => addFallen(n));
    addFallen('C');
    reviveAtChurch(run, a, 'church_1');
    reviveAtChurch(run, b, 'church_1');
    const restored = roundTrip(run);
    expect(restored.churchRevivesByNodeId).toEqual({ church_1: 2 });
    const c = restored.fallenUnits.find((u) => u.name === 'C');
    expect(reviveAtChurch(restored, c, 'church_1').ok).toBe(false);
  });

  it('a refused revival (too little gold) does not count toward the two', () => {
    const pricey = addFallen('Pricey', 15);
    run.gold = 1000;
    expect(reviveAtChurch(run, pricey, 'church_1').ok).toBe(false);
    expect(churchRevivesLeft(run, 'church_1')).toBe(2);
  });

  it('a save from before the limit reads as no revivals yet', () => {
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    delete saved.churchRevivesByNodeId;
    expect(RunManager.fromJSON(saved, data).churchRevivesByNodeId).toEqual({});
  });
});

describe('Route card: the price of reviving the fallen', () => {
  it('names each fallen unit with the price the altar charges, and how many are left', () => {
    const a = addFallen('Ana', 10);
    const b = addFallen('Bo', 2);
    const church = node('church', 'church_1');
    // 500 + 10 × 300 and 500 + 2 × 300, the same numbers getReviveCost gives.
    expect(getReviveCost(a)).toBe(3500);
    expect(reviveNodeNotes(run, church)).toEqual(['Revive up to 2: Ana 3500 G, Bo 1100 G.']);
    reviveAtChurch(run, b, 'church_1');
    expect(reviveNodeNotes(run, church)).toEqual(['Revive up to 1: Ana 3500 G.']);
    addFallen('Cy', 1);
    reviveAtChurch(run, a, 'church_1');
    expect(reviveNodeNotes(run, church)).toEqual(['Revive: this church has revived all it can.']);
  });

  it('a promoted unit shows its higher price', () => {
    const u = addFallen('Hero', 5);
    u.tier = 'promoted';
    expect(reviveNodeNotes(run, node('church', 'c'))).toEqual([
      `Revive up to 2: Hero ${getReviveCost(u)} G.`,
    ]);
    expect(getReviveCost(u)).toBe(6000); // effective level 17: 500 + 5100 + 15 × 25, to 50;
  });

  it('the Ruins card says one, injured, and goes quiet once spent or scavenged', () => {
    const ruinsId = run.nodeMap.nodes.find((n) => n.type === 'ruins').id;
    const ruins = run.nodeMap.nodes.find((n) => n.id === ruinsId);
    const a = addFallen('Ana', 4);
    addFallen('Bo', 1);
    expect(reviveNodeNotes(run, ruins)).toEqual([
      'Revive one, who returns injured: Ana 1700 G, Bo 800 G.',
    ]);
    chooseRuinsPath(run, ruinsId, 'rest');
    reviveAtRuins(run, ruinsId, a);
    expect(reviveNodeNotes(run, ruins)).toEqual(['Revive: these ruins gave back their one.']);
  });

  it('says nothing with no fallen, on other nodes, or on an eclipsed church', () => {
    expect(reviveNodeNotes(run, node('church', 'c'))).toEqual([]);
    addFallen('Ana');
    expect(reviveNodeNotes(run, node('shop', 's'))).toEqual([]);
    expect(reviveNodeNotes(run, { ...node('church', 'c'), eclipse: { label: 'x' } })).toEqual([]);
  });

  it('names at most four and counts the rest', () => {
    for (const n of ['A', 'B', 'C', 'D', 'E', 'F']) addFallen(n, 1);
    expect(reviveNodeNotes(run, node('church', 'c'))[0]).toBe(
      'Revive up to 2: A 800 G, B 800 G, C 800 G, D 800 G, +2 more.',
    );
  });
});
