// EarnedBoons.js - the boons of the earned blessings that PR D1 adds (docs/specs/blessings-v3.md
// §6.1): Standard of the Sun (`commander_aura`), Hollow Hourglass (`reinforcement_delay`),
// Chronicle (`xp_per_act_cleared`), Tithe Box (`church_entry_gold`), Lantern of the Road
// (`fog_opening_reveal`) and Crest of the Road (`recruit_mark_chance`).
//
// One parser per boon, shared by the validator (BlessingEngine.validateBoonParams refuses what
// the parser refuses), the run's handler (`applyEarnedBoon`, called from
// RunManager._applySingleRunStartBlessingEffect: a malformed set is skipped and recorded as
// `invalid_<type>_params`) and the save's sanitizer (`sanitizeEarnedBoonModifiers`), so the three
// cannot disagree. Each boon raises one field of `run.blessingRuntimeModifiers`; the systems read
// those fields through the getters at the bottom. Pure: no Phaser, no randomness.

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const isPositiveInt = (value) => Number.isInteger(value) && value > 0;
const isNonNegativeInt = (value) => Number.isInteger(value) && value >= 0;
const isUnitShare = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;

/** Standard of the Sun's params: `{ radius, hitBonus, avoidBonus }`, or why not. */
export function commanderAuraErrors(params) {
  if (!isPlainObject(params)) return ['params must be an object'];
  const errors = [];
  if (!isPositiveInt(params.radius)) errors.push('params.radius must be a positive integer');
  for (const key of ['hitBonus', 'avoidBonus'])
    if (params[key] !== undefined && !isNonNegativeInt(params[key]))
      errors.push(`params.${key} must be a whole number from 0`);
  if (!(params.hitBonus > 0) && !(params.avoidBonus > 0))
    errors.push('params needs a positive hitBonus or avoidBonus (otherwise it does nothing)');
  return errors;
}

export function parseCommanderAura(params) {
  if (commanderAuraErrors(params).length > 0) return null;
  return {
    radius: params.radius,
    hitBonus: params.hitBonus ?? 0,
    avoidBonus: params.avoidBonus ?? 0,
  };
}

/**
 * Why `effect` is not a usable earned boon of this module ([] when it is, or when the type is
 * not one of them).
 */
export function earnedBoonErrors(effect) {
  const params = effect?.params;
  switch (effect?.type) {
    case 'commander_aura':
      return commanderAuraErrors(params);
    case 'reinforcement_delay':
    case 'church_entry_gold':
      return isPositiveInt(params?.value) ? [] : ['params.value must be a positive integer'];
    case 'fog_opening_reveal':
      return isPositiveInt(params?.radius) ? [] : ['params.radius must be a positive integer'];
    case 'xp_per_act_cleared':
    case 'recruit_mark_chance':
      return isUnitShare(params?.value) ? [] : ['params.value must be a share above 0, at most 1'];
    default:
      return [];
  }
}

/** The boon types this module handles. */
export const EARNED_D1_BOON_TYPES = Object.freeze([
  'commander_aura',
  'reinforcement_delay',
  'xp_per_act_cleared',
  'church_entry_gold',
  'fog_opening_reveal',
  'recruit_mark_chance',
]);

/** The runtime fields these boons raise, at their "none held" values. */
export function earnedBoonModifierDefaults() {
  return {
    // Standard of the Sun: `[{ radius, hitBonus, avoidBonus }]`, read in BlessingCombatMods.
    commanderAuras: [],
    // Hollow Hourglass: turns every reinforcement wave arrives later (getBattleParams).
    reinforcementDelay: 0,
    // Chronicle: the XP share per act already cleared (getXpMultiplierDelta).
    xpPerActCleared: 0,
    // Tithe Box: gold paid on entering a church, once a node (ChurchCommands.payChurchTithe).
    churchEntryGold: 0,
    // Lantern of the Road: the opening reveal's radius on a fog map (engine/FogOpening.js).
    fogOpeningRadius: 0,
    // Crest of the Road: the least Mark chance a recruit rolls at (getEffectiveMetaEffects).
    recruitMarkChance: 0,
  };
}

/**
 * Apply one of these boons to the run's runtime modifiers. Returns false when `effect` is not
 * one of them (the caller goes on to its other handlers). A malformed set changes nothing and
 * is recorded as skipped (`invalid_<type>_params`).
 */
