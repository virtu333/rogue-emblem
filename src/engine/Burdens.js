// Burdens.js — run-long penalties an event can leave (docs/specs/event-nodes.md §7).
//
// A burden is a plain record on `run.burdens` (an array, saved with the run) with its own
// end condition; it disappears when spent. Phase 1 has two:
//   ill_omen  { id, battles, extraShadow }   each of the next `battles` victories gathers
//                                            `extraShadow` more shadow (First Light: 2 battles)
//   debt      { id, owed, garnish }          each victory, `garnish` (a half; First Light a
//                                            quarter) of the battle's gold goes to the lender
//                                            until `owed` is paid
// Phase 2B (docs/specs/event-nodes-phase2.md) adds three:
//   hunted       { id, battles, wave }       the next `battles` non-boss battles each get one extra
//                                            reinforcement wave `wave` { turn, count: [min, max],
//                                            xpMultiplier }, written into the battle config when it is
//                                            generated (MapGenerator reads `battleParams.huntedWave`);
//                                            a victory in a battle that carried it counts one down
//   sworn_enemy  { id }                      the act boss gains one tier-1 affix (AffixEngine
//                                            `assignSwornAffix`, seeded) until it falls: the
//                                            victory at a boss node ends it
//   wounded      { id, unitUid, unitName, stat, value, battles }
//                                            one unit fights at `value` (-2) to `stat` for the next
//                                            `battles` battles (a battle stat delta applied at battle
//                                            start, `battleParams.battleDebuffs`); every victory counts
//                                            one down whether or not the unit was deployed; a church heal
//                                            (Heal all counts) ends it early, and so does the unit's
//                                            fall or departure
// The numbers live in data/events.json `burdens`; `onRung` holds the exact-rung overrides
// (a burden is gentler on First Light only). They are resolved ONCE, when the burden is
// taken, and stored on the record, so a later data change never moves a burden in flight.
//
// A burden never stacks with itself: taking Debt twice adds to `owed`; taking Ill Omen
// again refreshes `battles` (and keeps the larger `extraShadow`); Hunted refreshes `battles` and
// keeps the larger wave; Sworn Enemy is one record; a fresh Lingering Injury (id `wounded`) replaces the old one (an injury
// is on one unit at a time).
//
// A twisted earned blessing (docs/specs/blessings-v3.md §6.2, PR D3) leaves burdens that do not
// count down: Blood Covenant's Ill Omen never ends (`permanent: true`), and Hollow Sun's Favor's
// Hunted lasts through the next act (`untilAct`: the act it ends as, set from the twist's
// `actsAhead` when it is taken; `permanent` when the run has no such act). `expireActBurdens` ends
// an `untilAct` as that act begins (RunManager.advanceAct, and on load).
//
// One record per id still holds when a twist's burden and a countdown (an event's, or a shrine
// price's) meet: the record is in two parts.
//   twist part   the record's own fields: `permanent` or `untilAct`, the twist's `extraShadow` or
//                `wave`, and `battles: 0` (it never counts down)
//   event part   `event`: the countdown's own values, `{ battles, extraShadow }` for an Ill Omen,
//                `{ battles, wave }` for a Hunted; it counts down exactly as it would alone (every
//                victory for an omen, a victory in a battle that carried the wave for a hunt) and
//                is gone when spent
// While the event part lasts, the record acts with the larger of the two (an omen's shadow is
// `max(twist, event)`, a hunt's wave the bigger one: `illOmenShadowOf`, `huntedWaveFor`); after it,
// the twist's own values alone. Either order of taking them makes the same record. A twist's span
// that ends (Hollow Sun's act begins) leaves the event part as a plain countdown record.
//
// Cleansing (ChurchVow.cleanseAtChurch) lifts any burden except Debt (UNCLEANSABLE_BURDENS),
// Lingering Injury (HEALED_BURDENS: Heal all, which is free and always open at a church, mends it)
// and a twist's part (one that never ends or ends with an act: `isTwistBurden`). A twist is the
// price of a strong earned card; a free vow lifting it would make the card free. On a merged record
// Cleanse lifts the event part only (`cleanseBurden`), exactly as it would lift it alone, and the
// twist's part stays. `isCleansable` is the one rule.
//
// Settlement happens at exactly one place, the battle's victory commit
// (RunManager.completeBattle -> burdenEffectsOnVictory), and nowhere mid-battle, so
// Vision rewind, suspend/resume and "Continue from Map" (which restore the run's entry
// state, and never run a victory commit) leave burdens exactly as they were at entry.
// `burdenEffectsOnVictory` is pure: it returns the next list and the settlement record;
// the caller assigns them.
//
// Pure: no Phaser, no DOM, no randomness.

import { unitUidOf } from './UnitIdentity.js';
import { actLabel } from '../utils/actNames.js';

export const BURDEN_IDS = Object.freeze(['ill_omen', 'debt', 'hunted', 'sworn_enemy', 'wounded']);

