// Per-instance item use counts (engine/ItemUsage.js): what counts (the player's
// strikes, kills and staff uses, through DeedSystem's seams; never the tutorial
// or the enemy), how it reads, and that the counts stay with the very item
// through saves, renames, forges, imbues, trades and the convoy, while a bought
// copy starts at none.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager, serializeUnit } from '../src/engine/RunManager.js';
import {
  ITEM_USAGE_KEYS,
  bumpItemUsage,
  itemUsage,
  itemUsageShort,
  itemUsageText,
} from '../src/engine/ItemUsage.js';
import { recordCombat, recordKill, recordStaffUse } from '../src/engine/DeedSystem.js';
import { DeedController } from '../src/ui/DeedController.js';
import { applyForge, deforgeWeapon } from '../src/engine/ForgeSystem.js';
import { applyImbue } from '../src/engine/ImbueSystem.js';
import { applyTrade, unitHolder } from '../src/engine/ItemTrade.js';
import { purchaseShopItem } from '../src/engine/ShopCommands.js';
import { ITEM_NAMES_REVISION } from '../src/engine/ItemNameMigration.js';

const data = loadGameData();
const catalog = (name) => structuredClone(data.weapons.find((w) => w.name === name));
let uidSeq = 0;
const carried = (name) => ({ ...catalog(name), uid: `test-item-${++uidSeq}` });
function fighter(name, faction = 'player', weaponName = 'Iron Sword') {
  const weapon = carried(weaponName);
  return {
    name,
    faction,
    level: 5,
    currentHP: 20,
    stats: { HP: 20, MOV: 5 },
    proficiencies: [
      { type: 'Sword', rank: 'Prof' },
      { type: 'Staff', rank: 'Prof' },
    ],
    weapon,
    inventory: [weapon],
    consumables: [],
  };
}
const strike = (side, extra = {}) => ({
  type: 'strike',
  attackerSide: side,
  miss: false,
  isCrit: false,
  damage: 3,
  ...extra,
});
const usageOf = (item) => Object.fromEntries(ITEM_USAGE_KEYS.map((k) => [k, item?.[k]]));

