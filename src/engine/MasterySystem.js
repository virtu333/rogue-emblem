// MasterySystem — pure module for class-mastery tracking + trait-modulated perks.
//
// Model: a unit accrues battle participation per class in `unit.classBattles`
// (a plain `{ [className]: count }` map). Progress toward mastery in the unit's
// CURRENT class family = battles fought in the current class + battles fought in
// its base class (so promotion carries pre-promotion battles forward). Reclass
// naturally resets progress because it moves the unit to a different family.
//
// A mastered unit gains a permanent, class-flavored combat-mod perk (authored on
// the base/lord class entry in classes.json as `masteryPerk`). Traits can shift
// the mastery threshold (`masteryBattlesDelta`) or replace the perk entirely
// (`masteryPerkOverride`).
//
// No mods are baked into `unit.stats` — the perk is applied at combat time via
// getSkillCombatMods, exactly like skill/affix mods.

import { MASTERY_BATTLES, MASTERY_MIN_BATTLES } from '../utils/constants.js';

const PERK_MOD_KEYS = [
  'critBonus',
  'hitBonus',
  'avoidBonus',
  'atkBonus',
  'defBonus',
  'resBonus',
  'spdBonus',
];

/**
 * Build a reverse map { promotedClassName -> baseClassName } from classes.json
 * promotion relationships. `promotesTo` may be a string or an array.
 * Cached per classesData array reference to avoid rebuilding every lookup.
 */
const _reverseMapCache = new WeakMap();
function getPromotedToBaseMap(classesData) {
  if (!Array.isArray(classesData)) return new Map();
  const cached = _reverseMapCache.get(classesData);
  if (cached) return cached;
  const map = new Map();
  for (const cls of classesData) {
    if (!cls?.name || !cls.promotesTo) continue;
    const targets = Array.isArray(cls.promotesTo) ? cls.promotesTo : [cls.promotesTo];
    for (const target of targets) {
      if (typeof target === 'string' && !map.has(target)) {
        map.set(target, cls.name);
      }
    }
  }
  _reverseMapCache.set(classesData, map);
  return map;
}

/**
 * Resolve the base class name of a unit's current class family.
 * Base classes return their own name; promoted classes resolve through the
 * reverse promotion map (falling back to `promotesFrom` on the class entry).
 */
export function getBaseClassName(unit, classesData) {
  const current = unit?.className;
  if (!current) return null;
  const revMap = getPromotedToBaseMap(classesData);
  if (revMap.has(current)) return revMap.get(current);
  // Fall back to the class entry's own promotesFrom, if present.
  const entry = Array.isArray(classesData) ? classesData.find((c) => c?.name === current) : null;
  if (entry?.promotesFrom) return entry.promotesFrom;
  return current; // already a base class (or unknown — treat as its own family)
}

/** Increment the unit's battle count in its CURRENT class (mutates in place). */
export function recordBattleParticipation(unit) {
  if (!unit || !unit.className) return;
  if (!unit.classBattles || typeof unit.classBattles !== 'object') {
    unit.classBattles = {};
  }
  unit.classBattles[unit.className] = (unit.classBattles[unit.className] || 0) + 1;
}

/**
 * Battles fought toward the unit's current class family.
 * = classBattles[currentClass] + classBattles[baseClassOfCurrentClass]
 * (deduped when the current class IS the base class).
 *
 * Known quirk (intentional): counters are never cleared, so reclassing
 * A -> B -> A resurrects the old family-A progress. Accepted as-is — the
 * round trip costs two scarce reclass seals, making it a deliberate
 * min-max path rather than an exploit.
 */
export function getMasteryProgress(unit, classesData) {
  const battles = unit?.classBattles;
  if (!battles || typeof battles !== 'object') return 0;
  const current = unit?.className;
  if (!current) return 0;
  const base = getBaseClassName(unit, classesData);
  let total = battles[current] || 0;
  if (base && base !== current) total += battles[base] || 0;
  return total;
}

