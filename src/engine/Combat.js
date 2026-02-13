// Combat.js — Pure combat calculation engine (no Phaser dependencies)
// All functions are stateless; BattleScene owns HP/state mutation.

import {
  WEAPON_TRIANGLE,
  DOUBLE_ATTACK_SPD_THRESHOLD,
  CRIT_MULTIPLIER,
  STAFF_BONUS_USE_THRESHOLDS,
} from '../utils/constants.js';
import { rollDefenseAffixes } from './AffixSystem.js';

// --- Weapon classification ---

const PHYSICAL_TYPES = new Set(['Sword', 'Lance', 'Axe', 'Bow']);
const MAGICAL_TYPES = new Set(['Tome', 'Light']);
const IS_DEV = Boolean(import.meta?.env?.DEV);

function normalizeCombatStatScaling(value) {
  if (!value || typeof value !== 'object') return null;
  const stat = typeof value.stat === 'string' ? value.stat.trim().toUpperCase() : '';
  if (!stat) return null;
  const divisor = Math.max(1, Math.trunc(Number(value.divisor) || 1));
  return { stat, divisor };
}

function normalizeCombatEffectiveness(value) {
  if (!value || typeof value !== 'object') return null;
  const rawMoveTypes = Array.isArray(value.moveTypes)
    ? value.moveTypes
    : (typeof value.moveType === 'string' ? [value.moveType] : []);
  const moveTypes = [...new Set(
    rawMoveTypes
      .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
      .filter(Boolean)
  )];
  const multiplier = Math.max(1, Math.trunc(Number(value.multiplier) || 1));
  if (moveTypes.length <= 0 || multiplier <= 1) return null;
  return { moveTypes, multiplier };
}

function normalizeCombatRangeOverride(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' || typeof value === 'string') {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n) || n < 1) return null;
    return { min: n, max: n };
  }
  if (typeof value !== 'object') return null;
  const min = Math.max(1, Math.trunc(Number(value.min) || 0));
  const max = Math.max(min, Math.trunc(Number(value.max) || min));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

function mergeCombatEffectiveness(baseValue, extraValue) {
  const base = normalizeCombatEffectiveness(baseValue);
  const extra = normalizeCombatEffectiveness(extraValue);
  if (!base && !extra) return null;
  if (!base) return extra;
  if (!extra) return base;
  return {
    moveTypes: [...new Set([...base.moveTypes, ...extra.moveTypes])],
    multiplier: Math.max(base.multiplier, extra.multiplier),
  };
}

function getArtEffectivenessMultiplier(mods, defender) {
  const effectiveness = mods?.effectiveness;
  if (!effectiveness) return 1;
  const defenderType = typeof defender?.moveType === 'string'
    ? defender.moveType.trim().toLowerCase()
    : '';
  if (!defenderType) return 1;
  if (!Array.isArray(effectiveness.moveTypes) || effectiveness.moveTypes.length <= 0) return 1;
  if (!effectiveness.moveTypes.includes(defenderType)) return 1;
  return Math.max(1, Math.trunc(Number(effectiveness.multiplier) || 1));
}

function getCombinedEffectivenessMultiplier(weapon, defender, mods = null) {
  if (defender?.accessory?.combatEffects?.negateEffectiveness) return 1;
  const weaponMult = getEffectivenessMultiplier(weapon, defender);
  const artMult = getArtEffectivenessMultiplier(mods, defender);
  if (weaponMult > 1 && artMult > 1) {
    return Math.min(5, weaponMult * artMult);
  }
  return Math.max(weaponMult, artMult, 1);
}

function getMissingHp(unit) {
  const maxHp = Math.max(0, Number(unit?.stats?.HP) || 0);
  const currentHp = Math.max(0, Number(unit?.currentHP) || 0);
  return Math.max(0, maxHp - currentHp);
}

function getCombatStatScalingBonus(unit, mods) {
  const scaling = mods?.statScaling;
  if (!scaling) return 0;
  const stat = typeof scaling.stat === 'string' ? scaling.stat.trim().toUpperCase() : '';
  if (!stat) return 0;
  const divisor = Math.max(1, Math.trunc(Number(scaling.divisor) || 1));
  const statValue = Number(unit?.stats?.[stat]) || 0;
  return Math.floor(statValue / divisor);
}

function hasWeaponArtActivation(mods) {
  if (mods?.weaponArt) return true;
  if (!Array.isArray(mods?.activated)) return false;
  return mods.activated.some((entry) => entry?.id === 'weapon_art');
}

function normalizeCombatMods(mods) {
  if (!mods || typeof mods !== 'object') return null;
  return {
    hitBonus: Number(mods.hitBonus) || 0,
    avoidBonus: Number(mods.avoidBonus) || 0,
    critBonus: Number(mods.critBonus) || 0,
    atkBonus: Number(mods.atkBonus) || 0,
    defBonus: Number(mods.defBonus) || 0,
    spdBonus: Number(mods.spdBonus) || 0,
    statScaling: normalizeCombatStatScaling(mods.statScaling),
    preventCounter: Boolean(mods.preventCounter),
    targetsRES: Boolean(mods.targetsRES),
    effectiveness: normalizeCombatEffectiveness(mods.effectiveness),
    rangeBonus: Math.trunc(Number(mods.rangeBonus) || 0),
    rangeOverride: normalizeCombatRangeOverride(mods.rangeOverride),
    halfPhysicalDamage: Boolean(mods.halfPhysicalDamage),
    vengeance: Boolean(mods.vengeance),
    weaponArt: Boolean(mods.weaponArt),
    ignoreTerrainAvoid: Boolean(mods.ignoreTerrainAvoid),
    vantage: Boolean(mods.vantage),
    quickRiposte: Boolean(mods.quickRiposte),
    desperation: Boolean(mods.desperation),
    activated: Array.isArray(mods.activated) ? [...mods.activated] : [],
  };
}

