// ShrineBoons.js - the boons of the rest of the §5 starting blessings (docs/specs/blessings-v3.md
// §5, blessings v3 PR D4): Late Bloom, Dawn Tithe, Cavalier's Hour, Saint's Reserve, Cutpurse's
// Luck, Open Roll, Watcher's Grace, Patient Dawn, Twin Chapel, Omen Reader and Lottery Loot.
// (Lone Banner is two existing boons and an intrinsic price; it needs nothing here.)
//
// One place for each boon's params (the validator's errors and the handler's parse are the same
// reading, so a card the validator passes never ships doing nothing), for the run state the
// boons keep (`blessingRuntimeModifiers`, saved; a save from before has none and reads the
// defaults) and for the pure reads the systems they ride on make. Pure: no Phaser, no DOM, never
// `Math.random`.
//
// Where each boon acts:
//   act_clear_army_stats   Late Bloom: an act-start grant (`kind: 'army_stats'`) paid by
//                          RunManager._payActStartGrants as each later act begins.
//   under_par_gold         Dawn Tithe: PendingBattleRewards.prepareBattleRewards, beside the turn
//                          bonus, so a Debt never garnishes it (`dawnTitheGold`).
//   move_type_battle_stats Cavalier's Hour: battle stat deltas in `battleParams.battleDebuffs`
//                          (`moveTypeBattleDeltas`), applied at a fresh start only.
//   staff_uses_bonus       Saint's Reserve: engine/StaffBlessings.js `staffRunOptions`.
//   carrier_luck           Cutpurse's Luck: `battleParams.carryPasses` (EnemyCarry rolls a second
//                          pass on its own stream) and Steal's `ignoreSpeed` (`stealRunOptions`).
//   recruit_alternate      Open Roll: RecruitNodeSystem.ensureRecruitAlternates and
//                          RunManager.swapRecruitCandidate.
//   boss_battle_vision     Watcher's Grace: RunManager.beginBattleInProgress / completeBattle.
//   par_turn_delta         Patient Dawn: `battleParams.blessingParTurns`, added last by
//                          TurnBonusCalculator.calculatePar.
//   church_extra_vows      Twin Chapel: engine/ChurchVow.js.
//   eclipse_omen           Omen Reader: EclipseSystem `spareTypes` and the view's `foretold`.
//   next_act_loot_card     Lottery Loot: PendingBattleRewards (engine/LotteryLoot.js).

import { CHURCH_VOWS, XP_STAT_NAMES } from '../utils/constants.js';
import { unitUidOf } from './UnitIdentity.js';

export const SHRINE_BOON_TYPES = Object.freeze([
  'act_clear_army_stats',
  'under_par_gold',
  'move_type_battle_stats',
  'staff_uses_bonus',
  'carrier_luck',
  'recruit_alternate',
  'boss_battle_vision',
  'par_turn_delta',
  'church_extra_vows',
  'eclipse_omen',
  'next_act_loot_card',
]);

/** The move types a class can have (classes.json). */
export const MOVE_TYPES = Object.freeze(['Infantry', 'Cavalry', 'Flying', 'Armored']);
/** The stats Cavalier's Hour may raise for a battle: the combat stats and Move. */
const BATTLE_STATS = Object.freeze([...XP_STAT_NAMES, 'MOV']);
/** The node types Omen Reader may spare (EclipseSystem's fallable types but plain battles). */
export const SPARABLE_NODE_TYPES = Object.freeze([
  'recruit',
  'shop',
  'church',
  'colosseum',
  'event',
]);
// Bounds that keep a typo from shipping a card that breaks the game.
const MAX_ARMY_STATS = 3;
const MAX_FORETELL = 5;
const MAX_LOTTERY_CARDS = 2;
const MAX_CARRY_MULTIPLIER = 4;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function positiveIntErrors(params, key, max = Infinity) {
  if (!isPlainObject(params)) return ['params must be an object'];
  const value = params[key];
  if (!isPositiveInteger(value)) return [`params.${key} must be a positive integer`];
  if (value > max) return [`params.${key} must be at most ${max}`];
  return [];
}