/** Sum a trait field across the unit's traits, from traitsData. */
function sumTraitField(unit, traitsData, field) {
  if (!Array.isArray(unit?.traits) || !Array.isArray(traitsData)) return 0;
  let sum = 0;
  for (const id of unit.traits) {
    const t = traitsData.find((td) => td?.id === id);
    const v = t?.[field];
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

/** First trait on the unit that carries the given field (for overrides). */
function findTraitField(unit, traitsData, field) {
  if (!Array.isArray(unit?.traits) || !Array.isArray(traitsData)) return null;
  for (const id of unit.traits) {
    const t = traitsData.find((td) => td?.id === id);
    if (t && t[field] != null) return t[field];
  }
  return null;
}

/**
 * Effective mastery threshold for a unit: base MASTERY_BATTLES plus the sum of
 * trait `masteryBattlesDelta` (e.g. Studious −2, Lazy +2), floored at
 * MASTERY_MIN_BATTLES so no trait combination trivializes mastery.
 */
export function getMasteryThreshold(unit, traitsData) {
  const delta = sumTraitField(unit, traitsData, 'masteryBattlesDelta');
  return Math.max(MASTERY_MIN_BATTLES, MASTERY_BATTLES + delta);
}

/** True when the unit's current-family progress meets its effective threshold. */
export function isMastered(unit, classesData, traitsData = null) {
  return getMasteryProgress(unit, classesData) >= getMasteryThreshold(unit, traitsData);
}

/** Sanitize a perk-like object down to the seven whitelisted flat mod keys. */
function sanitizePerkMods(mods) {
  const out = {};
  if (!mods || typeof mods !== 'object') return out;
  for (const key of PERK_MOD_KEYS) {
    if (Number.isFinite(mods[key])) out[key] = mods[key];
  }
  return out;
}

/**
 * The mastery perk for the unit's class family, resolved from the base/lord
 * class entry's `masteryPerk`. Returns `{ name, mods }` or null.
 *
 * Trait `masteryPerkOverride` (e.g. Reckless) fully REPLACES the class perk's
 * mods — the returned name is tagged so the UI can show the override source.
 */
export function getMasteryPerk(unit, classesData, traitsData = null) {
  if (!unit?.className) return null;
  const base = getBaseClassName(unit, classesData);
  const entry = Array.isArray(classesData)
    ? classesData.find((c) => c?.name === base) ||
      classesData.find((c) => c?.name === unit.className)
    : null;
  const classPerk = entry?.masteryPerk;

  const override = findTraitField(unit, traitsData, 'masteryPerkOverride');
  if (override && typeof override === 'object') {
    // Find which trait supplied it, for the display name.
    const overrideTrait = Array.isArray(unit.traits)
      ? (traitsData || []).find(
          (t) => unit.traits.includes(t?.id) && t?.masteryPerkOverride != null,
        )
      : null;
    return {
      name: overrideTrait?.name ? `${overrideTrait.name} Mastery` : 'Mastery',
      mods: sanitizePerkMods(override),
      overridden: true,
    };
  }

  if (!classPerk || typeof classPerk !== 'object') return null;
  return {
    name: typeof classPerk.name === 'string' ? classPerk.name : 'Mastery',
    mods: sanitizePerkMods(classPerk.mods),
    overridden: false,
  };
}

/**
 * Combat-time mods contributed by mastery. Returns `{ mods, activated }` where
 * `mods` is a partial of the seven flat keys and `activated` is a UI entry
 * (`{ id, name }`) or null. Empty/no-op when the unit is not mastered.
 */
export function getMasteryCombatMods(unit, classesData, traitsData = null) {
  if (!isMastered(unit, classesData, traitsData)) return { mods: {}, activated: null };
  const perk = getMasteryPerk(unit, classesData, traitsData);
  if (!perk) return { mods: {}, activated: null };
  const hasMods = Object.keys(perk.mods).length > 0;
  return {
    mods: perk.mods,
    activated: hasMods ? { id: 'mastery', name: perk.name } : null,
  };
}

/**
 * Multiplicative XP factor from all of a unit's traits (product of each trait's
 * `xpMultiplier`, default 1). Callers floor the resulting XP.
 */
export function getTraitXpMultiplier(unit, traitsData) {
  if (!Array.isArray(unit?.traits) || !Array.isArray(traitsData)) return 1;
  let mult = 1;
  for (const id of unit.traits) {
    const t = traitsData.find((td) => td?.id === id);
    if (Number.isFinite(t?.xpMultiplier)) mult *= t.xpMultiplier;
  }
  return mult;
}

export { PERK_MOD_KEYS };
