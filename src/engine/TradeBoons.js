// TradeBoons.js - the effects of the act boss's trade cards (docs/specs/blessings-v3.md §6.8):
// earned blessings modelled on Slay the Spire's boss relics, each a strong boon taken with a cost
// that changes how the army fights. Every one is offered by an act boss only; its boon is in
// `boons` and its cost is its `twist` (applied with it and held as its price, as the twisted
// cards' are: engine/TwistedBoons.js).
//
// One place for each effect's params (the validator's errors and the handler's parse are the same
// reading, so a card the validator passes never ships doing nothing), for the run state the effects
// keep (`blessingRuntimeModifiers`, saved; a save from before has none and reads the defaults) and
// for the pure reads the systems they ride on make. Pure: no Phaser, no DOM, never `Math.random`.
//
// A type may be a boon, a cost, or either (`TRADE_ROLES`): a boon must point the good way and a
// cost the costly way (an army Move delta is +1 as a boon and -1 as a cost), so a sign typo is
// refused rather than shipped as a second boon.
//
// Where each effect acts (the readers; each names this module):
//   army_combat_delta    Hit, Avoid, Crit, Might, DEF, RES for every player unit in combat, always
//                        or `when` a condition holds (player_phase: it starts the combat;
//                        enemy_phase: it does not; plain: no weapon art; beside_ally: an ally on
//                        a neighbouring tile; alone: no ally within `radius`). BlessingCombatMods.
//   army_mov_delta       Move for every player unit, a battle delta at a fresh start
//                        (`battleParams.battleDebuffs`, source 'army_move'); a joiner takes it
//                        too (BattleJoinBoons).
//   damage_dealt_scale   Player units' damage is scaled (floor, at least 1 on a blow that did
//                        damage): the `damageScale` combat mod (Combat.scaleDealtDamage).
//   weapon_weight_delta  Player units' weapons weigh less: the Attack Speed the lighter weapon
//                        gives, as a combat SPD bonus.
//   proc_chance_multiplier  Player units' skill proc odds scaled (SkillSystem.getActivationChance
//                        through the combat's skill context), at most 100.
//   enemy_affix_chance_multiplier  Foes roll affixes more often (`battleParams.affixChanceMultiplier`,
//                        AffixEngine).
//   weapon_art_hp_free   Player units' weapon arts cost no HP (WeaponArtSystem.weaponArtRunOptions).
//   loot_act_ahead       Battle loot is drawn from a later act's tables (never past Act IV), saved
//                        in the reward's draw (PendingBattleRewards), so a reroll draws the same.
//   loot_choice_delta    One fewer loot card to choose from (at least one), in the draw too.
//   xp_role_multiplier   Battle XP for the lowest-level (`role: 'lowest'`) or highest-level
//                        (`'highest'`) player unit on the field (`battleParams.xpRoleMultipliers`,
//                        BattleXp.scaledXp's `unitXpMultiplier`).
//   church_promotion_terms  A church promotes only units of `minLevel` and up, and at most
//                        `perVisit` units a visit (ChurchCommands.churchPromotionBlock).

import { ACT_SEQUENCE } from '../utils/constants.js';
import { calculateEffectiveWeight } from './Combat.js';
import { countAdjacentAllies, hasAllyWithin } from './SkillSystem.js';
import { getXpEffectiveLevel } from './UnitManager.js';
import { unitUidOf } from './UnitIdentity.js';

/** Which side of a card each type may stand on: a boon, a cost (`twist`), or either. */
export const TRADE_ROLES = Object.freeze({
  army_combat_delta: Object.freeze(['boon', 'twist']),
  army_mov_delta: Object.freeze(['boon', 'twist']),
  damage_dealt_scale: Object.freeze(['twist']),
  weapon_weight_delta: Object.freeze(['boon']),
  proc_chance_multiplier: Object.freeze(['boon']),
  enemy_affix_chance_multiplier: Object.freeze(['twist']),
  weapon_art_hp_free: Object.freeze(['boon']),
  loot_act_ahead: Object.freeze(['boon']),
  loot_choice_delta: Object.freeze(['twist']),
  xp_role_multiplier: Object.freeze(['boon', 'twist']),
  church_promotion_terms: Object.freeze(['twist']),
});
const TYPES = new Set(Object.keys(TRADE_ROLES));
/** The types a card's `boons` may name. */
export const TRADE_BOON_TYPES = Object.freeze(
  Object.keys(TRADE_ROLES).filter((type) => TRADE_ROLES[type].includes('boon')),
);
/** The types a card's `twist` may name (BlessingEngine.TWIST_EFFECT_TYPES lists them). */
export const TRADE_TWIST_TYPES = Object.freeze(
  Object.keys(TRADE_ROLES).filter((type) => TRADE_ROLES[type].includes('twist')),
);