/** Burdens a church can never lift ("the lender has lawyers"). */
export const UNCLEANSABLE_BURDENS = Object.freeze(['debt']);

/** Burdens a church's free Heal all ends, so Cleanse never offers them (an injury ends with its heal). */
export const HEALED_BURDENS = Object.freeze(['wounded']);

/** Burdens a twist may leave with no countdown (`permanent`; Hunted also `actsAhead`). */
export const TWIST_BURDEN_IDS = Object.freeze(['ill_omen', 'hunted']);

/** What an altar says of a burden it will not lift. */
export const CLEANSE_REFUSALS = Object.freeze({
  debt: 'The lender has lawyers. No altar lifts this.',
  twist: "A twisted blessing's price: no altar lifts it.",
});

/** The stats a wound may name (never HP: the wound is a battle stat delta, MOV stays whole). */
export const WOUND_STATS = Object.freeze(['STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK']);

/** The wave bounds a Hunted record is clamped to. */
export const HUNTED_TURN_RANGE = Object.freeze([1, 12]);
export const HUNTED_COUNT_MAX = 6;
const DEFAULT_HUNTED_WAVE = Object.freeze({
  turn: 3,
  count: Object.freeze([2, 2]),
  xpMultiplier: 0.5,
});
export const WOUND_MAX_PENALTY = 5;

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const int = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The burden definition table of a catalog (data/events.json `burdens`), or {}. */
export function burdenDefs(catalog) {
  return isPlain(catalog?.burdens) ? catalog.burdens : {};
}

/** A burden's data for a rung: the base entry with its `onRung[rung]` overrides on top. */
export function burdenDefFor(catalog, id, difficultyId) {
  const def = burdenDefs(catalog)[id];
  if (!isPlain(def)) return null;
  const { onRung, ...base } = def;
  return { ...base, ...(isPlain(onRung?.[difficultyId]) ? onRung[difficultyId] : {}) };
}

/**
 * A Hunted wave from data or a save, clamped: { turn, count: [min, max], xpMultiplier }.
 * Missing or malformed parts take the default (turn 3, two foes, half rewards).
 */
export function normalizeHuntedWave(raw) {
  const wave = isPlain(raw) ? raw : {};
  const turn = clamp(
    int(wave.turn, DEFAULT_HUNTED_WAVE.turn),
    HUNTED_TURN_RANGE[0],
    HUNTED_TURN_RANGE[1],
  );
  const range = Array.isArray(wave.count) ? wave.count : [];
  const min = clamp(int(range[0], DEFAULT_HUNTED_WAVE.count[0]), 1, HUNTED_COUNT_MAX);
  const max = clamp(int(range[1], min), min, HUNTED_COUNT_MAX);
  const xp = Number(wave.xpMultiplier);
  return {
    turn,
    count: [min, max],
    xpMultiplier:
      wave.xpMultiplier !== undefined && Number.isFinite(xp) && xp >= 0 && xp <= 1
        ? xp
        : DEFAULT_HUNTED_WAVE.xpMultiplier,
  };
}

/**
 * The burdens of a save, sanitized: known ids only, whole non-negative numbers, spent
 * burdens dropped, one record per id.
 */
export function normalizeBurdens(raw) {
  const out = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!isPlain(entry) || out.some((b) => b.id === entry.id)) continue;
    if (entry.id === 'ill_omen') {
      const battles = Math.max(0, int(entry.battles));
      const extraShadow = Math.max(0, int(entry.extraShadow, 1));
      // Blood Covenant's omen never ends: no countdown of its own (an event's omen merged into it
      // keeps its own, as the `event` part).
      if (entry.permanent === true) {
        const event = eventPartOf('ill_omen', entry.event);
        out.push({
          id: 'ill_omen',
          battles: 0,
          extraShadow,
          permanent: true,
          ...(event ? { event } : {}),
        });
      } else if (battles > 0) out.push({ id: 'ill_omen', battles, extraShadow });
    } else if (entry.id === 'debt') {
      const owed = Math.max(0, int(entry.owed));
      const garnish = Number(entry.garnish);
      if (owed > 0)
        out.push({
          id: 'debt',
          owed,
          garnish: Number.isFinite(garnish) && garnish > 0 && garnish <= 1 ? garnish : 0.5,
        });
    } else if (entry.id === 'hunted') {
      const battles = Math.max(0, int(entry.battles));
      const span = huntSpanOf(entry);
      const wave = normalizeHuntedWave(entry.wave);
      if (span) {
        // The twist's span, and an event's hunt merged into it as the `event` part (a merge an
        // earlier build kept as the record's own battles reads as that part).
        const event =
          eventPartOf('hunted', entry.event) || (battles > 0 ? { battles, wave } : null);
        out.push({ id: 'hunted', battles: 0, wave, ...span, ...(event ? { event } : {}) });
      } else if (battles > 0) out.push({ id: 'hunted', battles, wave });
    } else if (entry.id === 'sworn_enemy') {
      out.push({ id: 'sworn_enemy' });
    } else if (entry.id === 'wounded') {
      const battles = Math.max(0, int(entry.battles));
      const penalty = clamp(Math.abs(int(entry.value, -2)), 1, WOUND_MAX_PENALTY);
      if (
        battles > 0 &&
        typeof entry.unitUid === 'string' &&
        entry.unitUid &&
        WOUND_STATS.includes(entry.stat)
      )
        out.push({
          id: 'wounded',
          unitUid: entry.unitUid,
          unitName: typeof entry.unitName === 'string' ? entry.unitName : '',
          stat: entry.stat,
          value: -penalty,
          battles,
        });
    }
  }
  return out;
}

