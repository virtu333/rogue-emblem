// WeaponArtSystem.js - Weapon Art gating, usage tracking, and combat mod helpers

const RANK_ORDER = { Prof: 0, Mast: 1 };
const VALID_FACTIONS = new Set(['player', 'enemy', 'npc']);
const VALID_OWNER_SCOPES = new Set(['player', 'enemy', 'npc', 'any']);
const VALID_WEAPON_ART_SOURCES = new Set(['innate', 'scroll', 'meta_innate']);
const UNLOCK_ACT_RE = /^act\d+$/i;

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getRequiredRank(art) {
  return art?.requiredRank || 'Prof';
}

function toNonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeWeaponArtSource(value) {
  const source = toNonEmptyString(value)?.toLowerCase() || null;
  if (!source) return null;
  return VALID_WEAPON_ART_SOURCES.has(source) ? source : null;
}

export function normalizeWeaponArtBinding(weapon, options = {}) {
  if (!weapon || typeof weapon !== 'object') return weapon;
  const validArtIds = options.validArtIds instanceof Set ? options.validArtIds : null;
  const legacyBinding = weapon.weaponArtBinding && typeof weapon.weaponArtBinding === 'object'
    ? weapon.weaponArtBinding
    : null;

  const rawArtId = toNonEmptyString(
    weapon.weaponArtId
    ?? legacyBinding?.artId
    ?? weapon.weaponArt
    ?? weapon.artId
  );
  const artId = rawArtId && (!validArtIds || validArtIds.has(rawArtId)) ? rawArtId : null;
  let source = normalizeWeaponArtSource(weapon.weaponArtSource);
  if (!source) source = normalizeWeaponArtSource(legacyBinding?.source);

  delete weapon.weaponArtBinding;
  delete weapon.weaponArt;
  delete weapon.artId;

  if (!artId) {
    delete weapon.weaponArtId;
    delete weapon.weaponArtSource;
    return weapon;
  }

  weapon.weaponArtId = artId;
  weapon.weaponArtSource = source || 'innate';
  return weapon;
}

function normalizeStringList(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map(toNonEmptyString)
    .filter(Boolean);
  return [...new Set(out)];
}

function getFactionFromContext(unit, context = {}) {
  return toNonEmptyString(context.actorFaction) || toNonEmptyString(unit?.faction);
}

function normalizeAllowedScopes(art) {
  const raw = art?.allowedOwners ?? art?.owner ?? null;
  if (raw === null) return null;
  if (typeof raw === 'string') {
    const scope = toNonEmptyString(raw)?.toLowerCase();
    return scope ? [scope] : undefined;
  }
  const list = normalizeStringList(raw);
  if (list === null) return null;
  if (list === undefined) return undefined;
  return list.map((v) => v.toLowerCase());
}

function normalizeAllowedFactions(art) {
  const raw = art?.allowedFactions ?? art?.faction ?? null;
  if (raw === null) return null;
  if (typeof raw === 'string') {
    const faction = toNonEmptyString(raw)?.toLowerCase();
    return faction ? [faction] : undefined;
  }
  const list = normalizeStringList(raw);
  if (list === null) return null;
  if (list === undefined) return undefined;
  return list.map((v) => v.toLowerCase());
}

function validateArtConstraintConfig(art) {
  const unlockAct = toNonEmptyString(art?.unlockAct);
  if (unlockAct !== null && !UNLOCK_ACT_RE.test(unlockAct)) {
    return { ok: false, reason: 'invalid_unlock_act_config' };
  }

  const owners = normalizeAllowedScopes(art);
  if (owners === undefined) return { ok: false, reason: 'invalid_owner_scope_config' };
  if (owners && owners.some((v) => !VALID_OWNER_SCOPES.has(v))) {
    return { ok: false, reason: 'invalid_owner_scope_config' };
  }

  const factions = normalizeAllowedFactions(art);
  if (factions === undefined) return { ok: false, reason: 'invalid_faction_config' };
  if (factions && factions.some((v) => !VALID_FACTIONS.has(v))) {
    return { ok: false, reason: 'invalid_faction_config' };
  }

  const legendaryIds = normalizeStringList(art?.legendaryWeaponIds);
  if (art?.legendaryWeaponIds !== undefined && legendaryIds === undefined) {
    return { ok: false, reason: 'invalid_legendary_weapon_ids_config' };
  }

  return { ok: true, owners, factions, legendaryIds };
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
  const config = validateArtConstraintConfig(art);
  if (!config.ok) return { ok: false, reason: config.reason };

  const actorFaction = getFactionFromContext(unit, context)?.toLowerCase() || null;
  if (config.owners && !config.owners.includes('any')) {
    if (!actorFaction || !config.owners.includes(actorFaction)) {
      return { ok: false, reason: 'owner_scope_mismatch' };
    }
  }
  if (config.factions) {
    if (!actorFaction || !config.factions.includes(actorFaction)) {
      return { ok: false, reason: 'faction_mismatch' };
    }
  }
  if (Array.isArray(config.legendaryIds) && config.legendaryIds.length > 0) {
    const weaponToken = toNonEmptyString(weapon?.id) || toNonEmptyString(weapon?.name);
    if (!weaponToken || !config.legendaryIds.includes(weaponToken)) {
      return { ok: false, reason: 'legendary_weapon_required' };
    }
  }

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

  if (context.isAI && art.aiEnabled === false) {
    return { ok: false, reason: 'ai_disabled' };
  }

  const hpCost = Math.max(0, toFiniteNumber(art.hpCost, 0));
  const hp = toFiniteNumber(unit.currentHP, toFiniteNumber(unit?.stats?.HP, 0));
  const maxHp = Math.max(0, toFiniteNumber(unit?.stats?.HP, hp));
  if (hpCost > 0) {
    if (hp <= hpCost) return { ok: false, reason: 'insufficient_hp' };
  }
  if (context.isAI) {
    const defaultMinHpAfterCost = Math.max(2, Math.ceil(maxHp * 0.25));
    const minHp = Math.max(
      defaultMinHpAfterCost,
      Math.trunc(toFiniteNumber(art.aiMinHpAfterCost, 0)),
      Math.ceil(maxHp * Math.max(0, toFiniteNumber(art.aiMinHpAfterCostPercent, 0)))
    );
    if ((hp - hpCost) < minHp) return { ok: false, reason: 'ai_hp_floor' };
  }

  const mapLimit = Math.max(0, Math.trunc(toFiniteNumber(art.perMapLimit, 0)));
  if (mapLimit > 0 && getMapCount(unit, art.id) >= mapLimit) {
    return { ok: false, reason: 'per_map_limit' };
  }

  const turnLimit = Math.max(0, Math.trunc(toFiniteNumber(art.perTurnLimit, 0)));
  const aiTurnLimit = context.isAI ? Math.max(0, Math.trunc(toFiniteNumber(art.aiPerTurnLimit, 0))) : 0;
  const effectiveTurnLimit = aiTurnLimit > 0 ? (turnLimit > 0 ? Math.min(turnLimit, aiTurnLimit) : aiTurnLimit) : turnLimit;
  const turnKey = getTurnKey(context);
  if (effectiveTurnLimit > 0 && turnKey && getTurnCount(unit, art.id, turnKey) >= effectiveTurnLimit) {
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