describe('what counts', () => {
  it("counts every strike the player's units make, hit or miss, on the weapon they struck with", () => {
    const hero = fighter('Edric');
    const foe = fighter('Brigand', 'enemy', 'Iron Axe');
    // Hero attacks: hit, foe counters, hero doubles and misses; then the foe
    // attacks in its phase and the hero counters once.
    recordCombat(
      { events: [strike('attacker'), strike('defender'), strike('attacker', { miss: true })] },
      hero,
      foe,
      { phase: 'player' },
    );
    recordCombat({ events: [strike('attacker'), strike('defender')] }, foe, hero, {
      phase: 'enemy',
    });
    expect(hero.weapon._strikes).toBe(3);
    expect(usageOf(foe.weapon)).toEqual({ _strikes: undefined, _kills: undefined, _casts: undefined }); // prettier-ignore
    // A skill event is not a strike.
    recordCombat({ events: [{ type: 'skill', attackerSide: 'attacker' }] }, hero, foe, {});
    expect(hero.weapon._strikes).toBe(3);
  });

  it('credits a kill to the weapon whose strike made it, never a kill made otherwise', () => {
    const hero = fighter('Edric');
    const foe = fighter('Brigand', 'enemy', 'Iron Axe');
    // A miss, a wounding hit, the foe's counter that downs the hero (an enemy's kill),
    // then the hero's strike that leaves the foe at 0 HP.
    recordCombat(
      {
        events: [
          strike('attacker', { miss: true, targetHPAfter: 9 }),
          strike('attacker', { targetHPAfter: 4 }),
          strike('defender', { targetHPAfter: 0 }),
          strike('attacker', { targetHPAfter: 0 }),
        ],
      },
      hero,
      foe,
      {},
    );
    recordKill(foe, hero, { terrain: 'Plain' });
    expect(hero.weapon).toMatchObject({ _strikes: 3, _kills: 1 });
    expect(foe.weapon._kills).toBeUndefined();
    // A kill no strike made (a turn-start aura, a burst, poison): the deed still
    // counts it, the weapon does not. A healer's staff never "kills".
    const healer = fighter('Sera', 'player', 'Heal');
    recordKill(fighter('Thief', 'enemy'), healer, {});
    recordKill(fighter('Archer', 'enemy'), hero, {});
    expect(healer._battleDeeds.kills).toBe(1);
    expect(healer.weapon._kills).toBeUndefined();
    expect(hero._battleDeeds.kills).toBe(2);
    expect(hero.weapon._kills).toBe(1);
  });

  it("counts a staff use on the staff, only for the player's army", () => {
    const sera = fighter('Sera', 'player', 'Heal');
    const shaman = fighter('Shaman', 'enemy', 'Sleep Staff');
    recordStaffUse(sera, sera.weapon);
    recordStaffUse(sera, sera.weapon);
    recordStaffUse(shaman, shaman.weapon);
    expect(sera.weapon._casts).toBe(2);
    expect(shaman.weapon._casts).toBeUndefined();
  });

  it('counts nothing in the tutorial; the battle seam counts in a run', () => {
    const make = (tutorialMode) => {
      const hero = fighter('Edric');
      const foe = fighter('Brigand', 'enemy', 'Iron Axe');
      const deeds = new DeedController({
        runManager: {},
        gameData: { deeds: data.deeds },
        battleParams: { tutorialMode },
        turnManager: { currentPhase: 'player' },
      });
      deeds.onCombat(hero, foe, { events: [strike('attacker', { targetHPAfter: 0 })] });
      deeds.onUnitRemoved(foe, hero);
      deeds.onStaffUse(hero, hero.weapon);
      return usageOf(hero.weapon);
    };
    expect(make(true)).toEqual({ _strikes: undefined, _kills: undefined, _casts: undefined });
    expect(make(false)).toEqual({ _strikes: 1, _kills: 1, _casts: 1 });
  });

  it('ignores garbage: no item, an unknown key, a non-number', () => {
    const item = {};
    bumpItemUsage(null, '_strikes');
    bumpItemUsage(item, 'might');
    bumpItemUsage(item, '_kills', 'x');
    expect(item).toEqual({});
    expect(itemUsage({ _strikes: -4, _kills: 2.9, _casts: 'many' })).toEqual({
      strikes: 0,
      kills: 2,
      casts: 0,
    });
  });
});

describe('how it reads', () => {
  it.each([
    [{ type: 'Sword' }, '', ''],
    [{ type: 'Sword', _strikes: 1 }, 'Used in 1 strike', '1 strike'],
    [{ type: 'Bow', _strikes: 14, _kills: 3 }, 'Used in 14 strikes · 3 kills', '14 strikes'],
    [{ type: 'Axe', _strikes: 2, _kills: 1 }, 'Used in 2 strikes · 1 kill', '2 strikes'],
    [{ type: 'Staff' }, '', ''],
    // A staff's count reads as casts, never as charges left ("Uses 2/3").
    [{ type: 'Staff', _casts: 1 }, 'Cast once', '1 cast'],
    [{ type: 'Staff', _casts: 9 }, 'Cast 9 times', '9 casts'],
  ])('%o → "%s" / "%s"', (item, text, short) => {
    expect(itemUsageText(item)).toBe(text);
    expect(itemUsageShort(item)).toBe(short);
  });
});

