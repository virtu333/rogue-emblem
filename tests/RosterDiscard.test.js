// Roster Discard (RosterInventory 'discard'): throwing an item away for good between battles.
// Ways this goes wrong:
//   - it removes the wrong instance (the first item of that name, the first with that uid) and
//     leaves the one the player chose;
//   - it moves the item (to the convoy, or into gold) instead of destroying it, or the item
//     comes back from a save;
//   - it removes an equipped weapon and leaves `unit.weapon` pointing at a thrown-away item;
//   - it throws away what can never be had again (a lord's personal weapon), or acts in the
//     prologue (authored kits) or while a battle is in progress;
//   - it warns about the wrong unit, or not at all, when it takes a unit's last weapon;
//   - a blocked or stale request still changes something.
// Expected values are written by hand from the roster rules, not by re-running the command.
import { describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  rosterItemAction,
  rosterItemBlock,
  rosterItemWarnings,
} from '../src/engine/RosterInventory.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));
const withUid = (item, uid) => ({ ...item, uid });
const uidsOf = (list) => list.map((item) => item.uid);

function fixture() {
  const run = new RunManager(gameData);
  run.startRun();
  const unit = run.roster[0];
  // A known bag: two Iron Swords with their own uids, equipped first.
  unit.inventory = [
    withUid(weapon('Iron Sword'), 'sword-a'),
    withUid(weapon('Iron Sword'), 'sword-b'),
    withUid(weapon('Iron Lance'), 'lance-a'),
  ];
  unit.weapon = unit.inventory[0];
  unit.consumables = [
    { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 2, uid: 'vuln-a' },
    { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 2, uid: 'vuln-b' },
  ];
  return { run, unit };
}
const reload = (run) => RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), gameData);

describe('discarding a carried item', () => {
  it('removes exactly the chosen weapon instance, leaving the same-named one', () => {
    const { run, unit } = fixture();
    const [first, second, lance] = unit.inventory;
    expect(rosterItemBlock(run, unit, second, 'discard')).toBe('');
    expect(rosterItemAction(run, unit, second, 'discard')).toBe('');
    expect(unit.inventory).toHaveLength(2);
    expect(unit.inventory[0]).toBe(first);
    expect(unit.inventory[1]).toBe(lance);
    expect(unit.weapon).toBe(first);
  });

  it('tells identical clones apart by identity, not by name, uid or content', () => {
    const { run, unit } = fixture();
    // The same JSON, uid included (a duplicated bag item): only the one chosen goes.
    const twin = structuredClone(unit.inventory[0]);
    unit.inventory.push(twin);
    expect(rosterItemAction(run, unit, twin, 'discard')).toBe('');
    expect(unit.inventory).toHaveLength(3);
    expect(unit.inventory[0]).toBe(unit.weapon);
    expect(unit.inventory).not.toContain(twin);
  });

  it('removes exactly the chosen consumable instance', () => {
    const { run, unit } = fixture();
    const [first, second] = unit.consumables;
    expect(rosterItemAction(run, unit, first, 'discard')).toBe('');
    expect(unit.consumables).toEqual([second]);
    expect(unit.consumables[0]).toBe(second);
  });

  it('destroys the item: nothing lands in the convoy, no gold is paid', () => {
    const { run, unit } = fixture();
    const gold = run.gold;
    const stored = run.getConvoyCounts();
    rosterItemAction(run, unit, unit.inventory[2], 'discard');
    rosterItemAction(run, unit, unit.consumables[0], 'discard');
    expect(run.gold).toBe(gold);
    expect(run.getConvoyCounts()).toEqual(stored);
    expect(run.accessories).toEqual([]);
  });

  it('a second request for the same item is refused and changes nothing', () => {
    const { run, unit } = fixture();
    const lance = unit.inventory[2];
    expect(rosterItemAction(run, unit, lance, 'discard')).toBe('');
    expect(rosterItemBlock(run, unit, lance, 'discard')).toBe('Item is no longer here.');
    expect(rosterItemAction(run, unit, lance, 'discard')).toBe('Item is no longer here.');
    expect(unit.inventory).toHaveLength(2);
  });

  it('an item that moved to another unit is no longer here', () => {
    const { run, unit } = fixture();
    const other = run.roster[1] || Object.assign(structuredClone(unit), { name: 'Other' });
    const lance = unit.inventory[2];
    unit.inventory.splice(2, 1);
    other.inventory = [lance];
    expect(rosterItemAction(run, unit, lance, 'discard')).toBe('Item is no longer here.');
    expect(other.inventory).toEqual([lance]);
  });

  it('a unit that left the roster cannot discard, and loses nothing', () => {
    const { run, unit } = fixture();
    const ghost = structuredClone(unit);
    expect(rosterItemAction(run, ghost, ghost.inventory[0], 'discard')).toBe(
      'Unit is no longer in the roster.',
    );
    expect(ghost.inventory).toHaveLength(3);
  });

  it('an equipped weapon leaves as Store does: the next combat weapon is equipped', () => {
    const { run, unit } = fixture();
    const [equipped, second] = unit.inventory;
    expect(unit.weapon).toBe(equipped);
    expect(rosterItemAction(run, unit, equipped, 'discard')).toBe('');
    expect(unit.weapon).toBe(second);
    expect(unit.inventory[0]).toBe(second);
  });

  it('the last combat weapon leaves the unit unarmed, or on its staff', () => {
    const { run, unit } = fixture();
    const sword = unit.inventory[0];
    unit.inventory = [sword];
    unit.weapon = sword;
    expect(rosterItemAction(run, unit, sword, 'discard')).toBe('');
    expect(unit.inventory).toEqual([]);
    expect(unit.weapon).toBeNull();

    const staff = { name: 'Heal', type: 'Staff', rankRequired: 'Prof', uses: 3, uid: 'heal-1' };
    unit.proficiencies = [...unit.proficiencies, { type: 'Staff', rank: 'Prof' }];
    const last = withUid(weapon('Iron Sword'), 'sword-z');
    unit.inventory = [last, staff];
    unit.weapon = last;
    expect(rosterItemAction(run, unit, last, 'discard')).toBe('');
    expect(unit.inventory).toEqual([staff]);
    expect(unit.weapon).toBe(staff);
  });

  it('discarding a staff takes it from the bag', () => {
    const { run, unit } = fixture();
    const staff = { name: 'Heal', type: 'Staff', rankRequired: 'Prof', uses: 3, uid: 'heal-1' };
    unit.inventory.push(staff);
    expect(rosterItemAction(run, unit, staff, 'discard')).toBe('');
    expect(uidsOf(unit.inventory)).toEqual(['sword-a', 'sword-b', 'lance-a']);
  });
});

