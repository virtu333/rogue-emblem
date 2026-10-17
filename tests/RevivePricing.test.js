// Revival pricing (engine/RevivePricing.js; /mnt/project-files/reviews/revival-recovery-proposal.md).
// Each test targets one way it could break: a price curve that drifts from the agreed numbers, a
// promotion that makes a unit cheaper to bring back than it was the level before, a discount that
// is offered twice in an act, lost on a save, never comes back next act, spent by a revive it did
// not cheapen or by a refused one, missed at the Ruins, or a route card that names another price.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { reviveAtChurch } from '../src/engine/ChurchCommands.js';
import { chooseRuinsPath, reviveAtRuins } from '../src/engine/RuinsCommands.js';
import { reviveNodeNotes } from '../src/engine/RevivePreview.js';
import { getReviveCost, reviveCostFor, reviveHirePrice } from '../src/engine/RevivePricing.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function newRun(difficultyId = 'normal', actId = 'act1') {
  const run = new RunManager(data);
  run.startRun({ runSeed: 91, difficultyId });
  run.actIndex = run.actSequence.indexOf(actId);
  expect(run.currentAct).toBe(actId);
  run.gold = 100000;
  return run;
}

function addFallen(run, name, level, tier = 'base') {
  const unit = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    level,
    data.weapons,
    { name },
  );
  unit.tier = tier;
  unit.currentHP = 0;
  run.fallenUnits.push(unit);
  return unit;
}

const roundTrip = (r) => RunManager.fromJSON(JSON.parse(JSON.stringify(r.toJSON())), data);

describe('the full revival price', () => {
  // The proposal's table, worked by hand: 500 + 300 × E + 15 × (E − 12)² past 12, to the nearest 50;
  // E = level, + 12 once promoted.
  it.each([
    ['base', 1, 800],
    ['base', 5, 2000],
    ['base', 10, 3500],
    ['base', 12, 4100],
    ['base', 15, 5150], // 500 + 4500 + 135
    ['base', 20, 7450], // 500 + 6000 + 960
    ['promoted', 1, 4400], // E 13: 500 + 3900 + 15
    ['promoted', 5, 6000], // E 17: 500 + 5100 + 375
    ['promoted', 10, 8600], // E 22: 500 + 6600 + 1500
    ['promoted', 12, 9850], // E 24: 500 + 7200 + 2160
    ['promoted', 15, 12000], // E 27: 500 + 8100 + 3375
    ['promoted', 20, 16100], // E 32: 500 + 9600 + 6000
  ])('%s level %i costs %i', (tier, level, price) => {
    expect(getReviveCost({ level, tier })).toBe(price);
  });

  it('never drops when a unit promotes at level 12 or below, and drops far less at 20', () => {
    const promotedFloor = getReviveCost({ level: 1, tier: 'promoted' });
    for (let level = 1; level <= 12; level++)
      expect(promotedFloor).toBeGreaterThan(getReviveCost({ level, tier: 'base' }));
    // The old price fell from 6,500 to 2,000 (a 4,500 cliff) when a level 20 unit promoted.
    expect(getReviveCost({ level: 20, tier: 'base' }) - promotedFloor).toBeLessThan(3100);
  });

  it('rises with every level, across the promotion', () => {
    const ladder = [
      ...Array.from({ length: 12 }, (_, i) => ({ level: i + 1, tier: 'base' })),
      ...Array.from({ length: 20 }, (_, i) => ({ level: i + 1, tier: 'promoted' })),
    ].map(getReviveCost);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
  });
});

