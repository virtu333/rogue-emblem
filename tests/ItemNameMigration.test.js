// Item renames in saved runs (src/engine/ItemNameMigration.js). The ways it can
// fail, each caught below:
//   - a composed name loses its forge level or imbue word, or gains a second one;
//   - some place in the save is not walked (bag, convoy, shop, reward, battle
//     checkpoint, its entry state, a rewind patch, a siege weapon string), so an
//     old name survives and the next name lookup misses;
//   - the equipped weapon loses its link to the bag copy;
//   - an unrelated string is renamed (a skill, a deed, a unit), or a new save is
//     migrated twice;
//   - a renamed legendary no longer passes its weapon art's legendary gate;
//   - a renamed item keeps text the catalog changed with it (Gust Blade's rule).
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import {
  ITEM_RENAMES,
  ITEM_NAMES_REVISION,
  migrateSavedItemNames,
  renameItemName,
  renameItemsDeep,
} from '../src/engine/ItemNameMigration.js';
import { RunManager } from '../src/engine/RunManager.js';
import { canUseWeaponArt } from '../src/engine/WeaponArtSystem.js';

const gameData = loadGameData();
const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));
// A copy of a current item as an old save held it: its old name and its old text.
const legacy = (name, oldName, fields = {}) => ({ ...weapon(name), name: oldName, ...fields });

describe('composed names', () => {
  it.each([
    ['Killing Edge', {}, 'Keen Sword'],
    ['Killing Edge +2', {}, 'Keen Sword +2'],
    ['Doublebow +1', {}, "Hermit's Bow +1"],
    // Imbued with the crit imbue, whose word changed: both parts change.
    ['Keen Killing Edge +1', { imbueId: 'keen' }, 'Cruel Keen Sword +1'],
    ['Keen Iron Sword', { imbueId: 'keen' }, 'Cruel Iron Sword'],
    ['Sundering Bolganone', { imbueId: 'armorbane' }, 'Armorbane Conflagration'],
    // Imbued with an imbue whose word stayed: only the base changes.
    ['Vampiric Soulreaver +3', { imbueId: 'vampiric' }, 'Vampiric Namethief +3'],
    ['Vampiric Iron Axe', { imbueId: 'vampiric' }, 'Vampiric Iron Axe'],
    ['Keen Imbuing Stone', {}, 'Cruel Imbuing Stone'],
  ])('%s', (name, opts, expected) => {
    expect(renameItemName(name, opts)).toBe(expected);
  });

  it('leaves names that only look like items alone', () => {
    const knownBases = new Set(gameData.weapons.map((w) => w.name));
    expect(renameItemName('Renewal Aura', { knownBases })).toBe('Renewal Aura');
    expect(renameItemName('Keen Edge', { knownBases })).toBe('Keen Edge');
    expect(renameItemName('Edric', { knownBases })).toBe('Edric');
    // Already new: a second pass changes nothing.
    for (const next of Object.values(ITEM_RENAMES))
      expect(renameItemName(next, { knownBases }), next).toBe(next);
  });
});

describe('the rename table', () => {
  it('every old weapon name is gone from the catalog and every new one is in it', () => {
    const names = new Set(gameData.weapons.map((w) => w.name));
    const stones = new Set((gameData.imbues?.imbues || []).map((i) => i.stone?.name));
    const arts = new Set(gameData.weaponArts.arts.map((a) => a.name));
    for (const [oldName, newName] of Object.entries(ITEM_RENAMES)) {
      expect(names.has(oldName), oldName).toBe(false);
      expect(names.has(newName) || stones.has(newName) || arts.has(newName), newName).toBe(true);
    }
  });

  it('no new name is another item old name (a rename could never chain)', () => {
    for (const newName of Object.values(ITEM_RENAMES))
      expect(Object.hasOwn(ITEM_RENAMES, newName), newName).toBe(false);
  });
});

function legacyRun() {
  const rm = new RunManager(gameData);
  rm.startRun();
  const unit = rm.roster[0];
  const edge = legacy('Keen Sword', 'Killing Edge');
  const forged = legacy('Twinsworn', 'Gemini +1', { _baseName: 'Gemini', _forgeLevel: 1 });
  unit.inventory = [edge, forged];
  unit.weapon = edge;
  const saved = JSON.parse(JSON.stringify(rm.toJSON()));
  delete saved.itemNamesRevision;
  // Old saves had no item uids: the equipped link is found by signature.
  for (const item of [saved.roster[0].weapon, ...saved.roster[0].inventory]) delete item._uid;
  saved.convoy = {
    weapons: [
      legacy('Gust Blade', 'Wind Sword', {
        special: 'Throwable, lower stats',
        lore: 'Throw it at the second rank, soldier.',
      }),
    ],
    consumables: [],
  };
  saved.shopStateByNodeId = {
    n1: { items: [{ item: legacy('Keen Lance', 'Killer Lance'), price: 1 }] },
  };
  saved.pendingBattleReward = {
    version: 1,
    choices: [{ type: 'weapon', item: legacy('Firstwind', 'Excalibur') }],
  };
  saved.difficultyModifiers = {
    ...saved.difficultyModifiers,
    siegeWeaponConfig: { weaponName: 'Bolting' },
  };
  // A node of the save's route map: fromJSON keeps only those maps.
  saved.battleConfigsByNodeId = {
    [saved.nodeMap.nodes[1].id]: { enemySpawns: [{ className: 'Mage', siegeWeapon: 'Bolting' }] },
  };
  return saved;
}

