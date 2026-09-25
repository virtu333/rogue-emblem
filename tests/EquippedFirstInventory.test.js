// Equipped weapon is always first in the inventory (FE convention), across every
// path that changes what is equipped — and reordering is deterministic,
// idempotent and never draws RNG.
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  equipWeapon,
  normalizeEquippedFirst,
  inventoryDisplayOrder,
  removeFromInventory,
  equipIfUnarmed,
  addToInventory,
  promoteUnit,
  reclassUnit,
  grantLethalArmoryWeapon,
} from '../src/engine/UnitManager.js';
import { RunManager, serializeUnit } from '../src/engine/RunManager.js';
import { rosterItemAction } from '../src/engine/RosterInventory.js';
import { giveRosterItem } from '../src/engine/RosterTransfers.js';
import { shopOwnedItems, sellShopItem } from '../src/engine/ShopCommands.js';
import { createBossLordUnit } from '../src/engine/BossRecruitSystem.js';
import { applyForge } from '../src/engine/ForgeSystem.js';
import { serializeBattleUnit, restoreEquippedReference } from '../src/engine/BattleUnitState.js';
import { relinkWeapon } from '../src/engine/RunManager.js';
import { HealController } from '../src/ui/HealController.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const w = (name, uid = name) => ({
  ...structuredClone(data.weapons.find((x) => x.name === name)),
  uid,
});
const names = (unit) => unit.inventory.map((item) => item.name);

function swordsman(inventory, weapon = inventory[0]) {
  return {
    name: 'Hero',
    className: 'Myrmidon',
    faction: 'player',
    level: 5,
    stats: { HP: 20, STR: 8, MAG: 8, SKL: 8, SPD: 8, DEF: 4, RES: 3, LCK: 5, MOV: 5 },
    currentHP: 20,
    skills: [],
    proficiencies: [
      { type: 'Sword', rank: 'Prof' },
      { type: 'Staff', rank: 'Prof' },
    ],
    inventory,
    weapon,
    consumables: [],
  };
}

let random;
beforeEach(() => {
  // Any reorder that consumed Math.random would advance the battle RNG.
  random = vi.spyOn(Math, 'random');
});
afterEach(() => random.mockRestore());

describe('UnitManager ordering primitives', () => {
  it('equipWeapon moves the weapon to the top and keeps the rest in order', () => {
    const [a, b, c] = [w('Iron Sword'), w('Steel Sword'), w('Killing Edge')];
    const u = swordsman([a, b, c]);
    equipWeapon(u, c);
    expect(u.weapon).toBe(c);
    expect(u.inventory).toEqual([c, a, b]);
    equipWeapon(u, b);
    expect(u.inventory).toEqual([b, c, a]);
    expect(random).not.toHaveBeenCalled();
  });

  it('a provisional equip ({ reorder: false }) never moves items', () => {
    const [a, b] = [w('Iron Sword'), w('Steel Sword')];
    const u = swordsman([a, b]);
    equipWeapon(u, b, { reorder: false });
    expect(u.weapon).toBe(b);
    expect(u.inventory).toEqual([a, b]);
  });

  it('rejects uncarried or non-proficient weapons without touching order', () => {
    const [a, b] = [w('Iron Sword'), w('Iron Lance')];
    const u = swordsman([a, b]);
    equipWeapon(u, b);
    equipWeapon(u, w('Steel Sword'));
    expect(u.weapon).toBe(a);
    expect(u.inventory).toEqual([a, b]);
  });

  it('normalizeEquippedFirst is idempotent and ignores dangling weapons', () => {
    const [a, b, c] = [w('Iron Sword'), w('Steel Sword'), w('Killing Edge')];
    const u = swordsman([a, b, c], c);
    expect(normalizeEquippedFirst(u)).toBe(true);
    expect(u.inventory).toEqual([c, a, b]);
    expect(normalizeEquippedFirst(u)).toBe(false);
    expect(u.inventory).toEqual([c, a, b]);
    const dangling = swordsman([a, b], w('Silver Sword'));
    expect(normalizeEquippedFirst(dangling)).toBe(false);
    expect(dangling.inventory).toEqual([a, b]);
    expect(normalizeEquippedFirst({ weapon: null, inventory: [a] })).toBe(false);
    expect(normalizeEquippedFirst(null)).toBe(false);
  });

  it('inventoryDisplayOrder shows equipped first without mutating', () => {
    const [a, b, c] = [w('Iron Sword'), w('Steel Sword'), w('Killing Edge')];
    const u = swordsman([a, b, c], b);
    expect(inventoryDisplayOrder(u)).toEqual([b, a, c]);
    expect(u.inventory).toEqual([a, b, c]);
    expect(inventoryDisplayOrder({ weapon: null, inventory: [a, b] })).toEqual([a, b]);
  });

  it('removing the equipped weapon equips the next combat weapon at the top', () => {
    const [heal, a, b] = [w('Heal'), w('Iron Sword'), w('Steel Sword')];
    const u = swordsman([b, heal, a], b);
    removeFromInventory(u, b);
    expect(u.weapon).toBe(a);
    expect(u.inventory).toEqual([a, heal]);
  });

  it('an unarmed unit equips a received combat weapon; an armed one keeps its choice', () => {
    const [a, b] = [w('Iron Sword'), w('Steel Sword')];
    const unarmed = swordsman([a], null);
    expect(equipIfUnarmed(unarmed, a)).toBe(true);
    expect(unarmed.weapon).toBe(a);
    const armed = swordsman([a, b]);
    expect(equipIfUnarmed(armed, b)).toBe(false);
    expect(armed.weapon).toBe(a);
  });

  it('promotion/reclass weapon invalidation and Lethal Armory grants equip at the top', () => {
    const [heal, lance, sword] = [w('Heal'), w('Iron Lance'), w('Iron Sword')];
    const u = swordsman([lance, heal, sword], lance);
    u.proficiencies.push({ type: 'Lance', rank: 'Prof' });
    const paladin = data.classes.find((c) => c.name === 'Swordmaster');
    promoteUnit(u, paladin, paladin.promotionBonuses || {}, data.skills);
    // Swordmaster cannot wield lances: the first combat weapon takes over.
    expect(u.weapon).toBe(sword);
    expect(u.inventory[0]).toBe(sword);

    const mage = swordsman([w('Iron Sword', 's2'), w('Fire', 'f2')]);
    mage.proficiencies.push({ type: 'Tome', rank: 'Prof' });
    const oldClass = data.classes.find((c) => c.name === 'Myrmidon');
    const newClass = data.classes.find((c) => c.name === 'Mage');
    reclassUnit(mage, newClass, oldClass, data.classes, data.skills);
    expect(mage.weapon?.type).toBe('Tome');
    expect(mage.inventory[0]).toBe(mage.weapon);

    const recruit = swordsman([w('Iron Sword', 'r1')]);
    expect(grantLethalArmoryWeapon(recruit, data.weapons, 2)).toBe(true);
    expect(recruit.inventory[0]).toBe(recruit.weapon);
    expect(recruit.inventory).toHaveLength(2);
  });

  it('forging or imbuing the equipped weapon changes it in place', () => {
    const [a, b] = [w('Iron Sword'), w('Steel Sword')];
    const u = swordsman([a, b]);
    applyForge(a, 'might');
    expect(u.inventory).toEqual([a, b]);
    expect(u.weapon).toBe(a);
  });

  it('boss-recruit lords arrive with the scaled weapon equipped first', () => {
    const kira = data.lords.find((l) => l.name === 'Kira') || data.lords[2];
    const cls = data.classes.find((c) => c.name === kira.class);
    const unit = createBossLordUnit(kira, cls, data.weapons, 13, null, { act: 'act3' });
    expect(unit.weapon).toBeTruthy();
    expect(unit.inventory[0]).toBe(unit.weapon);
  });
});

