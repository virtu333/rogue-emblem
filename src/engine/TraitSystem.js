// TraitSystem — pure module for rolling unit traits, baking their creation-time
// mods, evaluating their combat mods, and migrating legacy trait saves.
//
// Traits are rolled ONCE, at unit creation: roster-joining non-lord units
// (random recruits, boss recruits, colosseum mercs) roll 0–2, and lords roll
// exactly one through `rollAndApplyLordTrait`. A unit carries
// `unit.traits = ['id', ...]`.
//
// Rules v2 (docs/specs/traits-v2.md):
// * Rolling is class-aware. Each trait's `roll` block can require or exclude
//   unit roles (see getTraitRoles) and weight the pick per role, so a trait
//   can never land where it does nothing (Brawny on a tome mage, Lone Wolf on a
//   healer who must stand next to allies).
// * Creation mods may target `ATTACK`, which resolves to the stat this unit
//   fights with (STR, or MAG for casters and healers). The resolved stat is
//   recorded on the unit (`traitAttackStat`) so promotion never silently
//   retargets it; reclassing moves it (see UnitManager.reclassUnit).
// * Mastery traits add to the class perk (threshold shift or multiplier);
//   nothing replaces a class perk any more.
// * Legacy saves are migrated once by `migrateUnitTraits` (never removing a
//   stat the unit already has). Retired traits stay defined in traits.json so
//   any unit that escaped migration still loads and still works.
//
// Creation-time mods are baked into the unit (serialization-safe, the same
// philosophy as rolled growths). Combat mods, XP multipliers and mastery
// interactions are read from traitsData at use time and never baked.
//
// RNG contract: a recruit's traits come from the rng its caller passes (the
// seeded recruit/battle stream). Rolling costs exactly one draw for the count
// plus one draw per trait picked — the same number of draws as rules v1 — so
// the class-aware pool never shifts the stream for anything rolled after it.

import { XP_STAT_NAMES } from '../utils/constants.js';

export const TRAIT_RULES_VERSION = 2;

/** Creation-mod token for "the stat this unit attacks (or heals) with". */
export const ATTACK_STAT_TOKEN = 'ATTACK';

// Mirrors Combat.js MAGICAL_TYPES (parity is covered by tests).
const MAGIC_WEAPON_TYPES = new Set(['Tome', 'Light', 'Breath']);
const STAFF_TYPE = 'Staff';
// Action skills that make a unit a support piece rather than a fighter.
const SUPPORT_ACTION_SKILLS = new Set(['dance']);
// Terrain avoid at or above this counts as cover (forest, mountain, fort and
// pillar — not thrones, villages, sand or water).
export const COVER_AVOID_THRESHOLD = 20;
const DEFAULT_ROLL_WEIGHT = 10;

// Roll distribution for number of traits: 15% none, 50% one, 35% two.
const TRAIT_COUNT_WEIGHTS = [
  { count: 0, weight: 0.15 },
  { count: 1, weight: 0.5 },
  { count: 2, weight: 0.35 },
];

