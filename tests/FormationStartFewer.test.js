import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
import { FormationController } from '../src/ui/FormationController.js';
import { createFormation, placeUnit } from '../src/engine/FormationPlacement.js';

// A roster at or under the deploy cap skips the deploy screen, so the formation is the only place
// to leave a unit out. Start used to need every unit placed: a player who sent one back to wait
// could never start (a playtester's report). The ways it can still go wrong:
//   - Start stays blocked with a unit waiting while the minimum is met (the report);
//   - Start opens below the deploy screen's minimum, or without the commander;
//   - a waiting unit takes the field anyway, or is lost: it must sit the battle out in
//     nonDeployedUnits so victory hands it back with the survivors.

const tiles = Array.from({ length: 5 }, (_, i) => ({ col: i, row: 0 }));

function setup({ names = ['Edric', 'Sera', 'Gaspar', 'Rowan'], min = 3 } = {}) {
  const units = names.map((name) => ({ name, isCommander: name === 'Edric', col: 0, row: 0 }));
  const removed = [];
  const scene = {
    _deployLimits: { min, max: 9 },
    battleParams: { deployCount: units.length },
    playerUnits: [...units],
    nonDeployedUnits: [],
    removeUnitGraphic: (u) => removed.push(u.name),
    updateUnitPosition: () => {},
  };
  const c = Object.create(FormationController.prototype);
  Object.assign(c, {
    scene,
    units,
    tiles,
    ready: true,
    active: true,
    leniency: units.map(() => 'strict'),
  });
  c.formation = createFormation(units.length, tiles);
  c.issue = () => '';
  Object.assign(c, {
    clearMarkers() {},
    setUnitShown() {},
    touch() {},
    syncField() {},
  });
  const place = (u, t) => (c.formation = placeUnit(c.formation, u, t));
  return { c, scene, units, removed, place };
}

describe('Starting a battle with fewer than everyone placed', () => {
  it('starts once the minimum is placed, leaving the waiting unit out of the field', () => {
    const { c, scene, units, removed, place } = setup();
    place(0, 0);
    place(1, 1);
    place(3, 2); // Gaspar (2) waits
    expect(c.canStart()).toBe(true);
    expect(c.start()).toBe(true);
    expect(scene.playerUnits.map((u) => u.name)).toEqual(['Edric', 'Sera', 'Rowan']);
    expect(scene.nonDeployedUnits).toEqual([units[2]]);
    expect(removed).toEqual(['Gaspar']);
    expect(scene.battleParams.deployCount).toBe(3);
    expect(units[3]).toMatchObject({ col: 2, row: 0 });
  });

  it('the saved battle and the next deploy remember the smaller army', () => {
    const { c, scene, place } = setup();
    // The battle entry saved its params before the formation opened; a resume rebuilds from them.
    scene.runManager = {
      battleInProgress: { battleParams: { deployCount: 4 } },
      lastDeployment: ['Edric', 'Sera', 'Gaspar', 'Rowan'],
    };
    place(0, 0);
    place(1, 1);
    place(3, 2); // Gaspar waits
    expect(c.start()).toBe(true);
    expect(scene.runManager.battleInProgress.battleParams.deployCount).toBe(3);
    expect(scene.runManager.lastDeployment).toEqual(['Edric', 'Sera', 'Rowan']);
  });

  it('stays blocked below the deploy minimum', () => {
    const { c, scene, place } = setup();
    place(0, 0);
    place(1, 1);
    expect(c.startBlock()).toEqual({ kind: 'count', need: 3 });
    expect(c.start()).toBe(false);
    expect(scene.playerUnits).toHaveLength(4);
  });

  it('stays blocked while the commander waits, however many are placed', () => {
    const { c, place } = setup();
    place(1, 0);
    place(2, 1);
    place(3, 2);
    expect(c.startBlock()).toEqual({ kind: 'commander', name: 'Edric' });
    expect(c.canStart()).toBe(false);
  });

  it('with everyone placed leaves the deploy count and bench alone', () => {
    const { c, scene, place } = setup();
    for (let u = 0; u < 4; u++) place(u, u);
    expect(c.start()).toBe(true);
    expect(scene.playerUnits).toHaveLength(4);
    expect(scene.nonDeployedUnits).toEqual([]);
    expect(scene.battleParams.deployCount).toBe(4);
  });

  it('never asks for more than the army has', () => {
    const { c, place } = setup({ names: ['Edric', 'Sera'], min: 3 });
    place(0, 0);
    expect(c.canStart()).toBe(false);
    place(1, 1);
    expect(c.canStart()).toBe(true);
  });
});