/**
 * A Hunted record's span beyond its countdown: `{ permanent: true }`, `{ untilAct }` (an act id),
 * or null. A permanent record never also names an act.
 */
function huntSpanOf(entry) {
  if (entry?.permanent === true) return { permanent: true };
  if (typeof entry?.untilAct === 'string' && entry.untilAct) return { untilAct: entry.untilAct };
  return null;
}

/**
 * The event part of a merged twist record, read back: `{ battles, extraShadow }` (Ill Omen) or
 * `{ battles, wave }` (Hunted), or null when there is none or it is spent.
 */
function eventPartOf(id, raw) {
  if (!isPlain(raw)) return null;
  const battles = Math.max(0, int(raw.battles));
  if (!(battles > 0)) return null;
  if (id === 'ill_omen') return { battles, extraShadow: Math.max(0, int(raw.extraShadow, 1)) };
  if (id === 'hunted') return { battles, wave: normalizeHuntedWave(raw.wave) };
  return null;
}

/** A merged twist record without its event part (the part spent, or lifted). */
function withoutEventPart(burden) {
  const { event: _spent, ...twist } = burden;
  return twist;
}

/**
 * The bigger of two Hunted waves: more foes at most, then more foes at least, then the earlier
 * turn; a tie keeps `a`.
 */
export function largerHuntedWave(a, b) {
  const x = normalizeHuntedWave(a);
  const y = normalizeHuntedWave(b);
  const order = y.count[1] - x.count[1] || y.count[0] - x.count[0] || x.turn - y.turn;
  return order > 0 ? y : x;
}

/**
 * The shadow an Ill Omen record adds to each victory now: its own `extraShadow`, or on a merged
 * record the larger of the twist's and its event part's while that part lasts.
 */
export function illOmenShadowOf(burden) {
  if (!burden || burden.id !== 'ill_omen') return 0;
  const own = Math.max(0, int(burden.extraShadow));
  const event = isTwistBurden(burden) ? eventPartOf('ill_omen', burden.event) : null;
  return event ? Math.max(own, event.extraShadow) : own;
}

/** True when a twist's record carries a merged countdown (its `event` part) still running. */
export function hasEventPart(burden) {
  return isTwistBurden(burden) && Boolean(eventPartOf(burden.id, burden.event));
}

/** The index of an act in the run's sequence (-1 when it is not one of them). */
function actIndexIn(run, actId) {
  return Array.isArray(run?.actSequence) ? run.actSequence.indexOf(actId) : -1;
}

/**
 * A twist's Hunted span from `actsAhead` when it is taken: through the next `actsAhead` acts, so
 * the record ends as act `actIndex + 1 + actsAhead` begins (taken at Act I's boss with 1: all of
 * Act II, ending as Act III begins); with no such act, for the rest of the run.
 */
function huntSpanFromActsAhead(run, actsAhead) {
  const ahead = int(actsAhead);
  if (!(ahead > 0)) return null;
  const index = Math.max(0, int(run?.actIndex)) + 1 + ahead;
  const act = Array.isArray(run?.actSequence) ? run.actSequence[index] : undefined;
  return typeof act === 'string' && act ? { untilAct: act } : { permanent: true };
}

/** The later of two Hunted spans (permanent outlasts any act; an unknown act counts as none). */
function laterHuntSpan(run, a, b) {
  if (a?.permanent || b?.permanent) return { permanent: true };
  if (!a?.untilAct) return b?.untilAct ? { untilAct: b.untilAct } : null;
  if (!b?.untilAct) return { untilAct: a.untilAct };
  return actIndexIn(run, b.untilAct) > actIndexIn(run, a.untilAct)
    ? { untilAct: b.untilAct }
    : { untilAct: a.untilAct };
}

/**
 * True for a burden a twisted blessing left: one with no countdown of its own (it never ends, or
 * it ends with an act). Only a twist's price writes these (the validator refuses `permanent` and
 * `actsAhead` anywhere else).
 */
export function isTwistBurden(burden) {
  return Boolean(burden) && (burden.permanent === true || typeof burden.untilAct === 'string');
}