describe('discard warnings', () => {
  it("warns leaves_unarmed, naming the unit, only for the unit's last combat weapon", () => {
    const { run, unit } = fixture();
    const sword = unit.inventory[0];
    // Three combat weapons: none is the last.
    for (const item of unit.inventory)
      expect(rosterItemWarnings(run, unit, item, 'discard')).toEqual([]);
    unit.inventory = [sword];
    expect(rosterItemWarnings(run, unit, sword, 'discard')).toEqual([
      { code: 'leaves_unarmed', unit },
    ]);
  });

  it('a lone staff is not a combat weapon, and supplies and convoy items carry no warning', () => {
    const { run, unit } = fixture();
    const staff = { name: 'Heal', type: 'Staff', rankRequired: 'Prof', uses: 3, uid: 'heal-1' };
    unit.inventory = [staff];
    expect(rosterItemWarnings(run, unit, staff, 'discard')).toEqual([]);
    expect(rosterItemWarnings(run, unit, unit.consumables[0], 'discard')).toEqual([]);
    const solo = withUid(weapon('Iron Sword'), 'solo');
    run.addToConvoy(solo);
    const stored = run.convoy.weapons[0];
    unit.inventory = [];
    expect(rosterItemWarnings(run, unit, stored, 'discard')).toEqual([]);
  });

  it('a blocked discard carries no warning', () => {
    const { run, unit } = fixture();
    const sword = unit.inventory[0];
    unit.inventory = [sword];
    run.battleInProgress = { nodeId: 'n1' };
    expect(rosterItemWarnings(run, unit, sword, 'discard')).toEqual([]);
  });

  it('Store is still warned exactly as before', () => {
    const { run, unit } = fixture();
    const sword = unit.inventory[0];
    unit.inventory = [sword];
    expect(rosterItemWarnings(run, unit, sword, 'store')).toEqual([
      { code: 'leaves_unarmed', unit },
    ]);
  });
});

