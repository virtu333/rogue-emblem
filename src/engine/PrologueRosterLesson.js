// PrologueRosterLesson — the row-2 roster lesson (docs/specs/prologue-chapter.md §6,
// "Route map, row 2"). Pure: no DOM, no Phaser, no RNG.
//
// The first time the player opens Roster at the fork node where a unit joined
// (joins.atNode: Tamsin, unarmed), the lesson's core runs, each goal done by the real
// action in the roster sheet (MobileRosterSheet reports what it applied):
//   withdraw  give the newcomer a weapon from the convoy (her bow)
//   equip     equip a weapon (Withdraw already armed an unarmed newcomer, so the
//             practice is another unit's spare: Gaspar's sword)
// Then, only if the player asks for more (the offer: "Show me" or "Done"), two
// optional goals:
//   trade     a unit-to-unit trade (Edric's Vulnerary to the newcomer)
//   store     put a carried item in the convoy
// A goal met another way counts (a newcomer armed before the lesson has withdrawn; a
// trade made during the core). A goal the army can't do right now (nobody carries a
// spare to trade) is skipped with its reason, and an offer with nothing left to show
// is never made. Every step can be skipped, and so can the lesson; nothing here ever
// blocks travel: the lesson is live only while the party stands on that node.
//
// State lives on the run (RunManager.prologueRosterLesson, saved): null before the
// lesson starts, then { completed: [step], skipped: [step], dismissed: bool,
// more: null | 'accepted' | 'declined' } (a save from before the offer reads null).

import { isPrologueRun } from './ScriptedBattle.js';
import { prologueJoinsAtNode } from './Prologue.js';
import { canEquip } from './UnitManager.js';
import { CONSUMABLE_MAX, INVENTORY_MAX } from '../utils/constants.js';

export const ROSTER_LESSON_STEPS = Object.freeze(['withdraw', 'equip', 'trade', 'store']);
/** The lesson's core: arming the newcomer and choosing what a unit fights with. */
export const ROSTER_LESSON_CORE = Object.freeze(['withdraw', 'equip']);
/** Offered once the core is done, never required. */
export const ROSTER_LESSON_MORE = Object.freeze(['trade', 'store']);
const MORE_CHOICES = ['accepted', 'declined'];

const isWeapon = (item) =>
  Boolean(item) && item.type !== 'Consumable' && item.type !== 'Scroll' && item.type !== 'Accessory'; // prettier-ignore
const isCombatWeapon = (item) => isWeapon(item) && item.type !== 'Staff';

/** A saved ledger, cleaned (unknown steps dropped), or null. */
export function normalizeRosterLesson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const steps = (list) =>
    [...new Set(Array.isArray(list) ? list : [])].filter((s) => ROSTER_LESSON_STEPS.includes(s));
  return {
    completed: steps(value.completed),
    skipped: steps(value.skipped),
    dismissed: value.dismissed === true,
    more: MORE_CHOICES.includes(value.more) ? value.more : null,
  };
}

const fresh = () => ({ completed: [], skipped: [], dismissed: false, more: null });
const settled = (state, step) => state.completed.includes(step) || state.skipped.includes(step);

/** The unit the lesson is about: the first one that joined at the party's node, if present. */
export function rosterLessonSubject(run) {
  if (!isPrologueRun(run)) return null;
  const keys = prologueJoinsAtNode(run.gameData?.prologue, run.currentNodeId);
  for (const key of keys) {
    const unit = (run.roster || []).find((u) => u?.name === key);
    if (unit) return unit;
  }
  return null;
}

function ledger(run) {
  return normalizeRosterLesson(run?.prologueRosterLesson);
}

function finished(state) {
  if (!state) return false;
  if (state.dismissed) return true;
  if (ROSTER_LESSON_STEPS.every((s) => settled(state, s))) return true;
  return ROSTER_LESSON_CORE.every((s) => settled(state, s)) && state.more === 'declined';
}

/** Where the lesson stands: 'core', 'offer' (core done, more not chosen), 'more', or null. */
function phaseOf(state) {
  if (!state || finished(state)) return null;
  if (!ROSTER_LESSON_CORE.every((s) => settled(state, s))) return 'core';
  return state.more === 'accepted' ? 'more' : 'offer';
}

/** True while the lesson can run: the prologue run, at the node its subject joined. */
export function isRosterLessonLive(run) {
  return Boolean(rosterLessonSubject(run)) && !finished(ledger(run));
}

