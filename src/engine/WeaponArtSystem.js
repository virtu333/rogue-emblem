// WeaponArtSystem.js - Weapon Art gating, usage tracking, and combat mod helpers

const RANK_ORDER = { Prof: 0, Mast: 1 };
const VALID_FACTIONS = new Set(['player', 'enemy', 'npc']);
const VALID_OWNER_SCOPES = new Set(['player', 'enemy', 'npc', 'any']);
const VALID_WEAPON_ART_SOURCES = new Set(['innate', 'scroll', 'meta_innate']);
const UNLOCK_ACT_RE = /^act\d+$/i;
const MAX_WEAPON_ART_SLOTS = 3;

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

export function getWeaponArtBindings(weapon, options = {}) {
  if (!weapon || typeof weapon !== 'object') return [];
  const validArtIds = options.validArtIds instanceof Set ? options.validArtIds : null;
  const maxSlots = Math.max(1, Math.trunc(Number(options.maxSlots) || MAX_WEAPON_ART_SLOTS));
  const legacyBinding = weapon.weaponArtBinding && typeof weapon.weaponArtBinding === 'object'
    ? weapon.weaponArtBinding
    : null;
  const bindings = [];
  const seen = new Set();

  const explicitIds = Array.isArray(weapon.weaponArtIds) ? weapon.weaponArtIds : [];
  const explicitSources = Array.isArray(weapon.weaponArtSources) ? weapon.weaponArtSources : [];
  const fallbackSource = normalizeWeaponArtSource(weapon.weaponArtSource)
    || normalizeWeaponArtSource(legacyBinding?.source)
    || 'innate';

  for (let i = 0; i < explicitIds.length; i++) {
    const id = toNonEmptyString(explicitIds[i]);
    if (!id || seen.has(id)) continue;
    if (validArtIds && !validArtIds.has(id)) continue;
    const source = normalizeWeaponArtSource(explicitSources[i]) || fallbackSource;
    bindings.push({ id, source });
    seen.add(id);
    if (bindings.length >= maxSlots) return bindings;
  }

  const legacyCandidates = [
    toNonEmptyString(weapon.weaponArtId),
    toNonEmptyString(legacyBinding?.artId),
    toNonEmptyString(weapon.weaponArt),
    toNonEmptyString(weapon.artId),
  ];
  for (const candidate of legacyCandidates) {
    if (!candidate || seen.has(candidate)) continue;
    if (validArtIds && !validArtIds.has(candidate)) continue;
    bindings.push({ id: candidate, source: fallbackSource });
    seen.add(candidate);
    if (bindings.length >= maxSlots) break;
  }

  return bindings;
}

export function getWeaponArtIds(weapon, options = {}) {
  return getWeaponArtBindings(weapon, options).map((binding) => binding.id);
}

