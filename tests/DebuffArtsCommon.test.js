import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { actArtScrollPool } from '../src/engine/LootSystem.js';
import {
  getWeaponArtAllowedTypes,
  isWeaponArtCompatibleWithWeapon,
} from '../src/engine/WeaponArtSystem.js';

// The after-combat stat debuff arts are weak for a Steel art, so they are common Iron arts
// now (Act I, cheap scroll) and any sword, lance or bow can carry them.
const data = loadGameData();
const artById = new Map(data.weaponArts.arts.map((art) => [art.id, art]));
const DEBUFF_ARTS = {
  sword_seal_speed: 'Seal Speed Scroll',
  lance_shatter_slash: 'Shatter Slash Scroll',
  bow_break_shot: 'Break Shot Scroll',
  bow_waning_shot: 'Waning Shot Scroll',
  bow_seal_magic: 'Seal Magic Scroll',
};
const TYPES = ['Sword', 'Lance', 'Bow'];
const WEAPON_TYPE_OF = {
  Swords: 'Sword',
  Lances: 'Lance',
  Axes: 'Axe',
  Bows: 'Bow',
  Tomes: 'Tome',
  Light: 'Light',
};
const scrollByName = new Map(
  data.weapons.filter((w) => w.type === 'Scroll').map((w) => [w.name, w]),
);

describe('stat debuff weapon arts', () => {
  it('are exactly the arts whose only after-combat effect debuffs the defender', () => {
    // Failure: a new debuff art lands at Steel without this list (or the list goes stale).
    const found = data.weaponArts.arts
      .filter((art) =>
        (art.effects?.afterCombat || []).some(
          (e) => e.type === 'debuff' && e.target === 'defender',
        ),
      )
      .map((art) => art.id)
      .sort();
    expect(found).toEqual(Object.keys(DEBUFF_ARTS).sort());
  });

  it('are Iron arts that open in Act I, with a scroll at the Iron price', () => {
    for (const [id, scrollName] of Object.entries(DEBUFF_ARTS)) {
      const art = artById.get(id);
      expect(art.tierAffinity, id).toBe('Iron');
      expect(art.unlockAct, id).toBe('act1');
      const scroll = scrollByName.get(scrollName);
      expect(scroll?.teachesWeaponArtId, scrollName).toBe(id);
      expect(scroll.price, scrollName).toBe(1200);
    }
  });

  it('work on swords, lances and bows, and nothing else', () => {
    for (const [id, scrollName] of Object.entries(DEBUFF_ARTS)) {
      const art = artById.get(id);
      expect(getWeaponArtAllowedTypes(art), id).toEqual(TYPES);
      expect(scrollByName.get(scrollName).allowedWeaponTypes, scrollName).toEqual(TYPES);
      for (const type of TYPES)
        expect(isWeaponArtCompatibleWithWeapon(art, { type }), `${id} on ${type}`).toBe(true);
      for (const type of ['Axe', 'Tome', 'Light', 'Staff'])
        expect(isWeaponArtCompatibleWithWeapon(art, { type }), `${id} on ${type}`).toBe(false);
    }
  });

  it("enter Act I's scroll draws and Iron weapons of all three types", () => {
    const actOne = new Set(
      actArtScrollPool(data.lootTables.act1, data.weapons, data.weaponArts.arts),
    );
    for (const scrollName of Object.values(DEBUFF_ARTS)) expect(actOne.has(scrollName)).toBe(true);

    const rm = new RunManager(data);
    rm.startRun({ runSeed: 1, difficultyId: 'normal', applyBlessingsAtStart: false });
    const iron = rm._buildWeaponArtSpawnPools({ includeIron: true }).get('Iron');
    for (const type of TYPES)
      for (const id of Object.keys(DEBUFF_ARTS)) expect(iron.get(type), type).toContain(id);
    expect(iron.get('Axe')).not.toContain('bow_waning_shot');
  });

  it("leave Scroll Archive's Act II pool, which still has 3 arts for every sword, lance or bow lord", () => {
    // #370: Scroll Archive draws 3 distinct arts that open in Act II. Moving these to Act I
    // takes them out of that pool; each sword, lance or bow lord alone must still leave it 3 to draw.
    for (const lord of data.lords) {
      const rm = new RunManager(data);
      rm.startRun({ runSeed: 1, difficultyId: 'normal', applyBlessingsAtStart: false });
      rm.roster = rm.roster.filter((u) => u.isLord).slice(0, 1);
      rm.roster[0].proficiencies = lord.weapon
        .split(',')
        .map((entry) => ({ type: WEAPON_TYPE_OF[entry.replace(/\(.*\)/, '').trim()] }));
      const pool = rm.startingArtScrollPool('act2', 'act2').map((s) => s.name);
      for (const scrollName of Object.values(DEBUFF_ARTS)) expect(pool).not.toContain(scrollName);
      // Kira's Tome pool (2) never held these arts; only the lords who lose them are held to 3.
      const types = rm.roster[0].proficiencies.map((p) => p.type);
      if (types.some((type) => TYPES.includes(type)))
        expect(new Set(pool).size, lord.name).toBeGreaterThanOrEqual(3);
    }
  });
});
