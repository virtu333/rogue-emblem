// Every effect the blessings catalog can name has a handler (docs/blessings_contract.md §6.5:
// a missing handler is an error, not a silent no-op). RunManager records an
// `unhandled_effect_type` event instead of throwing, so a new card or price whose type nobody
// wired up would ship as a boon that does nothing. This applies each blessing's boons and each
// priced effect (the v3 catalog and the v2 pools old saves still hold) to a fresh run and
// reads that history.
//
// Ways this can fail, a test each:
//   1. a blessing's boon type has no handler (the card does nothing);
//   2. a price's effect type has no handler (the price is never paid);
//   3. the check itself is blind (it never sees an unhandled type, or applies nothing).
import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const catalog = data.blessings;

function freshRun() {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: 17, difficultyId: 'dusk', applyBlessingsAtStart: false });
  rm.blessingHistory = [];
  return rm;
}
const unhandled = (rm) =>
  rm.blessingHistory.filter((r) => r.details?.reason === 'unhandled_effect_type');
const applied = (rm) => rm.blessingHistory.filter((r) => r.eventType === 'effect_applied');

describe('every blessing effect has a handler', () => {
  it.each(catalog.blessings.map((b) => [b.id, b]))('%s: its boons apply', (id, blessing) => {
    const rm = freshRun();
    rm.activeBlessings = [{ id, rolledCost: null }];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(unhandled(rm).map((r) => r.effectType)).toEqual([]);
    // Something was recorded for each boon: the effect did not vanish before its handler.
    const types = applied(rm).map((r) => r.effectType);
    for (const boon of blessing.boons) expect(types, boon.type).toContain(boon.type);
  });

  it.each(Object.entries(catalog.priceCatalog))('price %s: its effects apply', (id, price) => {
    const rm = freshRun();
    for (const effect of price.effects) rm._applySingleRunStartBlessingEffect('iron_oath', effect);
    expect(unhandled(rm).map((r) => r.effectType)).toEqual([]);
  });

  it('the v2 cost pools old saves hold still apply', () => {
    const rm = freshRun();
    for (const pool of Object.values(catalog.costPools))
      for (const entry of pool)
        for (const effect of entry.effects)
          rm._applySingleRunStartBlessingEffect('iron_oath', effect);
    expect(unhandled(rm).map((r) => r.effectType)).toEqual([]);
  });

  it('the check can see an unhandled type', () => {
    const rm = freshRun();
    rm._applySingleRunStartBlessingEffect('iron_oath', { type: 'no_such_effect', params: {} });
    expect(unhandled(rm).map((r) => r.effectType)).toEqual(['no_such_effect']);
  });
});