export function normalizeWeaponArtBinding(weapon, options = {}) {
  if (!weapon || typeof weapon !== 'object') return weapon;
  const bindings = getWeaponArtBindings(weapon, options);

  delete weapon.weaponArtBinding;
  delete weapon.weaponArt;
  delete weapon.artId;

  if (bindings.length <= 0) {
    delete weapon.weaponArtIds;
    delete weapon.weaponArtSources;
    delete weapon.weaponArtId;
    delete weapon.weaponArtSource;
    return weapon;
  }

  weapon.weaponArtIds = bindings.map((binding) => binding.id);
  weapon.weaponArtSources = bindings.map((binding) => binding.source || 'innate');
  // Keep singular aliases for backward compatibility while runtime migrates to arrays.
  weapon.weaponArtId = weapon.weaponArtIds[0];
  weapon.weaponArtSource = weapon.weaponArtSources[0] || 'innate';
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

function normalizeStatScaling(value) {
  if (!value || typeof value !== 'object') return null;
  const stat = toNonEmptyString(value.stat);
  if (!stat) return null;
  const divisor = Math.max(1, Math.trunc(toFiniteNumber(value.divisor, 1)));
  return { stat: stat.toUpperCase(), divisor };
}

function normalizeEffectiveness(value) {
  if (!value || typeof value !== 'object') return null;
  const rawMoveTypes = Array.isArray(value.moveTypes)
    ? value.moveTypes
    : (typeof value.moveType === 'string' ? [value.moveType] : []);
  const moveTypes = [...new Set(
    rawMoveTypes
      .map((entry) => toNonEmptyString(entry)?.toLowerCase())
      .filter(Boolean)
  )];
  const multiplier = Math.max(1, Math.trunc(toFiniteNumber(value.multiplier, 1)));
  if (moveTypes.length <= 0 || multiplier <= 1) return null;
  return { moveTypes, multiplier };
}

function normalizeRangeOverride(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' || typeof value === 'string') {
    const n = Math.trunc(toFiniteNumber(value, 0));
    if (n < 1) return null;
    return { min: n, max: n };
  }
  if (typeof value !== 'object') return null;
  const min = Math.max(1, Math.trunc(toFiniteNumber(value.min, 0)));
  const max = Math.max(min, Math.trunc(toFiniteNumber(value.max, min)));
  return { min, max };
}

function normalizeMultiHit(value) {
  if (!value || typeof value !== 'object') return null;
  const count = Math.trunc(toFiniteNumber(value.count, 0));
  if (count < 2) return null;
  const damageMultiplier = toFiniteNumber(value.damageMultiplier, 1);
  if (damageMultiplier <= 0 || damageMultiplier > 1) return null;
  return { count, damageMultiplier };
}

function normalizeDrainPercent(value) {
  const n = toFiniteNumber(value, 0);
  return n > 0 ? n : null;
}

const VALID_TIER2_MOVE_MODES = new Set(['advance', 'retreat', 'swap', 'push', 'through']);
const VALID_TIER2_DEBUFF_STATS = new Set(['STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK', 'MOV']);
const VALID_TIER5_SPLASH_BASIS = new Set(['first_landed_strike']);

function normalizeTier2Target(value) {
  const token = toNonEmptyString(value)?.toLowerCase();
  if (!token || token === 'defender' || token === 'target') return 'defender';
  if (token === 'attacker' || token === 'self') return 'attacker';
  return null;
}

function normalizeTier2DamageEffect(effect) {
  if (!effect || typeof effect !== 'object') return null;
  const amount = Math.max(0, Math.trunc(toFiniteNumber(effect.amount, 0)));
  if (amount <= 0) return null;
  const target = normalizeTier2Target(effect.target);
  if (!target) return null;
  return {
    target,
    amount,
    nonLethal: effect.nonLethal !== false,
  };
}

function normalizeTier2DebuffEffect(effect) {
  if (!effect || typeof effect !== 'object') return null;
  const target = normalizeTier2Target(effect.target);
  if (!target) return null;
  const stat = toNonEmptyString(effect.stat)?.toUpperCase();
  if (!stat || !VALID_TIER2_DEBUFF_STATS.has(stat)) return null;
  const rawAmount = Math.trunc(toFiniteNumber(effect.amount, 0));
  if (rawAmount === 0) return null;
  return {
    target,
    stat,
    amount: rawAmount < 0 ? rawAmount : -Math.abs(rawAmount),
  };
}

function normalizeTier2MoveEffect(effect) {
  if (!effect || typeof effect !== 'object') return null;
  const mode = toNonEmptyString(effect.mode)?.toLowerCase();
  if (!mode || !VALID_TIER2_MOVE_MODES.has(mode)) return null;
  const distance = Math.max(1, Math.trunc(toFiniteNumber(effect.distance, 1)));
  return { mode, distance };
}

