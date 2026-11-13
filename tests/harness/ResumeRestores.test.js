// What a resumed battle puts back (the Nov 2026 mutation baseline's first gap): the equipped
// weapon of every unit group, the run's gold, convoy, accessories and rerolls spent, and the
// fog. Each test saves a real checkpoint through the scene's own capture, reloads it from
// storage, and reads the restored state; the expected values are the ones the test set.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import './JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './RunDriver.js';
import { journeyBattleScene } from './JourneyBattleScene.js';
import { BattleSuspendController } from '../../src/ui/BattleSuspendController.js';
import { loadRun } from '../../src/engine/RunManager.js';
import { createUnit } from '../../src/engine/UnitManager.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';

let storage;
beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  installSeed(42);
});
afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const GROUPS = ['playerUnits', 'enemyUnits', 'npcUnits', 'escapedUnits', 'nonDeployedUnits'];

function weaponNamed(data, name, uid) {
  const weapon = structuredClone(data.weapons.find((w) => w.name === name));
  expect(weapon, name).toBeTruthy();
  if (uid) weapon.uid = uid;
  return weapon;
}

/** A Fighter holding an Iron Axe and a Steel Axe, the SECOND one in hand. */
function fighter(data, name, faction, col, row) {
  const unit = createUnit(
    data.classes.find((c) => c.name === 'Fighter'),
    14,
    data.weapons,
    { name },
  );
  unit.inventory = [
    weaponNamed(data, 'Iron Axe', `itm_${name}_iron`),
    weaponNamed(data, 'Steel Axe', `itm_${name}_steel`),
  ];
  unit.weapon = unit.inventory[1];
  Object.assign(unit, { col, row, faction });
  return unit;
}

function battle() {
  const d = new RunDriver(storage);
  d.run.beginBattleInProgress(d.run.nodeMap.nodes[0].id, { battleParams: {} });
  const s = journeyBattleScene(d.run, d.data);
  s.playerUnits = [fighter(d.data, 'Ally', 'player', 1, 1)];
  s.enemyUnits = [fighter(d.data, 'Foe', 'enemy', 3, 3)];
  s.npcUnits = [fighter(d.data, 'Friend', 'npc', 0, 3)];
  s.escapedUnits = [fighter(d.data, 'Gone', 'player', 0, 0)];
  s.nonDeployedUnits = [fighter(d.data, 'Benched', 'player', 0, 0)];
  for (const unit of [...s.playerUnits, ...s.enemyUnits, ...s.npcUnits]) s.addUnitGraphic(unit);
  return { d, s };
}

const capture = (s) =>
  expect(s._captureSuspendCheckpoint({ session: s._battleSession })).toBe(true);

/** Storage → a fresh run and scene, as a page reload makes them. `edit` plays an older save. */
function reload(d, { edit, before } = {}) {
  const run = loadRun(d.data, 1);
  const checkpoint = run.battleInProgress.checkpoint;
  edit?.(checkpoint);
  const scene = journeyBattleScene(run, d.data);
  scene.updateEnemyVisibility = vi.fn();
  before?.(scene, run);
  const controller = new BattleSuspendController(scene);
  controller.applyUnits(checkpoint);
  controller.finalizeResume(checkpoint);
  return { scene, run, checkpoint };
}

describe('a resumed battle hands every unit its equipped weapon', () => {
  it('the weapon in hand is the bag slot it was, as the same object, in every unit group', () => {
    const { d, s } = battle();
    capture(s);
    const { scene } = reload(d);
    for (const group of GROUPS) {
      expect(scene[group], group).toHaveLength(1);
      const unit = scene[group][0];
      expect(
        unit.inventory.map((w) => w.name),
        group,
      ).toEqual(['Iron Axe', 'Steel Axe']);
      expect(unit.weapon?.name, group).toBe('Steel Axe');
      // Identity, not equality: uses spent in combat must land on the bag's copy.
      expect(unit.weapon, group).toBe(unit.inventory[1]);
      expect('equippedInventoryIndex' in unit, group).toBe(false);
    }
  });

  it('two copies of one weapon: the copy in hand stays the one in hand', () => {
    // Nothing but the saved slot tells these apart (same name, same uid after an old
    // duplication, no uid on an old save), so a lookup by uid or by signature finds the first.
    for (const uid of ['itm_twin', null]) {
      storage = new JourneyStorage();
      vi.stubGlobal('localStorage', storage);
      const { d, s } = battle();
      for (const group of GROUPS) {
        const unit = s[group][0];
        unit.inventory = [
          weaponNamed(d.data, 'Iron Axe', uid),
          weaponNamed(d.data, 'Iron Axe', uid),
        ];
        unit.weapon = unit.inventory[1];
      }
      capture(s);
      const { scene } = reload(d);
      for (const group of GROUPS) {
        const unit = scene[group][0];
        expect(unit.weapon, `${group} uid ${uid}`).toBe(unit.inventory[1]);
        expect(unit.weapon, `${group} uid ${uid}`).not.toBe(unit.inventory[0]);
      }
    }
  });

  it('a checkpoint from before the saved slot still relinks the weapon by its uid', () => {
    const { d, s } = battle();
    capture(s);
    const { scene } = reload(d, {
      edit: (checkpoint) => {
        for (const group of GROUPS)
          for (const unit of checkpoint[group]) delete unit.equippedInventoryIndex;
      },
    });
    for (const group of GROUPS) {
      const unit = scene[group][0];
      expect(unit.weapon?.name, group).toBe('Steel Axe');
      expect(unit.weapon, group).toBe(unit.inventory[1]);
    }
  });

  it('a unit whose bag was emptied resumes unarmed, not holding a weapon it no longer has', () => {
    const { d, s } = battle();
    capture(s);
    const { scene } = reload(d, {
      edit: (checkpoint) => {
        for (const group of GROUPS) for (const unit of checkpoint[group]) unit.inventory = [];
      },
    });
    for (const group of GROUPS) expect(scene[group][0].weapon, group).toBeNull();
  });
});