describe('the first revival each act', () => {
  // The act's dearest mercenary × promoted 1.5 × the rung's rate, to the nearest 50
  // (data/colosseum.json: act1 1000, act2 1700, act3 2500, act4 3100; Dusk 1.25, Nightfall 1.5,
  // Black Sun 1.7).
  it.each([
    ['normal', 'act1', 'base', 5, 1000, 2000],
    ['dusk', 'act2', 'base', 10, 2150, 3500], // 1700 × 1.25 = 2125
    ['hard', 'act3', 'promoted', 10, 5650, 8600], // 2500 × 1.5 × 1.5 = 5625
    ['lunatic', 'act4', 'promoted', 15, 7900, 12000], // 3100 × 1.5 × 1.7 = 7905
  ])('%s %s, %s level %i: %i instead of %i', (rung, act, tier, level, price, full) => {
    const run = newRun(rung, act);
    const unit = addFallen(run, 'Ana', level, tier);
    expect(reviveCostFor(run, unit)).toEqual({ price, full, discounted: true });
  });

  it('the final act prices the hire as Act IV', () => {
    const run = newRun('lunatic', 'finalBoss');
    const unit = addFallen(run, 'Ana', 15, 'promoted');
    expect(reviveHirePrice(run, unit)).toBe(7900);
  });

  it('charges the hire price once, then full price, and comes back next act', () => {
    const run = newRun();
    const a = addFallen(run, 'Ana', 5);
    const b = addFallen(run, 'Bo', 5);
    let gold = run.gold;
    expect(reviveAtChurch(run, a, 'church_1').ok).toBe(true);
    expect(run.gold).toBe(gold - 1000);
    gold = run.gold;
    expect(reviveCostFor(run, b)).toEqual({ price: 2000, full: 2000, discounted: false });
    expect(reviveAtChurch(run, b, 'church_2').ok).toBe(true);
    expect(run.gold).toBe(gold - 2000);

    run.actIndex = run.actSequence.indexOf('act2');
    const c = addFallen(run, 'Cy', 5);
    expect(reviveCostFor(run, c)).toEqual({ price: 1700, full: 2000, discounted: true });
  });

  it('stays spent across a save and reload; a save from before it has none spent', () => {
    const run = newRun();
    reviveAtChurch(run, addFallen(run, 'Ana', 5), 'church_1');
    addFallen(run, 'Bo', 5);
    const restored = roundTrip(run);
    expect(restored.reviveDiscountAct).toBe('act1');
    const bo = restored.fallenUnits.find((u) => u.name === 'Bo');
    expect(reviveCostFor(restored, bo).price).toBe(2000);

    const old = JSON.parse(JSON.stringify(run.toJSON()));
    delete old.reviveDiscountAct;
    const fromOld = RunManager.fromJSON(old, data);
    expect(fromOld.reviveDiscountAct).toBeNull();
    expect(reviveCostFor(fromOld, fromOld.fallenUnits[0]).price).toBe(1000);
  });

  it('a revive already cheaper than a hire leaves the discount for a dearer one', () => {
    const run = newRun();
    const low = addFallen(run, 'Low', 1); // 800 full, under the 1000 hire
    const high = addFallen(run, 'High', 10);
    const gold = run.gold;
    expect(reviveAtChurch(run, low, 'church_1').ok).toBe(true);
    expect(run.gold).toBe(gold - 800);
    expect(run.reviveDiscountAct).toBeNull();
    expect(reviveCostFor(run, high).price).toBe(1000);
  });

  it('a refused revive spends nothing; enough gold for the hire price is enough', () => {
    const run = newRun();
    const unit = addFallen(run, 'Ana', 10);
    run.gold = 999;
    expect(reviveAtChurch(run, unit, 'church_1').reason).toBe('Not enough gold.');
    expect(run.reviveDiscountAct).toBeNull();
    run.gold = 1000;
    expect(reviveAtChurch(run, unit, 'church_1').ok).toBe(true);
    expect(run.gold).toBe(0);
    expect(run.reviveDiscountAct).toBe('act1');
  });

  it('the Ruins revive takes the discount too', () => {
    const run = newRun();
    const ruinsId = run.nodeMap.nodes.find((n) => n.type === 'ruins').id;
    const unit = addFallen(run, 'Ana', 5);
    chooseRuinsPath(run, ruinsId, 'rest');
    const gold = run.gold;
    expect(reviveAtRuins(run, ruinsId, unit).ok).toBe(true);
    expect(run.gold).toBe(gold - 1000);
    expect(run.reviveDiscountAct).toBe('act1');
  });

  it('the route card names the price the altar charges, and says the first is discounted', () => {
    const run = newRun();
    const a = addFallen(run, 'Ana', 5);
    addFallen(run, 'Bo', 1);
    const church = { id: 'church_1', type: 'church', completed: false };
    expect(reviveNodeNotes(run, church)).toEqual([
      'Revive up to 2: Ana 1000 G, Bo 800 G. First revival this act at hire price.',
    ]);
    reviveAtChurch(run, a, 'church_1');
    expect(reviveNodeNotes(run, church)).toEqual(['Revive up to 1: Bo 800 G.']);
  });
});
