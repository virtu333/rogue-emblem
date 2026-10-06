// A worn weapon is still the same weapon to everything that keys on a name (CLAUDE.md,
// "Item names are identity"; docs/specs/worn-weapons.md). The ways it can fail, each caught
// below: a legendary loses its weapon art or its gate, its icon turns generic, its fx family
// changes, its keyword tags or base line change, its signature status goes, an old save's
// rename misses it or its text refresh skips it, or wear does not survive a save, the convoy
// or a trade. A forged name ("+N") is held to the same rules, since several of these lookups
// only handled the unforged name before.
import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager, serializeUnit, relinkWeapon } from '../src/engine/RunManager.js';
import { applyWear, repairWeapon, wearCount, WEAR_STATS } from '../src/engine/WeaponWear.js';
import { applyForge } from '../src/engine/ForgeSystem.js';
import { applyImbue, getImbueById } from '../src/engine/ImbueSystem.js';
import { canUseWeaponArt, getWeaponArtIds } from '../src/engine/WeaponArtSystem.js';
import { resolveWeaponArtIds, getWeaponArtTooltipLines } from '../src/ui/WeaponArtVisibility.js';
import { itemKeywords, itemBaseLineFor } from '../src/engine/ItemKeywords.js';
import { isSignatureWeapon, signatureWeaponFor } from '../src/engine/SignatureWeapons.js';
import { itemIconId } from '../src/ui/itemIcons.js';
import { baseItemName, itemSlug } from '../src/ui/itemIconIds.js';
import { fxFamilyIdForWeapon } from '../src/art/combatFx/fxFamilies.js';
import { renameItemName, ITEM_NAMES_REVISION } from '../src/engine/ItemNameMigration.js';
import { migrateSavedPerBattleWeapons } from '../src/engine/WeaponCatalogMigration.js';
import { getPerBattleMaxUses } from '../src/engine/Combat.js';
import { planTrade, applyTrade, unitHolder, CONVOY_HOLDER } from '../src/engine/ItemTrade.js';
import {
  ITEM_NAME_SUFFIX_RE,
  stripItemNameSuffix,
  itemNameSuffix,
  composeWeaponName,
  weaponCatalogNames,
} from '../src/utils/itemNames.js';

const data = loadGameData();
const clone = (value) => structuredClone(value);
const catalog = (name) => clone(data.weapons.find((w) => w.name === name));
const UNWEARABLE = ['Staff', 'Scroll', 'Consumable', 'Accessory', 'Whetstone'];
const combatWeapons = data.weapons.filter((w) => !UNWEARABLE.includes(w.type));
const worn = (name, stats = ['might']) => {
  const weapon = catalog(name);
  for (const stat of stats) expect(applyWear(weapon, stat).success).toBe(true);
  return weapon;
};
const forged = (name, stat = 'might') => {
  const weapon = catalog(name);
  applyForge(weapon, stat);
  return weapon;
};
const vampiric = getImbueById(data.imbues, 'vampiric');

describe('the suffix rule', () => {
  it('reads both forge "+N" and wear "-N" and nothing else', () => {
    expect(stripItemNameSuffix('Iron Sword +2')).toBe('Iron Sword');
    expect(stripItemNameSuffix('Iron Sword -2')).toBe('Iron Sword');
    expect(itemNameSuffix('Iron Sword -3')).toBe(' -3');
    expect(itemNameSuffix('Iron Sword')).toBe('');
    expect(stripItemNameSuffix("Hermit's Bow")).toBe("Hermit's Bow");
    expect(stripItemNameSuffix('Gae Bolg')).toBe('Gae Bolg');
    expect(composeWeaponName('Iron Sword', { wearSteps: 2 })).toBe('Iron Sword -2');
    expect(composeWeaponName('Iron Sword', { forgeLevel: 2 })).toBe('Iron Sword +2');
    expect(composeWeaponName('Iron Sword')).toBe('Iron Sword');
  });

  it('no catalog item is named like a suffixed one (a base name never ends in " -N")', () => {
    const all = [
      ...data.weapons,
      ...data.consumables,
      ...data.accessories,
      ...data.whetstones,
      ...data.imbues.imbues.map((i) => i.stone),
    ];
    expect(all.filter((item) => ITEM_NAME_SUFFIX_RE.test(item.name)).map((i) => i.name)).toEqual(
      [],
    );
  });

  it('a weapon answers to its base, id and display names, imbue word aside', () => {
    const weapon = worn('Twinsworn', ['might', 'hit']);
    expect(weaponCatalogNames(weapon)).toEqual(
      expect.arrayContaining(['Twinsworn -2', 'Twinsworn']),
    );
    applyImbue(weapon, vampiric);
    expect(weapon.name).toBe('Vampiric Twinsworn -2');
    expect(weaponCatalogNames(weapon)).toContain('Twinsworn');
  });
});

