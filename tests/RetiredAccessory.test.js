// A retired accessory (accessories.json `retired`: the Longarm Bracer) never spawns again:
// every drop, shop stock, event grant and start gift reads a loot table's `accessories` list,
// so it is in none of them and the validator refuses one there. Copies already owned keep
// their rule (the catalog entry stays), and the Compendium lists it only for a save that has
// found one, so a new player never sees an entry nothing can give.
import { describe, expect, it } from 'vitest';
import { accessoryPoolFor } from '../src/engine/EventEffects.js';
import { CompendiumOverlay, TAB_DEFS } from '../src/ui/CompendiumOverlay.js';
import { discoveryView } from '../src/engine/CompendiumDiscovery.js';
import { meleeCounterRangeOf } from '../src/engine/AccessoryReactions.js';
import { validateCrossReferences } from '../tools/validateCrossReferences.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const NAME = 'Longarm Bracer';
const retired = gameData.accessories.filter((a) => a.retired === true);

describe('retired accessories', () => {
  it('the Longarm Bracer is the one retired accessory and is kept in the catalog', () => {
    expect(retired.map((a) => a.name)).toEqual([NAME]);
  });

  it('no accessory pool in any act or tier can hand one out', () => {
    for (const currentAct of ['act1', 'act2', 'act3', 'act4', 'finalBoss']) {
      for (const tierOffset of [0, 1, 2, 3]) {
        const pool = accessoryPoolFor({ gameData, currentAct }, tierOffset).map((a) => a.name);
        expect(pool.length, `${currentAct} +${tierOffset}`).toBeGreaterThan(0);
        for (const a of retired) expect(pool, `${currentAct} +${tierOffset}`).not.toContain(a.name);
      }
    }
  });

  it('the validator refuses a retired accessory in a loot table', () => {
    expect(validateCrossReferences().errors).toEqual([]);
    const lootTables = structuredClone(gameData.lootTables);
    lootTables.act3.accessories.push(NAME);
    const { errors } = validateCrossReferences({ ...gameData, lootTables });
    expect(errors.some((e) => e.includes('retired accessory "Longarm Bracer"'))).toBe(true);
  });

  it('an owned copy still works: a 1-range sword counters from 2', () => {
    const bracer = structuredClone(gameData.accessories.find((a) => a.name === NAME));
    const sword = gameData.weapons.find((w) => w.name === 'Iron Sword');
    expect(meleeCounterRangeOf({ accessory: bracer }, sword, { min: 1, max: 1 })).toBe(2);
  });

  it('the Compendium lists it only for a save that has found one', () => {
    const items = (seen) => {
      const view = Object.create(CompendiumOverlay.prototype);
      view.gameData = gameData;
      view.searchQuery = '';
      view._discovery = discoveryView({ items: seen });
      const tab = TAB_DEFS.findIndex((t) => t.key === 'items');
      return view._getItemsForTab(tab).map((i) => i.name);
    };
    expect(items([])).not.toContain(NAME);
    expect(items([])).toContain('Galeforce Charm'); // other accessories stay listed
    expect(items([NAME])).toContain(NAME);
  });
});