describe('discarding a convoy item', () => {
  it('removes the chosen stored weapon, given the live item', () => {
    const { run, unit } = fixture();
    run.convoy.weapons = [
      withUid(weapon('Iron Axe'), 'axe-a'),
      withUid(weapon('Iron Axe'), 'axe-b'),
      withUid(weapon('Iron Bow'), 'bow-a'),
    ];
    const live = run.convoy.weapons[1];
    expect(rosterItemBlock(run, unit, live, 'discard')).toBe('');
    expect(rosterItemAction(run, unit, live, 'discard')).toBe('');
    expect(uidsOf(run.convoy.weapons)).toEqual(['axe-a', 'bow-a']);
    // The unit that was looking at the convoy is untouched.
    expect(uidsOf(unit.inventory)).toEqual(['sword-a', 'sword-b', 'lance-a']);
  });

  it('given the live item, removes that one even where two share a uid', () => {
    const { run, unit } = fixture();
    const first = withUid(weapon('Iron Axe'), 'dup');
    const second = { ...withUid(weapon('Iron Axe'), 'dup'), name: 'Iron Axe +1' };
    run.convoy.weapons = [first, second];
    expect(rosterItemAction(run, unit, second, 'discard')).toBe('');
    expect(run.convoy.weapons).toEqual([first]);
    expect(run.convoy.weapons[0]).toBe(first);
  });

  it('removes a stored consumable, leaving the same-named one', () => {
    const { run, unit } = fixture();
    run.convoy.consumables = [
      { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 2, uid: 'v1' },
      { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 2, uid: 'v2' },
    ];
    expect(rosterItemAction(run, unit, run.convoy.consumables[0], 'discard')).toBe('');
    expect(uidsOf(run.convoy.consumables)).toEqual(['v2']);
    expect(unit.consumables).toHaveLength(2);
  });

  it('works with no unit looking at it, and refuses a retry of the discarded item', () => {
    const { run } = fixture();
    run.convoy.weapons = [withUid(weapon('Iron Axe'), 'axe-a')];
    const live = run.convoy.weapons[0];
    expect(rosterItemAction(run, null, live, 'discard')).toBe('');
    expect(run.convoy.weapons).toEqual([]);
    expect(rosterItemAction(run, null, live, 'discard')).toBe('Item is no longer here.');
  });

  it('a bag item is not confused with a convoy item of the same uid', () => {
    const { run, unit } = fixture();
    run.convoy.weapons = [withUid(weapon('Iron Sword'), 'sword-b')];
    const bagSword = unit.inventory[1];
    expect(rosterItemAction(run, unit, bagSword, 'discard')).toBe('');
    expect(uidsOf(unit.inventory)).toEqual(['sword-a', 'lance-a']);
    expect(uidsOf(run.convoy.weapons)).toEqual(['sword-b']);
  });
});

describe('what cannot be discarded', () => {
  it("a lord's personal weapon, carried or stored", () => {
    const { run, unit } = fixture();
    const personal = gameData.weapons.find((w) => w.signatureOf);
    expect(personal).toBeTruthy();
    const carried = withUid(structuredClone(personal), 'sig-1');
    unit.inventory.push(carried);
    const reason = "A lord's personal weapon cannot be discarded.";
    expect(rosterItemBlock(run, unit, carried, 'discard')).toBe(reason);
    expect(rosterItemAction(run, unit, carried, 'discard')).toBe(reason);
    expect(unit.inventory).toContain(carried);
    run.convoy.weapons = [withUid(structuredClone(personal), 'sig-2')];
    expect(rosterItemAction(run, unit, run.convoy.weapons[0], 'discard')).toBe(reason);
    expect(run.convoy.weapons).toHaveLength(1);
  });

  it('anything in the prologue', () => {
    const prologue = new RunManager(gameData);
    prologue.startPrologue(gameData, gameData.prologue);
    const unit = prologue.roster[0];
    const item = unit.inventory[0];
    expect(rosterItemBlock(prologue, unit, item, 'discard')).toBe(
      'Nothing is discarded in the prologue.',
    );
    const before = unit.inventory.length;
    expect(rosterItemAction(prologue, unit, item, 'discard')).not.toBe('');
    expect(unit.inventory).toHaveLength(before);
  });

  it('anything while a battle is in progress', () => {
    const { run, unit } = fixture();
    run.beginBattleInProgress('n-battle');
    const item = unit.inventory[2];
    expect(rosterItemBlock(run, unit, item, 'discard')).toBe(
      'Items cannot be discarded during a battle.',
    );
    expect(rosterItemAction(run, unit, item, 'discard')).not.toBe('');
    expect(unit.inventory).toContain(item);
    run.clearBattleInProgress();
    expect(rosterItemBlock(run, unit, item, 'discard')).toBe('');
  });

  it('an accessory, and anything that is not an item', () => {
    const { run, unit } = fixture();
    const ring = { name: 'Power Ring', type: 'Accessory', effects: { STR: 1 } };
    unit.accessory = ring;
    expect(rosterItemBlock(run, unit, ring, 'discard')).toBe('Accessories are not discarded.');
    expect(unit.accessory).toBe(ring);
    expect(rosterItemBlock(run, unit, null, 'discard')).toBe('Item is no longer here.');
    expect(rosterItemBlock(null, unit, ring, 'discard')).toBe('Unavailable action.');
  });

  it('Equip, Store and the rest still see only the unit they act for', () => {
    const { run, unit } = fixture();
    const ghost = structuredClone(unit);
    expect(rosterItemBlock(run, ghost, ghost.inventory[0], 'store')).toBe(
      'Unit is no longer in the roster.',
    );
  });
});