describe("a resumed battle puts the run's battle state back from the checkpoint", () => {
  function savedWithRunState() {
    const { d, s } = battle();
    d.run.gold = 1234;
    d.run.convoy = {
      weapons: [weaponNamed(d.data, 'Steel Axe', 'itm_convoy_axe')],
      consumables: [{ ...structuredClone(d.data.consumables[0]), uid: 'itm_convoy_item' }],
    };
    d.run.accessories = [{ ...structuredClone(d.data.accessories[0]), uid: 'itm_ring' }];
    d.run.rewardRerollsSpent = 2;
    capture(s);
    return { d, s };
  }
  // The run as a later, unsaved moment left it: the checkpoint is the authority on resume.
  const drift = (scene, run) => {
    run.gold = 5;
    run.convoy = { weapons: [], consumables: [] };
    run.accessories = [];
    run.rewardRerollsSpent = 0;
  };

  it('gold, convoy, accessories and rerolls spent are the checkpoint’s', () => {
    const { d } = savedWithRunState();
    const { run, checkpoint } = reload(d, { before: drift });
    expect(run.gold).toBe(1234);
    expect(run.convoy.weapons.map((w) => [w.name, w.uid])).toEqual([
      ['Steel Axe', 'itm_convoy_axe'],
    ]);
    expect(run.convoy.consumables.map((c) => c.uid)).toEqual(['itm_convoy_item']);
    expect(run.accessories.map((a) => a.uid)).toEqual(['itm_ring']);
    expect(run.rewardRerollsSpent).toBe(2);
    // Copies: play after the resume must never edit the saved checkpoint in place.
    expect(run.convoy).not.toBe(checkpoint.runBattleState.convoy);
    expect(run.convoy.weapons[0]).not.toBe(checkpoint.runBattleState.convoy.weapons[0]);
    expect(run.accessories).not.toBe(checkpoint.runBattleState.accessories);
    expect(run.accessories[0]).not.toBe(checkpoint.runBattleState.accessories[0]);
  });

  it('with no drift a reload alone gives the same run state (the save and checkpoint agree)', () => {
    const { d } = savedWithRunState();
    const { run } = reload(d);
    expect([run.gold, run.rewardRerollsSpent]).toEqual([1234, 2]);
    expect(run.convoy.weapons).toHaveLength(1);
    expect(run.accessories).toHaveLength(1);
  });

  it('a malformed value in the checkpoint never replaces the run’s', () => {
    const { d } = savedWithRunState();
    const { run } = reload(d, {
      edit: (checkpoint) => {
        checkpoint.runBattleState = {
          gold: -50,
          convoy: { weapons: 'none' },
          accessories: null,
          rewardRerollsSpent: 1.5,
        };
      },
    });
    expect(run.gold).toBe(1234);
    expect(run.convoy.weapons).toHaveLength(1);
    expect(run.accessories).toHaveLength(1);
    expect(run.rewardRerollsSpent).toBe(2);
  });

  it('the battle’s own gold tally and allies lost come back too', () => {
    const { d, s } = battle();
    s.goldEarned = 340;
    s._playerDeathsThisBattle = 2;
    capture(s);
    const { scene } = reload(d);
    expect(scene.goldEarned).toBe(340);
    expect(scene._playerDeathsThisBattle).toBe(2);
  });
});

describe('a resumed battle puts the fog back', () => {
  it('what is seen, what was seen and contacts are the checkpoint’s, and foes are re-hidden', () => {
    const { d, s } = battle();
    s.grid.visibleSet = new Set(['0,0', '1,0']);
    s.grid.everSeenSet = new Set(['0,0', '1,0', '2,2']);
    s.grid.contactSet = new Set(['3,3']);
    capture(s);
    // The fresh scene's grid starts on other sets (the fixture's), so a restore must move them.
    const { scene } = reload(d);
    expect([...scene.grid.visibleSet].sort()).toEqual(['0,0', '1,0']);
    expect([...scene.grid.everSeenSet].sort()).toEqual(['0,0', '1,0', '2,2']);
    expect([...scene.grid.contactSet]).toEqual(['3,3']);
    expect(scene.grid.isVisible(1, 1)).toBe(false);
    expect(scene.updateEnemyVisibility).toHaveBeenCalledTimes(1);
  });

  it('a map without fog keeps its sets and re-hides nobody', () => {
    const { d, s } = battle();
    capture(s);
    const { scene } = reload(d, {
      before: (fresh) => {
        fresh.grid.fogEnabled = false;
        fresh.grid.visibleSet = new Set(['2,2']);
      },
    });
    expect([...scene.grid.visibleSet]).toEqual(['2,2']);
    expect(scene.updateEnemyVisibility).not.toHaveBeenCalled();
  });
});
