// EarnedBoons.js - the boons of the earned blessings that PRs D1 and D2 add
// (docs/specs/blessings-v3.md §6.1): Standard of the Sun (`commander_aura`), Hollow Hourglass
// (`reinforcement_delay`), Chronicle (`xp_per_act_cleared`), Tithe Box (`church_entry_gold`),
// Lantern of the Road (`fog_opening_reveal`) and Crest of the Road (`recruit_mark_chance`); then
// Saint's Reliquary (`staff_heal_range_bonus`), Mercenary Ledger (`arena_terms`), Smith's
// Covenant (`weapons_never_wear`, beside the shrine's `shop_first_forge_free`), Thief's Lantern and
// Seer's Eye (`route_scout`; the Lantern adds Cutpurse's `carrier_luck` speed waiver, the Eye
// `foes_shown`).
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

// Bounds that keep a typo from shipping a card that breaks the game (PR D2's boons).
const MAX_STAFF_HEAL_BONUS = 20;
const MAX_STAFF_RANGE_BONUS = 3;
const MAX_ARENA_VISIT_BOUTS = 5;

/**
 * What a route preview may show (engine/BattleScout.js): nothing, the foes that carry items
 * (Thief's Lantern), or every foe with its affixes and what it carries (Seer's Eye). A level
 * is a rung: each shows all the one below it does.
 */
export const ROUTE_SCOUT_LEVELS = Object.freeze(['carriers', 'foes']);
/** The scout rung of a level name (0 for none or an unknown name). */
export function routeScoutRank(level) {
  return ROUTE_SCOUT_LEVELS.indexOf(level) + 1;
}

/** Saint's Reliquary's params: `{ heal, range }` (whole numbers, one of them positive), or why not. */
export function staffHealRangeErrors(params) {
  if (!isPlainObject(params)) return ['params must be an object'];
  const errors = [];
  for (const [key, max] of [
    ['heal', MAX_STAFF_HEAL_BONUS],
    ['range', MAX_STAFF_RANGE_BONUS],
  ])
    if (params[key] !== undefined && !(isNonNegativeInt(params[key]) && params[key] <= max))
      errors.push(`params.${key} must be a whole number from 0 to ${max}`);
  if (!errors.length && !(params.heal > 0) && !(params.range > 0))
    errors.push('params needs a positive heal or range (otherwise it does nothing)');
  return errors;
}

/** Mercenary Ledger's params: `{ feeMultiplier, visitBouts }`, or why not. */
export function arenaTermsErrors(params) {
  if (!isPlainObject(params)) return ['params must be an object'];
  const errors = [];
  const fee = params.feeMultiplier ?? 1;
  if (!(isUnitShare(fee) && fee >= 0.1))
    errors.push('params.feeMultiplier must be a share from 0.1 to 1');
  const bouts = params.visitBouts ?? 0;
  if (!(isNonNegativeInt(bouts) && bouts <= MAX_ARENA_VISIT_BOUTS))
    errors.push(`params.visitBouts must be a whole number from 0 to ${MAX_ARENA_VISIT_BOUTS}`);
  if (!errors.length && fee === 1 && bouts === 0)
    errors.push('params change nothing (the full fee and no extra bout)');
  return errors;
}

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
    case 'staff_heal_range_bonus':
      return staffHealRangeErrors(params);
    case 'arena_terms':
      return arenaTermsErrors(params);
    case 'weapons_never_wear':
    case 'foes_shown':
      // A switch: the one value it takes is 1 (anything else is a typo, not a stronger card).
      return params?.value === 1 ? [] : ['params.value must be 1'];
    case 'route_scout':
      return ROUTE_SCOUT_LEVELS.includes(params?.level)
        ? []
        : [`params.level must be one of ${ROUTE_SCOUT_LEVELS.join('/')}`];
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

/** PR D2's boon types (Saint's Reliquary, Mercenary Ledger, Smith's Covenant, the Lantern, the Eye). */
export const EARNED_D2_BOON_TYPES = Object.freeze([
  'staff_heal_range_bonus',
  'arena_terms',
  'weapons_never_wear',
  'route_scout',
  'foes_shown',
]);

/** Every boon type this module handles. */
export const EARNED_BOON_TYPES = Object.freeze([...EARNED_D1_BOON_TYPES, ...EARNED_D2_BOON_TYPES]);

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
    // Saint's Reliquary: HP a player's staff heal adds, and tiles its reach adds
    // (StaffBlessings.staffRunOptions).
    staffHealBonus: 0,
    staffRangeBonus: 0,
    // Mercenary Ledger: the share of a Colosseum entry fee paid, and bouts a visit adds
    // (ColosseumEngine.arenaEntryFee, ColosseumOverlay's visit cap).
    arenaFeeMultiplier: 1,
    arenaVisitBonus: 0,
    // Smith's Covenant: an event's wear never lands on the army's weapons (EventEffects.planWear).
    weaponsNeverWear: false,
    // Thief's Lantern / Seer's Eye: what a route preview shows (engine/BattleScout.js), a rung of
    // ROUTE_SCOUT_LEVELS (0: nothing).
    routeScout: 0,
    // Seer's Eye: fog never hides a foe (`battleParams.foesShown`, BattleInformation.canInspectUnit).
    foesShown: false,
  };
}