/** True once the lesson ran to its end (done, skipped, or dismissed). */
export function isRosterLessonFinished(run) {
  return finished(ledger(run));
}

const others = (run, subject) => (run.roster || []).filter((u) => u && u !== subject);

/** What each step points at right now, and whether the army can do it. */
export function rosterLessonTarget(run, step) {
  const subject = rosterLessonSubject(run);
  if (!subject) return { available: false, reason: 'no_subject' };
  if (step === 'withdraw') {
    const armed = (subject.inventory || []).some((w) => isCombatWeapon(w) && canEquip(subject, w));
    if (armed) return { available: true, met: true, unit: subject.name };
    const weapon = (run.convoy?.weapons || []).find((w) => isCombatWeapon(w) && canEquip(subject, w)); // prettier-ignore
    if (!weapon) return { available: false, reason: 'no_weapon_in_convoy', unit: subject.name };
    if ((subject.inventory || []).length >= INVENTORY_MAX)
      return { available: false, reason: 'bag_full', unit: subject.name };
    return { available: true, unit: subject.name, item: weapon.name };
  }
  if (step === 'equip') {
    for (const unit of [...others(run, subject), subject]) {
      const spare = (unit.inventory || []).find(
        (w) => isCombatWeapon(w) && w !== unit.weapon && canEquip(unit, w),
      );
      if (spare) return { available: true, unit: unit.name, item: spare.name };
    }
    return { available: false, reason: 'no_spare_weapon' };
  }
  if (step === 'trade') {
    if ((subject.consumables || []).length >= CONSUMABLE_MAX)
      return { available: false, reason: 'bag_full', unit: subject.name };
    const pool = others(run, subject);
    const commander = pool.find((u) => u.isCommander);
    const givers = commander ? [commander, ...pool.filter((u) => u !== commander)] : pool;
    for (const giver of givers) {
      const item = (giver.consumables || [])[0];
      if (item) return { available: true, unit: subject.name, giver: giver.name, item: item.name };
    }
    return { available: false, reason: 'no_spare_consumable', unit: subject.name };
  }
  if (step === 'store') {
    if (typeof run.canAddToConvoy !== 'function') return { available: false, reason: 'no_convoy' };
    // A spare weapon first (one the unit isn't fighting with), then a consumable.
    for (const unit of run.roster || []) {
      const spare = (unit.inventory || []).find((w) => isWeapon(w) && w !== unit.weapon);
      if (spare && run.canAddToConvoy(spare))
        return { available: true, unit: unit.name, item: spare.name };
    }
    for (const unit of run.roster || []) {
      const item = (unit.consumables || [])[0];
      if (item && run.canAddToConvoy(item))
        return { available: true, unit: unit.name, item: item.name };
    }
    return { available: false, reason: 'nothing_to_store' };
  }
  return { available: false, reason: 'unknown_step' };
}

/**
 * Start the lesson (the first Roster open at the node) and settle what the army's
 * state already says: a goal already met is completed, one it can't do is skipped.
 * Mutates the run's ledger; the caller saves. Returns the current step view or null.
 */
export function advanceRosterLesson(run) {
  if (!isRosterLessonLive(run)) return null;
  const state = ledger(run) || fresh();
  const settle = (steps) => {
    for (const step of steps) {
      if (settled(state, step)) continue;
      const target = rosterLessonTarget(run, step);
      if (target.met) state.completed.push(step);
      else if (!target.available) state.skipped.push(step);
      else return false; // this step is live
    }
    return true;
  };
  if (settle(ROSTER_LESSON_CORE)) {
    if (state.more === 'accepted') settle(ROSTER_LESSON_MORE);
    else if (
      state.more === null &&
      ROSTER_LESSON_MORE.every(
        (step) => settled(state, step) || !rosterLessonTarget(run, step).available,
      )
    ) {
      // Nothing left to offer (done early, or the army can't): no offer, the lesson ends.
      for (const step of ROSTER_LESSON_MORE) if (!settled(state, step)) state.skipped.push(step);
    }
  }
  run.prologueRosterLesson = state;
  return rosterLessonView(run);
}

/**
 * What to show: { phase, step, index (1-based), total, subject, target, completed,
 * skipped } or null when the lesson isn't live. `phase` is 'core' (Withdraw, Equip),
 * 'offer' (the core is done: more is offered, never required; `step` and `target`
 * are null, `total` counts what more would show) or 'more' (Trade, Store). `index`
 * and `total` count within the phase. Pure.
 */