/** The combat numbers `army_combat_delta` may move (its params' keys). */
export const COMBAT_DELTA_STATS = Object.freeze(['hit', 'avoid', 'crit', 'might', 'def', 'res']);
/** When an `army_combat_delta` applies. */
export const COMBAT_DELTA_WHEN = Object.freeze([
  'always',
  'player_phase',
  'enemy_phase',
  'plain',
  'beside_ally',
  'alone',
]);
/** The source the army's Move delta carries (`battleParams.battleDebuffs[].source`). */
export const ARMY_MOVE_SOURCE = 'army_move';
/** The acts whose loot tables an act-ahead draw may reach (the final act's pay gold only). */
const LOOT_ACTS = Object.freeze(ACT_SEQUENCE.filter((act) => /^act[1-4]$/.test(act)));

// Bounds that keep a typo from shipping a card that breaks the game.
const MAX_COMBAT_DELTA = 20;
const MAX_MOV_DELTA = 2;
const MIN_DAMAGE_SCALE = 0.5;
const MAX_WEIGHT_DELTA = 5;
const MAX_PROC_MULTIPLIER = 2;
const MAX_AFFIX_MULTIPLIER = 3;
const MAX_LOOT_ACT_AHEAD = 2;
const MAX_LOOT_CHOICE_CUT = 2;
const MAX_XP_ROLE_MULTIPLIER = 3;
const XP_ROLES = Object.freeze(['lowest', 'highest']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function combatDeltaErrors(params, role) {
  const errors = [];
  const values = [];
  for (const key of Object.keys(params)) {
    if (key === 'when' || key === 'radius') continue;
    if (!COMBAT_DELTA_STATS.includes(key)) {
      errors.push(`params.${key} is not one of ${COMBAT_DELTA_STATS.join(', ')}, when, radius`);
      continue;
    }
    const value = params[key];
    if (!(Number.isInteger(value) && Math.abs(value) <= MAX_COMBAT_DELTA && value !== 0))
      errors.push(`params.${key} must be a whole number from -20 to 20, not 0`);
    else values.push(value);
  }
  if (values.length === 0 && errors.length === 0)
    errors.push(`params must move one of ${COMBAT_DELTA_STATS.join(', ')}`);
  if (role === 'boon' && values.some((v) => v < 0))
    errors.push('a boon only raises (every number above 0)');
  if (role === 'twist' && values.some((v) => v > 0))
    errors.push('a cost only lowers (every number below 0)');
  const when = params.when ?? 'always';
  if (!COMBAT_DELTA_WHEN.includes(when))
    errors.push(`params.when must be one of ${COMBAT_DELTA_WHEN.join(', ')}`);
  if (params.radius !== undefined) {
    if (when !== 'alone') errors.push("params.radius belongs to when: 'alone' only");
    else if (!(Number.isInteger(params.radius) && params.radius >= 1 && params.radius <= 3))
      errors.push('params.radius must be a whole number from 1 to 3');
  }
  return errors;
}

/**
 * Why `effect` is not a usable effect of this module as a `role` ('boon' | 'twist'; [] when it
 * is, or when the type is not one of them). Without a role only the params are read.
 */
export function tradeEffectErrors(effect, role = null) {
  if (!TYPES.has(effect?.type)) return [];
  const params = effect.params;
  if (!isPlainObject(params)) return ['params must be an object'];
  const errors = [];
  if (role && !TRADE_ROLES[effect.type].includes(role))
    errors.push(role === 'boon' ? 'is a cost, never a boon' : 'is a boon, never a cost');
  const value = params.value;
  const signed = (positive, max, what) => {
    if (!(Number.isInteger(value) && value !== 0 && Math.abs(value) <= max))
      errors.push(`params.value must be a whole number from -${max} to ${max}, not 0 (${what})`);
    else if (role === 'boon' && value > 0 !== positive)
      errors.push(`params.value must be ${positive ? 'above' : 'below'} 0 as a boon`);
    else if (role === 'twist' && value > 0 === positive)
      errors.push(`params.value must be ${positive ? 'below' : 'above'} 0 as a cost`);
  };
  switch (effect.type) {
    case 'army_combat_delta':
      errors.push(...combatDeltaErrors(params, role));
      break;
    case 'army_mov_delta':
      signed(true, MAX_MOV_DELTA, 'Move');
      break;
    case 'damage_dealt_scale':
      if (!(isFiniteNumber(value) && value >= MIN_DAMAGE_SCALE && value < 1))
        errors.push(`params.value must be a share from ${MIN_DAMAGE_SCALE} to below 1`);
      break;
    case 'weapon_weight_delta':
      if (!(Number.isInteger(value) && value < 0 && value >= -MAX_WEIGHT_DELTA))
        errors.push(`params.value must be a whole number from -${MAX_WEIGHT_DELTA} to -1`);
      break;
    case 'proc_chance_multiplier':
      if (!(isFiniteNumber(value) && value > 1 && value <= MAX_PROC_MULTIPLIER))
        errors.push(`params.value must be above 1, at most ${MAX_PROC_MULTIPLIER}`);
      break;
    case 'enemy_affix_chance_multiplier':
      if (!(isFiniteNumber(value) && value > 1 && value <= MAX_AFFIX_MULTIPLIER))
        errors.push(`params.value must be above 1, at most ${MAX_AFFIX_MULTIPLIER}`);
      break;
    case 'weapon_art_hp_free':
      if (Object.keys(params).length) errors.push('params must be empty ({})');
      break;
    case 'loot_act_ahead':
      if (!(Number.isInteger(value) && value >= 1 && value <= MAX_LOOT_ACT_AHEAD))
        errors.push(`params.value must be a whole number from 1 to ${MAX_LOOT_ACT_AHEAD}`);
      break;
    case 'loot_choice_delta':
      if (!(Number.isInteger(value) && value < 0 && value >= -MAX_LOOT_CHOICE_CUT))
        errors.push(`params.value must be a whole number from -${MAX_LOOT_CHOICE_CUT} to -1`);
      break;
    case 'xp_role_multiplier':
      if (!XP_ROLES.includes(params.role))
        errors.push(`params.role must be one of ${XP_ROLES.join(', ')}`);
      if (!(isFiniteNumber(value) && value > 0 && value <= MAX_XP_ROLE_MULTIPLIER && value !== 1))
        errors.push(`params.value must be above 0, at most ${MAX_XP_ROLE_MULTIPLIER}, not 1`);
      else if (role === 'boon' && value < 1) errors.push('params.value must be above 1 as a boon');
      else if (role === 'twist' && value > 1) errors.push('params.value must be below 1 as a cost');
      break;
    case 'church_promotion_terms': {
      const { minLevel, perVisit } = params;
      if (minLevel === undefined && perVisit === undefined)
        errors.push('params must set minLevel or perVisit');
      if (
        minLevel !== undefined &&
        !(Number.isInteger(minLevel) && minLevel >= 2 && minLevel <= 20)
      )
        errors.push('params.minLevel must be a whole number from 2 to 20');
      if (perVisit !== undefined && !(Number.isInteger(perVisit) && perVisit >= 1 && perVisit <= 5))
        errors.push('params.perVisit must be a whole number from 1 to 5');
      break;
    }
    default:
      break;
  }
  return errors;
}

/** The runtime fields these effects raise, at their "none held" values. */
export function tradeBoonModifierDefaults() {
  return {
    // `[{ hit, avoid, crit, might, def, res, when, radius? }]`, one entry per grant.
    tradeCombatDeltas: [],
    armyMovDelta: 0,
    damageDealtScale: 1,
    weaponWeightDelta: 0,
    procChanceMultiplier: 1,
    enemyAffixChanceMultiplier: 1,
    weaponArtHpFree: false,
    lootActAhead: 0,
    lootChoiceDelta: 0,
    // Chronicle: the XP the lowest- and highest-level unit on the field earn (multipliers).
    xpRoleMultipliers: { lowest: 1, highest: 1 },
    // Kingmaker's Oath: `{ minLevel, perVisit }` while held (null when either is unset: none).
    churchPromotionTerms: null,
  };
}

/** A card's params as the held entry: every stat named (0 where the card moves none). */
function parseCombatDelta(raw) {
  if (!isPlainObject(raw) || combatDeltaErrors(raw, null).length) return null;
  return heldCombatDelta(raw);
}

function heldCombatDelta(raw) {
  const entry = { when: raw.when ?? 'always' };
  for (const stat of COMBAT_DELTA_STATS) entry[stat] = Number.isInteger(raw[stat]) ? raw[stat] : 0;
  if (entry.when === 'alone') entry.radius = Number.isInteger(raw.radius) ? raw.radius : 2;
  return entry;
}

/**
 * A held entry read back from a save (or from the run state on every read): the stored shape names
 * every stat, zeros included, which the card validator refuses, so it is checked on its own terms
 * (a known condition, whole numbers in bounds, at least one stat moved). Null when it is not one.
 */
function sanitizeHeldCombatDelta(raw) {
  if (!isPlainObject(raw)) return null;
  const when = raw.when ?? 'always';
  if (!COMBAT_DELTA_WHEN.includes(when)) return null;
  const stats = COMBAT_DELTA_STATS.map((stat) => raw[stat] ?? 0);
  if (!stats.every((v) => Number.isInteger(v) && Math.abs(v) <= MAX_COMBAT_DELTA)) return null;
  if (stats.every((v) => v === 0)) return null;
  const radius = Number.isInteger(raw.radius) ? Math.max(1, Math.min(3, raw.radius)) : 2;
  return heldCombatDelta({ ...raw, when, ...(when === 'alone' ? { radius } : {}) });
}

function parsePromotionTerms(raw) {
  if (!isPlainObject(raw)) return null;
  const minLevel = Number.isInteger(raw.minLevel) ? Math.max(1, Math.min(20, raw.minLevel)) : null;
  const perVisit = Number.isInteger(raw.perVisit) ? Math.max(1, Math.min(5, raw.perVisit)) : null;
  if (minLevel === null && perVisit === null) return null;
  return { minLevel, perVisit };
}

const clampNumber = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const clampInt = (value, min, max) => Math.max(min, Math.min(max, Math.trunc(Number(value)) || 0));

/** A saved runtime modifiers object's fields of this module put right (a save from before has none). */
export function sanitizeTradeBoonModifiers(mods) {
  if (!isPlainObject(mods)) return mods;
  mods.tradeCombatDeltas = (Array.isArray(mods.tradeCombatDeltas) ? mods.tradeCombatDeltas : [])
    .map(sanitizeHeldCombatDelta)
    .filter(Boolean);
  mods.armyMovDelta = clampInt(mods.armyMovDelta, -MAX_MOV_DELTA * 2, MAX_MOV_DELTA * 2);
  mods.damageDealtScale = clampNumber(mods.damageDealtScale, MIN_DAMAGE_SCALE ** 2, 1, 1);
  mods.weaponWeightDelta = clampInt(mods.weaponWeightDelta, -MAX_WEIGHT_DELTA * 2, 0);
  mods.procChanceMultiplier = clampNumber(mods.procChanceMultiplier, 1, MAX_PROC_MULTIPLIER, 1);
  mods.enemyAffixChanceMultiplier = clampNumber(
    mods.enemyAffixChanceMultiplier,
    1,
    MAX_AFFIX_MULTIPLIER,
    1,
  );
  mods.weaponArtHpFree = mods.weaponArtHpFree === true;
  mods.lootActAhead = clampInt(mods.lootActAhead, 0, MAX_LOOT_ACT_AHEAD);
  mods.lootChoiceDelta = clampInt(mods.lootChoiceDelta, -MAX_LOOT_CHOICE_CUT, 0);
  const roles = isPlainObject(mods.xpRoleMultipliers) ? mods.xpRoleMultipliers : {};
  mods.xpRoleMultipliers = {
    lowest: clampNumber(roles.lowest, 0, MAX_XP_ROLE_MULTIPLIER, 1),
    highest: clampNumber(roles.highest, 0, MAX_XP_ROLE_MULTIPLIER, 1),
  };
  mods.churchPromotionTerms = parsePromotionTerms(mods.churchPromotionTerms);
  return mods;
}

/**
 * Apply one of these effects to the run. Returns false when `effect` is not one of them (the
 * caller goes on to its other handlers). A malformed set changes nothing and is recorded as
 * skipped (`invalid_<type>_params`). Held as a boon or a cost alike: the sign rules are the
 * validator's (the data's), and two cards that move the same number add (or, for a share,
 * multiply).
 */
export function applyTradeBoon(run, blessingId, effect) {
  if (!TYPES.has(effect?.type)) return false;
  const record = (details) => run._recordBlessingEvent?.('run_start', blessingId, effect, details);
  if (tradeEffectErrors(effect).length > 0) {
    record({ skipped: true, reason: `invalid_${effect.type}_params` });
    return true;
  }
  const mods = run.blessingRuntimeModifiers;
  Object.assign(mods, sanitizeTradeBoonModifiers({ ...tradeBoonModifierDefaults(), ...mods }));
  const params = effect.params;
  const value = params.value;
  switch (effect.type) {
    case 'army_combat_delta': {
      const entry = parseCombatDelta(params);
      mods.tradeCombatDeltas = [...mods.tradeCombatDeltas, entry];
      record({ ...entry });
      break;
    }
    case 'army_mov_delta':
      mods.armyMovDelta += value;
      record({ appliedValue: value, total: mods.armyMovDelta });
      break;
    case 'damage_dealt_scale':
      mods.damageDealtScale = Math.max(MIN_DAMAGE_SCALE ** 2, mods.damageDealtScale * value);
      record({ appliedValue: value, total: mods.damageDealtScale });
      break;
    case 'weapon_weight_delta':
      mods.weaponWeightDelta = Math.max(-MAX_WEIGHT_DELTA * 2, mods.weaponWeightDelta + value);
      record({ appliedValue: value, total: mods.weaponWeightDelta });
      break;
    case 'proc_chance_multiplier':
      mods.procChanceMultiplier = Math.min(MAX_PROC_MULTIPLIER, mods.procChanceMultiplier * value);
      record({ appliedValue: value, total: mods.procChanceMultiplier });
      break;
    case 'enemy_affix_chance_multiplier':
      mods.enemyAffixChanceMultiplier = Math.min(
        MAX_AFFIX_MULTIPLIER,
        mods.enemyAffixChanceMultiplier * value,
      );
      record({ appliedValue: value, total: mods.enemyAffixChanceMultiplier });
      break;
    case 'weapon_art_hp_free':
      mods.weaponArtHpFree = true;
      record({});
      break;
    case 'loot_act_ahead':
      mods.lootActAhead = Math.min(MAX_LOOT_ACT_AHEAD, mods.lootActAhead + value);
      record({ appliedValue: value, total: mods.lootActAhead });
      break;
    case 'loot_choice_delta':
      mods.lootChoiceDelta = Math.max(-MAX_LOOT_CHOICE_CUT, mods.lootChoiceDelta + value);
      record({ appliedValue: value, total: mods.lootChoiceDelta });
      break;
    case 'xp_role_multiplier': {
      const held = mods.xpRoleMultipliers[params.role];
      mods.xpRoleMultipliers = {
        ...mods.xpRoleMultipliers,
        [params.role]: clampNumber(held * value, 0, MAX_XP_ROLE_MULTIPLIER, 1),
      };
      record({
        role: params.role,
        appliedValue: value,
        total: mods.xpRoleMultipliers[params.role],
      });
      break;
    }
    case 'church_promotion_terms': {
      const held = mods.churchPromotionTerms;
      // Two sets of terms: the stricter of each holds.
      const pick = (a, b, stricter) => (a === null ? b : b === null ? a : stricter(a, b));
      mods.churchPromotionTerms = parsePromotionTerms({
        minLevel: pick(held?.minLevel ?? null, params.minLevel ?? null, Math.max),
        perVisit: pick(held?.perVisit ?? null, params.perVisit ?? null, Math.min),
      });
      record({ ...mods.churchPromotionTerms });
      break;
    }
    default:
      break;
  }
  return true;
}

// ── Reads ────────────────────────────────────────────────────────────────

const modsOf = (run) => {
  const raw = run?.blessingRuntimeModifiers;
  if (!isPlainObject(raw)) return tradeBoonModifierDefaults();
  return sanitizeTradeBoonModifiers({ ...tradeBoonModifierDefaults(), ...raw });
};

/**
 * The run's trade cards as a combat reads them (RunManager.getBlessingCombatProfile's `trade`):
 * `{ deltas, damageScale, weightDelta, procMultiplier }`, null when none is held.
 */
export function tradeCombatProfileOf(run) {
  const mods = modsOf(run);
  const profile = {
    deltas: mods.tradeCombatDeltas,
    damageScale: mods.damageDealtScale,
    weightDelta: mods.weaponWeightDelta,
    procMultiplier: mods.procChanceMultiplier,
  };
  const none =
    profile.deltas.length === 0 &&
    profile.damageScale === 1 &&
    profile.weightDelta === 0 &&
    profile.procMultiplier === 1;
  return none ? null : profile;
}

function combatDeltaApplies(entry, side) {
  switch (entry.when) {
    case 'player_phase':
      return side.initiating === true;
    case 'enemy_phase':
      return side.initiating !== true;
    case 'plain':
      return side.weaponArt !== true;
    case 'beside_ally':
      return countAdjacentAllies(side.unit, side.allies) > 0;
    case 'alone':
      return !hasAllyWithin(side.unit, side.allies, entry.radius ?? 2);
    default:
      return true;
  }
}

/**
 * What the trade cards add to one player unit's side of a combat (BlessingCombatMods adds it):
 * `{ hitBonus, avoidBonus, critBonus, atkBonus, defBonus, resBonus, spdBonus, damageScale,
 * procChanceMultiplier }`. `side` = { unit, initiating, allies, weapon, weaponArt }. A foe or an
 * NPC ally gets nothing.
 */
export function tradeCombatModsFor(trade, side) {
  const out = {
    hitBonus: 0,
    avoidBonus: 0,
    critBonus: 0,
    atkBonus: 0,
    defBonus: 0,
    resBonus: 0,
    spdBonus: 0,
    damageScale: 1,
    procChanceMultiplier: 1,
  };
  const unit = side?.unit;
  if (!trade || unit?.faction !== 'player') return out;
  for (const entry of trade.deltas || []) {
    if (!combatDeltaApplies(entry, side)) continue;
    out.hitBonus += entry.hit || 0;
    out.avoidBonus += entry.avoid || 0;
    out.critBonus += entry.crit || 0;
    out.atkBonus += entry.might || 0;
    out.defBonus += entry.def || 0;
    out.resBonus += entry.res || 0;
  }
  out.damageScale = Number(trade.damageScale) > 0 ? Math.min(1, trade.damageScale) : 1;
  out.procChanceMultiplier = Number(trade.procMultiplier) > 1 ? trade.procMultiplier : 1;
  // A lighter weapon: the Attack Speed it gives back, never more than its weight costs now.
  const weapon = side.weapon;
  const weightDelta = Math.trunc(Number(trade.weightDelta) || 0);
  if (weapon?.weight && weightDelta < 0 && unit.stats) {
    const lighter = { ...weapon, weight: Math.max(0, weapon.weight + weightDelta) };
    out.spdBonus +=
      calculateEffectiveWeight(weapon, unit) - calculateEffectiveWeight(lighter, unit);
  }
  return out;
}

/** The share foes roll affixes at (1 without Gambler's Edge). */
export function enemyAffixChanceMultiplierOf(run) {
  return modsOf(run).enemyAffixChanceMultiplier;
}

/**
 * The army's Move delta as battle-start deltas, uid-keyed in the shape of
 * `battleParams.battleDebuffs` (BattleStatDeltas.applyBattleStartDebuffs): every roster unit with
 * a uid. None while no card moves it.
 */
export function armyMovBattleDeltas(run) {
  const value = modsOf(run).armyMovDelta;
  if (value === 0) return [];
  return (Array.isArray(run?.roster) ? run.roster : []).flatMap((unit) =>
    unitArmyMovBattleDeltas(unit, value),
  );
}

/** One unit's share of `armyMovBattleDeltas` (a joiner's too, engine/BattleJoinBoons.js). */
export function unitArmyMovBattleDeltas(unit, value) {
  const uid = unitUidOf(unit);
  const delta = Math.trunc(Number(value) || 0);
  if (!uid || delta === 0) return [];
  return [{ unitUid: uid, stat: 'MOV', value: delta, source: ARMY_MOVE_SOURCE }];
}

/** The run's army Move delta (0 without a card that moves it). */
export function armyMovDeltaOf(run) {
  return modsOf(run).armyMovDelta;
}

/** True while player units' weapon arts cost no HP (Way of the Art). */
export function weaponArtHpFreeOf(run) {
  return modsOf(run).weaponArtHpFree;
}

/**
 * The act a battle's loot is drawn from with Collector's Eye: `actId` moved `lootActAhead` acts
 * on, never past Act IV (the final act's tables pay gold only); an act outside Acts I-IV is kept.
 */
export function lootActAheadOf(run, actId) {
  const ahead = modsOf(run).lootActAhead;
  const index = LOOT_ACTS.indexOf(actId);
  if (ahead <= 0 || index < 0) return actId;
  return LOOT_ACTS[Math.min(LOOT_ACTS.length - 1, index + ahead)];
}

/** How many loot cards fewer a battle offers (0 or negative). */
export function lootChoiceDeltaOf(run) {
  return modsOf(run).lootChoiceDelta;
}

/** Chronicle's multipliers (`{ lowest, highest }`), null when both are 1. */
export function xpRoleMultipliersOf(run) {
  const roles = modsOf(run).xpRoleMultipliers;
  return roles.lowest === 1 && roles.highest === 1 ? null : { ...roles };
}

/**
 * The XP multiplier `unit` earns under Chronicle (`roles`, from `battleParams.xpRoleMultipliers`):
 * among the living player units on the field (`units`; two at least, else 1), the one with the
 * lowest XP level (UnitManager.getXpEffectiveLevel: a promoted unit counts 12 higher) earns
 * `roles.lowest`, the highest `roles.highest`; ties go by experience, then by roster order, so
 * exactly one unit holds each role. Read as each award is made, so a unit that levels past
 * another hands the role on.
 */
export function xpRoleMultiplierFor(unit, units, roles) {
  if (!unit || !isPlainObject(roles)) return 1;
  const field = (Array.isArray(units) ? units : []).filter(
    (u) => u && u.faction === 'player' && (Number(u.currentHP) || 0) > 0,
  );
  if (field.length < 2 || !field.includes(unit)) return 1;
  const ranked = field
    .map((u, order) => ({
      u,
      order,
      level: getXpEffectiveLevel(u),
      xp: Number(u.xp) || 0,
    }))
    .sort((a, b) => a.level - b.level || a.xp - b.xp || a.order - b.order);
  let multiplier = 1;
  if (ranked[0].u === unit) multiplier *= Number(roles.lowest) > 0 ? roles.lowest : 1;
  if (ranked[ranked.length - 1].u === unit)
    multiplier *= Number(roles.highest) > 0 ? roles.highest : 1;
  return multiplier;
}

/** Kingmaker's Oath's terms (`{ minLevel, perVisit }`, either null), or null without them. */
export function churchPromotionTermsOf(run) {
  return modsOf(run).churchPromotionTerms;
}