export function applyEarnedBoon(run, blessingId, effect) {
  if (!EARNED_D1_BOON_TYPES.includes(effect?.type)) return false;
  const record = (details) => run._recordBlessingEvent?.('run_start', blessingId, effect, details);
  if (earnedBoonErrors(effect).length > 0) {
    record({ skipped: true, reason: `invalid_${effect.type}_params` });
    return true;
  }
  const mods = run.blessingRuntimeModifiers;
  const params = effect.params;
  switch (effect.type) {
    case 'commander_aura': {
      const aura = parseCommanderAura(params);
      mods.commanderAuras = [...sanitizeCommanderAuras(mods.commanderAuras), aura];
      record({ ...aura, held: mods.commanderAuras.length });
      break;
    }
    case 'reinforcement_delay':
      mods.reinforcementDelay = countOf(mods.reinforcementDelay) + params.value;
      record({ appliedValue: params.value, total: mods.reinforcementDelay });
      break;
    case 'church_entry_gold':
      mods.churchEntryGold = countOf(mods.churchEntryGold) + params.value;
      record({ appliedValue: params.value, total: mods.churchEntryGold });
      break;
    case 'xp_per_act_cleared':
      mods.xpPerActCleared = shareOf(mods.xpPerActCleared) + params.value;
      record({ appliedValue: params.value, total: mods.xpPerActCleared });
      break;
    case 'fog_opening_reveal':
      // Two lanterns do not light farther than the brighter one.
      mods.fogOpeningRadius = Math.max(countOf(mods.fogOpeningRadius), params.radius);
      record({ appliedValue: params.radius, total: mods.fogOpeningRadius });
      break;
    case 'recruit_mark_chance':
      mods.recruitMarkChance = Math.min(1, Math.max(shareOf(mods.recruitMarkChance), params.value));
      record({ appliedValue: params.value, total: mods.recruitMarkChance });
      break;
    default:
      break;
  }
  return true;
}

function countOf(value) {
  return Math.max(0, Math.trunc(Number(value)) || 0);
}
function shareOf(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A saved list of held Standard of the Sun auras, each unusable entry dropped. */
export function sanitizeCommanderAuras(list) {
  if (!Array.isArray(list)) return [];
  return list.map((entry) => parseCommanderAura(entry)).filter(Boolean);
}

/** A saved runtime modifiers object's fields of this module put right (a save from before has none). */
export function sanitizeEarnedBoonModifiers(mods) {
  if (!isPlainObject(mods)) return;
  mods.commanderAuras = sanitizeCommanderAuras(mods.commanderAuras);
  mods.reinforcementDelay = countOf(mods.reinforcementDelay);
  mods.churchEntryGold = countOf(mods.churchEntryGold);
  mods.fogOpeningRadius = countOf(mods.fogOpeningRadius);
  mods.xpPerActCleared = shareOf(mods.xpPerActCleared);
  mods.recruitMarkChance = Math.min(1, shareOf(mods.recruitMarkChance));
}

// ── Reads ─────────────────────────────────────────────────────────────────

const modsOf = (run) =>
  isPlainObject(run?.blessingRuntimeModifiers) ? run.blessingRuntimeModifiers : {};

/** Hollow Hourglass: how many turns later every reinforcement wave arrives (0 without it). */
export function reinforcementDelayOf(run) {
  return countOf(modsOf(run).reinforcementDelay);
}

/**
 * Chronicle: the XP share it adds now, per act already cleared. The act index is the count of
 * acts cleared while the run stands in an act (it is taken at the boss, before the advance, so
 * the act it is taken in counts from the next act on, once).
 */
export function chronicleXpDeltaOf(run) {
  const per = shareOf(modsOf(run).xpPerActCleared);
  const cleared = Math.max(0, Math.trunc(Number(run?.actIndex)) || 0);
  return per * cleared;
}

/** Tithe Box: the gold a church pays on entry (0 without it). */
export function churchEntryGoldOf(run) {
  return countOf(modsOf(run).churchEntryGold);
}

/** Lantern of the Road: the opening reveal's radius on a fog map (0 without it). */
export function fogOpeningRadiusOf(run) {
  return countOf(modsOf(run).fogOpeningRadius);
}

/** Crest of the Road: the least Mark chance a recruit rolls at (0 without it). */
export function recruitMarkChanceOf(run) {
  return Math.min(1, shareOf(modsOf(run).recruitMarkChance));
}

/** Standard of the Sun: the held auras (a list; empty without it). */
export function commanderAurasOf(run) {
  return sanitizeCommanderAuras(modsOf(run).commanderAuras);
}
