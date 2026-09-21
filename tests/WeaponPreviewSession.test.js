vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { resetUnitForBattle } from '../src/scenes/BattleScene.js';
import { describe, it, expect, vi } from 'vitest';
import {
  beginWeaponPreview,
  restoreWeaponPreview,
  commitWeaponPreview,
} from '../src/ui/WeaponPreviewSession.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';
import { rosterItemAction } from '../src/engine/RosterInventory.js';
import { addToInventory } from '../src/engine/UnitManager.js';
function fixture() {
  const run = new RunManager(loadGameData());
  run.startRun();
  const unit = run.roster[0];
  addToInventory(unit, { ...unit.weapon, uid: 'second', name: 'Second sword' });
  return {
    run,
    unit,
    original: unit.weapon,
    other: unit.inventory.at(-1),
    scene: { _clearSelectedWeaponArt: vi.fn() },
  };
}
describe('weapon preview contract', () => {
  it('preserves original across repeated preview/cycle and restores on exit', () => {
    const { unit, original, other, scene } = fixture();
    beginWeaponPreview(scene, unit);
    unit.weapon = other;
    beginWeaponPreview(scene, unit);
    restoreWeaponPreview(scene);
    expect(unit.weapon).toBe(original);
    expect(scene._clearSelectedWeaponArt).toHaveBeenCalledOnce();
  });
  it('commit retains the chosen weapon and removed originals are not resurrected', () => {
    const { unit, other, scene } = fixture();
    beginWeaponPreview(scene, unit);
    unit.weapon = other;
    commitWeaponPreview(scene);
    restoreWeaponPreview(scene);
    expect(unit.weapon).toBe(other);
    beginWeaponPreview(scene, unit);
    unit.inventory = [];
    unit.weapon = null;
    restoreWeaponPreview(scene);
    expect(unit.weapon).toBeNull();
  });
  it('out-of-battle second-slot Equip survives serialization and battle reset without reorder', () => {
    const { run, unit, other } = fixture();
    const order = unit.inventory.map((w) => w.uid);
    expect(rosterItemAction(run, unit, other, 'equip')).toBe('');
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), loadGameData());
    const deployed = restored.getRoster()[0];
    resetUnitForBattle(deployed);
    expect(deployed.weapon.uid).toBe(other.uid);
    expect(deployed.inventory.map((w) => w.uid)).toEqual(order);
  });
});
