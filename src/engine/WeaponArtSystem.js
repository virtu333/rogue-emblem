// WeaponArtSystem.js - Weapon Art gating, usage tracking, and combat mod helpers

const RANK_ORDER = { Prof: 0, Mast: 1 };

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getRequiredRank(art) {
  return art?.requiredRank || 'Prof';
}

function getUnitRankForType(unit, weaponType) {
  if (!Array.isArray(unit?.proficiencies) || !weaponType) return null;
  const prof = unit.proficiencies.find((p) => p?.type === weaponType);
  return prof?.rank || null;
}

function ensureUsageState(unit) {
  if (!unit._battleWeaponArtUsage || typeof unit._battleWeaponArtUsage !== 'object') {
    unit._battleWeaponArtUsage = {
      map: {},
      turn: {},
      turnKey: null,
    };
  }
  return unit._battleWeaponArtUsage;
}

function getTurnKey(context = {}) {
  if (context.turnKey !== undefined && context.turnKey !== null) return String(context.turnKey);
  if (context.turnNumber !== undefined && context.turnNumber !== null) return String(context.turnNumber);
  return null;
}

function getMapCount(unit, artId) {
  const usage = ensureUsageState(unit);
  return Math.max(0, toFiniteNumber(usage.map?.[artId], 0));
}

function getTurnCount(unit, artId, turnKey) {
  if (!turnKey) return 0;
  const usage = ensureUsageState(unit);
  if (usage.turnKey !== turnKey) return 0;
  return Math.max(0, toFiniteNumber(usage.turn?.[artId], 0));
}

export function getWeaponArtCombatMods(art) {
  const mods = art?.combatMods || {};
  return {
    atkBonus: toFiniteNumber(mods.atkBonus, 0),
    hitBonus: toFiniteNumber(mods.hitBonus, 0),
    critBonus: toFiniteNumber(mods.critBonus, 0),
    spdBonus: toFiniteNumber(mods.spdBonus, 0),
    avoidBonus: toFiniteNumber(mods.avoidBonus, 0),
    defBonus: toFiniteNumber(mods.defBonus, 0),
    ignoreTerrainAvoid: Boolean(mods.ignoreTerrainAvoid),
    activated: Array.isArray(mods.activated) ? [...mods.activated] : [],
  };
}

export function canUseWeaponArt(unit, weapon, art, context = {}) {
  if (!unit || !weapon || !art) return { ok: false, reason: 'invalid_input' };

  const artWeaponType = art.weaponType;
  if (!artWeaponType || weapon.type !== artWeaponType) {
    return { ok: false, reason: 'wrong_weapon_type' };
  }

  const unitRank = getUnitRankForType(unit, weapon.type);
  if (!unitRank) return { ok: false, reason: 'no_proficiency' };
  if ((RANK_ORDER[unitRank] ?? -1) < (RANK_ORDER[getRequiredRank(art)] ?? 0)) {
    return { ok: false, reason: 'insufficient_rank' };
  }

  if (art.initiationOnly && context.isInitiating === false) {
    return { ok: false, reason: 'initiation_only' };
  }

  const hpCost = Math.max(0, toFiniteNumber(art.hpCost, 0));
  if (hpCost > 0) {
    const hp = toFiniteNumber(unit.currentHP, toFiniteNumber(unit?.stats?.HP, 0));
    if (hp <= hpCost) return { ok: false, reason: 'insufficient_hp' };
  }

  const mapLimit = Math.max(0, Math.trunc(toFiniteNumber(art.perMapLimit, 0)));
  if (mapLimit > 0 && getMapCount(unit, art.id) >= mapLimit) {
    return { ok: false, reason: 'per_map_limit' };
  }

  const turnLimit = Math.max(0, Math.trunc(toFiniteNumber(art.perTurnLimit, 0)));
  const turnKey = getTurnKey(context);
  if (turnLimit > 0 && turnKey && getTurnCount(unit, art.id, turnKey) >= turnLimit) {
    return { ok: false, reason: 'per_turn_limit' };
  }

  return { ok: true, reason: null };
}

export function recordWeaponArtUse(unit, art, context = {}) {
  if (!unit || !art?.id) return;
  const usage = ensureUsageState(unit);
  const turnKey = getTurnKey(context);

  usage.map[art.id] = getMapCount(unit, art.id) + 1;

  if (turnKey) {
    if (usage.turnKey !== turnKey) {
      usage.turn = {};
      usage.turnKey = turnKey;
    }
    usage.turn[art.id] = getTurnCount(unit, art.id, turnKey) + 1;
  }
}

export function applyWeaponArtCost(unit, art) {
  const hpCost = Math.max(0, toFiniteNumber(art?.hpCost, 0));
  if (!unit || hpCost <= 0) return;
  const hp = toFiniteNumber(unit.currentHP, toFiniteNumber(unit?.stats?.HP, 0));
  unit.currentHP = Math.max(1, hp - hpCost);
}

export function resetWeaponArtTurnUsage(unit, context = {}) {
  if (!unit) return;
  const usage = ensureUsageState(unit);
  usage.turn = {};
  usage.turnKey = getTurnKey(context);
}

