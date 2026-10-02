// Breachbolts in saved runs take the catalog's shot counts (WeaponCatalogMigration.js).
// A copy looted before the counts changed holds `uses: 1` and no `usesByFaction`, and
// saves store whole items. The ways the migration can fail, each caught below:
//   - a place in the save is not walked, so an old copy keeps firing once per battle;
//   - forged ("+1") or imbued copies are missed because their names are composed;
//   - instance state (uid, forge, imbue, shots already spent) is lost;
//   - another weapon, or a staff (its own uses rule), is changed; a second load changes
//     anything.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { getPerBattleMaxUses } from '../src/engine/Combat.js';
import { migrateSavedPerBattleWeapons } from '../src/engine/WeaponCatalogMigration.js';

const gameData = loadGameData();
const catalogBolt = gameData.weapons.find((w) => w.name === 'Breachbolt');
const catalog = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));

/** A Breachbolt as a save from before the shot counts held it. */
function legacyBolt(extra = {}) {
  const bolt = { ...catalog('Breachbolt'), uses: 1, uid: 'itm_old', ...extra };
  delete bolt.usesByFaction;
  return bolt;
}

const player = { faction: 'player' };
const enemy = { faction: 'enemy' };

function legacySave() {
  const rm = new RunManager(gameData);
  rm.startRun();
  const saved = JSON.parse(JSON.stringify(rm.toJSON()));
  saved.roster[0].inventory = [legacyBolt({ uid: 'itm_equipped', _usesSpent: 1 })];
  saved.roster[0].weapon = saved.roster[0].inventory[0];
  saved.convoy = {
    weapons: [legacyBolt({ uid: 'itm_convoy', name: 'Breachbolt +1', _baseName: 'Breachbolt' })],
    consumables: [],
  };
  saved.fallenUnits = [
    {
      ...structuredClone(saved.roster[1]),
      inventory: [
        legacyBolt({ uid: 'itm_fallen', name: 'Vampiric Breachbolt', _imbueId: 'vampiric' }),
      ],
    },
  ];
  saved.pendingBattleReward = {
    version: 1,
    choices: [{ type: 'weapon', item: legacyBolt({ uid: 'itm_reward' }) }],
  };
  saved.battleInProgress = {
    checkpoint: { enemyUnits: [{ name: 'Sage', faction: 'enemy', weapon: legacyBolt() }] },
    timeline: { snapshots: { s0: { playerUnits: [{ inventory: [legacyBolt()] }] } } },
  };
  return saved;
}

describe('RunManager.fromJSON on a save with an old Breachbolt', () => {
  it('an old copy fires the catalog count: the player 3, an enemy 5', () => {
    expect(getPerBattleMaxUses(legacyBolt(), player)).toBe(1); // the bug, before loading
    const rm = RunManager.fromJSON(legacySave(), gameData);
    const bolt = rm.roster[0].inventory[0];
    expect(getPerBattleMaxUses(bolt, player)).toBe(catalogBolt.uses);
    expect(getPerBattleMaxUses(bolt, enemy)).toBe(catalogBolt.usesByFaction.enemy);
  });

  it('reaches forged, imbued and every other saved copy, keeping instance state', () => {
    const saved = legacySave();
    RunManager.fromJSON(saved, gameData);
    const copies = [
      saved.roster[0].inventory[0],
      saved.convoy.weapons[0],
      saved.fallenUnits[0].inventory[0],
      saved.pendingBattleReward.choices[0].item,
      saved.battleInProgress.checkpoint.enemyUnits[0].weapon,
      saved.battleInProgress.timeline.snapshots.s0.playerUnits[0].inventory[0],
    ];
    for (const copy of copies) {
      expect(copy.uses).toBe(catalogBolt.uses);
      expect(copy.usesByFaction).toEqual(catalogBolt.usesByFaction);
    }
    expect(copies.map((c) => c.uid).slice(0, 4)).toEqual([
      'itm_equipped',
      'itm_convoy',
      'itm_fallen',
      'itm_reward',
    ]);
    expect(saved.roster[0].inventory[0]._usesSpent).toBe(1);
    expect(saved.convoy.weapons[0].name).toBe('Breachbolt +1');
    expect(saved.fallenUnits[0].inventory[0]._imbueId).toBe('vampiric');
  });

  it('touches no other weapon and no staff; a second load is a no-op', () => {
    const fire = catalog('Fire');
    const heal = { ...catalog('Heal'), uses: 1 }; // a staff: its own MAG-scaled rule
    const tree = { a: [legacyBolt(), fire], b: { staff: heal } };
    expect(migrateSavedPerBattleWeapons(tree, gameData)).toBe(1);
    expect(tree.a[1]).toEqual(catalog('Fire'));
    expect(tree.b.staff.uses).toBe(1);
    expect(migrateSavedPerBattleWeapons(tree, gameData)).toBe(0);

    const once = RunManager.fromJSON(legacySave(), gameData);
    const first = JSON.parse(JSON.stringify(once.toJSON()));
    expect(migrateSavedPerBattleWeapons(first, gameData)).toBe(0);
  });
});