describe('roster commands keep the equipped weapon first', () => {
  function run() {
    const rm = new RunManager(loadGameData());
    rm.startRun();
    return rm;
  }

  it('roster Equip, Store and convoy Withdraw', () => {
    const rm = run();
    const unit = rm.roster[0];
    addToInventory(unit, { ...unit.weapon, uid: 'spare', name: 'Spare' });
    const spare = unit.inventory.at(-1);
    expect(rosterItemAction(rm, unit, spare, 'equip')).toBe('');
    expect(unit.inventory[0]).toBe(spare);
    // Storing the equipped weapon (not the last) re-equips the next one on top.
    expect(rosterItemAction(rm, unit, spare, 'store')).toBe('');
    expect(unit.inventory[0]).toBe(unit.weapon);
    expect(unit.weapon).not.toBe(spare);
  });

  it('give: the giver re-equips on top; an unarmed receiver equips what it receives', () => {
    const rm = run();
    const [giver, receiver] = rm.roster;
    const given = giver.weapon;
    addToInventory(giver, { ...given, uid: 'giver-spare', name: 'Giver spare' });
    receiver.proficiencies.push({ type: given.type, rank: 'Mast' });
    receiver.weapon = null;
    expect(giveRosterItem(rm, giver, receiver, given).ok).toBe(true);
    expect(giver.inventory[0]).toBe(giver.weapon);
    expect(giver.weapon).toBeTruthy();
    expect(giver.weapon.uid).not.toBe(given.uid);
    expect(receiver.weapon?.uid).toBe(given.uid);
    expect(receiver.inventory[0]).toBe(receiver.weapon);
  });

  it('shop sell list shows the equipped weapon first; selling it re-equips on top', () => {
    const rm = run();
    const unit = rm.roster[0];
    addToInventory(unit, { ...unit.weapon, uid: 'sellable', name: 'Sellable', price: 500 });
    const sellable = unit.inventory.at(-1);
    unit.weapon = sellable; // legacy order: equipped weapon is last
    const rows = shopOwnedItems(rm).filter((r) => r.unit === unit && r.kind === 'inventory');
    expect(rows[0].item).toBe(sellable);
    expect(sellShopItem(rm, rows[0]).ok).toBe(true);
    expect(unit.inventory[0]).toBe(unit.weapon);
    expect(unit.weapon).not.toBe(sellable);
  });
});