/** The run's burden record for an id, or null. */
export function burdenOf(run, id) {
  return (run?.burdens || []).find((burden) => burden?.id === id) || null;
}

/**
 * Take a burden: resolve its numbers for the run's rung and merge into the list (no
 * stacking). `params` may override: ill_omen { battles, extraShadow }, debt { owed }
 * (a number, already resolved by the caller), hunted { battles, wave }, wounded
 * { unitUid, unitName, stat, value, battles } (the unit and stat are required: the caller
 * resolves who and what).
 * @returns {{ ok: boolean, reason?: string, burden?: object }}
 */
export function addBurden(run, id, params = {}, catalog = null) {
  if (!BURDEN_IDS.includes(id)) return { ok: false, reason: `Unknown burden "${id}".` };
  const def = burdenDefFor(catalog || run?.gameData?.events, id, run?.difficultyId);
  if (!def) return { ok: false, reason: `No definition for burden "${id}".` };
  const list = normalizeBurdens(run?.burdens);
  const existing = list.find((burden) => burden.id === id);
  let next;
  const twistHeld = isTwistBurden(existing);
  if (id === 'ill_omen') {
    const extraShadow = Math.max(0, int(params.extraShadow ?? def.extraShadow, 1));
    if (params.permanent === true) {
      // A twist's omen that never ends: the twist part. A countdown already held (an event's, a
      // shrine price's) becomes its event part, kept as it was.
      const prior = twistHeld
        ? existing.event
        : existing
          ? { battles: existing.battles, extraShadow: existing.extraShadow }
          : null;
      const event = eventPartOf(id, prior);
      next = {
        id,
        battles: 0,
        extraShadow: twistHeld ? Math.max(existing.extraShadow, extraShadow) : extraShadow,
        permanent: true,
        ...(event ? { event } : {}),
      };
    } else {
      // A countdown: on its own record it refreshes `battles` and keeps the larger shadow; on a
      // twist's record it is the event part, by the same rule.
      const prior = twistHeld ? eventPartOf(id, existing.event) : existing;
      const countdown = {
        battles: Math.max(1, int(params.battles ?? def.battles, 1)),
        extraShadow: prior ? Math.max(prior.extraShadow, extraShadow) : extraShadow,
      };
      next = twistHeld ? { ...existing, event: countdown } : { id, ...countdown };
    }
  } else if (id === 'debt') {
    const owed = Math.max(1, int(params.owed ?? def.owed, 1));
    const garnish = Number(params.garnish ?? def.garnish);
    next = {
      id,
      owed: (existing?.owed || 0) + owed,
      garnish: Number.isFinite(garnish) && garnish > 0 && garnish <= 1 ? garnish : 0.5,
    };
  } else if (id === 'hunted') {
    // A twist's Hunted runs through acts (`actsAhead`) or for good (`permanent`), with no
    // countdown of its own: the twist part. Anything else counts battles: on its own record, or
    // as a twist record's event part (the record then ends when both are spent).
    const twistSpan =
      params.permanent === true
        ? { permanent: true }
        : huntSpanFromActsAhead(run, params.actsAhead);
    const wave = normalizeHuntedWave(params.wave ?? def.wave);
    if (twistSpan) {
      const prior = twistHeld
        ? existing.event
        : existing
          ? { battles: existing.battles, wave: existing.wave }
          : null;
      const event = eventPartOf(id, prior);
      next = {
        id,
        battles: 0,
        wave: twistHeld ? largerHuntedWave(existing.wave, wave) : wave,
        ...laterHuntSpan(run, twistHeld ? huntSpanOf(existing) : null, twistSpan),
        ...(event ? { event } : {}),
      };
    } else {
      // A countdown refreshes to the larger count of battles and keeps the bigger wave.
      const prior = twistHeld ? eventPartOf(id, existing.event) : existing;
      const battles = Math.max(1, int(params.battles ?? def.battles, 1));
      const countdown = {
        battles: prior ? Math.max(prior.battles, battles) : battles,
        wave: prior ? largerHuntedWave(wave, prior.wave) : wave,
      };
      next = twistHeld ? { ...existing, event: countdown } : { id, ...countdown };
    }
  } else if (id === 'sworn_enemy') {
    next = { id };
  } else {
    if (typeof params.unitUid !== 'string' || !params.unitUid)
      return { ok: false, reason: 'An injury needs someone to bear it.' };
    if (!WOUND_STATS.includes(params.stat))
      return { ok: false, reason: `An injury cannot fall on "${params.stat}".` };
    next = {
      id,
      unitUid: params.unitUid,
      unitName: typeof params.unitName === 'string' ? params.unitName : '',
      stat: params.stat,
      value: -clamp(Math.abs(int(params.value ?? def.value, -2)), 1, WOUND_MAX_PENALTY),
      battles: Math.max(1, int(params.battles ?? def.battles, 1)),
    };
  }
  run.burdens = existing
    ? list.map((burden) => (burden.id === id ? next : burden))
    : [...list, next];
  return { ok: true, burden: structuredClone(next) };
}

