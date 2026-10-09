// Every effect type the blessing data can apply has a handler. An effect type with no handler
// is recorded as skipped ('unhandled_effect_type') and does nothing: a card that reads fine
// and silently does not work. Covers boons, costs, every catalog price and every pact.
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

function everyEffect() {
  const found = [];
  for (const blessing of data.blessings.blessings) {
    for (const effect of blessing.boons || []) found.push([`${blessing.id} boon`, effect]);
    for (const effect of blessing.costs || []) found.push([`${blessing.id} cost`, effect]);
  }
  for (const [id, price] of Object.entries(data.blessings.priceCatalog || {})) {
    for (const effect of price.effects || []) found.push([`price ${id}`, effect]);
  }
  return found;
}

describe('blessing effect handlers', () => {
  it('the data names effects at all (the walk below is not vacuous)', () => {
    expect(everyEffect().length).toBeGreaterThan(40);
  });

  it('applying any boon, cost or price effect never reports an unhandled effect type', () => {
    const unhandled = [];
    for (const [where, effect] of everyEffect()) {
      const rm = new RunManager(data);
      rm.startRun({ runSeed: 7001, applyBlessingsAtStart: false });
      rm._applySingleRunStartBlessingEffect('coverage', effect);
      const record = rm.blessingHistory.find(
        (entry) => entry.details?.reason === 'unhandled_effect_type',
      );
      if (record) unhandled.push(`${where}: ${effect.type}`);
    }
    expect(unhandled).toEqual([]);
  });
});