export function mergeCombatMods(baseMods, extraMods) {
  const base = normalizeCombatMods(baseMods);
  const extra = normalizeCombatMods(extraMods);
  if (!base && !extra) return null;
  if (!base) return extra;
  if (!extra) return base;

  return {
    hitBonus: base.hitBonus + extra.hitBonus,
    avoidBonus: base.avoidBonus + extra.avoidBonus,
    critBonus: base.critBonus + extra.critBonus,
    atkBonus: base.atkBonus + extra.atkBonus,
    defBonus: base.defBonus + extra.defBonus,
    spdBonus: base.spdBonus + extra.spdBonus,
    statScaling: base.statScaling || extra.statScaling,
    preventCounter: base.preventCounter || extra.preventCounter,
    targetsRES: base.targetsRES || extra.targetsRES,
    effectiveness: mergeCombatEffectiveness(base.effectiveness, extra.effectiveness),
    rangeBonus: base.rangeBonus + extra.rangeBonus,
    rangeOverride: extra.rangeOverride || base.rangeOverride,
    halfPhysicalDamage: base.halfPhysicalDamage || extra.halfPhysicalDamage,
    vengeance: base.vengeance || extra.vengeance,
    weaponArt: base.weaponArt || extra.weaponArt,
    ignoreTerrainAvoid: base.ignoreTerrainAvoid || extra.ignoreTerrainAvoid,
    vantage: base.vantage || extra.vantage,
    quickRiposte: base.quickRiposte || extra.quickRiposte,
    desperation: base.desperation || extra.desperation,
    activated: [...base.activated, ...extra.activated],
  };
}

export function isPhysical(weapon) {
  return PHYSICAL_TYPES.has(weapon.type);
}

export function isMagical(weapon) {
  return MAGICAL_TYPES.has(weapon.type);
}

export function isStaff(weapon) {
  return weapon.type === 'Staff';
}

/** Check weapon effectiveness vs defender's moveType. Returns multiplier (1 if none). */
export function getEffectivenessMultiplier(weapon, defender) {
  // Check if defender's accessory negates effectiveness
  if (defender.accessory?.combatEffects?.negateEffectiveness) return 1;
  // Global rule: all bows are effective against fliers
  if (weapon?.type === 'Bow' && defender.moveType === 'Flying') return 3;
  if (!weapon?.special) return 1;
  const match = weapon.special.match(/Effective vs (\w+)\s*\((\d+)x\)/i);
  if (!match) return 1;
  return defender.moveType === match[1] ? parseInt(match[2], 10) : 1;
}

/** Parse weapon stat bonuses from special string (e.g. "+5 DEF when equipped", "+5 DEF, +5 RES when equipped"). */
export function getWeaponStatBonuses(weapon) {
  if (!weapon?.special) return [];
  if (!weapon.special.includes('when equipped')) return [];
  const bonuses = [];
  const regex = /\+(\d+)\s+(STR|MAG|SKL|SPD|DEF|RES|LCK)/gi;
  let match;
  while ((match = regex.exec(weapon.special)) !== null) {
    bonuses.push({ stat: match[2].toUpperCase(), value: parseInt(match[1], 10) });
  }
  return bonuses;
}

/** True if weapon uses MAG stat for damage (tomes, light magic, or magic swords). */
export function usesMagic(weapon) {
  return isMagical(weapon) || (weapon.special?.includes('Magic sword') ?? false);
}

/** Sum a specific stat bonus from weapon bonus array. */
function sumWeaponBonus(bonuses, stat) {
  return bonuses.reduce((sum, b) => sum + (b.stat === stat ? b.value : 0), 0);
}

/** Check if weapon has Sunder effect (halves target DEF). */
export function hasSunderEffect(weapon) {
  return weapon?.special?.includes('Halves target DEF') ?? false;
}

