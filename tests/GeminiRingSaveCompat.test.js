// A Gemini Ring crossing builds (the outside review of PR #440, P1): its own stat bonus must
// live in the ring's ordinary `effects`, the only thing a client from before the ring reads
// when it equips or unequips an accessory. Otherwise a save that goes new → old → new leaves
// the bonus stuck on the unit and the next equip stacks it (STR 6 → 8 → 8 → 10).
//
// `olderClient` is the build before the ring, as it was on main (UnitManager's
// applyAccessoryStats read `accessory.effects` and nothing else), driven on the real save:
// RunManager.toJSON, JSON, RunManager.fromJSON.
import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { equipAccessory, unequipAccessory } from '../src/engine/UnitManager.js';
import { accessoryStatEffects, settleGeminiRingsIn } from '../src/engine/GeminiRing.js';
import { ensureItemUid } from '../src/utils/itemUid.js';
import { generateLootChoices, generateShopInventory } from '../src/engine/LootSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const catalogRing = data.accessories.find((a) => a.name === 'Gemini Ring');

const olderClient = {
  equip(unit, item) {
    for (const [stat, v] of Object.entries(item.effects || {}))
      unit.stats[stat] = (unit.stats[stat] || 0) + v;
    unit.accessory = item;
  },
  unequip(unit) {
    const item = unit.accessory;
    for (const [stat, v] of Object.entries(item.effects || {}))
      unit.stats[stat] = (unit.stats[stat] || 0) - v;
    unit.accessory = null;
    return item;
  },
};

const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
// The older client reads the save as plain JSON and writes it back the same way.
const throughOlderClient = (rm, act) => {
  const saved = JSON.parse(JSON.stringify(rm.toJSON()));
  act(saved);
  return RunManager.fromJSON(JSON.parse(JSON.stringify(saved)), data);
};

function freshRun() {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: 7, difficultyId: 'normal', autoSelectBlessing: false });
  const unit = rm.roster[0];
  if (unit.accessory) unequipAccessory(unit);
  unit.stats.STR = 6;
  return { rm, unit };
}

const strRing = () => ({ ...structuredClone(catalogRing), uid: 'itm_9_aaaa', geminiStat: 'STR' });

describe('a Gemini Ring through an older client', () => {
  it('new equips, old unequips, new equips again: STR 6 → 8 → 6 → 8', () => {
    const { rm, unit } = freshRun();
    equipAccessory(unit, strRing());
    expect(unit.stats.STR).toBe(8);

    const back = throughOlderClient(rm, (saved) => {
      const u = saved.roster[0];
      saved.accessories = [...(saved.accessories || []), olderClient.unequip(u)];
      expect(u.stats.STR).toBe(6);
    });
    const u = back.roster[0];
    expect(u.stats.STR).toBe(6);
    const ring = back.accessories.find((a) => a.name === 'Gemini Ring');
    equipAccessory(u, ring);
    expect(u.stats.STR).toBe(8);
    unequipAccessory(u);
    expect(u.stats.STR).toBe(6);
  });

  it('an unworn ring the older client equips is taken back exactly by this build', () => {
    const { rm } = freshRun();
    rm.accessories.push(ensureItemUid({ ...structuredClone(catalogRing), geminiStat: 'STR' }));
    const back = throughOlderClient(rm, (saved) => {
      const ring = saved.accessories.find((a) => a.name === 'Gemini Ring');
      saved.accessories = saved.accessories.filter((a) => a !== ring);
      olderClient.equip(saved.roster[0], ring);
    });
    const u = back.roster[0];
    const stat = u.accessory.geminiStat;
    const before = u.stats[stat];
    unequipAccessory(u);
    expect(u.stats[stat]).toBe(before - 2);
    expect(u.stats.STR).toBe(6); // back where it started, whatever the ring's stat
  });

  it('a ring saved worn before the fix (stat stamped, effects empty) loads settled', () => {
    const { rm, unit } = freshRun();
    // As the earlier build of this PR wore it: the +2 in stats, nothing in effects.
    const ring = strRing();
    unit.accessory = ring;
    unit.stats.STR = 8;
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    delete saved.roster[0].accessory.geminiApplied;
    saved.roster[0].accessory.effects = {};
    const back = RunManager.fromJSON(saved, data);
    const u = back.roster[0];
    expect(u.accessory.effects).toEqual({ STR: 2 });
    // The older client now takes back exactly what was given.
    const again = JSON.parse(JSON.stringify(back.toJSON()));
    olderClient.unequip(again.roster[0]);
    expect(again.roster[0].stats.STR).toBe(6);
    // And this build reads it the same: settling never adds the bonus twice.
    expect(accessoryStatEffects(u.accessory)).toEqual({ STR: 2 });
    unequipAccessory(u);
    expect(u.stats.STR).toBe(6);
  });

  it('a plain round trip on this build changes nothing', () => {
    const { rm, unit } = freshRun();
    equipAccessory(unit, strRing());
    const back = roundTrip(roundTrip(rm));
    expect(back.roster[0].stats.STR).toBe(8);
    unequipAccessory(back.roster[0]);
    expect(back.roster[0].stats.STR).toBe(6);
  });
});

describe('every ring is settled where it is made', () => {
  it('a ring given a uid holds its stat in effects', () => {
    const ring = ensureItemUid(structuredClone(catalogRing));
    expect(ring.geminiApplied).toBe(true);
    expect(ring.effects).toEqual({ [ring.geminiStat]: 2 });
    // The catalog row is untouched.
    expect(catalogRing.effects).toEqual({});
  });

  it('loot and shop rings are settled, never unsettled in a bag', () => {
    const rings = [];
    const collect = (value) => {
      JSON.stringify(value, (key, v) => {
        if (v && typeof v === 'object' && v.name === 'Gemini Ring') rings.push(v);
        return v;
      });
    };
    for (let i = 0; i < 300; i++) {
      collect(
        generateLootChoices('act2', data.lootTables, data.weapons, data.consumables, 3, 0, data.accessories, data.whetstones), // prettier-ignore
      );
      collect(
        generateShopInventory('act3', data.lootTables, data.weapons, data.consumables, data.accessories), // prettier-ignore
      );
    }
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) {
      expect(ring.geminiApplied).toBe(true);
      expect(ring.effects).toEqual({ [ring.geminiStat]: 2 });
    }
  });

  it('a save is walked once: each unsettled ring settled, a settled one left alone', () => {
    const nest = { a: [{ b: { ...structuredClone(catalogRing), uid: 'itm_1_zz' } }] };
    expect(settleGeminiRingsIn(nest)).toBe(1);
    expect(settleGeminiRingsIn(nest)).toBe(0);
    const ring = nest.a[0].b;
    expect(ring.effects).toEqual({ [ring.geminiStat]: 2 });
  });
});
