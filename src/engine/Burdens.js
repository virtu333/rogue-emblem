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
// an `untilAct` as that act begins (RunManager.advanceAct, and on load). A countdown taken on top
// (an event's Hunted for 2 battles) merges into the record: it ends when both are spent.
//
// Cleansing (ChurchVow.cleanseAtChurch) lifts any burden except Debt (UNCLEANSABLE_BURDENS),
// Lingering Injury (HEALED_BURDENS: Heal all, which is free and always open at a church, mends it)
// and a twist's burden (one that never ends or ends with an act: `isTwistBurden`). A twist is the
// price of a strong earned card; a free vow lifting it would make the card free. `isCleansable` is
// the one rule.
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
  twist: "A twisted blessing's price: no altar lifts it while you hold the blessing.",
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
      // Blood Covenant's omen never ends: no countdown of its own.
      if (entry.permanent === true)
        out.push({ id: 'ill_omen', battles: 0, extraShadow, permanent: true });
      else if (battles > 0) out.push({ id: 'ill_omen', battles, extraShadow });
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
      if (battles > 0 || span)
        out.push({ id: 'hunted', battles, wave: normalizeHuntedWave(entry.wave), ...span });
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
  if (id === 'ill_omen') {
    const extraShadow = Math.max(0, int(params.extraShadow ?? def.extraShadow, 1));
    const shadow = existing ? Math.max(existing.extraShadow, extraShadow) : extraShadow;
    // An omen that never ends (a twist) swallows any countdown, before or after it.
    if (params.permanent === true || existing?.permanent === true)
      next = { id, battles: 0, extraShadow: shadow, permanent: true };
    else
      next = {
        id,
        battles: Math.max(1, int(params.battles ?? def.battles, 1)),
        extraShadow: shadow,
      };
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
    // countdown of its own; anything else counts battles. Merged, the record ends when both are
    // spent: its battles counted down and its act begun.
    const twistSpan =
      params.permanent === true
        ? { permanent: true }
        : huntSpanFromActsAhead(run, params.actsAhead);
    const battles = twistSpan ? 0 : Math.max(1, int(params.battles ?? def.battles, 1));
    const wave = normalizeHuntedWave(params.wave ?? def.wave);
    const span = laterHuntSpan(run, huntSpanOf(existing), twistSpan);
    next = {
      id,
      battles: existing ? Math.max(existing.battles, battles) : battles,
      wave: existing && existing.wave.count[1] > wave.count[1] ? existing.wave : wave,
      ...span,
    };
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
 * True when a church could lift this burden with a Cleanse vow: every one but Debt (the lender
 * has lawyers), Lingering Injury (Heal all mends it for free at any church or sanctuary, so a
 * church's one vow is never spent on it: `endWoundByHealing`) and a twist's burden (`isTwistBurden`:
 * Blood Covenant's endless Ill Omen, Hollow Sun's Favor's Hunted through the next act). A twist is
 * the price of a strong earned card, taken knowingly; a free vow lifting it would make the card
 * free. The one rule the church's offer, its refusal and its menu read.
 */
export function isCleansable(burden) {
  return (
    Boolean(burden) &&
    !UNCLEANSABLE_BURDENS.includes(burden.id) &&
    !HEALED_BURDENS.includes(burden.id) &&
    !isTwistBurden(burden)
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
    const { untilAct: _spent, ...rest } = burden;
    if (rest.battles > 0) next.push(rest);
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
      extraShadow += burden.extraShadow;
      if (burden.permanent === true) {
        // Blood Covenant's omen never counts down.
        record.illOmen = { extraShadow: burden.extraShadow, remaining: null, ended: false };
        next.push(burden);
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
      if (battle?.hunted === true) {
        // A twist's span outlasts the countdown: the record stays until its act (or for good).
        const remaining = Math.max(0, burden.battles - 1);
        const spans = isTwistBurden(burden);
        record.hunted = { remaining, ended: remaining <= 0 && !spans };
        if (remaining > 0 || spans) next.push({ ...burden, battles: remaining });
      } else next.push(burden);
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
  // A twist's span holds until its act begins (expireActBurdens ends it then; a stale span on a
  // record no act advance has reached yet is read against the run's own act).
  const spans =
    hunted.permanent === true ||
    (typeof hunted.untilAct === 'string' &&
      actIndexIn(run, hunted.untilAct) > Math.max(0, int(run?.actIndex)));
  return int(hunted.battles) > 0 || spans ? normalizeHuntedWave(hunted.wave) : null;
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
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

/** "Act III" for `act3`, "the final act" for `finalBoss` (engine-side: no UI import). */
function actName(actId) {
  const match = /^act(\d+)$/.exec(String(actId || ''));
  if (match) return `Act ${ROMAN[Number(match[1])] || match[1]}`;
  if (actId === 'finalBoss') return 'the final act';
  return 'a later act';
}

/**
 * The words of one burden record: { label, short, line, detail }. `short` is the chip's
 * figure ("3 left", "450 G"), `detail` the full count; the chip reads `${line} ${detail}.`
 */
export function describeBurden(burden, { def = {}, roster = [] } = {}) {
  const label = def.label || burden.id;
  const line = def.line || '';
  const left = `${plural(burden.battles, 'battle')} left`;
  if (burden.id === 'ill_omen' && burden.permanent === true)
    return {
      label,
      // The catalog's line says the omen passes; this one never does.
      line: 'Each victory gathers more shadow.',
      short: 'Never ends',
      detail: `never ends: +${burden.extraShadow} shadow each victory; no altar lifts it`,
    };
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
    const [min, max] = burden.wave.count;
    const foes = min === max ? `${min}` : `${min}–${max}`;
    const wave = `an extra wave of ${foes} foes on turn ${burden.wave.turn}, boss maps spared`;
    // A twist's span (no altar lifts it); a countdown merged on top still ends with its battles.
    if (burden.permanent === true)
      return { label, line, short: 'Rest of run', detail: `for the rest of the run: ${wave}` };
    if (typeof burden.untilAct === 'string') {
      const act = actName(burden.untilAct);
      const extra =
        burden.battles > 0 ? ` and ${plural(burden.battles, 'more battle')} are fought` : '';
      return {
        label,
        line,
        short: `Until ${act}`,
        detail: `until ${act} begins${extra}: ${wave}`,
      };
    }
    return { label, line, short: `${burden.battles} left`, detail: `${left}: ${wave}` };
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
 * Display model of the run's burdens for the route map's chips and the pause menu:
 * [{ id, label, short, line, detail }]. `short` is the chip's number ("3 left", "450 G"),
 * `detail` the full count ("3 battles left, +1 shadow each", "450 G owed, 50% of ...").
 */
export function describeBurdens(run, catalog = null) {
  const defs = burdenDefs(catalog || run?.gameData?.events);
  return normalizeBurdens(run?.burdens).map((burden) => ({
    id: burden.id,
    // Whether a church's Cleanse could lift it (`isCleansable`, the one rule), and why not.
    cleansable: isCleansable(burden),
    refusal: cleanseRefusal(burden),
    ...describeBurden(burden, { def: defs[burden.id], roster: run?.roster }),
  }));
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
      `Ill Omen +${settlement.illOmen.extraShadow}${settlement.illOmen.ended ? ' (passed)' : ''}`,
    );
  if (settlement?.hunted?.ended) lines.push('Hunted (passed)');
  if (settlement?.sworn?.ended) lines.push('Sworn Enemy falls');
  if (settlement?.wounded?.ended) lines.push(`${injuryPhrase(settlement.wounded)} mends`);
  return lines;
}