export function rosterLessonView(run) {
  if (!isRosterLessonLive(run)) return null;
  const state = ledger(run) || fresh();
  const phase = phaseOf(state);
  if (!phase) return null;
  const common = {
    phase,
    subject: rosterLessonSubject(run)?.name || null,
    completed: [...state.completed],
    skipped: [...state.skipped],
  };
  if (phase === 'offer') {
    const left = ROSTER_LESSON_MORE.filter((s) => !settled(state, s));
    return { ...common, step: null, index: null, total: left.length, target: null, steps: left };
  }
  const steps = phase === 'core' ? ROSTER_LESSON_CORE : ROSTER_LESSON_MORE;
  const index = steps.findIndex((s) => !settled(state, s));
  if (index < 0) return null;
  const step = steps[index];
  return {
    ...common,
    step,
    index: index + 1,
    total: steps.length,
    target: rosterLessonTarget(run, step),
  };
}

/** The offer's answer: 'accepted' shows Trade and Store, 'declined' ends the lesson. */
export function chooseRosterLessonMore(run, accept) {
  const view = rosterLessonView(run);
  if (view?.phase !== 'offer') return null;
  const state = ledger(run) || fresh();
  state.more = accept ? 'accepted' : 'declined';
  run.prologueRosterLesson = state;
  if (accept) advanceRosterLesson(run);
  return rosterLessonView(run);
}

/**
 * The roster sheet applied an action. `event`: { action: 'withdraw' | 'store' |
 * 'equip' | 'trade', unit, from?, to?, item } (unit and item names; for a trade,
 * `from` gives `item` to `to`). Completes every step the action is (any order: a goal
 * met early counts), then settles the next one. A step completes only when the army's
 * state shows the skill the copy promises (review, 2026-10-04): Withdraw once a combat
 * weapon the newcomer can wield reached her bag (a Vulnerary, or a lance she can't
 * use, is not the lesson), Equip once the named unit really fights with the named
 * weapon. Returns the steps it completed. Mutates the run's ledger; the caller saves.
 */
export function observeRosterAction(run, event) {
  if (!isRosterLessonLive(run) || !event) return [];
  const state = ledger(run) || fresh();
  const subject = rosterLessonSubject(run);
  const done = [];
  const complete = (step) => {
    if (state.completed.includes(step)) return;
    state.completed.push(step);
    state.skipped = state.skipped.filter((s) => s !== step);
    done.push(step);
  };
  if (
    event.action === 'withdraw' &&
    event.unit === subject?.name &&
    withdrewWeapon(subject, event.item)
  )
    // prettier-ignore
    complete('withdraw');
  if (event.action === 'equip' && equippedWeapon(run, event.unit, event.item)) complete('equip');
  if (event.action === 'trade' && event.from && event.to && event.from !== event.to)
    complete('trade');
  if (event.action === 'store') complete('store');
  run.prologueRosterLesson = state;
  if (done.length) advanceRosterLesson(run);
  return done;
}

/** The newcomer now carries the named item, and it is a combat weapon she can wield. */
function withdrewWeapon(subject, itemName) {
  if (!subject || typeof itemName !== 'string') return false;
  return (subject.inventory || []).some(
    (w) => w?.name === itemName && isCombatWeapon(w) && canEquip(subject, w),
  );
}

/** The named unit fights with the named item now: a combat weapon, equipped. */
function equippedWeapon(run, unitName, itemName) {
  if (typeof unitName !== 'string' || typeof itemName !== 'string') return false;
  const unit = (run.roster || []).find((u) => u?.name === unitName);
  const weapon = unit?.weapon;
  return Boolean(weapon && weapon.name === itemName && isCombatWeapon(weapon) && canEquip(unit, weapon)); // prettier-ignore
}

/** Skip the current step. Returns the skipped step, or null. Mutates; the caller saves. */
export function skipRosterLessonStep(run) {
  const view = rosterLessonView(run);
  if (!view?.step) return null;
  const state = ledger(run) || fresh();
  state.skipped.push(view.step);
  run.prologueRosterLesson = state;
  advanceRosterLesson(run);
  return view.step;
}

/** Leave the lesson for good. Mutates; the caller saves. */
export function dismissRosterLesson(run) {
  if (!isRosterLessonLive(run)) return false;
  const state = ledger(run) || fresh();
  state.dismissed = true;
  run.prologueRosterLesson = state;
  return true;
}