describe('RunManager.fromJSON on an old save', () => {
  it('renames items everywhere and keeps the equipped link', () => {
    const rm = RunManager.fromJSON(legacyRun(), gameData);
    const unit = rm.roster[0];
    expect(unit.inventory.map((w) => w.name)).toEqual(['Keen Sword', 'Twinsworn +1']);
    expect(unit.inventory[1]._baseName).toBe('Twinsworn');
    expect(unit.inventory[1]._forgeLevel).toBe(1);
    expect(unit.weapon).toBe(unit.inventory[0]);
    expect(rm.convoy.weapons[0].name).toBe('Gust Blade');
    expect(rm.shopStateByNodeId.n1.items[0].item.name).toBe('Keen Lance');
    expect(rm.pendingBattleReward.choices[0].item.name).toBe('Firstwind');
    expect(rm.difficultyModifiers.siegeWeaponConfig.weaponName).toBe('Breachbolt');
    expect(rm.battleConfigsByNodeId[rm.nodeMap.nodes[1].id].enemySpawns[0].siegeWeapon).toBe(
      'Breachbolt',
    );
  });

  it('a renamed item takes the text the catalog changed with it; run state stays', () => {
    const rm = RunManager.fromJSON(legacyRun(), gameData);
    const gust = rm.convoy.weapons[0];
    expect(gust.special).toBe('Wind gust at range, lower stats');
    expect(gust.lore).toBe(weapon('Gust Blade').lore);
  });

  it('a renamed legendary still passes its weapon art gate', () => {
    const rm = RunManager.fromJSON(legacyRun(), gameData);
    const unit = rm.roster[0];
    const twin = unit.inventory[1];
    const art = gameData.weaponArts.arts.find((a) => a.legendaryWeaponIds?.includes('Twinsworn'));
    expect(art).toBeTruthy();
    const result = canUseWeaponArt(unit, twin, art, { weaponArts: gameData.weaponArts });
    expect(result.reason).not.toBe('legendary_weapon_required');
  });

  it('writes the revision, and a new save is left as it is', () => {
    const rm = RunManager.fromJSON(legacyRun(), gameData);
    const again = JSON.parse(JSON.stringify(rm.toJSON()));
    expect(again.itemNamesRevision).toBe(ITEM_NAMES_REVISION);
    // A current save holding a name that looks old (a unit called "Aura") is untouched.
    again.roster[0].inventory[0].name = 'Killing Edge';
    RunManager.fromJSON(again, gameData);
    expect(again.roster[0].inventory[0].name).toBe('Killing Edge');
  });
});

describe('battle checkpoint and rewind timeline', () => {
  it('renames units, entry state, siege params and patch leaves; skills and deeds stay', () => {
    const save = {
      battleInProgress: {
        nodeId: 'n3',
        battleParams: { siegeWeaponConfig: { weaponName: 'Bolting' } },
        entryBattleState: { convoy: { weapons: [legacy('Adder Blade', 'Venin Blade')] } },
        checkpoint: {
          _battleSession: 1,
          version: 2,
          playerUnits: [
            {
              name: 'Edric',
              weapon: legacy('Oathblade', 'Brave Sword'),
              inventory: [legacy('Oathblade', 'Brave Sword')],
              skills: ['sol'],
              deeds: { earned: [{ id: 'keen_edge', name: 'Keen Edge' }] },
              activated: [{ id: 'renewal_aura', name: 'Renewal Aura' }],
            },
          ],
          enemyUnits: [{ name: 'Soldier', weapon: legacy('Horsebane', 'Horseslayer') }],
        },
        timeline: {
          snapshots: [
            // A keyframe holds whole items; a patch may hold only a changed name.
            { state: { playerUnits: [{ weapon: legacy('Glimmer', 'Lightning') }] } },
            { base: 0, patch: { o: { weapon: { o: { name: { $: 'Keen Iron Sword +1' } } } } } },
            { base: 0, patch: { o: { history: { $: [{ weapon: 'Swordreaver' }] } } } },
          ],
        },
      },
    };
    migrateSavedItemNames(save, gameData);
    const bip = save.battleInProgress;
    expect(bip.battleParams.siegeWeaponConfig.weaponName).toBe('Breachbolt');
    expect(bip.entryBattleState.convoy.weapons[0].name).toBe('Adder Blade');
    const edric = bip.checkpoint.playerUnits[0];
    expect(edric.name).toBe('Edric');
    expect(edric.weapon.name).toBe('Oathblade');
    expect(edric.inventory[0].name).toBe('Oathblade');
    expect(edric.deeds.earned[0].name).toBe('Keen Edge');
    expect(edric.activated[0].name).toBe('Renewal Aura');
    expect(bip.checkpoint.enemyUnits[0].weapon.name).toBe('Horsebane');
    expect(bip.timeline.snapshots[0].state.playerUnits[0].weapon.name).toBe('Glimmer');
    expect(bip.timeline.snapshots[1].patch.o.weapon.o.name.$).toBe('Cruel Iron Sword +1');
    expect(bip.timeline.snapshots[2].patch.o.history.$[0].weapon).toBe('Axehook');
    expect(save.itemNamesRevision).toBe(ITEM_NAMES_REVISION);
  });

  it('counts what it changed, and a second walk changes nothing', () => {
    const tree = { a: [legacy('Keen Axe', 'Killer Axe'), { weaponName: 'Luce' }] };
    expect(renameItemsDeep(tree, gameData)).toBe(2);
    expect(renameItemsDeep(tree, gameData)).toBe(0);
  });
});
