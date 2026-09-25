vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { resetUnitForBattle } from '../src/scenes/BattleScene.js';
import { describe, it, expect, vi } from 'vitest';
import {
  beginWeaponPreview,
  restoreWeaponPreview,
  commitWeaponPreview,
  previewEquipWeapon,
  resetWeaponPreview,
  baselineWeapon,
  equipForAttackPlanning,
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
  it('out-of-battle second-slot Equip moves it to the top and survives serialization + battle reset', () => {
    const { run, unit, other } = fixture();
    const order = unit.inventory.map((w) => w.uid);
    expect(rosterItemAction(run, unit, other, 'equip')).toBe('');
    expect(unit.inventory[0]).toBe(other);
    const expected = [other.uid, ...order.filter((uid) => uid !== other.uid)];
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), loadGameData());
    const deployed = restored.getRoster()[0];
    resetUnitForBattle(deployed);
    expect(deployed.weapon.uid).toBe(other.uid);
    expect(deployed.inventory[0]).toBe(deployed.weapon);
    expect(deployed.inventory.map((w) => w.uid)).toEqual(expected);
  });
  it('previewing never reorders; cancel restores weapon and exact order', () => {
    const { unit, original, other, scene } = fixture();
    const third = { ...original, uid: 'third', name: 'Third sword' };
    unit.inventory.push(third);
    const order = [...unit.inventory];
    beginWeaponPreview(scene, unit);
    previewEquipWeapon(scene, unit, third);
    expect(unit.weapon).toBe(third);
    expect(unit.inventory).toEqual(order);
    expect(baselineWeapon(scene, unit)).toBe(original);
    resetWeaponPreview(scene);
    expect(unit.weapon).toBe(original);
    expect(scene._weaponPreviewSession).toBeTruthy();
    previewEquipWeapon(scene, unit, other);
    restoreWeaponPreview(scene);
    expect(unit.weapon).toBe(original);
    expect(unit.inventory).toEqual(order);
    expect(scene._weaponPreviewSession).toBeNull();
  });
  it('commit equips the previewed weapon and moves it to the top', () => {
    const { unit, original, scene } = fixture();
    const third = { ...original, uid: 'third', name: 'Third sword' };
    unit.inventory.push(third);
    const before = unit.inventory.map((w) => w.uid);
    beginWeaponPreview(scene, unit);
    previewEquipWeapon(scene, unit, third);
    commitWeaponPreview(scene);
    expect(unit.weapon).toBe(third);
    expect(unit.inventory[0]).toBe(third);
    // Everything else keeps its relative order.
    expect(unit.inventory.map((w) => w.uid)).toEqual([
      'third',
      ...before.filter((uid) => uid !== 'third'),
    ]);
    expect(unit.inventory[1]).toBe(original);
  });
  it('equipForAttackPlanning is provisional only inside a preview of that unit', () => {
    const { unit, other, scene } = fixture();
    equipForAttackPlanning(scene, unit, other);
    expect(unit.inventory[0]).toBe(other);
    const { unit: u2, original: o2, other: x2, scene: s2 } = fixture();
    beginWeaponPreview(s2, u2);
    equipForAttackPlanning(s2, u2, x2);
    expect(u2.inventory[0]).toBe(o2);
    expect(u2.weapon).toBe(x2);
  });
});