describe('weapon arts', () => {
  const legendaryArts = data.weaponArts.arts.filter((a) => a.legendaryWeaponIds?.length);
  const unit = {
    name: 'Edric',
    faction: 'player',
    stats: { HP: 30, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 2, LCK: 5 },
    currentHP: 30,
    proficiencies: ['Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light'].map((type) => ({
      type,
      rank: 'Mast',
    })),
  };

  it('there are legendary-gated arts to test', () => {
    expect(legendaryArts.length).toBeGreaterThan(3);
  });

  it('a worn, forged or imbued legendary passes the same gate as the pristine one', () => {
    for (const art of legendaryArts) {
      for (const id of art.legendaryWeaponIds) {
        const base = data.weapons.find((w) => w.name === id);
        expect(base, id).toBeTruthy();
        const pristine = canUseWeaponArt(unit, clone(base), art, {});
        expect(pristine.reason).not.toBe('legendary_weapon_required');
        for (const [label, variant] of [
          ['worn 1', worn(id)],
          ['worn 3', worn(id, ['might', 'hit', 'weight'])],
          ['forged', forged(id)],
          ['imbued', (() => { const w = catalog(id); applyImbue(w, vampiric); return w; })()], // prettier-ignore
          ['imbued and worn', (() => { const w = catalog(id); applyImbue(w, vampiric); applyWear(w, 'hit'); return w; })()], // prettier-ignore
        ]) {
          const result = canUseWeaponArt(unit, variant, art, {});
          expect(result.reason, `${id} ${label}`).toBe(pristine.reason);
          expect(result.ok, `${id} ${label}`).toBe(pristine.ok);
        }
      }
    }
  });

  it('a bare display name (no _baseName: an old save, a copied record) is read through its suffix', () => {
    for (const art of legendaryArts) {
      for (const id of art.legendaryWeaponIds) {
        const type = data.weapons.find((w) => w.name === id).type;
        for (const name of [`${id} -2`, `${id} +2`, `Vampiric ${id} -1`]) {
          const bare = {
            type,
            name,
            ...(name.startsWith('Vampiric') ? { _imbueId: 'vampiric' } : {}),
          };
          expect(canUseWeaponArt(unit, bare, art, {}).reason, name).not.toBe('legendary_weapon_required'); // prettier-ignore
          expect(resolveWeaponArtIds(bare, data.weaponArts.arts), name).toContain(art.id);
        }
      }
    }
  });

  it('the gate still refuses a different weapon when only the name differs by a suffix', () => {
    const art = legendaryArts.find((a) => a.legendaryWeaponIds.includes('Twinsworn'));
    const iron = worn('Iron Sword');
    expect(canUseWeaponArt(unit, iron, art, {}).reason).toBe('legendary_weapon_required');
  });

  it('the roster and tooltip views list the same arts for a worn legendary', () => {
    for (const art of legendaryArts) {
      for (const id of art.legendaryWeaponIds) {
        const base = catalog(id);
        const wornWeapon = worn(id, ['crit', 'weight']);
        const arts = data.weaponArts.arts;
        expect(resolveWeaponArtIds(wornWeapon, arts), id).toEqual(resolveWeaponArtIds(base, arts));
        expect(resolveWeaponArtIds(wornWeapon, arts), id).toContain(art.id);
        expect(getWeaponArtTooltipLines(wornWeapon, arts), id).toEqual(
          getWeaponArtTooltipLines(base, arts),
        );
      }
    }
  });

  it('weapon arts bound to an instance survive wear and repair', () => {
    const weapon = { ...catalog('Iron Sword'), weaponArtIds: ['sword_precise_cut'] };
    applyWear(weapon, 'might');
    expect(getWeaponArtIds(weapon)).toEqual(['sword_precise_cut']);
    repairWeapon(weapon);
    expect(getWeaponArtIds(weapon)).toEqual(['sword_precise_cut']);
  });
});