function normalizeTier2PierceEffect(effect) {
  if (!effect || typeof effect !== 'object') return null;
  const target = normalizeTier2Target(effect.target);
  if (!target) return null;
  const rawMaxTargets = Math.trunc(toFiniteNumber(effect.maxTargets, 1));
  if (rawMaxTargets <= 0) return null;
  // Tier 2 pierce currently supports exactly one unit behind the primary target.
  return { target, maxTargets: 1 };
}

function normalizeTier2SetHpEffect(effect) {
  if (!effect || typeof effect !== 'object') return null;
  const target = normalizeTier2Target(effect.target);
  if (!target) return null;
  const value = Math.trunc(toFiniteNumber(effect.value, 0));
  if (value <= 0) return null;
  return { target, value };
}

export function normalizeTier5AoeSplashEffect(effect) {
  if (!effect || typeof effect !== 'object') return null;
  const radius = Math.max(1, Math.trunc(toFiniteNumber(effect.radius, 0)));
  if (radius <= 0) return null;

  const rawMaxTargets = Math.trunc(toFiniteNumber(effect.maxTargets, 0));
  const maxTargets = rawMaxTargets > 0 ? rawMaxTargets : null;
  const basisToken = toNonEmptyString(effect.basis)?.toLowerCase() || 'first_landed_strike';
  const basis = VALID_TIER5_SPLASH_BASIS.has(basisToken) ? basisToken : 'first_landed_strike';

  let damageKind = toNonEmptyString(effect.damageKind)?.toLowerCase() || null;
  const fixedDamage = Math.max(0, Math.trunc(toFiniteNumber(effect.fixedDamage, 0)));
  let damageMultiplier = toFiniteNumber(effect.damageMultiplier, 0);
  if (damageMultiplier > 1) damageMultiplier /= 100;

  if (!damageKind) {
    if (fixedDamage > 0) damageKind = 'fixed';
    else damageKind = 'scaled';
  }
  if (damageKind === 'multiplier') damageKind = 'scaled';
  if (damageKind !== 'fixed' && damageKind !== 'scaled') return null;
  if (damageKind === 'fixed' && fixedDamage <= 0) return null;
  if (damageKind === 'scaled' && !(damageMultiplier > 0)) return null;

  return {
    radius,
    maxTargets,
    damageKind,
    damageMultiplier: damageKind === 'scaled' ? damageMultiplier : null,
    fixedDamage: damageKind === 'fixed' ? fixedDamage : null,
    nonLethal: effect.nonLethal === true,
    basis,
  };
}

export function normalizeTier5AllyBuffEffect(effect) {
  if (!effect || typeof effect !== 'object') return null;
  const range = Math.max(1, Math.trunc(toFiniteNumber(effect.range, 0)));
  if (range <= 0) return null;
  const durationPhases = Math.max(1, Math.trunc(toFiniteNumber(effect.durationPhases, 1)));

  const rawStats = effect.stats;
  if (!rawStats || typeof rawStats !== 'object' || Array.isArray(rawStats)) return null;
  const stats = {};
  for (const [rawStat, rawValue] of Object.entries(rawStats)) {
    const stat = toNonEmptyString(rawStat)?.toUpperCase();
    if (!stat) continue;
    const value = Math.trunc(toFiniteNumber(rawValue, 0));
    if (value === 0) continue;
    stats[stat] = value;
  }
  if (Object.keys(stats).length <= 0) return null;

  return {
    range,
    durationPhases,
    stats,
    includeSelf: effect.includeSelf === true,
  };
}

