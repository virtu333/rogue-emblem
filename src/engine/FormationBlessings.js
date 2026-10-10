// FormationBlessings.js - the two blessing boons that read where a unit stands among its own
// side: Phalanx Rite (`adjacent_ally_def_bonus`: DEF for each ally on a cardinal neighbour
// tile) and Duelist's Creed (`isolated_combat_bonus`: Avoid and Crit while no ally is within
// `radius`). Docs: docs/specs/blessings-v3.md §5.2.
//
// Pure parsers and counting, no Phaser and no randomness. The combat reads live in
// engine/BlessingCombatMods.js (the one place blessing combat bonuses are added); the board
// predicates are SkillSystem's `countAdjacentAllies` / `hasAllyWithin`, the same ones the
// accessory conditions `adjacent_ally` and `no_ally_within_2` use.

import { countAdjacentAllies, hasAllyWithin } from './SkillSystem.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/** Why `params` is not a usable Phalanx Rite boon (empty when it is). */
export function adjacentAllyDefBonusErrors(params) {
  if (!isPlainObject(params)) return ['params must be an object'];
  const errors = [];
  if (!isPositiveInteger(params.perAlly)) errors.push('params.perAlly must be a positive integer');
  if (!isPositiveInteger(params.max)) errors.push('params.max must be a positive integer');
  else if (isPositiveInteger(params.perAlly) && params.max < params.perAlly)
    errors.push('params.max must be at least perAlly (a cap below one ally never pays)');
  return errors;
}

/** Normalised Phalanx Rite params `{ perAlly, max }`, or null when they would do nothing. */
export function parseAdjacentAllyDefBonus(params) {
  if (adjacentAllyDefBonusErrors(params).length > 0) return null;
  return { perAlly: params.perAlly, max: params.max };
}

/** Why `params` is not a usable Duelist's Creed boon (empty when it is). */
export function isolatedCombatBonusErrors(params) {
  if (!isPlainObject(params)) return ['params must be an object'];
  const errors = [];
  if (!isPositiveInteger(params.radius)) errors.push('params.radius must be a positive integer');
  for (const key of ['avoidBonus', 'critBonus']) {
    const value = params[key];
    if (value !== undefined && !isPositiveInteger(value))
      errors.push(`params.${key} must be a positive integer when given`);
  }
  if (!isPositiveInteger(params.avoidBonus) && !isPositiveInteger(params.critBonus))
    errors.push('params needs a positive avoidBonus or critBonus (otherwise it does nothing)');
  return errors;
}

/** Normalised Duelist's Creed params `{ radius, avoidBonus, critBonus }`, or null. */
export function parseIsolatedCombatBonus(params) {
  if (isolatedCombatBonusErrors(params).length > 0) return null;
  return {
    radius: params.radius,
    avoidBonus: params.avoidBonus ?? 0,
    critBonus: params.critBonus ?? 0,
  };
}

/** A saved list of held Phalanx Rite entries, every unusable one dropped. */
export function sanitizeAdjacentAllyDefBonuses(list) {
  if (!Array.isArray(list)) return [];
  return list.map((entry) => parseAdjacentAllyDefBonus(entry)).filter(Boolean);
}

/** A saved list of held Duelist's Creed entries, every unusable one dropped. */
export function sanitizeIsolatedCombatBonuses(list) {
  if (!Array.isArray(list)) return [];
  return list.map((entry) => parseIsolatedCombatBonus(entry)).filter(Boolean);
}

/**
 * The DEF Phalanx Rite adds to `unit`: each held entry pays `perAlly` for every living ally on
 * a cardinal neighbour tile, up to its `max`.
 */
export function adjacentAllyDefBonus(entries, unit, allies) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  const neighbours = countAdjacentAllies(unit, allies);
  if (neighbours <= 0) return 0;
  let total = 0;
  for (const entry of entries) {
    const perAlly = Math.trunc(Number(entry?.perAlly) || 0);
    const max = Math.trunc(Number(entry?.max) || 0);
    if (perAlly <= 0 || max <= 0) continue;
    total += Math.min(max, perAlly * neighbours);
  }
  return total;
}

/**
 * The Avoid and Crit Duelist's Creed adds to `unit`: each held entry pays while no living ally
 * stands within its `radius`. Foes never count: only the unit's own side breaks the duel.
 */
export function isolatedCombatBonus(entries, unit, allies) {
  const total = { avoidBonus: 0, critBonus: 0 };
  if (!Array.isArray(entries)) return total;
  for (const entry of entries) {
    const radius = Math.trunc(Number(entry?.radius) || 0);
    if (radius <= 0 || hasAllyWithin(unit, allies, radius)) continue;
    total.avoidBonus += Math.trunc(Number(entry?.avoidBonus) || 0);
    total.critBonus += Math.trunc(Number(entry?.critBonus) || 0);
  }
  return total;
}