/**
 * True when a church could lift this burden (or part of it) with a Cleanse vow: every one but Debt
 * (the lender has lawyers), Lingering Injury (Heal all mends it for free at any church or
 * sanctuary, so a church's one vow is never spent on it: `endWoundByHealing`) and a twist's burden
 * (`isTwistBurden`: Blood Covenant's endless Ill Omen, Hollow Sun's Favor's Hunted through the next
 * act). A twist is the price of a strong earned card, taken knowingly; a free vow lifting it would
 * make the card free. A twist's record with a countdown merged into it (`hasEventPart`) is
 * cleansable for that part alone (`cleanseBurden` lifts only it). The one rule the church's offer,
 * its refusal and its menu read.
 */
export function isCleansable(burden) {
  return (
    Boolean(burden) &&
    !UNCLEANSABLE_BURDENS.includes(burden.id) &&
    !HEALED_BURDENS.includes(burden.id) &&
    (!isTwistBurden(burden) || hasEventPart(burden))
  );
}

/** What an altar says of a burden it will not lift ('' when it would lift it). */
export function cleanseRefusal(burden) {
  if (!burden || isCleansable(burden)) return '';
  if (UNCLEANSABLE_BURDENS.includes(burden.id)) return CLEANSE_REFUSALS.debt;
  if (HEALED_BURDENS.includes(burden.id))
    return 'Heal all mends a lingering injury. It needs no vow.';
  return CLEANSE_REFUSALS.twist;
}

/**
 * End the Hunted spans whose act has begun: a record whose `untilAct` is the run's current act
 * or an earlier one (or an act the run does not have) loses the span, and is gone when it has no
 * battles left either. Pure: returns `{ burdens, ended }` (`ended`: the ids that ended). Called by
 * RunManager.advanceAct after the act advances, and on load.
 */
export function expireActBurdens(burdens, { actSequence = null, actIndex = 0 } = {}) {
  const list = normalizeBurdens(burdens);
  const acts = Array.isArray(actSequence) ? actSequence : [];
  const ended = [];
  const next = [];
  for (const burden of list) {
    if (burden.id !== 'hunted' || typeof burden.untilAct !== 'string') {
      next.push(burden);
      continue;
    }
    const until = acts.indexOf(burden.untilAct);
    if (until > int(actIndex)) {
      next.push(burden);
      continue;
    }
    // The twist's part is spent; an event part still counting is a plain hunt of its own now.
    const event = eventPartOf('hunted', burden.event);
    if (event) next.push({ id: 'hunted', battles: event.battles, wave: event.wave });
    else ended.push(burden.id);
  }
  return { burdens: next, ended };
}

/**
 * How the player names a Lingering Injury (the `wounded` burden) in a sentence:
 * "Edric's lingering injury", or "The lingering injury" when the unit is unnamed.
 * The burden is never called Wounded to the player: that is the status condition's name.
 */
export function injuryPhrase(burden, { capital = true } = {}) {
  const name = burden?.unitName || burden?.name || '';
  if (name) return `${name}'s lingering injury`;
  return capital ? 'The lingering injury' : 'the lingering injury';
}

/** What the church says beside Heal all while an injury is carried ('' when none). */
export function woundHealLine(run) {
  const wound = burdenOf(run, 'wounded');
  if (!wound) return '';
  return `Heal all also mends ${injuryPhrase(wound, { capital: false })}.`;
}

/** The run's burdens a church can lift, in the order they were taken. */
export function cleansableBurdens(run) {
  return normalizeBurdens(run?.burdens).filter(isCleansable);
}

/**
 * What a Cleanse vow lifts: the whole burden, or on a twist's record only its event part (the
 * twist's part stays). Nothing when the burden is not cleansable (`isCleansable`).
 * @returns {object|null} the lifted record (an event part as a record of its own: `{ id, battles,
 *   extraShadow }` / `{ id, battles, wave }`, with `partial: true`), or null when nothing was lifted
 */
export function cleanseBurden(run, id) {
  const list = normalizeBurdens(run?.burdens);
  const found = list.find((burden) => burden.id === id);
  if (!found || !isCleansable(found)) return null;
  if (!isTwistBurden(found)) return removeBurden(run, id);
  run.burdens = list.map((burden) => (burden.id === id ? withoutEventPart(burden) : burden));
  return { id, ...structuredClone(found.event), partial: true };
}

/**
 * Lift one burden from the run (a cleanse, or a wound that has healed).
 * @returns {object|null} the record that was removed, or null when the run held none
 */
export function removeBurden(run, id) {
  const list = normalizeBurdens(run?.burdens);
  const found = list.find((burden) => burden.id === id);
  if (!found) return null;
  run.burdens = list.filter((burden) => burden.id !== id);
  return structuredClone(found);
}

