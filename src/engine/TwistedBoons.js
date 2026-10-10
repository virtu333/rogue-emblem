// TwistedBoons.js - the boons and twists of the twisted earned blessings (docs/specs/blessings-v3.md
// §6.2, blessings v3 PR D3): Darkened Dawn, Blood Covenant, Kingmaker's Oath and Hollow Sun's
// Favor. Each is offered by an act boss only and taken knowingly: its `twist` is applied after its
// boons (RunManager.addBlessingMidRun's `price`) and held as its price.
//
// One place for each new effect's params (the validator's errors and the handler's parse are the
// same reading, so a card the validator passes never ships doing nothing), for the run state the
// effects keep (`blessingRuntimeModifiers`, saved; a save from before has none and reads the
// defaults) and for the pure reads the systems they ride on make. Pure: no Phaser, no DOM, never
// `Math.random`.
//
// Where each effect acts:
//   army_stat_bonus               Blood Covenant (boon): +value to every stat but Move, once per
//                                 unit (`unit.recruitBlessingGrants` holds the key): the roster and
//                                 the fallen at the take, every later joiner through
//                                 RunManager.grantRecruitBlessingConsumables, a revived ally kept.
//   kingmaker_promotion           Kingmaker's Oath (boon): a church promotion costs nothing
//                                 (ChurchCommands.churchPromoteCost) and adds `bonus` to the
//                                 `stats` stats the class's promotion bonuses favour.
//   loot_gold_multiplier_delta    Hollow Sun's Favor (boon): gold loot cards are worth more; read
//                                 into the reward's draw params (PendingBattleRewards), so a
//                                 Branching Threads reroll pays the same.
//   eclipse_gain_multiplier_delta Darkened Dawn (twist): each victory's shadow gain grows by the
//                                 share, in exact quarters with a saved carry (`scaledShadowGain`,
//                                 the one helper the projection and the commit read).
//   master_seals_forbidden        Kingmaker's Oath (twist): a Master Seal is refused on every path
//                                 (`classChangeItemBlock`); the reclass seals still work.
// (Blood Covenant's and Hollow Sun's twists are burdens: engine/Burdens.js, `permanent` and
// `actsAhead`.)

import { XP_STAT_NAMES } from '../utils/constants.js';
import { setUnitHP } from './UnitHealth.js';
import { unitUidOf } from './UnitIdentity.js';

/** The boons these cards add. */
export const TWISTED_BOON_TYPES = Object.freeze([
  'army_stat_bonus',
  'kingmaker_promotion',
  'loot_gold_multiplier_delta',
]);
/** The twist effects these cards add (BlessingEngine.TWIST_EFFECT_TYPES lists them). */
export const TWISTED_TWIST_TYPES = Object.freeze([
  'eclipse_gain_multiplier_delta',
  'master_seals_forbidden',
]);
const TYPES = new Set([...TWISTED_BOON_TYPES, ...TWISTED_TWIST_TYPES]);

// Bounds that keep a typo from shipping a card that breaks the game.
const MAX_ARMY_STAT_BONUS = 3;
const MAX_KINGMAKER_BONUS = 5;
const MAX_LOOT_GOLD_DELTA = 2;
/** The Eclipse's gain share moves in quarters (the carry is exact in quarter units). */
export const ECLIPSE_GAIN_STEP = 0.25;
const MAX_ECLIPSE_GAIN_QUARTERS = 8; // at most twice as fast, whatever is held

/** The words a refused Master Seal shows (the roster sheet, the battle menu, the convoy). */
export const MASTER_SEAL_BANNED =
  "Kingmaker's Oath: Master Seals can't be used. Promote at a church.";

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const isPositiveInt = (value) => Number.isInteger(value) && value > 0;
const isQuarter = (value) =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value * 4);

/**
 * Why `effect` is not a usable effect of this module ([] when it is, or when the type is not one
 * of them).
 */