/**
 * Apply one of these boons to the run's runtime modifiers. Returns false when `effect` is not
 * one of them (the caller goes on to its other handlers). A malformed set changes nothing and
 * is recorded as skipped (`invalid_<type>_params`).
 */
export function applyEarnedBoon(run, blessingId, effect) {
  if (!EARNED_BOON_TYPES.includes(effect?.type)) return false;
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
    case 'staff_heal_range_bonus':
      mods.staffHealBonus = Math.min(
        MAX_STAFF_HEAL_BONUS,
        countOf(mods.staffHealBonus) + (params.heal ?? 0),
      );
      mods.staffRangeBonus = Math.min(
        MAX_STAFF_RANGE_BONUS,
        countOf(mods.staffRangeBonus) + (params.range ?? 0),
      );
      record({ heal: mods.staffHealBonus, range: mods.staffRangeBonus });
      break;
    case 'arena_terms':
      // Two ledgers never make the arena free: the cheaper share holds; the bouts add.
      mods.arenaFeeMultiplier = Math.min(
        feeShareOf(mods.arenaFeeMultiplier),
        params.feeMultiplier ?? 1,
      );
      mods.arenaVisitBonus = Math.min(
        MAX_ARENA_VISIT_BOUTS,
        countOf(mods.arenaVisitBonus) + (params.visitBouts ?? 0),
      );
      record({ feeMultiplier: mods.arenaFeeMultiplier, visitBouts: mods.arenaVisitBonus });
      break;
    case 'weapons_never_wear':
      mods.weaponsNeverWear = true;
      record({ weaponsNeverWear: true });
      break;
    case 'route_scout':
      mods.routeScout = Math.max(scoutRankOf(mods.routeScout), routeScoutRank(params.level));
      record({ level: params.level, routeScout: mods.routeScout });
      break;
    case 'foes_shown':
      mods.foesShown = true;
      record({ foesShown: true });
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
// A fee share: (0.1, 1], anything else reads as the full fee.
function feeShareOf(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0.1 && n <= 1 ? n : 1;
}
function scoutRankOf(value) {
  return Math.min(ROUTE_SCOUT_LEVELS.length, countOf(value));
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
  mods.staffHealBonus = Math.min(MAX_STAFF_HEAL_BONUS, countOf(mods.staffHealBonus));
  mods.staffRangeBonus = Math.min(MAX_STAFF_RANGE_BONUS, countOf(mods.staffRangeBonus));
  mods.arenaFeeMultiplier = feeShareOf(mods.arenaFeeMultiplier ?? 1);
  mods.arenaVisitBonus = Math.min(MAX_ARENA_VISIT_BOUTS, countOf(mods.arenaVisitBonus));
  mods.weaponsNeverWear = mods.weaponsNeverWear === true;
  mods.routeScout = scoutRankOf(mods.routeScout);
  mods.foesShown = mods.foesShown === true;
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

/** Saint's Reliquary: `{ heal, range }` a player's staves add (0 each without it). */
export function staffHealRangeOf(run) {
  const mods = modsOf(run);
  return {
    heal: Math.min(MAX_STAFF_HEAL_BONUS, countOf(mods.staffHealBonus)),
    range: Math.min(MAX_STAFF_RANGE_BONUS, countOf(mods.staffRangeBonus)),
  };
}

/** Mercenary Ledger: the share of a Colosseum entry fee paid (1 without it). */
export function arenaFeeMultiplierOf(run) {
  return feeShareOf(modsOf(run).arenaFeeMultiplier ?? 1);
}

/** Mercenary Ledger: bouts each Colosseum visit allows beyond the rung's cap (0 without it). */
export function arenaVisitBonusOf(run) {
  return Math.min(MAX_ARENA_VISIT_BOUTS, countOf(modsOf(run).arenaVisitBonus));
}

/** Smith's Covenant: true when an event's wear never lands on the army's weapons. */
export function weaponsNeverWearOf(run) {
  return modsOf(run).weaponsNeverWear === true;
}

/** Thief's Lantern / Seer's Eye: the route preview's rung (0 none, 1 carriers, 2 foes). */
export function routeScoutOf(run) {
  return scoutRankOf(modsOf(run).routeScout);
}

/** Seer's Eye: true when fog never hides a foe on the run's maps. */
export function foesShownOf(run) {
  return modsOf(run).foesShown === true;
}