/**
 * A wound ends when its unit is healed at a church (Heal all heals everyone). `units` are the
 * healed roster units; returns the wound that ended (for a line), or null.
 */
export function endWoundByHealing(run, units) {
  const wound = burdenOf(run, 'wounded');
  if (!wound) return null;
  const healed = (Array.isArray(units) ? units : []).some(
    (unit) => unitUidOf(unit) === wound.unitUid,
  );
  return healed ? removeBurden(run, 'wounded') : null;
}

/**
 * Drop a wound whose unit is no longer in the roster (it fell, or left): there is nobody
 * to carry it. Pure: returns the list.
 */
export function pruneGoneWounds(burdens, roster) {
  const list = normalizeBurdens(burdens);
  const uids = new Set((roster || []).map((unit) => unitUidOf(unit)).filter(Boolean));
  return list.filter((burden) => burden.id !== 'wounded' || uids.has(burden.unitUid));
}

/**
 * What a battle's victory does to the burdens (pure; nothing is mutated).
 * @param {object} run
 * @param {{ gold?: number, shadowGain?: number, battle?: { boss?: boolean, hunted?: boolean } }} input
 *   the battle's gold (final, after its multipliers) and its shadow gain before any burden;
 *   `battle.boss`: the battle is an act boss's (a Sworn Enemy ends; Hunted never rode it);
 *   `battle.hunted`: the battle carried the Hunted wave (so it counts one down)
 * @returns {{ gold: number, garnished: number, shadowGain: number, extraShadow: number,
 *   burdens: object[], record: object|null }} `gold` is what the army keeps; `burdens` is
 *   the next list (spent ones gone); `record` says what happened for the victory band:
 *   { debt: { paid, remaining, cleared }|null, illOmen: { extraShadow, remaining, ended }|null,
 *     hunted: { remaining, ended }|null, sworn: { ended }|null,
 *     wounded: { name, stat, value, remaining, ended }|null }
 */
export function burdenEffectsOnVictory(run, { gold = 0, shadowGain = 0, battle = {} } = {}) {
  const current = normalizeBurdens(run?.burdens);
  const total = Math.max(0, int(gold));
  let kept = total;
  let garnished = 0;
  let extraShadow = 0;
  const next = [];
  const record = { debt: null, illOmen: null, hunted: null, sworn: null, wounded: null };
  for (const burden of current) {
    if (burden.id === 'ill_omen') {
      const shadow = illOmenShadowOf(burden);
      extraShadow += shadow;
      if (burden.permanent === true) {
        // Blood Covenant's omen never counts down; an event part merged into it does (the larger
        // shadow holds while it lasts).
        const event = eventPartOf('ill_omen', burden.event);
        const left = event ? event.battles - 1 : null;
        record.illOmen = {
          extraShadow: shadow,
          remaining: null,
          ended: false,
          ...(event ? { event: { remaining: left, ended: left <= 0 } } : {}),
        };
        if (event && left > 0) next.push({ ...burden, event: { ...event, battles: left } });
        else next.push(event ? withoutEventPart(burden) : burden);
        continue;
      }
      const remaining = burden.battles - 1;
      record.illOmen = { extraShadow: burden.extraShadow, remaining, ended: remaining <= 0 };
      if (remaining > 0) next.push({ ...burden, battles: remaining });
    } else if (burden.id === 'debt') {
      const share = Math.floor(total * burden.garnish);
      const paid = Math.min(share, burden.owed);
      garnished += paid;
      kept -= paid;
      const remaining = burden.owed - paid;
      record.debt = { paid, remaining, cleared: remaining <= 0 };
      if (remaining > 0) next.push({ ...burden, owed: remaining });
    } else if (burden.id === 'hunted') {
      if (battle?.hunted !== true) next.push(burden);
      else if (isTwistBurden(burden)) {
        // A twist's span never counts down: the record stays until its act (or for good). An
        // event part merged into it counts one down, as it would alone.
        const event = eventPartOf('hunted', burden.event);
        const left = event ? event.battles - 1 : null;
        record.hunted = {
          remaining: null,
          ended: false,
          ...(event ? { event: { remaining: left, ended: left <= 0 } } : {}),
        };
        if (event && left > 0) next.push({ ...burden, event: { ...event, battles: left } });
        else next.push(event ? withoutEventPart(burden) : burden);
      } else {
        const remaining = Math.max(0, burden.battles - 1);
        record.hunted = { remaining, ended: remaining <= 0 };
        if (remaining > 0) next.push({ ...burden, battles: remaining });
      }
    } else if (burden.id === 'sworn_enemy') {
      if (battle?.boss === true) record.sworn = { ended: true };
      else next.push(burden);
    } else if (burden.id === 'wounded') {
      const remaining = burden.battles - 1;
      record.wounded = {
        name: burden.unitName,
        stat: burden.stat,
        value: burden.value,
        remaining,
        ended: remaining <= 0,
      };
      if (remaining > 0) next.push({ ...burden, battles: remaining });
    }
  }
  return {
    gold: kept,
    garnished,
    shadowGain: Math.max(0, int(shadowGain)) + extraShadow,
    extraShadow,
    burdens: next,
    record: Object.values(record).some(Boolean) ? record : null,
  };
}

