import { resolveHeal } from '../engine/Combat.js';
import { staffRunOptions } from '../engine/StaffBlessings.js';
import { isCureStaff, isHealStaff } from '../engine/StatusConditionSystem.js';
import { STATUS_CONDITIONS } from '../utils/constants.js';

/**
 * Pure preview, with the same output and missing-HP cap as staff resolution. `opts`: the
 * healer's StaffBlessings.staffRunOptions (the heal multiplier, Saint's Reliquary's heal).
 */
export function healTargetPreview(staff, healer, target, opts = {}) {
  if (!staff || !healer || !target) return null;
  const from = target.currentHP;
  const max = target.stats.HP;
  if (isCureStaff(staff)) {
    const conditions = (target._conditions || []).map((c) => STATUS_CONDITIONS[c.id]?.name || c.id);
    return {
      from,
      to: from,
      max,
      amount: 0,
      conditions,
      text: `Cure: removes ${conditions.join(', ') || 'no conditions'}`,
    };
  }
  if (!isHealStaff(staff)) return null;
  const { healAmount: amount, targetHPAfter: to } = resolveHeal(staff, healer, target, opts);
  return { from, to, max, amount, text: `Heal +${amount} → ${to}/${max} HP` };
}

export function sceneHealPreview(scene, target) {
  const healer = scene.selectedUnit;
  return healTargetPreview(
    healer?.weapon,
    healer,
    target,
    staffRunOptions(scene.runManager, healer),
  );
}