describe('the count stays with the very item', () => {
  const used = (name) => Object.assign(carried(name), { _strikes: 14, _kills: 3 });

  it('through a unit serialization and a run save and load (roster, convoy, fallen)', () => {
    const run = new RunManager(data);
    run.startRun({ runSeed: 21 });
    const [lead, partner] = run.roster;
    const sword = used('Iron Sword');
    lead.inventory.push(sword);
    expect(serializeUnit(lead).inventory.at(-1)).toMatchObject({ _strikes: 14, _kills: 3 });
    const heal = Object.assign(carried('Heal'), { _casts: 6 });
    run.convoy.weapons.push(heal);
    const lance = used('Iron Lance');
    partner.inventory.push(lance);
    run.fallenUnits.push(serializeUnit(partner));
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    const find = (list, uid) => list.find((i) => i.uid === uid);
    expect(usageOf(find(loaded.roster[0].inventory, sword.uid))).toEqual(usageOf(sword));
    expect(find(loaded.convoy.weapons, heal.uid)._casts).toBe(6);
    expect(usageOf(find(loaded.fallenUnits[0].inventory, lance.uid))).toEqual(usageOf(lance));
  });

  it('through a renamed item in an old save (ItemNameMigration)', () => {
    const run = new RunManager(data);
    run.startRun({ runSeed: 22 });
    const old = Object.assign(used('Keen Sword'), { name: 'Killing Edge' });
    run.roster[0].inventory.push(old);
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    delete saved.itemNamesRevision;
    expect(ITEM_NAMES_REVISION).toBeGreaterThan(0);
    const loaded = RunManager.fromJSON(saved, data);
    const item = loaded.roster[0].inventory.find((i) => i.uid === old.uid);
    expect(item.name).toBe('Keen Sword');
    expect(usageOf(item)).toEqual(usageOf(old));
  });

  it('through forging, a whetstone, deforging and an imbue', () => {
    const sword = used('Iron Sword');
    const counts = usageOf(sword);
    expect(applyForge(sword, 'might').success).toBe(true); // a forge (or a Might whetstone)
    expect(applyForge(sword, 'hit').success).toBe(true);
    expect(deforgeWeapon(sword).success).toBe(true);
    const imbue = data.imbues.imbues.find((i) => i.adjective);
    expect(applyImbue(sword, imbue).success).toBe(true);
    expect(sword.name).toBe(`${imbue.adjective} Iron Sword +1`);
    expect(usageOf(sword)).toEqual(counts);
  });

  it('through a trade and the convoy (the same instance moves)', () => {
    const run = new RunManager(data);
    run.startRun({ runSeed: 23 });
    const [lead, partner] = run.roster;
    const sword = used('Iron Sword');
    lead.inventory.push(sword);
    const result = applyTrade(
      { context: 'roster', run },
      { holder: unitHolder(lead), bag: 'inventory', item: sword },
      { holder: unitHolder(partner), bag: 'inventory', item: null },
    );
    expect(result.ok).toBe(true);
    const moved = partner.inventory.find((i) => i.uid === sword.uid);
    expect(usageOf(moved)).toEqual(usageOf(sword));
    expect(run.addToConvoy(moved)).toBe(true);
    expect(usageOf(run.convoy.weapons.find((i) => i.uid === sword.uid))).toEqual(usageOf(sword));
  });

  it('a bought copy is a fresh item, and the catalog never counts', () => {
    const run = new RunManager(data);
    run.startRun({ runSeed: 24 });
    run.gold = 5000;
    const [lead] = run.roster;
    const worn = used('Iron Sword');
    lead.inventory.push(worn);
    const stockItem = catalog('Iron Sword');
    const entry = { item: stockItem, type: 'weapon', price: stockItem.price };
    expect(purchaseShopItem(run, [entry], entry, lead).ok).toBe(true);
    const bought = lead.inventory.at(-1);
    expect(bought).not.toBe(worn);
    expect(itemUsageText(bought)).toBe('');
    // Striking with a unit's weapon never reaches the catalog it was copied from.
    recordCombat({ events: [strike('attacker')] }, lead, fighter('Foe', 'enemy'), {});
    expect(data.weapons.find((w) => w.name === lead.weapon.name)._strikes).toBeUndefined();
  });
});