function moveTypeBonusErrors(params) {
  if (!isPlainObject(params)) return ['params must be an object'];
  if (!Array.isArray(params.bonuses) || params.bonuses.length === 0)
    return ['params.bonuses must list at least one { moveTypes, stat, value }'];
  const errors = [];
  const seen = new Set();
  params.bonuses.forEach((bonus, i) => {
    const at = `params.bonuses[${i}]`;
    if (!isPlainObject(bonus)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (
      !Array.isArray(bonus.moveTypes) ||
      bonus.moveTypes.length === 0 ||
      !bonus.moveTypes.every((t) => MOVE_TYPES.includes(t))
    )
      errors.push(`${at}.moveTypes must list move types from ${MOVE_TYPES.join('/')}`);
    else
      for (const t of bonus.moveTypes) {
        if (seen.has(t)) errors.push(`${at}.moveTypes repeats ${t} (one bonus per move type)`);
        seen.add(t);
      }
    if (!BATTLE_STATS.includes(bonus.stat))
      errors.push(`${at}.stat must be one of ${BATTLE_STATS.join('/')}`);
    if (!isPositiveInteger(bonus.value)) errors.push(`${at}.value must be a positive integer`);
  });
  return errors;
}

function carrierLuckErrors(params) {
  if (!isPlainObject(params)) return ['params must be an object'];
  const errors = [];
  const multiplier = params.carryMultiplier ?? 1;
  if (!Number.isInteger(multiplier) || multiplier < 1 || multiplier > MAX_CARRY_MULTIPLIER)
    errors.push(`params.carryMultiplier must be an integer from 1 to ${MAX_CARRY_MULTIPLIER}`);
  if (params.stealIgnoresSpeed !== undefined && typeof params.stealIgnoresSpeed !== 'boolean')
    errors.push('params.stealIgnoresSpeed must be true or false');
  if (!errors.length && multiplier === 1 && params.stealIgnoresSpeed !== true)
    errors.push('params change nothing (no extra carriers and no speed waiver)');
  return errors;
}

function eclipseOmenErrors(params) {
  if (!isPlainObject(params)) return ['params must be an object'];
  const errors = [];
  const foretell = params.foretell ?? 0;
  if (!Number.isInteger(foretell) || foretell < 0 || foretell > MAX_FORETELL)
    errors.push(`params.foretell must be an integer from 0 to ${MAX_FORETELL}`);
  const spare = params.spare ?? [];
  if (!Array.isArray(spare) || !spare.every((t) => SPARABLE_NODE_TYPES.includes(t)))
    errors.push(`params.spare must list node types from ${SPARABLE_NODE_TYPES.join('/')}`);
  if (!errors.length && foretell === 0 && spare.length === 0)
    errors.push('params change nothing (no foretold falls and nothing spared)');
  return errors;
}

/**
 * Why `params` is not a usable boon of `type` (empty when it is), or null when `type` is not one
 * of these boons. The validator (BlessingEngine.validateBoonParams) and the handler share it.
 * @returns {string[]|null}
 */
export function shrineBoonErrors(type, params) {
  switch (type) {
    case 'act_clear_army_stats':
      return positiveIntErrors(params, 'value', MAX_ARMY_STATS);
    case 'under_par_gold':
      return positiveIntErrors(params, 'perTurn');
    case 'move_type_battle_stats':
      return moveTypeBonusErrors(params);
    case 'staff_uses_bonus':
    case 'boss_battle_vision':
    case 'par_turn_delta':
      return positiveIntErrors(params, 'value');
    case 'carrier_luck':
      return carrierLuckErrors(params);
    case 'recruit_alternate':
      // One alternate per node: the loom shows two candidates, never three.
      return positiveIntErrors(params, 'value', 1);
    case 'church_extra_vows':
      // A church has three vows; at most every one of them.
      return positiveIntErrors(params, 'value', CHURCH_VOWS.length - 1);
    case 'eclipse_omen':
      return eclipseOmenErrors(params);
    case 'next_act_loot_card':
      return positiveIntErrors(params, 'count', MAX_LOTTERY_CARDS);
    default:
      return null;
  }
}

/** The run state these boons keep, as a fresh run holds it (nothing held). */
export function createShrineBoonModifiers() {
  return {
    // Dawn Tithe: gold per turn under the map's own par at each victory.
    underParGoldPerTurn: 0,
    // Cavalier's Hour: `[{ moveTypes, stat, value }]`, battle-scoped stat deltas.
    moveTypeBattleStats: [],
    // Saint's Reserve: extra uses each of a player unit's staves has in each battle.
    staffUsesBonus: 0,
    // Cutpurse's Luck: how many carry rolls a battle makes (1 = the rung's own), and whether a
    // player unit's Steal skips its speed check.
    carryMultiplier: 1,
    stealIgnoresSpeed: false,
    // Open Roll: alternates each recruit node shows (0 or 1).
    recruitAlternates: 0,
    // Watcher's Grace: Vision charges granted for each boss map, taken back unspent.
    bossBattleVision: 0,
    // Patient Dawn: turns added to every battle's par.
    parTurnDelta: 0,
    // Twin Chapel: vows each church accepts beyond the first.
    extraChurchVows: 0,
    // Omen Reader: how many of the next falls the route map marks, and node types never taken.
    eclipseForetell: 0,
    eclipseSpareTypes: [],
    // Lottery Loot: battle loot cards drawn from the next act's table.
    nextActLootCards: 0,
  };
}

const nonNegInt = (value, max = Infinity) =>
  Math.min(max, Math.max(0, Math.trunc(Number(value) || 0)));

/**
 * Normalise a saved run's shrine-boon state in place: a save from before PR D4 (or a hand-edited
 * one) reads the defaults, and nothing malformed survives a load.
 */
export function sanitizeShrineBoonModifiers(mods) {
  if (!isPlainObject(mods)) return mods;
  mods.underParGoldPerTurn = nonNegInt(mods.underParGoldPerTurn);
  mods.moveTypeBattleStats = (
    Array.isArray(mods.moveTypeBattleStats) ? mods.moveTypeBattleStats : []
  ).filter((bonus) => moveTypeBonusErrors({ bonuses: [bonus] }).length === 0);
  mods.staffUsesBonus = nonNegInt(mods.staffUsesBonus);
  mods.carryMultiplier = Math.max(1, nonNegInt(mods.carryMultiplier, MAX_CARRY_MULTIPLIER) || 1);
  mods.stealIgnoresSpeed = mods.stealIgnoresSpeed === true;
  mods.recruitAlternates = nonNegInt(mods.recruitAlternates, 1);
  mods.bossBattleVision = nonNegInt(mods.bossBattleVision);
  mods.parTurnDelta = nonNegInt(mods.parTurnDelta);
  mods.extraChurchVows = nonNegInt(mods.extraChurchVows, CHURCH_VOWS.length - 1);
  mods.eclipseForetell = nonNegInt(mods.eclipseForetell, MAX_FORETELL);
  mods.eclipseSpareTypes = [
    ...new Set(
      (Array.isArray(mods.eclipseSpareTypes) ? mods.eclipseSpareTypes : []).filter((t) =>
        SPARABLE_NODE_TYPES.includes(t),
      ),
    ),
  ];
  mods.nextActLootCards = nonNegInt(mods.nextActLootCards, MAX_LOTTERY_CARDS);
  return mods;
}

/** The held shrine-boon state of a run, normalised (a run without any reads the defaults). */
export function shrineBoonsOf(run) {
  const mods = run?.blessingRuntimeModifiers;
  const held = createShrineBoonModifiers();
  if (!isPlainObject(mods)) return held;
  for (const key of Object.keys(held)) if (key in mods) held[key] = mods[key];
  return sanitizeShrineBoonModifiers(held);
}

/**
 * Apply one of these boons to the run. Returns the details its history record carries (with
 * `skipped` and an `invalid_<type>_params` reason for malformed params), or null when `effect`
 * is not one of these boons. Mutates `run.blessingRuntimeModifiers` (and, for Late Bloom, the
 * act-start grants; for Open Roll, the current map's recruit nodes).
 */
export function applyShrineBoon(run, blessingId, effect) {
  const type = effect?.type;
  const errors = shrineBoonErrors(type, effect?.params);
  if (errors === null) return null;
  if (errors.length > 0) return { skipped: true, reason: `invalid_${type}_params` };
  const params = effect.params;
  const mods = run.blessingRuntimeModifiers;
  Object.assign(mods, sanitizeShrineBoonModifiers({ ...createShrineBoonModifiers(), ...mods }));
  switch (type) {
    case 'act_clear_army_stats': {
      // Late Bloom pays "as each act ends": the act it is taken in counts as paid, so the first
      // payment is the next act's (RunManager._payActStartGrants).
      run._actStartGrantList().push({
        blessingId,
        kind: 'army_stats',
        value: params.value,
        paidActs: [run.currentAct].filter(Boolean),
      });
      return { recurringValue: params.value, firstPayment: 'next_act' };
    }
    case 'under_par_gold':
      mods.underParGoldPerTurn += params.perTurn;
      return { perTurn: params.perTurn, total: mods.underParGoldPerTurn };
    case 'move_type_battle_stats':
      mods.moveTypeBattleStats = [
        ...mods.moveTypeBattleStats,
        ...params.bonuses.map((b) => ({
          moveTypes: [...b.moveTypes],
          stat: b.stat,
          value: b.value,
        })),
      ];
      return { bonuses: params.bonuses.length };
    case 'staff_uses_bonus':
      mods.staffUsesBonus += params.value;
      return { appliedValue: params.value, total: mods.staffUsesBonus };
    case 'carrier_luck': {
      const multiplier = params.carryMultiplier ?? 1;
      mods.carryMultiplier = Math.min(
        MAX_CARRY_MULTIPLIER,
        Math.max(mods.carryMultiplier, multiplier),
      );
      if (params.stealIgnoresSpeed === true) mods.stealIgnoresSpeed = true;
      return { carryMultiplier: mods.carryMultiplier, stealIgnoresSpeed: mods.stealIgnoresSpeed };
    }
    case 'recruit_alternate': {
      mods.recruitAlternates = 1;
      // The current map's recruit nodes show their second candidate from now on.
      const created =
        typeof run.ensureRecruitPreviews === 'function' ? run.ensureRecruitPreviews() : 0;
      return { recruitAlternates: 1, created };
    }
    case 'boss_battle_vision':
      mods.bossBattleVision += params.value;
      return { appliedValue: params.value, total: mods.bossBattleVision };
    case 'par_turn_delta':
      mods.parTurnDelta += params.value;
      return { appliedValue: params.value, total: mods.parTurnDelta };
    case 'church_extra_vows':
      mods.extraChurchVows = Math.min(CHURCH_VOWS.length - 1, mods.extraChurchVows + params.value);
      return { appliedValue: params.value, total: mods.extraChurchVows };
    case 'eclipse_omen':
      mods.eclipseForetell = Math.max(mods.eclipseForetell, params.foretell ?? 0);
      mods.eclipseSpareTypes = [...new Set([...mods.eclipseSpareTypes, ...(params.spare ?? [])])];
      return { foretell: mods.eclipseForetell, spare: [...mods.eclipseSpareTypes] };
    case 'next_act_loot_card':
      mods.nextActLootCards = Math.min(MAX_LOTTERY_CARDS, mods.nextActLootCards + params.count);
      return { appliedValue: params.count, total: mods.nextActLootCards };
    default:
      return null;
  }
}

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * Dawn Tithe: the gold a victory pays for the turns it came in under the map's OWN par (Patient
 * Dawn's added turns are taken off first, so holding both never pays for turns the par was only
 * stretched by: docs, D-18). Nothing without a par, or at or over it.
 * @param {{ perTurn: number, turnPar: number|null, parTurnDelta?: number, turnNumber: number }} input
 */
