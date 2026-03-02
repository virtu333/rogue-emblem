import {
  STATUS_CONDITIONS,
  STATUS_HIT_MIN,
  STATUS_HIT_MAX,
  STATUS_MAG_MULT,
  STATUS_RES_MULT,
} from '../utils/constants.js';

// --- Condition storage helpers ---

export function applyCondition(unit, conditionId, turnsRemaining) {
  if (!unit || !conditionId) return;
  const config = STATUS_CONDITIONS[conditionId];
  if (!config) return;
  if (!Array.isArray(unit._conditions)) unit._conditions = [];
  // Don't stack — replace existing condition of same type
  unit._conditions = unit._conditions.filter((c) => c.id !== conditionId);
  unit._conditions.push({ id: conditionId, turnsRemaining: turnsRemaining ?? config.maxTurns });
}

export function removeCondition(unit, conditionId) {
  if (!unit || !Array.isArray(unit._conditions)) return;
  unit._conditions = unit._conditions.filter((c) => c.id !== conditionId);
}

export function clearAllConditions(unit) {
  if (!unit) return;
  unit._conditions = [];
}

export function hasCondition(unit, conditionId) {
  if (!unit || !Array.isArray(unit._conditions)) return false;
  return unit._conditions.some((c) => c.id === conditionId);
}

export function getConditions(unit) {
  if (!unit || !Array.isArray(unit._conditions)) return [];
  return unit._conditions;
}

export function isSleeping(unit) {
  return hasCondition(unit, 'sleep');
}

export function isSilenced(unit) {
  return hasCondition(unit, 'silence');
}

export function isAcidPoisoned(unit) {
  return hasCondition(unit, 'acid');
}

// --- Weapon classification ---

export function isStatusStaff(weapon) {
  return weapon?.type === 'Staff' && Boolean(weapon.statusEffect);
}

export function isHealStaff(weapon) {
  return weapon?.type === 'Staff' && !weapon.statusEffect;
}

// --- Hit formula ---

export function calculateStatusHit(staff, caster, target) {
  const baseHit = staff?.hit ?? 0;
  const casterMag = caster?.stats?.MAG ?? 0;
  const targetRes = target?.stats?.RES ?? 0;
  const raw = baseHit + casterMag * STATUS_MAG_MULT - targetRes * STATUS_RES_MULT;
  return Math.max(STATUS_HIT_MIN, Math.min(STATUS_HIT_MAX, raw));
}

// --- Resolution ---

export function resolveStatusStaff(staff, caster, target, rng = Math.random) {
  if (!staff || !staff.statusEffect) return { hit: false, hitChance: 0, conditionId: null };
  const conditionId = staff.statusEffect;
  const hitChance = calculateStatusHit(staff, caster, target);
  const roll = rng() * 100;
  const hit = roll < hitChance;
  if (hit) {
    const config = STATUS_CONDITIONS[conditionId];
    applyCondition(target, conditionId, config?.maxTurns ?? 3);
  }
  return { hit, hitChance, conditionId };
}

// --- Turn-start recovery ---

export function processConditionRecovery(units, rng = Math.random) {
  const events = [];
  if (!Array.isArray(units)) return events;
  for (const unit of units) {
    if (!unit || !Array.isArray(unit._conditions)) continue;
    const recovered = [];
    for (const cond of unit._conditions) {
      cond.turnsRemaining = (cond.turnsRemaining ?? 1) - 1;
      const config = STATUS_CONDITIONS[cond.id];
      const chance = config?.recoveryChance ?? 0;
      if (cond.turnsRemaining <= 0 || rng() < chance) {
        recovered.push(cond.id);
      }
    }
    for (const condId of recovered) {
      removeCondition(unit, condId);
      events.push({ unit, conditionId: condId });
    }
  }
  return events;
}

// --- Staff range parsing ---

export function parseStaffRange(rangeStr) {
  if (!rangeStr || typeof rangeStr !== 'string') return { min: 1, max: 1 };
  const parts = rangeStr.split('-');
  if (parts.length === 2) {
    return { min: parseInt(parts[0], 10) || 1, max: parseInt(parts[1], 10) || 1 };
  }
  const val = parseInt(parts[0], 10) || 1;
  return { min: val, max: val };
}
