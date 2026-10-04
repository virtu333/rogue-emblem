// PrologueRosterLesson — the row-2 roster lesson (docs/specs/prologue-chapter.md §6,
// "Route map, row 2"). Pure: no DOM, no Phaser, no RNG.
//
// The first time the player opens Roster at the fork node where a unit joined
// (joins.atNode: Tamsin, unarmed), four goals run in order, each done by the real
// action in the roster sheet (MobileRosterSheet reports what it applied):
//   withdraw  give the newcomer a weapon from the convoy (her bow)
//   equip     equip a weapon (Withdraw already armed an unarmed newcomer, so the
//             practice is another unit's spare: Gaspar's sword)
//   trade     a unit-to-unit trade (Edric's Vulnerary to the newcomer)
//   store     put a carried item in the convoy
// A goal met another way counts (a newcomer armed before the lesson has withdrawn).
// A goal the army can't do right now (nobody carries a spare to trade) is skipped
// with its reason. Every step can be skipped, and so can the lesson; nothing here
// ever blocks travel: the lesson is live only while the party stands on that node.
//
// State lives on the run (RunManager.prologueRosterLesson, saved): null before the
// lesson starts, then { completed: [step], skipped: [step], dismissed: bool }.

import { isPrologueRun } from './ScriptedBattle.js';
import { prologueJoinsAtNode } from './Prologue.js';
import { canEquip } from './UnitManager.js';
import { CONSUMABLE_MAX, INVENTORY_MAX } from '../utils/constants.js';

export const ROSTER_LESSON_STEPS = Object.freeze(['withdraw', 'equip', 'trade', 'store']);

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
  };
}

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
  return ROSTER_LESSON_STEPS.every((s) => state.completed.includes(s) || state.skipped.includes(s));
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
  const state = ledger(run) || { completed: [], skipped: [], dismissed: false };
  for (const step of ROSTER_LESSON_STEPS) {
    if (state.completed.includes(step) || state.skipped.includes(step)) continue;
    const target = rosterLessonTarget(run, step);
    if (target.met) state.completed.push(step);
    else if (!target.available) state.skipped.push(step);
    break;
  }
  run.prologueRosterLesson = state;
  return rosterLessonView(run);
}

/**
 * The step to show: { step, index (1-based), total, target, completed, skipped } or
 * null when the lesson isn't live. Pure.
 */
export function rosterLessonView(run) {
  if (!isRosterLessonLive(run)) return null;
  const state = ledger(run) || { completed: [], skipped: [], dismissed: false };
  const index = ROSTER_LESSON_STEPS.findIndex(
    (s) => !state.completed.includes(s) && !state.skipped.includes(s),
  );
  if (index < 0) return null;
  const step = ROSTER_LESSON_STEPS[index];
  return {
    step,
    index: index + 1,
    total: ROSTER_LESSON_STEPS.length,
    subject: rosterLessonSubject(run)?.name || null,
    target: rosterLessonTarget(run, step),
    completed: [...state.completed],
    skipped: [...state.skipped],
  };
}

/**
 * The roster sheet applied an action. `event`: { action: 'withdraw' | 'store' |
 * 'equip' | 'trade', unit, from?, to?, item } (unit names; for a trade, `from` gives
 * `item` to `to`). Completes every step the action is (any order: a goal met early
 * counts), then settles the next one. Returns the steps it completed. Mutates the
 * run's ledger; the caller saves.
 */
export function observeRosterAction(run, event) {
  if (!isRosterLessonLive(run) || !event) return [];
  const state = ledger(run) || { completed: [], skipped: [], dismissed: false };
  const subject = rosterLessonSubject(run);
  const done = [];
  const complete = (step) => {
    if (state.completed.includes(step)) return;
    state.completed.push(step);
    state.skipped = state.skipped.filter((s) => s !== step);
    done.push(step);
  };
  if (event.action === 'withdraw' && event.unit === subject?.name) complete('withdraw');
  if (event.action === 'equip') complete('equip');
  if (event.action === 'trade' && event.from && event.to && event.from !== event.to)
    complete('trade');
  if (event.action === 'store') complete('store');
  run.prologueRosterLesson = state;
  if (done.length) advanceRosterLesson(run);
  return done;
}

/** Skip the current step. Returns the skipped step, or null. Mutates; the caller saves. */
export function skipRosterLessonStep(run) {
  const view = rosterLessonView(run);
  if (!view) return null;
  const state = ledger(run) || { completed: [], skipped: [], dismissed: false };
  state.skipped.push(view.step);
  run.prologueRosterLesson = state;
  advanceRosterLesson(run);
  return view.step;
}

/** Leave the lesson for good. Mutates; the caller saves. */
export function dismissRosterLesson(run) {
  if (!isRosterLessonLive(run)) return false;
  const state = ledger(run) || { completed: [], skipped: [], dismissed: false };
  state.dismissed = true;
  run.prologueRosterLesson = state;
  return true;
}