export function dawnTitheGold({ perTurn, turnPar, parTurnDelta = 0, turnNumber }) {
  const rate = nonNegInt(perTurn);
  if (rate <= 0 || !Number.isFinite(turnPar) || !Number.isFinite(turnNumber)) return 0;
  const ownPar = Math.trunc(turnPar) - nonNegInt(parTurnDelta);
  const under = Math.max(0, ownPar - Math.trunc(turnNumber));
  return under * rate;
}

/**
 * A unit's move type now: its own field (kept in step with its class by
 * UnitManager.normalizeUnitClassState), else its class's.
 */
export function unitMoveType(unit, classes = []) {
  if (typeof unit?.moveType === 'string' && MOVE_TYPES.includes(unit.moveType))
    return unit.moveType;
  const cls = (Array.isArray(classes) ? classes : []).find((c) => c?.name === unit?.className);
  return MOVE_TYPES.includes(cls?.moveType) ? cls.moveType : null;
}

/**
 * Cavalier's Hour: the battle stat deltas each roster unit starts a battle with, by its move
 * type now (a unit promoted onto a horse takes the mounted bonus). The shape of
 * `battleParams.battleDebuffs` (BattleStatDeltas.applyBattleStartDebuffs): uid-keyed, applied at
 * a fresh start only and taken back with every battle delta when the battle ends.
 * @returns {Array<{ unitUid: string, stat: string, value: number, source: string }>}
 */
export function moveTypeBattleDeltas(run, classes = run?.gameData?.classes || []) {
  const bonuses = shrineBoonsOf(run).moveTypeBattleStats;
  if (bonuses.length === 0) return [];
  const deltas = [];
  for (const unit of Array.isArray(run?.roster) ? run.roster : []) {
    const uid = unitUidOf(unit);
    const moveType = unitMoveType(unit, classes);
    if (!uid || !moveType) continue;
    for (const bonus of bonuses)
      if (bonus.moveTypes.includes(moveType))
        deltas.push({
          unitUid: uid,
          stat: bonus.stat,
          value: bonus.value,
          source: 'cavaliers_hour',
        });
  }
  return deltas;
}

/** Steal's run options for `thief` (Cutpurse's Luck): a player unit's speed check waived. */
export function stealRunOptions(run, thief) {
  if (thief?.faction !== 'player') return {};
  return shrineBoonsOf(run).stealIgnoresSpeed ? { ignoreSpeed: true } : {};
}
