import { describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { HealController } from '../src/ui/HealController.js';
import { loadGameData } from './testData.js';
const data = loadGameData();
function setup() {
  const tome = structuredClone(data.weapons.find((w) => w.name === 'Lightning'));
  const staff = structuredClone(data.weapons.find((w) => w.name === 'Heal'));
  const unit = {
    name: 'Sera',
    weapon: tome,
    inventory: [tome, staff],
    proficiencies: [
      { type: 'Light', rank: 'Prof' },
      { type: 'Staff', rank: 'Prof' },
    ],
    stats: { HP: 18, MAG: 8 },
    currentHP: 18,
  };
  unit.proficiencies[0].type = tome.type;
  const scene = {
    grid: { clearAttackHighlights() {}, showHealRange() {} },
    registry: { get: () => null },
    updateHPBar() {},
    animateHeal: async () => {},
    awardScaledXP: vi.fn(async () => {}),
    finishUnitAction: vi.fn(),
    _recoverUnitActionError: vi.fn(),
  };
  const ctrl = new HealController(scene);
  return { ctrl, scene, unit, tome, staff };
}
describe('staff action defense weapon', () => {
  it('restores the equipped tome after healing without an extra action or staff-use reset', async () => {
    const { ctrl, scene, unit, tome, staff } = setup();
    const ally = { stats: { HP: 30 }, currentHP: 4 };
    ctrl.startHealTargetSelection(unit, [ally], staff);
    expect(unit.weapon).toBe(staff);
    await ctrl.executeHeal(unit, ally);
    expect(unit.weapon).toBe(tome);
    expect(staff._usesSpent).toBe(1);
    expect(ally.currentHP).toBeGreaterThan(4);
    expect(scene.finishUnitAction).toHaveBeenCalledTimes(1);
    expect(scene._recoverUnitActionError).not.toHaveBeenCalled();
  });
  it('restores preferred weapon instead of first inventory weapon, revalidating ownership', () => {
    const { ctrl, unit, tome, staff } = setup();
    const other = { ...tome, name: 'Other tome' };
    unit.inventory.unshift(other);
    ctrl.rememberCombatWeapon(unit);
    unit.weapon = staff;
    ctrl.restoreCombatWeapon(unit);
    expect(unit.weapon).toBe(tome);
    ctrl.rememberCombatWeapon(unit);
    unit.weapon = staff;
    unit.inventory = [staff, other];
    ctrl.restoreCombatWeapon(unit);
    expect(unit.weapon).toBe(other);
  });
  it('leaves staff-only units unable to counterattack', () => {
    const { ctrl, unit, staff } = setup();
    unit.weapon = staff;
    unit.inventory = [staff];
    ctrl.restoreCombatWeapon(unit);
    expect(unit.weapon).toBe(staff);
  });
});
