// TraitSystem — pure module for rolling recruit traits and baking their
// creation-time stat/growth mods.
//
// Traits are rolled ONCE, at unit creation, for roster-joining non-lord units
// (random recruits, boss recruits, colosseum mercs). Lords never roll traits.
// A unit carries `unit.traits = ['id', ...]` (0–2 entries).
//
// Creation-time mods (`creationMods.stats` / `creationMods.growths`) are baked
// directly into the unit at creation — the same philosophy as rolled growths:
// serialization-safe, no combat-time plumbing needed. Combat-time mods
// (`combatMods`), XP multipliers, and mastery interactions live in SkillSystem
// and MasterySystem and are read from traitsData at use time (never baked).

import { XP_STAT_NAMES } from '../utils/constants.js';

// Roll distribution for number of traits: 15% none, 50% one, 35% two.
const TRAIT_COUNT_WEIGHTS = [
  { count: 0, weight: 0.15 },
  { count: 1, weight: 0.5 },
  { count: 2, weight: 0.35 },
];

function rollTraitCount(rng) {
  const r = rng();
  let acc = 0;
  for (const { count, weight } of TRAIT_COUNT_WEIGHTS) {
    acc += weight;
    if (r < acc) return count;
  }
  return 0;
}

/**
 * Pick `count` distinct trait ids from traitsData, without replacement, using rng.
 * Returns an array of trait ids (may be shorter than count if the pool is small).
 */
export function rollTraits(traitsData, count, rng = Math.random) {
  if (!Array.isArray(traitsData) || traitsData.length === 0 || count <= 0) return [];
  const pool = traitsData.map((t) => t.id).filter((id) => typeof id === 'string');
  const picked = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

/**
 * Bake a single trait's creationMods into the unit (mutates in place).
 * Stats bump `unit.stats` (and currentHP for HP); growths bump `unit.growths`.
 */
export function applyTraitCreationMods(unit, trait) {
  const mods = trait?.creationMods;
  if (!mods || typeof mods !== 'object') return;
  if (mods.stats && typeof mods.stats === 'object' && unit.stats) {
    for (const [stat, delta] of Object.entries(mods.stats)) {
      if (!Number.isFinite(delta)) continue;
      unit.stats[stat] = (unit.stats[stat] || 0) + delta;
      if (stat === 'HP') {
        unit.currentHP = (unit.currentHP || 0) + delta;
      }
    }
    if (Number.isFinite(unit.stats.HP)) {
      unit.currentHP = Math.min(unit.currentHP, unit.stats.HP);
    }
    if (Object.prototype.hasOwnProperty.call(mods.stats, 'MOV')) {
      unit.mov = unit.stats.MOV;
    }
  }
  if (mods.growths && typeof mods.growths === 'object' && unit.growths) {
    for (const [stat, delta] of Object.entries(mods.growths)) {
      if (!Number.isFinite(delta)) continue;
      if (XP_STAT_NAMES.includes(stat)) {
        unit.growths[stat] = (unit.growths[stat] || 0) + delta;
      }
    }
  }
}

/**
 * Roll and apply traits to a freshly-created recruit unit (mutates in place).
 * No-op (leaves `unit.traits = []`) when traitsData is absent — this keeps
 * sim/harness/test paths that don't pass traitsData deterministic and unchanged.
 *
 * @param {object} unit - the unit to receive traits (must have stats/growths).
 * @param {Array}  traitsData - loaded traits.json, or null to skip rolling.
 * @param {Function} rng - seeded rng (0..1); defaults to Math.random.
 */
export function rollAndApplyTraits(unit, traitsData, rng = Math.random) {
  unit.traits = [];
  if (!Array.isArray(traitsData) || traitsData.length === 0) return unit;
  const roll = typeof rng === 'function' ? rng : Math.random;
  const count = rollTraitCount(roll);
  const ids = rollTraits(traitsData, count, roll);
  unit.traits = ids;
  for (const id of ids) {
    const trait = traitsData.find((t) => t.id === id);
    if (trait) applyTraitCreationMods(unit, trait);
  }
  return unit;
}

/** Look up trait objects for a unit's trait ids (skips unknown ids). */
export function getUnitTraits(unit, traitsData) {
  if (!Array.isArray(unit?.traits) || !Array.isArray(traitsData)) return [];
  return unit.traits.map((id) => traitsData.find((t) => t?.id === id)).filter((t) => t != null);
}

/** Comma-joined trait display names for UI (empty string when none). */
export function getTraitNames(unit, traitsData) {
  return getUnitTraits(unit, traitsData)
    .map((t) => t.name)
    .join(', ');
}