// ── What a battle reads of the burdens ───────────────────────────────────

/**
 * The Hunted wave a battle of this run should carry ({ turn, count, xpMultiplier }), or
 * null: the run is not hunted, or the battle is a boss's (a boss map is never hunted).
 */
export function huntedWaveFor(run, { isBoss = false } = {}) {
  if (isBoss) return null;
  const hunted = burdenOf(run, 'hunted');
  if (!hunted) return null;
  if (!isTwistBurden(hunted))
    return int(hunted.battles) > 0 ? normalizeHuntedWave(hunted.wave) : null;
  // A twist's span holds until its act begins (expireActBurdens ends it then; a stale span on a
  // record no act advance has reached yet is read against the run's own act). While an event part
  // merged into it lasts, the bigger of the two waves comes; after it, the twist's own.
  const spans =
    hunted.permanent === true || actIndexIn(run, hunted.untilAct) > Math.max(0, int(run?.actIndex));
  const event = eventPartOf('hunted', hunted.event);
  if (spans)
    return event ? largerHuntedWave(hunted.wave, event.wave) : normalizeHuntedWave(hunted.wave);
  return event ? event.wave : null;
}

/** True while a Sworn Enemy waits for the act boss. */
export function isSwornEnemy(run) {
  return Boolean(burdenOf(run, 'sworn_enemy'));
}

/**
 * The stat deltas a battle starts with: [{ unitUid, stat, value, source: 'wounded' }]. They
 * ride `battleParams.battleDebuffs`, so the scene, the previews and the harness read one list.
 */
export function battleDebuffsFor(run) {
  const wound = burdenOf(run, 'wounded');
  if (!wound || !(int(wound.battles) > 0)) return [];
  return [{ unitUid: wound.unitUid, stat: wound.stat, value: wound.value, source: 'wounded' }];
}

// ── Display ───────────────────────────────────────────────────────────────

const minus = (n) => `−${Math.abs(n)}`;
/**
 * How a burden's span names its act: the act card's own name (utils/actNames.js `actLabel`:
 * "Act III", "Final Act"), `the` before a name that is not numbered ("until the Final Act
 * begins"). `title` is the chip's form ("Until Final Act").
 */
function actName(actId, { title = false } = {}) {
  const label = actLabel(actId);
  if (!label) return 'a later act';
  return title || /^Act /.test(label) ? label : `the ${label}`;
}

const foesOf = (wave) => {
  const [min, max] = wave.count;
  return min === max ? `${min}` : `${min}–${max}`;
};
const waveText = (wave) =>
  `an extra wave of ${foesOf(wave)} foes on turn ${wave.turn}, boss maps spared`;
const sameWave = (a, b) =>
  a.turn === b.turn && a.count[0] === b.count[0] && a.count[1] === b.count[1];

/**
 * The words of one burden record: { label, short, line, detail }. `short` is the chip's
 * figure ("3 left", "450 G"), `detail` the full count; the chip reads `${line} ${detail}.`
 */
