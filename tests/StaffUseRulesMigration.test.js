// Warp Staves in saved runs take the catalog's use rules (WeaponCatalogMigration.js).
// Saves store whole items, so a Warp Staff saved before the nerf has no `useBonuses`
// or `maxUses` and would keep the shared +1 at MAG 8/14/20 with no cap. Ways the
// migration can fail, each caught below:
//   - a place in the save is not walked, so an old copy keeps 4 warps at MAG 20;
//   - instance state (uid, uses already spent) is lost;
//   - another staff is changed; a second load changes anything.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { getStaffMaxUses } from '../src/engine/Combat.js';
import { migrateSavedStaffUseRules } from '../src/engine/WeaponCatalogMigration.js';

const gameData = loadGameData();
const catalog = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));
const healer = (mag) => ({ stats: { MAG: mag } });

/** A Warp Staff as a save from before the nerf held it. */
function legacyWarp(extra = {}) {
  const warp = { ...catalog('Warp Staff'), uid: 'itm_old', ...extra };
  delete warp.useBonuses;
  delete warp.maxUses;
  return warp;
}

function legacySave() {
  const rm = new RunManager(gameData);
  rm.startRun();
  const saved = JSON.parse(JSON.stringify(rm.toJSON()));
  saved.roster[0].inventory.push(legacyWarp({ uid: 'itm_bag', _usesSpent: 1 }));
  saved.convoy = { weapons: [legacyWarp({ uid: 'itm_convoy' })], consumables: [] };
  saved.pendingBattleReward = {
    version: 1,
    choices: [{ type: 'weapon', item: legacyWarp({ uid: 'itm_reward' }) }],
  };
  saved.battleInProgress = {
    checkpoint: { playerUnits: [{ name: 'Sera', inventory: [legacyWarp()] }] },
    timeline: { snapshots: { s0: { playerUnits: [{ inventory: [legacyWarp()] }] } } },
  };
  return saved;
}

describe('RunManager.fromJSON on a save with a pre-nerf Warp Staff', () => {
  it('an old copy follows the new rule: 1 warp at MAG 14, 3 at most', () => {
    expect(getStaffMaxUses(legacyWarp(), healer(20))).toBe(4); // the bug, before loading
    const rm = RunManager.fromJSON(legacySave(), gameData);
    const warp = rm.roster[0].inventory.find((i) => i.uid === 'itm_bag');
    expect(getStaffMaxUses(warp, healer(14))).toBe(1);
    expect(getStaffMaxUses(warp, healer(20))).toBe(2);
    expect(getStaffMaxUses(warp, healer(30), { bonusUses: 3 })).toBe(3);
    expect(warp._usesSpent).toBe(1);
  });

  it('reaches every saved copy and leaves other staves alone', () => {
    const saved = legacySave();
    const heal = { ...catalog('Heal'), uid: 'itm_heal', uses: 3 };
    saved.convoy.weapons.push(heal);
    RunManager.fromJSON(saved, gameData);
    const copies = [
      saved.convoy.weapons[0],
      saved.pendingBattleReward.choices[0].item,
      saved.battleInProgress.checkpoint.playerUnits[0].inventory[0],
      saved.battleInProgress.timeline.snapshots.s0.playerUnits[0].inventory[0],
    ];
    for (const copy of copies) {
      expect(copy.useBonuses).toEqual([
        { mag: 16, bonus: 1 },
        { mag: 22, bonus: 1 },
      ]);
      expect(copy.maxUses).toBe(3);
    }
    expect(saved.convoy.weapons[0].uid).toBe('itm_convoy');
    expect(heal).toEqual({ ...catalog('Heal'), uid: 'itm_heal', uses: 3 });
  });

  it('is idempotent', () => {
    const saved = legacySave();
    expect(migrateSavedStaffUseRules(saved, gameData)).toBeGreaterThan(0);
    expect(migrateSavedStaffUseRules(saved, gameData)).toBe(0);
  });
});
