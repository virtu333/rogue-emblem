// Review fixes for Smith's Mark and Pilgrim's Road (the stage of a mid-run grant's records).
// The Pilgrim's Road reachability, the Free-on-a-capped-stat and the review-test fixes are
// tested beside their subjects (PilgrimsRoad, SmithsMark, BlessingReviewFixes).
//   - a blessing taken at a church or from an event recorded every handler's event under
//     'run_start' (only Quartermaster Cache said 'mid_run'), so the history could not tell
//     a shrine pick from a vow
import { describe, it, expect } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => store[key] ?? null,
    setItem: (key, val) => {
      store[key] = String(val);
    },
    removeItem: (key) => {
      delete store[key];
    },
  },
  configurable: true,
  writable: true,
});

const data = loadGameData();

function plainRun(seed = 7301) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, applyBlessingsAtStart: false });
  return rm;
}
const applied = (rm, id) =>
  rm.blessingHistory.filter((e) => e.eventType === 'effect_applied' && e.blessingId === id);

describe('a mid-run grant records its events as mid_run, whichever handler wrote them', () => {
  const grantable = data.blessings.blessings.filter((b) => (b.boons || []).length > 0);

  it('every card a church or an event can hand out: no record says run_start', () => {
    let taken = 0;
    let records = 0;
    for (const blessing of grantable) {
      const rm = plainRun();
      if (!rm.addBlessingMidRun(blessing.id)) continue;
      taken++;
      const mine = applied(rm, blessing.id);
      records += mine.length;
      expect(
        mine.map((e) => e.stage),
        blessing.id,
      ).toEqual(mine.map(() => 'mid_run'));
    }
    expect(taken).toBeGreaterThan(10);
    expect(records).toBeGreaterThan(10);
  });

  it('the same cards at the shrine still record run_start', () => {
    let records = 0;
    for (const blessing of grantable) {
      const rm = plainRun();
      rm.activeBlessings = [{ id: blessing.id, rolledCost: null }];
      rm._runStartBlessingsApplied = false;
      rm.applyRunStartBlessingEffects();
      const mine = applied(rm, blessing.id);
      records += mine.length;
      expect(
        mine.map((e) => e.stage),
        blessing.id,
      ).toEqual(mine.map(() => 'run_start'));
    }
    expect(records).toBeGreaterThan(10);
  });

  it('the marker is gone afterwards, so a later shrine-style application is run_start again', () => {
    const rm = plainRun();
    expect(rm.addBlessingMidRun('steady_hands')).toBe(true);
    expect(rm._blessingEventStage).toBeUndefined();
    rm.activeBlessings = [{ id: 'coin_of_fate', rolledCost: null }];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(applied(rm, 'coin_of_fate').every((e) => e.stage === 'run_start')).toBe(true);
  });

  it('a handler that throws still clears the marker', () => {
    const rm = plainRun();
    rm._applySingleRunStartBlessingEffect = () => {
      throw new Error('boom');
    };
    expect(() => rm.addBlessingMidRun('steady_hands')).toThrow('boom');
    expect(rm._blessingEventStage).toBeUndefined();
  });
});