const COMBAT_MOD_KEYS = [
  'critBonus',
  'hitBonus',
  'avoidBonus',
  'atkBonus',
  'defBonus',
  'resBonus',
  'spdBonus',
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

// --- Unit profile -----------------------------------------------------------

/** The stat a unit's class fights with: its first non-staff weapon type
 * decides (magic → MAG, physical → STR); staff-only healers heal with MAG. */
export function resolveAttackStat(unit) {
  const profs = Array.isArray(unit?.proficiencies) ? unit.proficiencies : [];
  const attacking = profs.find((p) => p?.type && p.type !== STAFF_TYPE);
  if (attacking) return MAGIC_WEAPON_TYPES.has(attacking.type) ? 'MAG' : 'STR';
  return profs.some((p) => p?.type === STAFF_TYPE) ? 'MAG' : 'STR';
}

/** The attack stat a unit's ATTACK-token traits are baked into. */
export function getTraitAttackStat(unit) {
  const recorded = unit?.traitAttackStat;
  if (recorded === 'STR' || recorded === 'MAG') return recorded;
  return resolveAttackStat(unit);
}

/**
 * Role tags a trait's `roll` block can require, exclude or weight:
 *  attacker  — has a weapon that can initiate combat (not staff-only)
 *  support   — staff-only healer, or carries a refresh action (Dance)
 *  caster / physical — attack stat is MAG / STR
 *  infantry / armored / cavalry / flying, and mounted (cavalry or flying)
 *  lord
 */
export function getTraitRoles(unit) {
  const roles = new Set();
  const profs = Array.isArray(unit?.proficiencies) ? unit.proficiencies : [];
  const attacker = profs.some((p) => p?.type && p.type !== STAFF_TYPE);
  if (attacker) roles.add('attacker');
  const skills = Array.isArray(unit?.skills) ? unit.skills : [];
  if (!attacker || skills.some((id) => SUPPORT_ACTION_SKILLS.has(id))) roles.add('support');
  roles.add(resolveAttackStat(unit) === 'MAG' ? 'caster' : 'physical');
  const move = typeof unit?.moveType === 'string' ? unit.moveType.toLowerCase() : '';
  if (move) roles.add(move);
  if (move === 'cavalry' || move === 'flying') roles.add('mounted');
  if (unit?.isLord) roles.add('lord');
  return roles;
}

// --- Eligibility and rolling ------------------------------------------------

/**
 * Whether the roll rules may put this trait on this unit. Legendary traits
 * belong to their named lord only; retired traits never roll.
 * `options.lord` applies the lord pool rules (`roll.lords === false` excludes).
 */
export function isTraitEligible(trait, unit, options = {}) {
  if (!trait || typeof trait.id !== 'string') return false;
  if (trait.retired) return false;
  if (trait.lordName) return Boolean(unit?.isLord && unit.name === trait.lordName);
  if (Array.isArray(trait.eligibleWeaponTypes)) {
    const profs = Array.isArray(unit?.proficiencies) ? unit.proficiencies : [];
    if (!profs.some((p) => trait.eligibleWeaponTypes.includes(p?.type))) return false;
  }
  const roll = trait.roll || {};
  if (options.lord && roll.lords === false) return false;
  const roles = getTraitRoles(unit);
  if (Array.isArray(roll.requires) && !roll.requires.every((role) => roles.has(role))) return false;
  if (Array.isArray(roll.excludes) && roll.excludes.some((role) => roles.has(role))) return false;
  return getTraitRollWeight(trait, unit) > 0;
}

/** Relative pick weight: `roll.weight` (default 10) × every matching role weight. */
export function getTraitRollWeight(trait, unit) {
  const roll = trait?.roll || {};
  let weight = Number.isFinite(roll.weight) ? roll.weight : DEFAULT_ROLL_WEIGHT;
  if (roll.roleWeights && typeof roll.roleWeights === 'object') {
    const roles = getTraitRoles(unit);
    for (const [role, factor] of Object.entries(roll.roleWeights)) {
      if (roles.has(role) && Number.isFinite(factor)) weight *= factor;
    }
  }
  return Math.max(0, weight);
}

/**
 * Pick `count` distinct eligible trait ids by weight, without replacement.
 * Costs exactly one rng() draw per pick. Returns fewer ids when the eligible
 * pool runs out.
 */
export function rollTraits(traitsData, count, rng = Math.random, unit = null, options = {}) {
  if (!Array.isArray(traitsData) || traitsData.length === 0 || count <= 0) return [];
  const pool = traitsData
    .filter((t) => isTraitEligible(t, unit, options))
    .map((t) => ({ id: t.id, weight: getTraitRollWeight(t, unit) }));
  const picked = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    const target = rng() * total;
    let idx = 0;
    let acc = pool[0].weight;
    while (acc <= target && idx < pool.length - 1) {
      idx++;
      acc += pool[idx].weight;
    }
    picked.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return picked;
}

// --- Creation mods ------------------------------------------------------------

function resolveModStat(stat, attackStat) {
  return stat === ATTACK_STAT_TOKEN ? attackStat : stat;
}

function usesAttackToken(trait) {
  const mods = trait?.creationMods;
  return Boolean(
    mods &&
    ((mods.stats && ATTACK_STAT_TOKEN in mods.stats) ||
      (mods.growths && ATTACK_STAT_TOKEN in mods.growths)),
  );
}

/**
 * Bake a single trait's creationMods into the unit (mutates in place).
 * Stats bump `unit.stats` (and currentHP for HP); growths bump `unit.growths`.
 * `options.profile` (unit-like) decides the ATTACK stat when the unit is about
 * to become another class (promoted recruits roll on their base class).
 */
export function applyTraitCreationMods(unit, trait, options = {}) {
  if (!unit || !trait) return;
  if (trait.id === 'clever') unit.cleverRulesVersion = 2;
  unit.traitRulesVersion = TRAIT_RULES_VERSION;
  const mods = trait.creationMods;
  if (!mods || typeof mods !== 'object') return;
  let attackStat = null;
  if (usesAttackToken(trait)) {
    attackStat =
      unit.traitAttackStat === 'STR' || unit.traitAttackStat === 'MAG'
        ? unit.traitAttackStat
        : resolveAttackStat(options.profile || unit);
    unit.traitAttackStat = attackStat;
  }
  if (mods.stats && typeof mods.stats === 'object' && unit.stats) {
    for (const [rawStat, delta] of Object.entries(mods.stats)) {
      if (!Number.isFinite(delta)) continue;
      const stat = resolveModStat(rawStat, attackStat);
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
    applyGrowthMods(unit, mods.growths, attackStat);
  }
}

function applyGrowthMods(unit, growthMods, attackStat) {
  for (const [rawStat, delta] of Object.entries(growthMods)) {
    if (!Number.isFinite(delta)) continue;
    const stat = resolveModStat(rawStat, attackStat);
    if (XP_STAT_NAMES.includes(stat)) {
      unit.growths[stat] = (unit.growths[stat] || 0) + delta;
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
 * @param {object} [options] - `profile`: unit-like stand-in whose class decides
 *   eligibility and the ATTACK stat (the promoted class a recruit is about to
 *   become); defaults to the unit itself.
 */
export function rollAndApplyTraits(unit, traitsData, rng = Math.random, options = {}) {
  unit.traits = [];
  if (!Array.isArray(traitsData) || traitsData.length === 0) return unit;
  const roll = typeof rng === 'function' ? rng : Math.random;
  const profile = options.profile || unit;
  const count = rollTraitCount(roll);
  const ids = rollTraits(
    traitsData.filter((t) => t.rarity !== 'legendary'),
    count,
    roll,
    profile,
  );
  unit.traits = ids;
  for (const id of ids) {
    const trait = traitsData.find((t) => t.id === id);
    if (trait) applyTraitCreationMods(unit, trait, { profile });
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

// --- Reclass support ------------------------------------------------------------

/**
 * Stat shift that moves ATTACK-token stat bonuses when a reclass changes the
 * unit's attack stat (a Kindled fighter who becomes a mage keeps +1 in the
 * stat it now fights with). Returns `{ [stat]: delta }` (empty when nothing moves).
 */
export function getTraitReclassStatShift(unit, newAttackStat, traitsData) {
  const shift = {};
  if (newAttackStat !== 'STR' && newAttackStat !== 'MAG') return shift;
  const oldAttackStat = getTraitAttackStat(unit);
  if (oldAttackStat === newAttackStat) return shift;
  let amount = 0;
  for (const trait of getUnitTraits(unit, traitsData)) {
    const delta = trait.creationMods?.stats?.[ATTACK_STAT_TOKEN];
    if (Number.isFinite(delta)) amount += delta;
  }
  if (!amount) return shift;
  shift[oldAttackStat] = -amount;
  shift[newAttackStat] = amount;
  return shift;
}

/** True when any of the unit's traits bakes into its attack stat. */
export function hasAttackStatTrait(unit, traitsData) {
  return getUnitTraits(unit, traitsData).some(usesAttackToken);
}

/**
 * Re-bake every trait growth mod after a reclass re-rolls the unit's growths
 * (otherwise a Hardy unit would silently lose its +10% HP growth). ATTACK
 * growth follows the unit's current trait attack stat.
 */
export function reapplyTraitGrowthMods(unit, traitsData) {
  if (!unit?.growths) return unit;
  for (const trait of getUnitTraits(unit, traitsData)) {
    const growths = trait.creationMods?.growths;
    if (!growths || typeof growths !== 'object') continue;
    applyGrowthMods(unit, growths, getTraitAttackStat(unit));
  }
  return unit;
}

// --- Combat mods ----------------------------------------------------------------

function combatModParts(trait) {
  const raw = trait?.combatMods;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).filter((part) => part && typeof part === 'object');
}

function terrainAvoid(terrain) {
  const value = Number.parseInt(terrain?.avoidBonus, 10);
  return Number.isFinite(value) ? value : 0;
}

function isBelowHalf(unit) {
  return (
    Number.isFinite(unit?.currentHP) &&
    Number.isFinite(unit?.stats?.HP) &&
    unit.currentHP <= Math.floor(unit.stats.HP / 2)
  );
}

/**
 * Trait combat conditions. Trait-specific ones are decided here; shared
 * battlefield ones (below50, above75, adjacent_ally, no_ally_within_2,
 * on_forest…) are delegated to `isConditionMet(condition)` from SkillSystem.
 */
export function isTraitConditionMet(condition, ctx) {
  const { unit, opponent, isInitiating, terrain, isConditionMet } = ctx;
  if (!condition) return true;
  switch (condition) {
    case 'initiating':
      return Boolean(isInitiating);
    case 'defending':
      return !isInitiating;
    case 'initiating_full_hp_foe':
      return Boolean(isInitiating && opponent && opponent.currentHP === opponent.stats?.HP);
    case 'moved_3_plus_initiating':
      return Boolean(isInitiating && (unit?._movementSpent || 0) >= 3);
    case 'initiating_no_adjacent_ally':
      return Boolean(isInitiating && !(isConditionMet?.('adjacent_ally') ?? false));
    case 'foe_below50':
      return isBelowHalf(opponent);
    case 'in_cover':
      return terrainAvoid(terrain) >= COVER_AVOID_THRESHOLD;
    default:
      return typeof isConditionMet === 'function' ? Boolean(isConditionMet(condition)) : false;
  }
}

/**
 * Combat mods from a unit's traits for one combat. `combatMods` may be one
 * part or an array of parts, each `{ condition?, <modKey>: n }`.
 * Returns `{ mods: {<modKey>: n}, activated: [{ id, name }] }`.
 */
export function getTraitCombatMods(unit, opponent, ctx = {}) {
  const mods = {};
  const activated = [];
  for (const trait of getUnitTraits(unit, ctx.traitsData)) {
    let applied = false;
    for (const part of combatModParts(trait)) {
      if (!isTraitConditionMet(part.condition, { ...ctx, unit, opponent })) continue;
      for (const key of COMBAT_MOD_KEYS) {
        if (Number.isFinite(part[key]) && part[key] !== 0) {
          mods[key] = (mods[key] || 0) + part[key];
          applied = true;
        }
      }
    }
    if (applied) activated.push({ id: `trait_${trait.id}`, name: trait.name });
  }
  return { mods, activated };
}

// --- Migration --------------------------------------------------------------------

// Creation bonuses are baked into saves. Repair the old Clever penalty once,
// retaining the player's rolled trait rather than randomly replacing it.
export function migrateCleverTrait(unit) {
  if (!unit?.traits?.includes('clever') || unit.cleverRulesVersion >= 2 || !unit.stats) return unit;
  unit.stats = { ...unit.stats, DEF: (unit.stats.DEF || 0) + 1 };
  unit.growths = { ...unit.growths, MAG: (unit.growths?.MAG || 0) + 5 };
  unit.cleverRulesVersion = 2;
  return unit;
}

/**
 * Rules v1 → v2 conversions. Each entry names the v2 trait and the baked
 * top-up that brings a v1 unit level with a freshly rolled v2 unit. Top-ups
 * only ever add: a unit never loses a stat it already had.
 * Traits not listed keep their id (unchanged, rebalanced at combat time, or
 * retired-but-still-defined in traits.json).
 */
const LEGACY_TRAIT_CONVERSIONS = {
  // Rolls Hard to Kill at +3 HP now (was +2).
  hardy: { to: 'hardy', topUp: () => ({ stats: { HP: 1 } }) },
  // Quicksilver grows +10% SPD now (was +5%).
  nimble: { to: 'nimble', topUp: () => ({ growths: { SPD: 5 } }) },
  // Brawny (+1 STR, −5% SPD growth) was downside-only on casters. It becomes
  // Kindled in the stat the unit actually fights with and refunds the SPD growth.
  brawny: {
    to: 'gifted',
    attackStat: (unit) => resolveAttackStat(unit),
    topUp: (attackStat) =>
      attackStat === 'MAG'
        ? { stats: { MAG: 1 }, growths: { MAG: 10, SPD: 5 } }
        : { growths: { STR: 10, SPD: 5 } },
  },
  // Clever (+1 MAG, +5% MAG growth after its v1 repair) becomes Kindled (MAG).
  clever: { to: 'gifted', attackStat: () => 'MAG', topUp: () => ({ growths: { MAG: 5 } }) },
  // Lazy (+1 STR/+1 DEF, mastery 2 battles later) becomes Slow Oath: the same
  // 2-battle delay now doubles the class perk. Its baked stats stay with the unit.
  lazy: { to: 'slow_oath', topUp: () => ({}) },
};

/**
 * Bring a unit's traits to rules v2, once (`traitRulesVersion`). Idempotent
 * and safe on units without traits. Runs the v1 Clever repair first.
 */
export function migrateUnitTraits(unit) {
  if (!unit || !Array.isArray(unit.traits) || unit.traits.length === 0) return unit;
  migrateCleverTrait(unit);
  if (unit.traitRulesVersion >= TRAIT_RULES_VERSION) return unit;
  const stats = unit.stats && typeof unit.stats === 'object' ? { ...unit.stats } : null;
  const growths = unit.growths && typeof unit.growths === 'object' ? { ...unit.growths } : null;
  let currentHP = unit.currentHP;
  let attackStat = null;
  const next = [];
  for (const id of unit.traits) {
    const conversion = LEGACY_TRAIT_CONVERSIONS[id];
    if (!conversion) {
      if (!next.includes(id)) next.push(id);
      continue;
    }
    if (next.includes(conversion.to)) continue; // never top up the same trait twice
    next.push(conversion.to);
    const resolved = conversion.attackStat ? conversion.attackStat(unit) : null;
    if (resolved) attackStat = attackStat || resolved;
    const topUp = conversion.topUp(resolved);
    for (const [stat, delta] of Object.entries(topUp.stats || {})) {
      if (!stats) continue;
      stats[stat] = (stats[stat] || 0) + delta;
      if (stat === 'HP' && Number.isFinite(currentHP)) currentHP += delta;
    }
    for (const [stat, delta] of Object.entries(topUp.growths || {})) {
      if (growths) growths[stat] = (growths[stat] || 0) + delta;
    }
  }
  unit.traits = next;
  if (stats) unit.stats = stats;
  if (growths) unit.growths = growths;
  if (Number.isFinite(currentHP)) {
    unit.currentHP = stats && Number.isFinite(stats.HP) ? Math.min(currentHP, stats.HP) : currentHP;
  }
  if (attackStat && !unit.traitAttackStat) unit.traitAttackStat = attackStat;
  unit.traitRulesVersion = TRAIT_RULES_VERSION;
  return unit;
}

// --- Lords ------------------------------------------------------------------------

/** Lord traits preserve mastery identity and respect class eligibility.
 * Existing saves are never re-rolled; an already assigned trait is retained.
 */
export function rollAndApplyLordTrait(unit, traitsData, rng = Math.random, legendaryChance = 0.05) {
  if (!unit?.isLord || unit.traits?.length) return unit;
  const legendary = (traitsData || []).filter(
    (t) => t.rarity === 'legendary' && t.lordName === unit.name,
  );
  const chance = Math.min(0.15, Math.max(0, Number(legendaryChance) || 0));
  const useLegendary = legendary.length > 0 && chance > 0 && rng() < chance;
  const pool = useLegendary
    ? legendary
    : (traitsData || []).filter((trait) => trait.rarity !== 'legendary');
  const ids = rollTraits(pool, 1, rng, unit, { lord: true });
  unit.traits = ids;
  for (const id of ids)
    applyTraitCreationMods(
      unit,
      pool.find((trait) => trait.id === id),
    );
  return unit;
}

/** Apply only after a staff actually heals another unit. Usage belongs to the
 * battle unit, so canonical checkpoints restore it alongside HP. */
export function applyLegendaryStaffHeal(healer, target, healed, traitsData, turn, phase) {
  if (
    phase !== 'player' ||
    !Number.isInteger(turn) ||
    turn < 1 ||
    healer === target ||
    healed <= 0 ||
    healer.currentHP <= 0 ||
    healer._legendaryGraceTurn === turn
  )
    return 0;
  const amount = getUnitTraits(healer, traitsData).reduce(
    (max, t) => Math.max(max, t.staffSelfHeal || 0),
    0,
  );
  const actual = Math.max(0, Math.min(amount, healer.stats.HP - healer.currentHP));
  if (!actual) return 0;
  healer.currentHP += actual;
  healer._legendaryGraceTurn = turn;
  return actual;
}