describe('a discard is saved', () => {
  it('a thrown-away bag item and convoy item stay gone after save and load', () => {
    const { run, unit } = fixture();
    run.convoy.weapons = [
      withUid(weapon('Iron Axe'), 'axe-a'),
      withUid(weapon('Iron Axe'), 'axe-b'),
    ];
    rosterItemAction(run, unit, unit.inventory[1], 'discard');
    rosterItemAction(run, unit, unit.consumables[0], 'discard');
    rosterItemAction(run, null, run.convoy.weapons[0], 'discard');

    const loaded = reload(run);
    const kept = loaded.roster[0];
    expect(uidsOf(kept.inventory)).toEqual(['sword-a', 'lance-a']);
    expect(uidsOf(kept.consumables)).toEqual(['vuln-b']);
    expect(uidsOf(loaded.convoy.weapons)).toEqual(['axe-b']);
    expect(kept.weapon.uid).toBe('sword-a');
  });

  it('a discarded equipped weapon is not equipped again by a load', () => {
    const { run, unit } = fixture();
    rosterItemAction(run, unit, unit.inventory[0], 'discard');
    const kept = reload(run).roster[0];
    expect(uidsOf(kept.inventory)).toEqual(['sword-b', 'lance-a']);
    expect(kept.weapon.uid).toBe('sword-b');
  });
});