export function getWeaponArtTier2Effects(art) {
  const out = {
    afterCombatDamage: [],
    afterCombatDebuff: [],
    pierceThrough: [],
    postCombatMove: [],
    setHp: [],
  };

  const afterCombatEffects = Array.isArray(art?.effects?.afterCombat)
    ? art.effects.afterCombat
    : [];
  for (const effect of afterCombatEffects) {
    const type = toNonEmptyString(effect?.type)?.toLowerCase();
    if (type === 'damage') {
      const normalized = normalizeTier2DamageEffect(effect);
      if (normalized) out.afterCombatDamage.push(normalized);
      continue;
    }
    if (type === 'debuff') {
      const normalized = normalizeTier2DebuffEffect(effect);
      if (normalized) out.afterCombatDebuff.push(normalized);
      continue;
    }
    if (type === 'move') {
      const normalized = normalizeTier2MoveEffect(effect);
      if (normalized) out.postCombatMove.push(normalized);
      continue;
    }
    if (type === 'pierce_through') {
      const normalized = normalizeTier2PierceEffect(effect);
      if (normalized) out.pierceThrough.push(normalized);
      continue;
    }
    if (type === 'set_hp') {
      const normalized = normalizeTier2SetHpEffect(effect);
      if (normalized) out.setHp.push(normalized);
    }
  }

  return out;
}

export function getWeaponArtTier5Effects(art) {
  return {
    aoeSplash: normalizeTier5AoeSplashEffect(art?.effects?.aoeSplash),
    allyBuff: normalizeTier5AllyBuffEffect(art?.effects?.allyBuff),
  };
}

export function getWeaponArtAllowedTypes(art) {
  const allowedTypes = normalizeStringList(art?.allowedTypes);
  if (allowedTypes === undefined) return [];
  if (Array.isArray(allowedTypes) && allowedTypes.length > 0) return allowedTypes;
  const weaponType = toNonEmptyString(art?.weaponType);
  return weaponType ? [weaponType] : [];
}

export function isWeaponArtCompatibleWithWeapon(art, weapon) {
  const weaponType = toNonEmptyString(weapon?.type);
  if (!weaponType) return false;
  const allowedTypes = getWeaponArtAllowedTypes(art);
  return allowedTypes.includes(weaponType);
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
    resBonus: toFiniteNumber(mods.resBonus, 0),
    statScaling: normalizeStatScaling(mods.statScaling),
    preventCounter: Boolean(mods.preventCounter),
    targetsRES: Boolean(mods.targetsRES),
    effectiveness: normalizeEffectiveness(mods.effectiveness),
    rangeBonus: Math.trunc(toFiniteNumber(mods.rangeBonus, 0)),
    rangeOverride: normalizeRangeOverride(mods.rangeOverride),
    halfPhysicalDamage: Boolean(mods.halfPhysicalDamage),
    vengeance: Boolean(mods.vengeance),
    weaponArt: true,
    ignoreTerrainAvoid: Boolean(mods.ignoreTerrainAvoid),
    multiHit: normalizeMultiHit(mods.multiHit),
    drainPercent: normalizeDrainPercent(mods.drainPercent),
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
    const tokens = [weapon?._baseName, weapon?.id, weapon?.name]
      .map(t => toNonEmptyString(t))
      .filter(Boolean);
    if (tokens.length === 0 || !tokens.some(t => config.legendaryIds.includes(t))) {
      return { ok: false, reason: 'legendary_weapon_required' };
    }
  }

  if (!isWeaponArtCompatibleWithWeapon(art, weapon)) {
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

  const hpCost = getEffectiveWeaponArtHpCost(unit, art);
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

export function getEffectiveWeaponArtHpCost(unit, art) {
  const baseCost = Math.max(0, toFiniteNumber(art?.hpCost, 0));
  if (baseCost <= 0) return 0;
  const combatEffects = unit?.accessory?.combatEffects || null;
  const explicitReduction = Math.max(
    0,
    Math.trunc(
      toFiniteNumber(
        combatEffects?.weaponArtHpCostReduction,
        toFiniteNumber(combatEffects?.weaponArtCostReduction, 0)
      )
    )
  );
  const fallbackReduction = combatEffects?.bloodGem ? 5 : 0;
  const reduction = Math.max(explicitReduction, fallbackReduction);
  return Math.max(1, baseCost - reduction);
}

export function applyWeaponArtCost(unit, art) {
  const hpCost = getEffectiveWeaponArtHpCost(unit, art);
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