export function twistedEffectErrors(effect) {
  const params = effect?.params;
  if (!isPlainObject(params)) return TYPES.has(effect?.type) ? ['params must be an object'] : [];
  switch (effect.type) {
    case 'army_stat_bonus':
      return isPositiveInt(params.value) && params.value <= MAX_ARMY_STAT_BONUS
        ? []
        : [`params.value must be a whole number from 1 to ${MAX_ARMY_STAT_BONUS}`];
    case 'kingmaker_promotion': {
      const errors = [];
      if (!(isPositiveInt(params.bonus) && params.bonus <= MAX_KINGMAKER_BONUS))
        errors.push(`params.bonus must be a whole number from 1 to ${MAX_KINGMAKER_BONUS}`);
      if (!(isPositiveInt(params.stats) && params.stats <= XP_STAT_NAMES.length))
        errors.push(`params.stats must be a whole number from 1 to ${XP_STAT_NAMES.length}`);
      return errors;
    }
    case 'loot_gold_multiplier_delta':
      return typeof params.value === 'number' &&
        Number.isFinite(params.value) &&
        params.value > 0 &&
        params.value <= MAX_LOOT_GOLD_DELTA
        ? []
        : [`params.value must be a share above 0, at most ${MAX_LOOT_GOLD_DELTA}`];
    case 'eclipse_gain_multiplier_delta':
      // A quarter step keeps the carry exact (quarter units, never a float drifting over a run).
      return isQuarter(params.value) && params.value > 0 && params.value <= 1
        ? []
        : ['params.value must be a positive multiple of 0.25, at most 1'];
    case 'master_seals_forbidden':
      return Object.keys(params).length === 0 ? [] : ['params must be empty ({})'];
    default:
      return [];
  }
}

/** The runtime fields these effects raise, at their "none held" values. */
export function twistedBoonModifierDefaults() {
  return {
    // Darkened Dawn: the share each victory's shadow gain grows by (quarters), and the quarter
    // units carried to the next victory (0-3), so 25% faster is exact over a run.
    eclipseGainDelta: 0,
    eclipseGainCarry: 0,
    // Kingmaker's Oath: `{ bonus, stats }` while held, and its twist (no Master Seal).
    kingmakerPromotion: null,
    masterSealsForbidden: false,
    // Hollow Sun's Favor: the share gold loot cards gain.
    lootGoldMultiplierDelta: 0,
  };
}

const quartersOf = (share) =>
  Math.max(0, Math.min(MAX_ECLIPSE_GAIN_QUARTERS, Math.round((Number(share) || 0) * 4)));
const carryOf = (value) => Math.max(0, Math.min(3, Math.trunc(Number(value)) || 0));

function parseKingmaker(raw) {
  if (twistedEffectErrors({ type: 'kingmaker_promotion', params: raw }).length) return null;
  return { bonus: raw.bonus, stats: raw.stats };
}

/** A saved runtime modifiers object's fields of this module put right (a save from before has none). */
export function sanitizeTwistedBoonModifiers(mods) {
  if (!isPlainObject(mods)) return mods;
  mods.eclipseGainDelta = quartersOf(mods.eclipseGainDelta) / 4;
  mods.eclipseGainCarry = mods.eclipseGainDelta > 0 ? carryOf(mods.eclipseGainCarry) : 0;
  mods.kingmakerPromotion = isPlainObject(mods.kingmakerPromotion)
    ? parseKingmaker(mods.kingmakerPromotion)
    : null;
  mods.masterSealsForbidden = mods.masterSealsForbidden === true;
  const loot = Number(mods.lootGoldMultiplierDelta);
  mods.lootGoldMultiplierDelta =
    Number.isFinite(loot) && loot > 0 ? Math.min(MAX_LOOT_GOLD_DELTA, loot) : 0;
  return mods;
}

/**
 * Apply one of these effects to the run. Returns false when `effect` is not one of them (the
 * caller goes on to its other handlers). A malformed set changes nothing and is recorded as
 * skipped (`invalid_<type>_params`).
 */