// Discard destroys, so it acts only on the live instance in the place the request names: never
// the first item with the same uid, never an equal copy, never the other container.
describe('discard needs the live instance, never a matching uid or content', () => {
  const STALE = 'Item is no longer here.';

  it('a detached snapshot of the second duplicate-uid axe destroys nothing', () => {
    const { run, unit } = fixture();
    const first = withUid(weapon('Iron Axe'), 'dup');
    const second = { ...withUid(weapon('Iron Axe'), 'dup'), name: 'Iron Axe +1' };
    run.convoy.weapons = [first, second];
    // getConvoyItems() hands out clones: the old uid fallback matched the FIRST axe.
    const snapshot = run.getConvoyItems().weapons[1];
    expect(snapshot.name).toBe('Iron Axe +1');
    expect(rosterItemBlock(run, unit, snapshot, 'discard')).toBe(STALE);
    expect(rosterItemAction(run, unit, snapshot, 'discard')).toBe(STALE);
    expect(run.convoy.weapons.map((item) => item.name)).toEqual(['Iron Axe', 'Iron Axe +1']);
  });

  it('the live second duplicate-uid axe goes, and the first stays', () => {
    const { run, unit } = fixture();
    const first = withUid(weapon('Iron Axe'), 'dup');
    const second = { ...withUid(weapon('Iron Axe'), 'dup'), name: 'Iron Axe +1' };
    run.convoy.weapons = [first, second];
    expect(rosterItemAction(run, unit, run.convoy.weapons[1], 'discard')).toBe('');
    expect(run.convoy.weapons.map((item) => item.name)).toEqual(['Iron Axe']);
    // And the other way round: the live first one goes, the +1 axe stays.
    run.convoy.weapons = [first, second];
    expect(rosterItemAction(run, unit, first, 'discard')).toBe('');
    expect(run.convoy.weapons.map((item) => item.name)).toEqual(['Iron Axe +1']);
  });

  it('a stale bag request does not fall through to a convoy copy sharing its uid', () => {
    const { run, unit } = fixture();
    const carried = unit.inventory[1];
    run.convoy.weapons = [{ ...structuredClone(carried), name: 'Iron Sword +1' }];
    expect(carried.uid).toBe(run.convoy.weapons[0].uid);
    expect(rosterItemAction(run, unit, carried, 'discard', 'bag')).toBe('');
    expect(uidsOf(unit.inventory)).toEqual(['sword-a', 'lance-a']);
    // The retry of the same request finds nothing in the bag and must not touch the convoy.
    expect(rosterItemBlock(run, unit, carried, 'discard', 'bag')).toBe(STALE);
    expect(rosterItemAction(run, unit, carried, 'discard', 'bag')).toBe(STALE);
    expect(run.convoy.weapons.map((item) => item.name)).toEqual(['Iron Sword +1']);
    // Without a named place the discarded reference is equally refused.
    expect(rosterItemAction(run, unit, carried, 'discard')).toBe(STALE);
    expect(run.convoy.weapons).toHaveLength(1);
  });

  it('a request naming the convoy never reads the bag, and one naming the bag never the convoy', () => {
    const { run, unit } = fixture();
    const carried = unit.inventory[2];
    expect(rosterItemAction(run, unit, carried, 'discard', 'convoy')).toBe(STALE);
    expect(unit.inventory).toContain(carried);
    const stored = withUid(weapon('Iron Axe'), 'axe-a');
    run.convoy.weapons = [stored];
    expect(rosterItemAction(run, unit, stored, 'discard', 'bag')).toBe(STALE);
    expect(run.convoy.weapons).toEqual([stored]);
    expect(rosterItemAction(run, unit, stored, 'discard', 'convoy')).toBe('');
    expect(run.convoy.weapons).toEqual([]);
  });

  it('uid-less identical consumables: a snapshot is refused, the live ones go one at a time', () => {
    const { run, unit } = fixture();
    const plain = () => ({ name: 'Elixir', type: 'Consumable', effect: 'healFull', uses: 1 });
    run.convoy.consumables = [plain(), plain()];
    const snapshot = run.getConvoyItems().consumables[0];
    expect(rosterItemAction(run, unit, snapshot, 'discard')).toBe(STALE);
    expect(run.convoy.consumables).toHaveLength(2);

    const [first, second] = run.convoy.consumables;
    expect(rosterItemAction(run, unit, first, 'discard')).toBe('');
    expect(run.convoy.consumables).toHaveLength(1);
    expect(run.convoy.consumables[0]).toBe(second);
    // The stale retry of the discarded one (and of its snapshot) must not take the remaining one.
    expect(rosterItemAction(run, unit, first, 'discard')).toBe(STALE);
    expect(rosterItemAction(run, unit, snapshot, 'discard')).toBe(STALE);
    expect(run.convoy.consumables[0]).toBe(second);
  });

  it('an equal copy of a carried item is not the carried item', () => {
    const { run, unit } = fixture();
    const copy = structuredClone(unit.inventory[0]);
    expect(rosterItemAction(run, unit, copy, 'discard')).toBe(STALE);
    expect(uidsOf(unit.inventory)).toEqual(['sword-a', 'sword-b', 'lance-a']);
  });

  it('the warning agrees with the action: none for a reference the action refuses', () => {
    const { run, unit } = fixture();
    const sword = unit.inventory[0];
    unit.inventory = [sword];
    expect(rosterItemWarnings(run, unit, sword, 'discard', 'bag')).toEqual([
      { code: 'leaves_unarmed', unit },
    ]);
    expect(rosterItemWarnings(run, unit, structuredClone(sword), 'discard', 'bag')).toEqual([]);
    expect(rosterItemWarnings(run, unit, sword, 'discard', 'convoy')).toEqual([]);
    expect(rosterItemBlock(run, unit, sword, 'discard', 'convoy')).toBe(STALE);
  });
});