describe('icons', () => {
  it('every wearable weapon keeps its own icon at one, two and three steps', () => {
    for (const original of combatWeapons) {
      const expected = itemIconId(original);
      expect(expected).toBe(itemSlug(original.name));
      const weapon = clone(original);
      for (const stat of ['might', 'hit', 'crit']) {
        applyWear(weapon, stat);
        expect(itemIconId(weapon), weapon.name).toBe(expected);
        // Even with only the display name (no _baseName), as a bare string or an old save.
        const bare = { name: weapon.name, type: weapon.type };
        expect(itemIconId(bare), weapon.name).toBe(expected);
        expect(itemIconId(weapon.name), weapon.name).toBe(expected);
      }
    }
  });

  it('an imbued worn weapon resolves to the base weapon', () => {
    const weapon = worn('Silver Lance', ['might', 'hit']);
    applyImbue(weapon, vampiric);
    expect(weapon.name).toBe('Vampiric Silver Lance -2');
    expect(itemIconId(weapon)).toBe('silver-lance');
    expect(baseItemName(weapon)).toBe('Vampiric Silver Lance');
    expect(baseItemName('Keen Keen Axe -3')).toBe('Keen Keen Axe');
  });
});

describe('combat fx', () => {
  it('every weapon draws the same family worn, forged or pristine, melee and ranged', () => {
    for (const original of data.weapons) {
      for (const distance of [1, 2]) {
        const expected = fxFamilyIdForWeapon(original, { distance });
        if (!UNWEARABLE.includes(original.type)) {
          const wornWeapon = clone(original);
          applyWear(wornWeapon, 'might');
          expect(fxFamilyIdForWeapon(wornWeapon, { distance }), wornWeapon.name).toBe(expected);
        }
        if (!['Scroll', 'Staff'].includes(original.type)) {
          const forgedWeapon = clone(original);
          if (applyForge(forgedWeapon, 'might').success)
            expect(fxFamilyIdForWeapon(forgedWeapon, { distance }), forgedWeapon.name).toBe(expected); // prettier-ignore
        }
      }
    }
  });

  it('a bare display name reads through its suffix', () => {
    expect(fxFamilyIdForWeapon({ type: 'Tome', name: 'Firstwind -2' })).toBe('wind');
    expect(fxFamilyIdForWeapon({ type: 'Tome', name: 'Firstwind +2' })).toBe('wind');
    expect(fxFamilyIdForWeapon({ type: 'Sword', name: 'Gale Blade -1' }, { distance: 2 })).toBe(
      'wind',
    );
  });

  it('named relics keep their named family', () => {
    expect(fxFamilyIdForWeapon(worn('Firstwind'))).toBe('wind');
    expect(fxFamilyIdForWeapon(forged('Firstwind'))).toBe('wind');
    expect(fxFamilyIdForWeapon(worn('Gust Blade'), { distance: 2 })).toBe('wind');
    expect(fxFamilyIdForWeapon(worn('Gust Blade'), { distance: 1 })).toBe('sword');
    expect(fxFamilyIdForWeapon(worn('Breachbolt'), { distance: 3 })).toBe('thunder');
    const imbued = catalog('Firstwind');
    applyImbue(imbued, vampiric);
    applyWear(imbued, 'might');
    expect(fxFamilyIdForWeapon(imbued)).toBe('wind');
  });
});