export function describeBurden(burden, { def = {}, roster = [] } = {}) {
  const label = def.label || burden.id;
  const line = def.line || '';
  const left = `${plural(burden.battles, 'battle')} left`;
  if (burden.id === 'ill_omen' && burden.permanent === true) {
    // The catalog's line says the omen passes; this one never does. A passing omen merged into it
    // (its event part) says what it adds and for how long.
    const event = eventPartOf('ill_omen', burden.event);
    if (!event)
      return {
        label,
        line: 'Each victory gathers more shadow.',
        short: 'Never ends',
        detail: `never ends: +${burden.extraShadow} shadow each victory; no altar lifts it`,
      };
    const shadow = illOmenShadowOf(burden);
    const more = plural(event.battles, 'more battle');
    return {
      label,
      line: 'Each victory gathers more shadow.',
      short: `Never ends; +${shadow} for ${more}`,
      detail:
        `never ends: +${burden.extraShadow} shadow each victory, +${shadow} for ${more} while a ` +
        `passing omen lasts (+${event.extraShadow}); an altar lifts only the passing omen`,
    };
  }
  if (burden.id === 'ill_omen')
    return {
      label,
      line,
      short: `${burden.battles} left`,
      detail: `${left}, +${burden.extraShadow} shadow each`,
    };
  if (burden.id === 'debt')
    return {
      label,
      line,
      short: `${burden.owed} G`,
      detail: `${burden.owed} G owed, ${Math.round(burden.garnish * 100)}% of each victory's gold`,
    };
  if (burden.id === 'hunted') {
    const wave = waveText(burden.wave);
    if (!isTwistBurden(burden))
      return { label, line, short: `${burden.battles} left`, detail: `${left}: ${wave}` };
    // A twist's span (no altar lifts it). A passing hunt merged into it (its event part) keeps its
    // own battles, and while it lasts the bigger wave comes.
    const span =
      burden.permanent === true
        ? { short: 'Rest of run', detail: 'for the rest of the run' }
        : {
            short: `Until ${actName(burden.untilAct, { title: true })}`,
            detail: `until ${actName(burden.untilAct)} begins`,
          };
    const event = eventPartOf('hunted', burden.event);
    if (!event) return { label, line, short: span.short, detail: `${span.detail}: ${wave}` };
    const more = plural(event.battles, 'more battle');
    const larger = largerHuntedWave(burden.wave, event.wave);
    const passing = sameWave(larger, burden.wave)
      ? `a passing hunt rides with it for ${more}`
      : `for ${more}, while a passing hunt lasts, ${foesOf(larger)} foes on turn ${larger.turn}`;
    return {
      label,
      line,
      short: `${span.short}; ${more}`,
      detail: `${span.detail}: ${wave}; ${passing}; an altar lifts only the passing hunt`,
    };
  }
  if (burden.id === 'sworn_enemy')
    return {
      label,
      line,
      short: 'Boss',
      detail: 'the act boss carries an extra affix until it falls',
    };
  const unit = (roster || []).find((u) => unitUidOf(u) === burden.unitUid);
  const name = unit?.name || burden.unitName || 'Someone';
  return {
    label,
    line,
    short: `${name} ${minus(burden.value)} ${burden.stat}`,
    detail: `${name} fights at ${minus(burden.value)} ${burden.stat}, ${left}; a church heal ends it`,
  };
}

/**
 * Display model of the run's burdens for the route map's chips, the pause menu and the church:
 * [{ id, label, short, line, detail, cleansable, refusal, twist, twistShort?, twistRefusal?,
 * lift? }]. `short` is the chip's number ("3 left", "450 G"; a merged twist record names both
 * parts, "Never ends; +2 for 3 more battles"), `detail` the full count ("3 battles left, +1 shadow
 * each", "450 G owed, 50% of ..."). `twist`: the record holds a twisted blessing's part (never
 * lifted: `twistShort` is that part's own figure, `twistRefusal` the altar's words); `lift`: on a
 * merged record, what a Cleanse would lift (its event part's `{ short, detail }`).
 */
export function describeBurdens(run, catalog = null) {
  const defs = burdenDefs(catalog || run?.gameData?.events);
  return normalizeBurdens(run?.burdens).map((burden) => {
    const words = { def: defs[burden.id], roster: run?.roster };
    const twist = isTwistBurden(burden);
    // A merged twist record: what Cleanse would lift (its event part, described as the plain
    // countdown it is) and what stays (the twist's part).
    const event = twist ? eventPartOf(burden.id, burden.event) : null;
    const lift = event ? describeBurden({ id: burden.id, ...event }, words) : null;
    const kept = twist ? describeBurden(withoutEventPart(burden), words) : null;
    return {
      id: burden.id,
      // Whether a church's Cleanse could lift it (`isCleansable`, the one rule), and why not.
      cleansable: isCleansable(burden),
      refusal: cleanseRefusal(burden),
      // A twisted blessing's part (never lifted): its own figure and the altar's refusal.
      twist,
      ...(twist ? { twistShort: kept.short, twistRefusal: CLEANSE_REFUSALS.twist } : {}),
      ...(lift ? { lift: { short: lift.short, detail: lift.detail } } : {}),
      ...describeBurden(burden, words),
    };
  });
}

/**
 * The victory band's words for a settlement record: ["Debt −120 G", "Ill Omen +1"]
 * (empty when nothing was settled).
 */
export function settlementLines(settlement) {
  const lines = [];
  if (settlement?.debt && settlement.debt.paid > 0)
    lines.push(`Debt −${settlement.debt.paid} G${settlement.debt.cleared ? ' (paid off)' : ''}`);
  else if (settlement?.debt?.cleared) lines.push('Debt paid off');
  if (settlement?.illOmen && settlement.illOmen.extraShadow > 0)
    lines.push(
      `Ill Omen +${settlement.illOmen.extraShadow}${
        settlement.illOmen.ended
          ? ' (passed)'
          : settlement.illOmen.event?.ended
            ? ' (the passing omen ends)'
            : ''
      }`,
    );
  if (settlement?.hunted?.ended) lines.push('Hunted (passed)');
  else if (settlement?.hunted?.event?.ended) lines.push('Hunted (the passing hunt ends)');
  if (settlement?.sworn?.ended) lines.push('Sworn Enemy falls');
  if (settlement?.wounded?.ended) lines.push(`${injuryPhrase(settlement.wounded)} mends`);
  return lines;
}