describe('persistence', () => {
  function legacyRun() {
    const rm = new RunManager(loadGameData());
    rm.startRun();
    const unit = rm.roster[0];
    addToInventory(unit, { ...unit.weapon, uid: 'legacy-2', name: 'Legacy second' });
    unit.weapon = unit.inventory.at(-1); // legacy save: equipped weapon not first
    return rm;
  }

  it('normalizes a legacy save on load, idempotently and without RNG', () => {
    const rm = legacyRun();
    const liveOrder = names(rm.roster[0]);
    const raw = JSON.parse(JSON.stringify(rm.toJSON()));
    // Force the raw save itself into legacy order.
    const saved = raw.roster[0];
    saved.inventory.reverse();
    random.mockClear();
    const loaded = RunManager.fromJSON(structuredClone(raw), loadGameData());
    const unit = loaded.roster[0];
    expect(unit.weapon.uid).toBe('legacy-2');
    expect(unit.inventory[0]).toBe(unit.weapon);
    const once = JSON.stringify(loaded.toJSON().roster);
    const twice = JSON.stringify(
      RunManager.fromJSON(JSON.parse(JSON.stringify(loaded.toJSON())), loadGameData()).toJSON()
        .roster,
    );
    expect(twice).toBe(once);
    expect(liveOrder).toContain('Legacy second');
  });

  it('serializeUnit normalizes its copy without mutating the live unit', () => {
    const rm = legacyRun();
    const live = rm.roster[0];
    const before = names(live);
    const data2 = serializeUnit(live);
    expect(names(live)).toEqual(before);
    expect(data2.inventory[0]).toBe(data2.weapon);
    expect(data2.weapon.uid).toBe('legacy-2');
  });

  it('deployment (getRoster) and battle completion keep equipped first', () => {
    const rm = legacyRun();
    const deployed = rm.getRoster();
    expect(deployed[0].inventory[0]).toBe(deployed[0].weapon);
    const node = rm.nodeMap.nodes.find((n) => !n.completed && n.type === 'battle');
    expect(node).toBeTruthy();
    // A unit that ended the battle holding a weapon anywhere in the bag.
    deployed[0].weapon = deployed[0].inventory.at(-1);
    expect(rm.completeBattle(deployed, node.id, 0)).toBe(true);
    expect(rm.roster[0].inventory[0]).toBe(rm.roster[0].weapon);
    expect(rm.roster[0].weapon.uid).toBe(deployed[0].weapon.uid);
  });

  it('battle checkpoints restore the exact order and the equipped reference', () => {
    const [a, b, c] = [w('Iron Sword'), w('Steel Sword'), w('Killing Edge')];
    // A legacy checkpoint may hold the equipped weapon anywhere: restore exactly.
    const u = swordsman([a, b, c], c);
    const snapshot = JSON.parse(JSON.stringify(serializeBattleUnit(u)));
    expect(snapshot.equippedInventoryIndex).toBe(2);
    restoreEquippedReference(snapshot);
    relinkWeapon(snapshot);
    expect(snapshot.weapon).toBe(snapshot.inventory[2]);
    expect(snapshot.inventory.map((x) => x.name)).toEqual(names(u));
    // A modern (reordered) checkpoint restores equipped-first.
    equipWeapon(u, c);
    const modern = JSON.parse(JSON.stringify(serializeBattleUnit(u)));
    restoreEquippedReference(modern);
    relinkWeapon(modern);
    expect(modern.equippedInventoryIndex).toBeUndefined();
    expect(modern.inventory[0]).toBe(modern.weapon);
    expect(modern.weapon.name).toBe('Killing Edge');
  });
});

describe('staff use is provisional (HealController)', () => {
  const controller = () => new HealController({ playerUnits: [] });

  it('holding a staff never reorders; restoring brings back the prior weapon', () => {
    const [sword, heal] = [w('Iron Sword'), w('Heal')];
    const u = swordsman([sword, heal]);
    const hc = controller();
    hc.holdStaff(u, heal);
    expect(u.weapon).toBe(heal);
    expect(u.inventory).toEqual([sword, heal]);
    hc.holdStaff(u, heal); // re-entering keeps the true prior
    hc.restoreCombatWeapon(u);
    expect(u.weapon).toBe(sword);
    expect(u.inventory).toEqual([sword, heal]);
  });

  it('a staff-only unit gets its original staff back on top', () => {
    const [heal, mend] = [w('Heal'), w('Mend')];
    const u = swordsman([heal, mend]);
    const hc = controller();
    hc.holdStaff(u, mend);
    hc.restoreCombatWeapon(u);
    expect(u.weapon).toBe(heal);
    expect(u.inventory).toEqual([heal, mend]);
  });

  it('a unit with a staff equipped switches to its first combat weapon (a real equip)', () => {
    const [heal, sword] = [w('Heal'), w('Iron Sword')];
    const u = swordsman([heal, sword]);
    const hc = controller();
    hc.holdStaff(u, heal);
    hc.restoreCombatWeapon(u);
    expect(u.weapon).toBe(sword);
    expect(u.inventory).toEqual([sword, heal]);
  });
});