describe('keywords, base lines and signature weapons', () => {
  it('keyword tags and the base line are the same worn as pristine, for every weapon', () => {
    for (const original of combatWeapons) {
      const weapon = clone(original);
      applyWear(weapon, 'hit');
      expect(itemKeywords(weapon), original.name).toEqual(itemKeywords(original));
      expect(itemBaseLineFor(weapon), original.name).toBe(itemBaseLineFor(original));
    }
  });

  it('every lord keeps its personal weapon status through wear and repair', () => {
    const signatures = data.weapons.filter((w) => w.signatureOf);
    expect(signatures.length).toBe(data.lords.length);
    for (const original of signatures) {
      const weapon = clone(original);
      applyWear(weapon, 'weight');
      expect(isSignatureWeapon(weapon), weapon.name).toBe(true);
      expect(weapon.signatureOf).toBe(original.signatureOf);
      expect(signatureWeaponFor(original.signatureOf, [weapon])).toBe(weapon);
      repairWeapon(weapon);
      expect(weapon).toEqual(original);
    }
  });
});

describe('old saves and the item-name migration', () => {
  it.each([
    ['Killing Edge -2', 'Keen Sword -2', {}],
    ['Doublebow -1', "Hermit's Bow -1", {}],
    ['Keen Killing Edge -3', 'Cruel Keen Sword -3', { imbueId: 'keen' }],
    ['Vampiric Soulreaver -1', 'Vampiric Namethief -1', { imbueId: 'vampiric' }],
  ])('%s renames to %s', (name, expected, opts) => {
    expect(renameItemName(name, opts)).toBe(expected);
  });

  function legacyGust() {
    return {
      ...catalog('Gust Blade'),
      name: 'Wind Sword -1',
      _baseName: 'Wind Sword',
      special: 'Throwable, lower stats',
      lore: 'Throw it at the second rank, soldier.',
      _wear: [{ stat: 'might', delta: -1, priceLoss: 0 }],
      uid: 'itm_old_gust',
    };
  }

  it('a worn item in an old save is renamed, its text refreshed, its wear kept', () => {
    const rm = new RunManager(data);
    rm.startRun();
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    delete saved.itemNamesRevision;
    saved.convoy = { weapons: [legacyGust()], consumables: [] };
    const loaded = RunManager.fromJSON(saved, data);
    const gust = loaded.convoy.weapons[0];
    expect(gust.name).toBe('Gust Blade -1');
    expect(gust._baseName).toBe('Gust Blade');
    expect(gust.special).toBe('Wind gust at range, lower stats');
    expect(gust.lore).toBe(catalog('Gust Blade').lore);
    expect(gust._wear).toEqual([{ stat: 'might', delta: -1, priceLoss: 0 }]);
    expect(loaded.toJSON().itemNamesRevision).toBe(ITEM_NAMES_REVISION);
  });

  it('a worn Breachbolt in a save still takes the catalog shot counts', () => {
    const rm = new RunManager(data);
    rm.startRun();
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    const bolt = { ...catalog('Breachbolt'), uses: 1, uid: 'itm_bolt' };
    delete bolt.usesByFaction;
    applyWear(bolt, 'weight');
    expect(bolt.name).toBe('Breachbolt -1');
    saved.convoy = { weapons: [bolt], consumables: [] };
    expect(getPerBattleMaxUses(bolt, { faction: 'player' })).toBe(1);
    expect(migrateSavedPerBattleWeapons(saved, data)).toBeGreaterThan(0);
    const fixed = saved.convoy.weapons[0];
    expect(getPerBattleMaxUses(fixed, { faction: 'player' })).toBe(
      getPerBattleMaxUses(catalog('Breachbolt'), { faction: 'player' }),
    );
    expect(fixed.name).toBe('Breachbolt -1');
    expect(fixed._wear).toHaveLength(1);
  });
});

