import { canEquip } from './UnitManager.js';
import { resolveHeal, spendStaffUse, getStaffRemainingUses } from './Combat.js';
import { setUnitHP } from './UnitHealth.js';
import { clearAllConditions } from './StatusConditionSystem.js';
import { applyLegendaryStaffHeal } from './TraitSystem.js';

export function validateStaffAction({ staff, healer, targets, usable, destinations, dest }) {
  if (
    !staff ||
    staff.type !== 'Staff' ||
    !(healer?.currentHP > 0) ||
    healer.hasActed ||
    !Array.isArray(usable) ||
    !Array.isArray(healer.proficiencies) ||
    !canEquip(healer, staff) ||
    !Array.isArray(healer.inventory) ||
    !healer.inventory.includes(staff) ||
    getStaffRemainingUses(staff, healer) <= 0 ||
    !targets?.length ||
    !targets.every(
      (target) => target?.currentHP > 0 && !target._removing && usable.includes(target),
    )
  )
    return null;
  if (dest && !destinations?.some((tile) => tile.col === dest.col && tile.row === dest.row))
    return null;
  return true;
}

export function settleStaffHeal({
  staff,
  healer,
  targets,
  healOpts,
  traits,
  turn,
  phase,
  onTarget,
}) {
  const results = targets.map((unit) => {
    const hpBefore = unit.currentHP;
    const { healAmount, targetHPAfter } = resolveHeal(staff, healer, unit, healOpts);
    setUnitHP(unit, targetHPAfter);
    onTarget?.({ unit, hpBefore, healAmount });
    const selfHeal = applyLegendaryStaffHeal(healer, unit, healAmount, traits, turn, phase);
    return { unit, hpBefore, hpAfter: unit.currentHP, healAmount, selfHeal };
  });
  spendStaffUse(staff);
  return { kind: 'heal', staff, targets: results, usesSpent: 1 };
}

export function settleStaffCure({ staff, target }) {
  const cleared = [...(target._conditions || [])];
  clearAllConditions(target);
  spendStaffUse(staff);
  return { kind: 'cure', target, cleared, usesSpent: 1 };
}

export function settleStaffRelocation({ staff, ally, dest }) {
  const from = { col: ally.col, row: ally.row };
  ally.col = dest.col;
  ally.row = dest.row;
  spendStaffUse(staff);
  return { kind: 'relocate', moves: [{ unit: ally, from, to: { ...dest } }], usesSpent: 1 };
}