/** Parse poison damage from weapon special (e.g. "Poison: target loses 5 HP after combat"). */
function parsePoisonDamage(weapon) {
  if (!weapon?.special) return 0;
  const match = weapon.special.match(/Poison: target loses (\d+) HP after combat/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Calculate effective weight penalty from weapon weight and unit STR.
 * Formula: effectiveWeight = max(0, weapon.weight - floor(STR / 5))
 * Every 5 STR negates 1 weapon weight.
 */
export function calculateEffectiveWeight(weapon, unit) {
  if (!weapon?.weight) return 0;
  const strReduction = Math.floor(unit.stats.STR / 5);
  return Math.max(0, weapon.weight - strReduction);
}

/**
 * Calculate effective Attack Speed (AS).
 * Formula: SPD - effectiveWeight + weaponBonus + additionalBonus (skills/accessories)
 */
export function calculateEffectiveSpeed(unit, weapon, additionalSpdBonus = 0) {
  if (!weapon || isStaff(weapon)) return unit.stats.SPD + additionalSpdBonus;
  
  const weight = calculateEffectiveWeight(weapon, unit);
  const wpnBonuses = getWeaponStatBonuses(weapon);
  const wpnSpdBonus = sumWeaponBonus(wpnBonuses, 'SPD');
  
  return unit.stats.SPD - weight + wpnSpdBonus + additionalSpdBonus;
}

/**
 * Calculate basic combat stats for a unit without an opponent.
 * Used for status screens and inventory previews.
 */
export function getStaticCombatStats(unit, weapon) {
  if (!weapon || isStaff(weapon)) {
    return { atk: 0, as: unit.stats.SPD, hit: 0, crit: 0, weight: 0 };
  }

  const atk = calculateAttack(unit, weapon);
  const weight = calculateEffectiveWeight(weapon, unit);
  const as = calculateEffectiveSpeed(unit, weapon);

  // Static Hit/Crit (standard formulas without defender avoid/luck)
  const hit = weapon.hit + (unit.stats.SKL * 2) + unit.stats.LCK;
  const crit = Math.floor(unit.stats.SKL / 2) + weapon.crit;

  return { atk, as, hit, crit, weight };
}

// --- Healing ---

/**
 * Calculate how much HP a staff heals, clamped to missing HP.
 * Uses MAG-based formula: healer.stats.MAG + staff.healBase.
 */
export function calculateHealAmount(staff, healer, target) {
  const healBase = staff.healBase ?? 0;
  const healAmount = healer.stats.MAG + healBase;
  const missingHP = target.stats.HP - target.currentHP;
  return Math.min(healAmount, missingHP);
}

/**
 * Resolve a heal action (pure — mutates nothing).
 * Returns { healAmount, targetHPAfter }.
 */
export function resolveHeal(staff, healer, target) {
  const healAmount = calculateHealAmount(staff, healer, target);
  return {
    healAmount,
    targetHPAfter: target.currentHP + healAmount,
  };
}

// --- Staff uses ---

/** Count bonus uses from MAG thresholds (8→+1, 14→+2, 20→+3). */
export function calculateBonusUses(mag) {
  return STAFF_BONUS_USE_THRESHOLDS.filter(t => mag >= t).length;
}

/** Total max uses for a staff given the healer's MAG. */
export function getStaffMaxUses(staff, healer) {
  const base = staff.uses ?? 0;
  return base + calculateBonusUses(healer.stats.MAG);
}

/** Remaining uses for a staff given uses spent. */
export function getStaffRemainingUses(staff, healer) {
  const spent = staff._usesSpent || 0;
  return Math.max(0, getStaffMaxUses(staff, healer) - spent);
}

/** Spend one use of a staff (mutates staff). */
export function spendStaffUse(staff) {
  staff._usesSpent = (staff._usesSpent || 0) + 1;
}

// --- Per-battle weapon uses (e.g. Bolting) ---

/** Total max uses for a per-battle-use weapon given the user's MAG. */
export function getPerBattleMaxUses(weapon, unit) {
  const base = weapon.uses ?? 0;
  return base + calculateBonusUses(unit.stats.MAG);
}

/** Remaining uses for a per-battle-use weapon. */
export function getPerBattleRemainingUses(weapon, unit) {
  const spent = weapon._usesSpent || 0;
  return Math.max(0, getPerBattleMaxUses(weapon, unit) - spent);
}

/** Spend one use of a per-battle weapon (mutates weapon). */
export function spendPerBattleUse(weapon) {
  weapon._usesSpent = (weapon._usesSpent || 0) + 1;
}

// --- Staff range ---

/** Get effective range for a staff, accounting for MAG-based range bonuses (Physic). */
export function getEffectiveStaffRange(staff, healer) {
  const baseRange = parseRange(staff.range);
  if (!staff.rangeBonuses) return baseRange;
  const bonus = staff.rangeBonuses.reduce(
    (sum, rb) => sum + (healer.stats.MAG >= rb.mag ? rb.bonus : 0), 0
  );
  return { min: baseRange.min, max: baseRange.max + bonus };
}

// --- Range helpers ---

/** Parse "1", "1-2", "2-3" → { min, max }. "1-ALL" treated as { min:1, max:99 }. */
export function parseRange(rangeStr) {
  if (rangeStr.includes('ALL')) return { min: 1, max: 99 };
  if (rangeStr.includes('-')) {
    const [min, max] = rangeStr.split('-').map(Number);
    return { min, max };
  }
  const val = parseInt(rangeStr, 10);
  return { min: val, max: val };
}

export function isInRange(weapon, distance) {
  const { min, max } = parseRange(weapon.range);
  return distance >= min && distance <= max;
}

/** Manhattan distance between two grid positions */
export function gridDistance(col1, row1, col2, row2) {
  return Math.abs(col1 - col2) + Math.abs(row1 - row2);
}

// --- Weapon Triangle ---

/**
 * Returns { hit, damage } modifiers for attacker's weapon vs defender's weapon.
 * Sword > Axe > Lance > Sword. Bow/Tome/Light/Staff are neutral.
 * weaponRank: "Prof" | "Mast" — mastery improves advantage, softens disadvantage.
 */
export function getWeaponTriangleBonus(attackerWeapon, defenderWeapon, weaponRank = 'Prof') {
  const { matchups } = WEAPON_TRIANGLE;
  const atkType = attackerWeapon.type;
  const defType = defenderWeapon.type;

  // Both must be triangle types (Sword/Lance/Axe)
  if (!matchups[atkType] || !matchups[defType]) {
    return { hit: 0, damage: 0 };
  }

  const mastery = weaponRank === 'Mast';
  const atkReaver = attackerWeapon.special?.includes('Reverses weapon triangle') ?? false;

  let result = { hit: 0, damage: 0 };

  // Attacker has advantage
  if (matchups[atkType] === defType) {
    result = mastery
      ? { ...WEAPON_TRIANGLE.masteryAdvantage }
      : { ...WEAPON_TRIANGLE.advantage };
  }

  // Attacker has disadvantage
  if (matchups[defType] === atkType) {
    result = mastery
      ? { ...WEAPON_TRIANGLE.masteryDisadvantage }
      : { ...WEAPON_TRIANGLE.disadvantage };
  }

  // Reaver: swap advantage ↔ disadvantage
  if (atkReaver && (result.hit !== 0 || result.damage !== 0)) {
    if (result.hit < 0) {
      // Was disadvantage → become advantage
      result = mastery
        ? { ...WEAPON_TRIANGLE.masteryAdvantage }
        : { ...WEAPON_TRIANGLE.advantage };
    } else if (result.hit > 0) {
      // Was advantage → become disadvantage
      result = mastery
        ? { ...WEAPON_TRIANGLE.masteryDisadvantage }
        : { ...WEAPON_TRIANGLE.disadvantage };
    }
  }

  // Triangle ignore: clamp negative results to 0
  if (attackerWeapon.special?.includes('Ignores weapon triangle disadvantage')) {
    result.hit = Math.max(0, result.hit);
    result.damage = Math.max(0, result.damage);
  }

  return result;
}

// --- Core stat calculations ---

/** Attack power = relevant stat + weapon might (×effectiveness) + triangle damage bonus */
export function calculateAttack(
  unit,
  weapon,
  triangleBonus = { damage: 0 },
  defender = null,
  isInitiating = true,
  effectivenessMultiplier = null
) {
  const stat = usesMagic(weapon) ? unit.stats.MAG : unit.stats.STR;
  const normalizedEffMult = (effectivenessMultiplier !== null && effectivenessMultiplier !== undefined
    && Number.isFinite(Number(effectivenessMultiplier)))
    ? Math.max(1, Number(effectivenessMultiplier))
    : null;
  const effMult = normalizedEffMult ?? (defender ? getEffectivenessMultiplier(weapon, defender) : 1);
  // Gae Bolg: +5 STR when counterattacking (defending)
  let bonus = 0;
  if (!isInitiating && weapon?.special?.includes('+5 STR when counterattacking')) {
    bonus = 5;
  }
  return stat + bonus + (weapon.might * effMult) + triangleBonus.damage;
}

/** Defense against an incoming weapon (DEF for physical, RES for magical/magic sword). */
export function calculateDefense(unit, incomingWeapon) {
  return usesMagic(incomingWeapon) ? unit.stats.RES : unit.stats.DEF;
}

/** Avoid = SPD×2 + LCK + terrain avoid bonus */
export function calculateAvoid(unit, terrain) {
  const terrainAvoid = parseInt(terrain?.avoidBonus, 10) || 0;
  return (unit.stats.SPD * 2) + unit.stats.LCK + terrainAvoid;
}

/** Hit rate, clamped [0, 100] */
export function calculateHitRate(attacker, weapon, defender, defenderTerrain, triangleBonus = { hit: 0 }) {
  const rawHit = weapon.hit + (attacker.stats.SKL * 2) + attacker.stats.LCK + triangleBonus.hit;
  const avoid = calculateAvoid(defender, defenderTerrain);
  return Math.max(0, Math.min(100, rawHit - avoid));
}

/** Crit rate, clamped [0, 100] */
export function calculateCritRate(attacker, weapon, defender) {
  const rawCrit = Math.floor(attacker.stats.SKL / 2) + weapon.crit;
  return Math.max(0, Math.min(100, rawCrit - defender.stats.LCK));
}

/** Raw damage (before crit), minimum 0. Includes terrain DEF bonus + weapon effectiveness. */
export function calculateDamage(
  attacker,
  atkWeapon,
  defender,
  defWeapon,
  defenderTerrain,
  isInitiating = true,
  options = null
) {
  const triangle = defWeapon
    ? getWeaponTriangleBonus(atkWeapon, defWeapon, attacker.weaponRank)
    : { hit: 0, damage: 0 };
  const targetsRES = Boolean(options?.targetsRES);
  const effectivenessMultiplier = Number(options?.effectivenessMultiplier);
  const atk = calculateAttack(
    attacker,
    atkWeapon,
    triangle,
    defender,
    isInitiating,
    Number.isFinite(effectivenessMultiplier) ? effectivenessMultiplier : null
  );
  let def = targetsRES
    ? (Number(defender?.stats?.RES) || 0)
    : calculateDefense(defender, atkWeapon);
  if (!targetsRES && hasSunderEffect(atkWeapon)) {
    def = Math.floor(def / 2);
  }
  const terrainDef = parseInt(defenderTerrain?.defBonus, 10) || 0;
  const result = Math.max(0, atk - def - terrainDef);
  if (IS_DEV && Number.isNaN(result)) {
    console.warn('[Combat] NaN damage:', { attacker: attacker?.name, weapon: atkWeapon?.name });
  }
  return result;
}

/** True if attacker is fast enough to strike twice (after weight penalty) */
export function canDouble(attacker, defender, atkWeapon, defWeapon) {
  const atkEffectiveSpd = calculateEffectiveSpeed(attacker, atkWeapon);
  const defEffectiveSpd = calculateEffectiveSpeed(defender, defWeapon);
  return atkEffectiveSpd >= defEffectiveSpd + DOUBLE_ATTACK_SPD_THRESHOLD;
}

/** True if defender can counter-attack at this distance */
export function canCounter(defender, defenderWeapon, distance) {
  if (!defenderWeapon || isStaff(defenderWeapon)) return false;
  return isInRange(defenderWeapon, distance);
}

// --- Combat Forecast (deterministic preview for UI) ---

/**
 * Returns what WOULD happen — no RNG, just the numbers.
 * Used by StatPanel/HUD to show combat preview before the player commits.
 *
 * skillCtx (optional): { atkMods, defMods } from SkillSystem.getSkillCombatMods().
 *   Each has: { hitBonus, avoidBonus, critBonus, atkBonus, defBonus, statScaling, preventCounter, targetsRES, effectiveness, rangeBonus, rangeOverride, halfPhysicalDamage, vengeance, ignoreTerrainAvoid, vantage, activated }
 */
export function getCombatForecast(
  attacker, atkWeapon,
  defender, defWeapon,
  distance, atkTerrain, defTerrain,
  skillCtx = null
) {
  // Safety: if attacker has no valid weapon, return zeroed forecast
  if (!atkWeapon || isStaff(atkWeapon)) {
    return {
      attacker: {
        name: attacker.name, hp: attacker.currentHP ?? attacker.stats.HP,
        damage: 0, hit: 0, crit: 0, doubles: false, brave: false, attackCount: 0, skills: [],
      },
      defender: {
        name: defender.name, hp: defender.currentHP ?? defender.stats.HP,
        canCounter: false, damage: 0, hit: 0, crit: 0, doubles: false, brave: false, attackCount: 0, skills: [],
      },
    };
  }

  const atkMods = mergeCombatMods(skillCtx?.atkMods, skillCtx?.atkWeaponArtMods);
  const defMods = mergeCombatMods(skillCtx?.defMods, skillCtx?.defWeaponArtMods);

  const atkTriangle = defWeapon
    ? getWeaponTriangleBonus(atkWeapon, defWeapon, attacker.weaponRank)
    : { hit: 0, damage: 0 };

  // Weapon stat bonuses (e.g. Ragnarok +5 DEF, Stormbreaker +5 DEF +5 RES)
  // Pick the relevant defensive bonus based on incoming weapon type
  const fDefWpnBonuses = defWeapon ? getWeaponStatBonuses(defWeapon) : [];
  const fAtkWpnBonuses = getWeaponStatBonuses(atkWeapon);
  const fDefWpnDef = sumWeaponBonus(fDefWpnBonuses, usesMagic(atkWeapon) ? 'RES' : 'DEF');
  const fAtkWpnDef = defWeapon ? sumWeaponBonus(fAtkWpnBonuses, usesMagic(defWeapon) ? 'RES' : 'DEF') : 0;

  // Attacker stats (skill mods applied as flat adjustments)
  const defTerrainForAtkHit = (atkMods?.ignoreTerrainAvoid) ? null : defTerrain;
  const atkEffectiveness = getCombinedEffectivenessMultiplier(atkWeapon, defender, atkMods);
  let atkDmg = calculateDamage(attacker, atkWeapon, defender, defWeapon, defTerrain, true, {
    targetsRES: atkMods?.targetsRES,
    effectivenessMultiplier: atkEffectiveness,
  })
    + (atkMods?.atkBonus || 0) - (defMods?.defBonus || 0) - fDefWpnDef;
  atkDmg += getCombatStatScalingBonus(attacker, atkMods);
  if (atkMods?.vengeance) atkDmg += getMissingHp(attacker);
  if (defMods?.halfPhysicalDamage && isPhysical(atkWeapon)) atkDmg = Math.floor(atkDmg / 2);
  atkDmg = Math.max(0, atkDmg);
  let atkHit = calculateHitRate(attacker, atkWeapon, defender, defTerrainForAtkHit, atkTriangle)
    + (atkMods?.hitBonus || 0) - (defMods?.avoidBonus || 0);
  atkHit = Math.max(0, Math.min(100, atkHit));
  let atkCrit = calculateCritRate(attacker, atkWeapon, defender)
    + (atkMods?.critBonus || 0);
  atkCrit = Math.max(0, Math.min(100, atkCrit));

  // Doubling with accessory + skill + weight modifiers
  const fAtkPursuit = attacker.accessory?.combatEffects?.doubleThresholdReduction || 0;
  const fDefPursuit = defender.accessory?.combatEffects?.doubleThresholdReduction || 0;
  const fAtkPrevent = attacker.accessory?.combatEffects?.preventEnemyDouble || false;
  const fDefPrevent = defender.accessory?.combatEffects?.preventEnemyDouble || false;
  const atkSpdBonus = atkMods?.spdBonus || 0;
  const defSpdBonus = defMods?.spdBonus || 0;

  const atkEffectiveSpd = calculateEffectiveSpeed(attacker, atkWeapon, atkSpdBonus);
  const defEffectiveSpd = calculateEffectiveSpeed(defender, defWeapon, defSpdBonus);

  const atkArtActive = hasWeaponArtActivation(atkMods);
  const atkDoubles = !atkArtActive && !fDefPrevent && (
    atkEffectiveSpd >= defEffectiveSpd + DOUBLE_ATTACK_SPD_THRESHOLD - fAtkPursuit
  );
  const atkBrave = atkWeapon.special?.includes('twice consecutively') ?? false;
  const atkCount = (atkBrave ? 2 : 1) * (atkDoubles ? 2 : 1);

  const defCanCounter = !atkMods?.preventCounter && canCounter(defender, defWeapon, distance);
  let defDmg = 0, defHit = 0, defCrit = 0, defDoubles = false, defBrave = false, defCount = 0;

  if (defCanCounter) {
    const defTriangle = getWeaponTriangleBonus(defWeapon, atkWeapon, defender.weaponRank);
    const atkTerrainForDefHit = (defMods?.ignoreTerrainAvoid) ? null : atkTerrain;
    const defEffectiveness = getCombinedEffectivenessMultiplier(defWeapon, attacker, defMods);
    defDmg = calculateDamage(defender, defWeapon, attacker, atkWeapon, atkTerrain, false, {
      targetsRES: defMods?.targetsRES,
      effectivenessMultiplier: defEffectiveness,
    })
      + (defMods?.atkBonus || 0) - (atkMods?.defBonus || 0) - fAtkWpnDef;
    defDmg += getCombatStatScalingBonus(defender, defMods);
    if (defMods?.vengeance) defDmg += getMissingHp(defender);
    if (atkMods?.halfPhysicalDamage && isPhysical(defWeapon)) defDmg = Math.floor(defDmg / 2);
    defDmg = Math.max(0, defDmg);
    defHit = calculateHitRate(defender, defWeapon, attacker, atkTerrainForDefHit, defTriangle)
      + (defMods?.hitBonus || 0) - (atkMods?.avoidBonus || 0);
    defHit = Math.max(0, Math.min(100, defHit));
    defCrit = calculateCritRate(defender, defWeapon, attacker)
      + (defMods?.critBonus || 0);
    defCrit = Math.max(0, Math.min(100, defCrit));
    // Quick Riposte: always double when defending above 50% HP
    const defArtActive = hasWeaponArtActivation(defMods);
    defDoubles = (defMods?.quickRiposte) || (!defArtActive && !fAtkPrevent && (
      defEffectiveSpd >= atkEffectiveSpd + DOUBLE_ATTACK_SPD_THRESHOLD - fDefPursuit
    ));
    defBrave = defWeapon.special?.includes('twice consecutively') ?? false;
    defCount = (defBrave ? 2 : 1) * (defDoubles ? 2 : 1);
  }

  // Collect activated skills for UI display
  const atkActivated = atkMods?.activated || [];
  const defActivated = defMods?.activated || [];
  const atkWarnings = [];
  const defWarnings = [];

  if (Array.isArray(defender.affixes)) {
    if (defender.affixes.includes('shielded') && !defender._hitByPlayerThisPhase) atkWarnings.push('Shielded');
    if (defender.affixes.includes('thorns') && distance === 1 && atkDmg > 0) atkWarnings.push('Thorns');
    if (defender.affixes.includes('teleporter') && atkDmg > 0) atkWarnings.push('Teleporter');
  }
  if (Array.isArray(attacker.affixes)) {
    if (attacker.affixes.includes('shielded') && !attacker._hitByPlayerThisPhase) defWarnings.push('Shielded');
    if (attacker.affixes.includes('thorns') && distance === 1 && defDmg > 0) defWarnings.push('Thorns');
    if (attacker.affixes.includes('teleporter') && defDmg > 0) defWarnings.push('Teleporter');
  }

  const forecast = {
    attacker: {
      name: attacker.name, hp: attacker.currentHP ?? attacker.stats.HP,
      damage: atkDmg, hit: atkHit, crit: atkCrit,
      as: atkEffectiveSpd,
      doubles: atkDoubles, brave: atkBrave, attackCount: atkCount,
      skills: atkActivated,
      warnings: atkWarnings,
    },
    defender: {
      name: defender.name, hp: defender.currentHP ?? defender.stats.HP,
      canCounter: defCanCounter,
      damage: defDmg, hit: defHit, crit: defCrit,
      as: defEffectiveSpd,
      doubles: defDoubles, brave: defBrave, attackCount: defCount,
      skills: defActivated,
      warnings: defWarnings,
    },
  };

  if (IS_DEV) {
    for (const side of [forecast.attacker, forecast.defender]) {
      for (const [k, v] of Object.entries(side)) {
        if (typeof v === 'number' && Number.isNaN(v)) {
          console.warn(`[Combat] NaN forecast.${k}:`, { unit: side.name });
        }
      }
    }
  }

  return forecast;
}

// --- Combat Resolution (RNG rolls → event log) ---

/**
 * Roll a single strike. Returns an event object for the animation system.
 * strikeSkills (optional): { striker, target, rollStrikeSkills, skillsData }
 *   — for per-hit effects like Sol, Luna, Lethality.
 */
function rollStrike(strikerName, targetName, hit, damage, critRate, targetHP, strikeSkills, weaponSpecial) {
  const hitRoll = Math.random() * 100;
  if (hitRoll >= hit) {
    return { type: 'strike', attacker: strikerName, target: targetName, miss: true, damage: 0, isCrit: false, targetHPAfter: targetHP, skillActivations: [], extraStrike: false };
  }

  const isCrit = Math.random() * 100 < critRate;
  let finalDmg = isCrit ? damage * CRIT_MULTIPLIER : damage;
  let heal = 0;
  let extraStrike = false;
  let aetherLuna = false;
  let commandersGambit = false;
  let reflectDamage = 0;
  let warpRange = 0;
  const skillActivations = [];

  // Per-strike skill effects (only on hit)
  if (strikeSkills?.rollStrikeSkills) {
    const skillResult = strikeSkills.rollStrikeSkills(
      strikeSkills.striker, finalDmg, strikeSkills.target, strikeSkills.skillsData
    );
    if (skillResult.commandersGambit) commandersGambit = true;
    if (skillResult.aetherLuna) aetherLuna = true;
    if (skillResult.lethal) {
      finalDmg = targetHP; // instant kill
      skillActivations.push(...skillResult.activated);
    } else if (skillResult.modifiedDamage !== finalDmg) {
      finalDmg = skillResult.modifiedDamage;
      skillActivations.push(...skillResult.activated);
    }
    if (skillResult.heal > 0) {
      heal = skillResult.heal;
      // Only add Sol activation if not already in list
      if (!skillActivations.some(a => a.id === 'sol')) {
        skillActivations.push(...skillResult.activated);
      }
    }
    if (skillResult.extraStrike) {
      extraStrike = true;
    }
  }

  // On-defend skills (Pavise, Aegis, Miracle)
  if (strikeSkills?.rollDefenseSkills && finalDmg > 0) {
    const isPhysicalAtk = strikeSkills.strikerWeaponPhysical;
    const defResult = strikeSkills.rollDefenseSkills(
      strikeSkills.target, finalDmg, isPhysicalAtk, strikeSkills.skillsData
    );
    if (defResult.modifiedDamage !== finalDmg) {
      finalDmg = defResult.modifiedDamage;
      skillActivations.push(...defResult.activated);
    }
    if (defResult.miracleTriggered) {
      skillActivations.push(...defResult.activated.filter(a => a.id === 'miracle' && !skillActivations.some(s => s.id === 'miracle')));
    }
  }

  // On-defend affixes (Shielded, Teleporter, Thorns)
  if (strikeSkills?.rollDefenseAffixes && finalDmg >= 0) {
    const defResult = strikeSkills.rollDefenseAffixes(
      strikeSkills.target, finalDmg, strikeSkills.isMelee, strikeSkills.isFirstHit, strikeSkills.affixData
    );
    if (defResult.modifiedDamage !== finalDmg) {
      finalDmg = defResult.modifiedDamage;
      skillActivations.push(...defResult.activated);
    }
    if (defResult.reflectDamage > 0) {
      reflectDamage = defResult.reflectDamage;
      skillActivations.push(...defResult.activated.filter(a => a.id === 'thorns' && !skillActivations.some(s => s.id === 'thorns')));
    }
    if (defResult.warpRange > 0) {
      warpRange = defResult.warpRange;
      skillActivations.push(...defResult.activated.filter(a => a.id === 'teleporter' && !skillActivations.some(s => s.id === 'teleporter')));
    }
  }

  // Drain HP (Runesword: heal equal to damage dealt)
  if (weaponSpecial?.includes('Drains HP') && finalDmg > 0) {
    heal = Math.min(finalDmg, targetHP); // Can't drain more than target has
  }

  const hpAfter = Math.max(0, targetHP - finalDmg);
  return {
    type: 'strike', attacker: strikerName, target: targetName,
    miss: false, damage: finalDmg, isCrit, targetHPAfter: hpAfter,
    heal, skillActivations, extraStrike, aetherLuna, commandersGambit,
    reflectDamage, warpRange,
  };
}

/**
 * Resolve full combat exchange. Returns { events[], attackerHP, defenderHP }.
 *
 * Attack order (GBA Fire Emblem style):
 *   1. Attacker strikes (×2 if brave weapon)
 *   2. Defender counters if in range (×2 if brave)
 *   3. Attacker follow-up if doubles (×2 if brave)
 *   4. Defender follow-up if doubles (×2 if brave)
 * Combat stops early when either combatant reaches 0 HP.
 *
 * skillCtx (optional): {
 *   atkMods, defMods — from SkillSystem.getSkillCombatMods()
 *   rollStrikeSkills — function(striker, dmg, target, skillsData)
 *   checkAstra — function(striker, skillsData)
 *   skillsData — full skills array
 * }
 */
export function resolveCombat(
  attacker, atkWeapon,
  defender, defWeapon,
  distance, atkTerrain, defTerrain,
  skillCtx = null
) {
  const events = [];
  let atkHP = attacker.currentHP ?? attacker.stats.HP;
  let defHP = defender.currentHP ?? defender.stats.HP;

  const atkMods = mergeCombatMods(skillCtx?.atkMods, skillCtx?.atkWeaponArtMods);
  const defMods = mergeCombatMods(skillCtx?.defMods, skillCtx?.defWeaponArtMods);

  // Weapon stat bonuses (e.g. Ragnarok +5 DEF, Stormbreaker +5 DEF +5 RES) — combat-time mods only
  // Pick the relevant defensive bonus based on incoming weapon type
  const atkWeaponBonuses = getWeaponStatBonuses(atkWeapon);
  const defWeaponBonuses = defWeapon ? getWeaponStatBonuses(defWeapon) : [];
  const defWeaponDefBonus = sumWeaponBonus(defWeaponBonuses, usesMagic(atkWeapon) ? 'RES' : 'DEF');
  const atkWeaponDefBonus = defWeapon ? sumWeaponBonus(atkWeaponBonuses, usesMagic(defWeapon) ? 'RES' : 'DEF') : 0;

  // Pre-compute all the static combat values (with skill mods applied)
  const atkTriangle = defWeapon
    ? getWeaponTriangleBonus(atkWeapon, defWeapon, attacker.weaponRank)
    : { hit: 0, damage: 0 };
  const defTriangle = defWeapon
    ? getWeaponTriangleBonus(defWeapon, atkWeapon, defender.weaponRank)
    : { hit: 0, damage: 0 };

  const defTerrainForAtkHit = (atkMods?.ignoreTerrainAvoid) ? null : defTerrain;
  const atkEffectiveness = getCombinedEffectivenessMultiplier(atkWeapon, defender, atkMods);
  let atkDmg = Math.max(0,
    calculateDamage(attacker, atkWeapon, defender, defWeapon, defTerrain, true, {
      targetsRES: atkMods?.targetsRES,
      effectivenessMultiplier: atkEffectiveness,
    })
    + (atkMods?.atkBonus || 0) - (defMods?.defBonus || 0) - defWeaponDefBonus);
  atkDmg += getCombatStatScalingBonus(attacker, atkMods);
  if (atkMods?.vengeance) atkDmg += getMissingHp(attacker);
  if (defMods?.halfPhysicalDamage && isPhysical(atkWeapon)) atkDmg = Math.floor(atkDmg / 2);
  atkDmg = Math.max(0, atkDmg);
  let atkHit = Math.max(0, Math.min(100,
    calculateHitRate(attacker, atkWeapon, defender, defTerrainForAtkHit, atkTriangle)
    + (atkMods?.hitBonus || 0) - (defMods?.avoidBonus || 0)));
  let atkCrit = Math.max(0, Math.min(100,
    calculateCritRate(attacker, atkWeapon, defender) + (atkMods?.critBonus || 0)));

  const defCanCounter = !atkMods?.preventCounter && canCounter(defender, defWeapon, distance);

  // Doubling: apply accessory + skill + weight modifiers
  const atkPursuitReduction = attacker.accessory?.combatEffects?.doubleThresholdReduction || 0;
  const defPursuitReduction = defender.accessory?.combatEffects?.doubleThresholdReduction || 0;
  const atkPreventDouble = attacker.accessory?.combatEffects?.preventEnemyDouble || false;
  const defPreventDouble = defender.accessory?.combatEffects?.preventEnemyDouble || false;
  const rAtkSpdBonus = atkMods?.spdBonus || 0;
  const rDefSpdBonus = defMods?.spdBonus || 0;

  // Use shared AS helper to keep combat resolution aligned with forecast/UI.
  const rAtkAs = calculateEffectiveSpeed(attacker, atkWeapon, rAtkSpdBonus);
  const rDefAs = calculateEffectiveSpeed(defender, defWeapon, rDefSpdBonus);

  const atkArtActive = hasWeaponArtActivation(atkMods);
  const atkDoubles = !atkArtActive && !defPreventDouble && (
    rAtkAs >= rDefAs + DOUBLE_ATTACK_SPD_THRESHOLD - atkPursuitReduction
  );
  const defArtActive = hasWeaponArtActivation(defMods);
  // Quick Riposte: always double when defending above 50% HP
  const defDoubles = defCanCounter && ((defMods?.quickRiposte) || (!defArtActive && !atkPreventDouble && (
    rDefAs >= rAtkAs + DOUBLE_ATTACK_SPD_THRESHOLD - defPursuitReduction
  )));

  const atkBrave = atkWeapon.special?.includes('twice consecutively') ?? false;
  const defBrave = defWeapon?.special?.includes('twice consecutively') ?? false;

  let defDmg = 0, defHit = 0, defCrit = 0;
  if (defCanCounter) {
    const atkTerrainForDefHit = (defMods?.ignoreTerrainAvoid) ? null : atkTerrain;
    const defEffectiveness = getCombinedEffectivenessMultiplier(defWeapon, attacker, defMods);
    defDmg = Math.max(0,
      calculateDamage(defender, defWeapon, attacker, atkWeapon, atkTerrain, false, {
        targetsRES: defMods?.targetsRES,
        effectivenessMultiplier: defEffectiveness,
      })
      + (defMods?.atkBonus || 0) - (atkMods?.defBonus || 0) - atkWeaponDefBonus);
    defDmg += getCombatStatScalingBonus(defender, defMods);
    if (defMods?.vengeance) defDmg += getMissingHp(defender);
    if (atkMods?.halfPhysicalDamage && isPhysical(defWeapon)) defDmg = Math.floor(defDmg / 2);
    defDmg = Math.max(0, defDmg);
    defHit = Math.max(0, Math.min(100,
      calculateHitRate(defender, defWeapon, attacker, atkTerrainForDefHit, defTriangle)
      + (defMods?.hitBonus || 0) - (atkMods?.avoidBonus || 0)));
    defCrit = Math.max(0, Math.min(100,
      calculateCritRate(defender, defWeapon, attacker) + (defMods?.critBonus || 0)));
  }

  // Build per-strike skill context for attacker and defender
  const isMelee = distance === 1;
  const atkStrikeSkills = skillCtx?.rollStrikeSkills ? {
    striker: attacker, target: defender,
    rollStrikeSkills: skillCtx.rollStrikeSkills,
    rollDefenseSkills: skillCtx.rollDefenseSkills || null,
    rollDefenseAffixes: skillCtx.rollDefenseAffixes || null,
    affixData: skillCtx.affixData || null,
    strikerWeaponPhysical: isPhysical(atkWeapon),
    isFirstHit: !defender._hitByPlayerThisPhase,
    isMelee,
    skillsData: skillCtx.skillsData,
  } : null;
  const defStrikeSkills = (skillCtx?.rollStrikeSkills && defCanCounter) ? {
    striker: defender, target: attacker,
    rollStrikeSkills: skillCtx.rollStrikeSkills,
    rollDefenseSkills: skillCtx.rollDefenseSkills || null,
    rollDefenseAffixes: skillCtx.rollDefenseAffixes || null,
    affixData: skillCtx.affixData || null,
    strikerWeaponPhysical: defWeapon ? isPhysical(defWeapon) : true,
    isFirstHit: false, // Player doesn't have Shielded usually, but keeping consistent
    isMelee,
    skillsData: skillCtx.skillsData,
  } : null;

  // Track Cancel follow-up negation
  let cancelledAtkFollowUp = false;
  let cancelledDefFollowUp = false;

  // Execute N strikes from one combatant against the other
  function strike(aName, tName, hit, dmg, crit, isAttackingDefender, count, strikeSkills, weaponSpecial) {
    for (let i = 0; i < count && atkHP > 0 && defHP > 0; i++) {
      const targetHP = isAttackingDefender ? defHP : atkHP;
      const evt = rollStrike(aName, tName, hit, dmg, crit, targetHP, strikeSkills, weaponSpecial);
      if (isAttackingDefender) {
        defHP = evt.targetHPAfter;
        // Sol/Drain heal: striker heals HP
        if (evt.heal > 0) {
          atkHP = Math.min(attacker.stats.HP, atkHP + evt.heal);
          evt.strikerHealTo = atkHP;
        }
      } else {
        atkHP = evt.targetHPAfter;
        if (evt.heal > 0) {
          defHP = Math.min(defender.stats.HP, defHP + evt.heal);
          evt.strikerHealTo = defHP;
        }
      }
      events.push(evt);

      // Update first-hit flag for Shielded consumption
      if (!evt.miss && strikeSkills) {
        strikeSkills.isFirstHit = false;
      }

      // Check Cancel on defend (negates opponent's follow-up)
      if (!evt.miss && evt.skillActivations) {
        for (const sa of evt.skillActivations) {
          if (sa.id === 'cancel') {
            if (isAttackingDefender) cancelledAtkFollowUp = true; // defender cancelled attacker's follow-up
            else cancelledDefFollowUp = true; // attacker cancelled defender's follow-up
          }
        }
      }

      // Adept/Aether: extra strike at full damage (one bonus strike per hit)
      if (evt.extraStrike && atkHP > 0 && defHP > 0) {
        // Aether Luna: bonus strike at 1.5x damage
        const bonusDmg = evt.aetherLuna ? Math.floor(dmg * 1.5) : dmg;
        const bonusTargetHP = isAttackingDefender ? defHP : atkHP;
        const bonusEvt = rollStrike(aName, tName, hit, bonusDmg, crit, bonusTargetHP, null, weaponSpecial);
        bonusEvt.adeptStrike = true;
        if (isAttackingDefender) {
          defHP = bonusEvt.targetHPAfter;
          if (bonusEvt.heal > 0) {
            atkHP = Math.min(attacker.stats.HP, atkHP + bonusEvt.heal);
            bonusEvt.strikerHealTo = atkHP;
          }
        } else {
          atkHP = bonusEvt.targetHPAfter;
          if (bonusEvt.heal > 0) {
            defHP = Math.min(defender.stats.HP, defHP + bonusEvt.heal);
            bonusEvt.strikerHealTo = defHP;
          }
        }
        events.push(bonusEvt);
      }
    }
  }

  // Check Astra for attacker (replaces normal strike count with 5 at half dmg)
  function strikePhase(aName, tName, hit, dmg, crit, isAtkDef, braveCount, strikeSkills, unit, weapon) {
    let count = braveCount;
    let phaseDmg = dmg;
    if (skillCtx?.checkAstra) {
      const astra = skillCtx.checkAstra(unit, skillCtx.skillsData);
      if (astra.triggered) {
        count = astra.strikeCount;
        phaseDmg = Math.max(1, Math.floor(dmg * astra.damageMult));
        events.push({ type: 'skill', name: astra.name, unit: aName });
      }
    }
    strike(aName, tName, hit, phaseDmg, crit, isAtkDef, count, strikeSkills, weapon?.special || '');
  }

  // Determine phase order — Vantage, Desperation modify order
  const defenderVantage = defCanCounter && (defMods?.vantage || false);
  const attackerDesperation = atkMods?.desperation || false;

  if (defenderVantage) {
    // Vantage: defender strikes first
    events.push({ type: 'skill', name: 'Vantage', unit: defender.name });
    strikePhase(defender.name, attacker.name, defHit, defDmg, defCrit, false, defBrave ? 2 : 1, defStrikeSkills, defender, defWeapon);
    strikePhase(attacker.name, defender.name, atkHit, atkDmg, atkCrit, true, atkBrave ? 2 : 1, atkStrikeSkills, attacker, atkWeapon);
    if (defDoubles && !cancelledDefFollowUp) strikePhase(defender.name, attacker.name, defHit, defDmg, defCrit, false, defBrave ? 2 : 1, defStrikeSkills, defender, defWeapon);
    if (atkDoubles && !cancelledAtkFollowUp) strikePhase(attacker.name, defender.name, atkHit, atkDmg, atkCrit, true, atkBrave ? 2 : 1, atkStrikeSkills, attacker, atkWeapon);
  } else if (attackerDesperation && atkDoubles) {
    // Desperation: all attacker hits before defender responds
    events.push({ type: 'skill', name: 'Desperation', unit: attacker.name });
    strikePhase(attacker.name, defender.name, atkHit, atkDmg, atkCrit, true, atkBrave ? 2 : 1, atkStrikeSkills, attacker, atkWeapon);
    if (!cancelledAtkFollowUp) strikePhase(attacker.name, defender.name, atkHit, atkDmg, atkCrit, true, atkBrave ? 2 : 1, atkStrikeSkills, attacker, atkWeapon);
    if (defCanCounter) {
      strikePhase(defender.name, attacker.name, defHit, defDmg, defCrit, false, defBrave ? 2 : 1, defStrikeSkills, defender, defWeapon);
    }
    if (defDoubles && !cancelledDefFollowUp) strikePhase(defender.name, attacker.name, defHit, defDmg, defCrit, false, defBrave ? 2 : 1, defStrikeSkills, defender, defWeapon);
  } else {
    // Normal order
    strikePhase(attacker.name, defender.name, atkHit, atkDmg, atkCrit, true, atkBrave ? 2 : 1, atkStrikeSkills, attacker, atkWeapon);
    if (defCanCounter) {
      strikePhase(defender.name, attacker.name, defHit, defDmg, defCrit, false, defBrave ? 2 : 1, defStrikeSkills, defender, defWeapon);
    }
    if (atkDoubles && !cancelledAtkFollowUp) strikePhase(attacker.name, defender.name, atkHit, atkDmg, atkCrit, true, atkBrave ? 2 : 1, atkStrikeSkills, attacker, atkWeapon);
    if (defDoubles && !cancelledDefFollowUp) strikePhase(defender.name, attacker.name, defHit, defDmg, defCrit, false, defBrave ? 2 : 1, defStrikeSkills, defender, defWeapon);
  }

  // Post-combat: Poison damage (both sides can apply independently)
  const poisonEffects = [];
  if (atkHP > 0 && defHP > 0) {
    const atkPoison = parsePoisonDamage(atkWeapon);
    if (atkPoison > 0) {
      defHP = Math.max(1, defHP - atkPoison); // Poison can't kill (leave at 1 HP)
      poisonEffects.push({ target: 'defender', damage: atkPoison });
    }
    const defPoison = defCanCounter && defWeapon ? parsePoisonDamage(defWeapon) : 0;
    if (defPoison > 0) {
      atkHP = Math.max(1, atkHP - defPoison);
      poisonEffects.push({ target: 'attacker', damage: defPoison });
    }
  }

  return {
    events,
    attackerHP: atkHP,
    defenderHP: defHP,
    attackerDied: atkHP <= 0,
    defenderDied: defHP <= 0,
    poisonEffects,
    // Backward compat: expose first poison entry as flat fields
    poisonDamage: poisonEffects.length > 0 ? poisonEffects[0].damage : 0,
    poisonTarget: poisonEffects.length > 0 ? poisonEffects[0].target : null,
  };
}
