// A save from before the legendary ledger: what the army holds is written into the ledger on
// load, so discarding a held legendary afterwards does not make it eligible again.
// Ways this goes wrong: the ledger stays empty after load (the held-weapon scan stops
// protecting a legendary the moment it is discarded); the adopted ledger is not saved; a Legend
// staff is adopted; a forged, imbued copy is recorded under its display name.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { rosterItemAction } from '../src/engine/RosterInventory.js';
import { isDuplicateLegendary, ownedLegendaryNames } from '../src/engine/LegendaryOwnership.js';
import { generateLootChoices } from '../src/engine/LootSystem.js';
import { loadGameData } from './testData.js';

beforeEach(() => {
  const storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

const weapon = (name) => structuredClone(loadGameData().weapons.find((w) => w.name === name));
const reload = (run) =>
  RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), loadGameData());

/** A run that held Ragnarok (convoy) and a Warp Staff (bag) when an older build saved it. */
function oldSave() {
  const run = new RunManager(loadGameData());
  run.startRun();
  expect(run.addToConvoy(weapon('Ragnarok'))).toBe(true);
  run.roster[0].inventory.push(weapon('Warp Staff'));
  const saved = JSON.parse(JSON.stringify(run.toJSON()));
  delete saved.legendaryGrants;
  return saved;
}

describe('legendary ledger on loading a save from before it', () => {
  it('adopts the held legendary, never a Legend staff, and saves it', () => {
    const run = RunManager.fromJSON(oldSave(), loadGameData());
    expect(run.legendaryGrants).toEqual(['Ragnarok']);
    expect(reload(run).legendaryGrants).toEqual(['Ragnarok']);
  });

  it('keeps it owned after it is discarded, across a save and reload', () => {
    const run = RunManager.fromJSON(oldSave(), loadGameData());
    const live = run.convoy.weapons.find((w) => w.name === 'Ragnarok');
    expect(rosterItemAction(run, run.roster[0], live, 'discard', 'convoy')).toBe('');
    expect(run.convoy.weapons.some((w) => w.name === 'Ragnarok')).toBe(false);

    const again = reload(run);
    expect(ownedLegendaryNames(again).has('Ragnarok')).toBe(true);
    expect(isDuplicateLegendary(again, weapon('Ragnarok'))).toBe(true);
    // Loot drawn from a table that can only offer Ragnarok offers nothing once it is owned.
    const data = again.gameData;
    const table = { act3: { weights: { legendaryWeapon: 1 }, legendaryWeapon: ['Ragnarok'] } };
    const choices = generateLootChoices(
      'act3',
      table,
      data.weapons,
      data.consumables,
      3,
      0,
      data.accessories,
      data.whetstones,
      null,
      false,
      null,
      false,
      null,
      { excludeLegendaryNames: [...ownedLegendaryNames(again)] },
    );
    expect(choices.some((c) => c.item?.name === 'Ragnarok')).toBe(false);
    // The staff was never adopted: it stays repeatable.
    expect(again.legendaryGrants).toEqual(['Ragnarok']);
    expect(isDuplicateLegendary(again, weapon('Warp Staff'))).toBe(false);
  });

  it('records a forged, imbued copy under its catalog name', () => {
    const saved = oldSave();
    saved.convoy.weapons[0] = {
      ...saved.convoy.weapons[0],
      name: 'Vampiric Ragnarok +1',
      _baseName: 'Vampiric Ragnarok',
      _imbueId: 'vampiric',
    };
    expect(RunManager.fromJSON(saved, loadGameData()).legendaryGrants).toEqual(['Ragnarok']);
  });
});