export function applyTwistedBoon(run, blessingId, effect) {
  if (!TYPES.has(effect?.type)) return false;
  const record = (details) => run._recordBlessingEvent?.('run_start', blessingId, effect, details);
  if (twistedEffectErrors(effect).length > 0) {
    record({ skipped: true, reason: `invalid_${effect.type}_params` });
    return true;
  }
  const mods = run.blessingRuntimeModifiers;
  Object.assign(mods, sanitizeTwistedBoonModifiers({ ...twistedBoonModifierDefaults(), ...mods }));
  const params = effect.params;
  switch (effect.type) {
    case 'army_stat_bonus': {
      // The roster and the fallen now (a revived ally has kept pace); a joiner on joining.
      const units = [...(run.roster || []), ...(run.fallenUnits || [])].filter((u) => u?.stats);
      const fallen = new Set(run.fallenUnits || []);
      const reached = [];
      for (const unit of units)
        if (grantArmyStatBonus(unit, blessingId, params.value, { fallen: fallen.has(unit) }))
          reached.push(unitUidOf(unit));
      record({ appliedValue: params.value, units: reached });
      break;
    }
    case 'kingmaker_promotion': {
      const held = mods.kingmakerPromotion;
      // Two oaths do not make a bigger king: the stronger one holds.
      mods.kingmakerPromotion = held
        ? { bonus: Math.max(held.bonus, params.bonus), stats: Math.max(held.stats, params.stats) }
        : { bonus: params.bonus, stats: params.stats };
      record({ ...mods.kingmakerPromotion });
      break;
    }
    case 'loot_gold_multiplier_delta':
      mods.lootGoldMultiplierDelta = Math.min(
        MAX_LOOT_GOLD_DELTA,
        mods.lootGoldMultiplierDelta + params.value,
      );
      record({ appliedValue: params.value, total: mods.lootGoldMultiplierDelta });
      break;
    case 'eclipse_gain_multiplier_delta':
      mods.eclipseGainDelta = quartersOf(mods.eclipseGainDelta + params.value) / 4;
      record({ appliedValue: params.value, total: mods.eclipseGainDelta });
      break;
    case 'master_seals_forbidden':
      mods.masterSealsForbidden = true;
      record({});
      break;
    default:
      break;
  }
  return true;
}

// ── Blood Covenant ───────────────────────────────────────────────────────

/** The key a unit carries once Blood Covenant's bonus has reached it (one per blessing). */
export function armyStatBonusKey(blessingId) {
  return `${blessingId}:army_stat_bonus`;
}

/**
 * Give one unit Blood Covenant's +value to every stat but Move, once: a unit already holding the
 * key is left alone (a reload, a second call, a revival). A living unit's HP gain raises its
 * current HP with it (UnitHealth); a fallen unit gains none (a revival sets it).
 * @returns {boolean} true when the bonus was given now
 */
export function grantArmyStatBonus(unit, blessingId, value, { fallen = false } = {}) {
  if (!unit?.stats || !isPositiveInt(value)) return false;
  const key = armyStatBonusKey(blessingId);
  const grants = Array.isArray(unit.recruitBlessingGrants) ? unit.recruitBlessingGrants : [];
  if (grants.includes(key)) return false;
  for (const stat of XP_STAT_NAMES) unit.stats[stat] = (Number(unit.stats[stat]) || 0) + value;
  if (!fallen) setUnitHP(unit, (Number(unit.currentHP) || 0) + value);
  unit.recruitBlessingGrants = [...grants, key];
  return true;
}

// ── Kingmaker's Oath ─────────────────────────────────────────────────────

const modsOf = (run) =>
  isPlainObject(run?.blessingRuntimeModifiers) ? run.blessingRuntimeModifiers : {};

/** Kingmaker's Oath while held (`{ bonus, stats }`), else null. */
export function kingmakerOf(run) {
  const raw = modsOf(run).kingmakerPromotion;
  return isPlainObject(raw) ? parseKingmaker(raw) : null;
}