describe('saving, the convoy and trading', () => {
  function runWithWornWeapons() {
    const rm = new RunManager(data);
    rm.startRun();
    const unit = rm.roster[0];
    const a = { ...catalog('Steel Sword'), uid: 'worn_a' };
    applyWear(a, 'might');
    applyWear(a, 'weight');
    const b = { ...catalog('Iron Lance'), uid: 'worn_b' };
    applyWear(b, 'crit');
    applyImbue(b, vampiric);
    unit.inventory = [a];
    unit.weapon = a;
    rm.convoy.weapons.push(b);
    return { rm, unit, a, b };
  }

  it('wear survives toJSON -> JSON -> fromJSON on a unit and in the convoy, and repairs exactly', () => {
    const { rm, a, b } = runWithWornWeapons();
    const aBefore = clone(a);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    const loaded = RunManager.fromJSON(saved, data);
    const unit = loaded.roster[0];
    expect(unit.weapon).toBe(unit.inventory[0]);
    expect(unit.inventory[0]).toEqual(aBefore);
    expect(unit.inventory[0].name).toBe('Steel Sword -2');
    expect(wearCount(unit.inventory[0])).toBe(2);
    const convoyB = loaded.convoy.weapons.at(-1);
    expect(convoyB).toEqual(b);
    expect(convoyB.name).toBe('Vampiric Iron Lance -1');
    // Repair after the load restores the pristine weapon exactly.
    repairWeapon(unit.inventory[0]);
    repairWeapon(unit.inventory[0]);
    expect(unit.inventory[0]).toEqual({ ...catalog('Steel Sword'), uid: 'worn_a' });
    // A second round trip is stable.
    const again = RunManager.fromJSON(JSON.parse(JSON.stringify(loaded.toJSON())), data);
    expect(again.convoy.weapons.at(-1)).toEqual(b);
  });

  it('serializeUnit and relinkWeapon keep the equipped worn weapon linked', () => {
    const { unit, a } = runWithWornWeapons();
    const restored = JSON.parse(JSON.stringify(serializeUnit(unit)));
    relinkWeapon(restored);
    expect(restored.weapon).toBe(restored.inventory[0]);
    expect(restored.weapon._wear).toEqual(a._wear);
    expect(restored.weapon.name).toBe('Steel Sword -2');
  });

  it('the convoy hands a worn weapon back intact', () => {
    const { rm, b } = runWithWornWeapons();
    const index = rm.convoy.weapons.indexOf(b);
    const taken = rm.takeFromConvoy('weapon', index);
    expect(taken).toEqual(b);
    expect(taken._wear).toEqual(b._wear);
  });

  it('a trade between units and with the convoy moves the very same worn instance', () => {
    const { rm, unit, a } = runWithWornWeapons();
    const friend = {
      name: 'Gaspar',
      faction: 'player',
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      inventory: [],
      consumables: [],
      weapon: null,
      accessory: null,
      stats: { HP: 20, STR: 5, MAG: 1, SKL: 5, SPD: 5, DEF: 4, RES: 1, LCK: 3, MOV: 5 },
      currentHP: 20,
      mov: 5,
      moveType: 'Infantry',
    };
    rm.roster = [unit, friend];
    const ctx = { context: 'roster', run: rm };
    const from = { holder: unitHolder(unit), bag: 'inventory', item: a };
    const to = { holder: unitHolder(friend), bag: 'inventory', item: null };
    const before = clone(a);
    expect(planTrade(ctx, from, to).ok).toBe(true);
    expect(applyTrade(ctx, from, to).ok).toBe(true);
    expect(friend.inventory[0]).toBe(a);
    expect(friend.inventory[0]).toEqual(before);
    const toConvoy = { holder: CONVOY_HOLDER, bag: 'inventory', item: null };
    const fromFriend = { holder: unitHolder(friend), bag: 'inventory', item: a };
    expect(applyTrade(ctx, fromFriend, toConvoy).ok).toBe(true);
    expect(rm.convoy.weapons).toContain(a);
    expect(a).toEqual(before);
  });
});

describe('no sources yet', () => {
  it('a new run and the catalog carry no worn weapons', () => {
    const rm = new RunManager(data);
    rm.startRun();
    const everything = JSON.stringify([rm.roster, rm.convoy, data.weapons]);
    expect(everything).not.toContain('_wear');
    for (const w of rm.roster.flatMap((u) => u.inventory)) expect(wearCount(w)).toBe(0);
    expect(WEAR_STATS).toEqual(['might', 'hit', 'crit', 'weight']);
  });
});