/** True while the run's twist forbids Master Seals (Kingmaker's Oath). */
export function masterSealsForbidden(run) {
  return modsOf(run).masterSealsForbidden === true;
}

/**
 * Why this class-change item cannot be used in this run ('' when it can): a Master Seal (a
 * `promote` item) while Kingmaker's Oath forbids them. A reclass seal is never refused here. The
 * one rule every seal path reads (the roster sheet and the convoy through
 * RosterCommands.rosterClassChangeBlock, the battle's Promote command and item menu through
 * BattleScene.getPromotionConsumable, the promotion itself in PromotionController).
 */
export function classChangeItemBlock(run, item) {
  if (item?.effect === 'promote' && masterSealsForbidden(run)) return MASTER_SEAL_BANNED;
  return '';
}

/**
 * The stats Kingmaker's Oath raises: the `count` with the highest values in the class's promotion
 * bonuses (`bonuses`), ties in the order HP, STR, MAG, SKL, SPD, DEF, RES, LCK. Never Move, never
 * a stat the class does not raise at all.
 */
export function kingmakerBonusStats(bonuses, count) {
  const ranked = XP_STAT_NAMES.map((stat, order) => ({
    stat,
    order,
    value: Number(bonuses?.[stat]) || 0,
  }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.order - b.order);
  return ranked.slice(0, Math.max(0, Math.trunc(count) || 0)).map((entry) => entry.stat);
}

/**
 * Kingmaker's Oath at a church's altar, after the promotion: +bonus to the class's best stats
 * (`kingmakerBonusStats` over `classBonuses`). HP raises current HP with it (UnitHealth).
 * @returns {Array<{ stat: string, value: number }>} what was added (empty without the oath)
 */
export function applyKingmakerBonus(run, unit, classBonuses) {
  const oath = kingmakerOf(run);
  if (!oath || !unit?.stats) return [];
  const added = [];
  for (const stat of kingmakerBonusStats(classBonuses, oath.stats)) {
    unit.stats[stat] = (Number(unit.stats[stat]) || 0) + oath.bonus;
    if (stat === 'HP') setUnitHP(unit, (Number(unit.currentHP) || 0) + oath.bonus);
    added.push({ stat, value: oath.bonus });
  }
  return added;
}

// ── Hollow Sun's Favor ───────────────────────────────────────────────────

/** What gold loot cards are multiplied by (1 without Hollow Sun's Favor). */
export function lootGoldMultiplierOf(run) {
  const delta = Number(modsOf(run).lootGoldMultiplierDelta);
  return Number.isFinite(delta) && delta > 0 ? 1 + Math.min(MAX_LOOT_GOLD_DELTA, delta) : 1;
}

// ── Darkened Dawn ────────────────────────────────────────────────────────

/**
 * A victory's shadow gain with Darkened Dawn's share (in quarters) and the quarter units carried
 * from earlier victories: `extra = floor((gain × quarters + carry) / 4)`, the rest carried, so
 * over a run the Eclipse gathers exactly that much faster. Pure; the one reading the HUD's
 * projection and the victory's commit share.
 * @returns {{ gain: number, carry: number }}
 */
export function scaledShadowGain(gain, { delta = 0, carry = 0 } = {}) {
  const base = Math.max(0, Math.trunc(Number(gain)) || 0);
  const quarters = quartersOf(delta);
  if (quarters === 0) return { gain: base, carry: 0 };
  const total = base * quarters + carryOf(carry);
  return { gain: base + Math.floor(total / 4), carry: total % 4 };
}

/** The run's Darkened Dawn share and carry (`{ delta: 0, carry: 0 }` without it). */
export function eclipseGainOf(run) {
  const mods = modsOf(run);
  const delta = quartersOf(mods.eclipseGainDelta) / 4;
  return { delta, carry: delta > 0 ? carryOf(mods.eclipseGainCarry) : 0 };
}
