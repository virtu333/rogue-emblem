// PrologueRosterCoach — the row-2 roster lesson inside the roster sheet
// (docs/specs/prologue-chapter.md §6 "Route map, row 2"; the rules live in
// engine/PrologueRosterLesson.js). create(sheet) / destroy(), CLAUDE.md's controller
// pattern: the sheet (MobileRosterSheet — every Roster entry point in a browser: the
// route map on desktop and phone, the Market's and the Chapel's Roster buttons)
// mounts the strip on each render and reports each action it applied.
//
// The strip is a goal, never a gate: every button of the sheet keeps working, Skip
// step and Skip lesson are always there, and Close leaves the lesson where it was
// (it resumes on the next Roster open at the same node; travel ends it).

import {
  advanceRosterLesson,
  dismissRosterLesson,
  isRosterLessonLive,
  observeRosterAction,
  rosterLessonView,
  skipRosterLessonStep,
} from '../engine/PrologueRosterLesson.js';
import { isPrologueRun } from '../engine/ScriptedBattle.js';
import { rosterLessonCopy, rosterLessonSkipText } from '../data/prologueContent.js';
import { guidanceText } from '../engine/Guidance.js';
import { CONVOY_HOLDER } from '../engine/ItemTrade.js';

const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};

/** The lesson's view of a roster trade: withdraw, store, or a unit-to-unit trade. */
export function rosterTradeEvents(from, to, item) {
  const name = (slot) => (slot?.holder?.kind === 'unit' ? slot.holder.unit?.name : null);
  const fromConvoy = from?.holder?.kind === CONVOY_HOLDER.kind;
  const toConvoy = to?.holder?.kind === CONVOY_HOLDER.kind;
  if (fromConvoy && !toConvoy) return [{ action: 'withdraw', unit: name(to), item: item?.name }];
  if (toConvoy && !fromConvoy) return [{ action: 'store', unit: name(from), item: item?.name }];
  if (!fromConvoy && !toConvoy && name(from) !== name(to))
    return [{ action: 'trade', from: name(from), to: name(to), item: item?.name }];
  return [];
}

export class PrologueRosterCoach {
  /** The coach for a managing roster sheet in the prologue run at the lesson's node, or null. */
  static attach(sheet) {
    const run = sheet?.run;
    if (!run || !isPrologueRun(run) || !isRosterLessonLive(run)) return null;
    return new PrologueRosterCoach(sheet).create();
  }

  constructor(sheet) {
    this.sheet = sheet;
    this.run = sheet.run;
    this.message = '';
    this.destroyed = false;
  }

  create() {
    advanceRosterLesson(this.run);
    this.markTaught();
    this.sheet.persistNow?.();
    return this;
  }

  destroy() {
    this.destroyed = true;
    this.root?.remove();
    this.root = null;
  }

  /** The in-run notes this lesson stands in for are read on the slot (convoy). */
  markTaught() {
    const view = rosterLessonView(this.run);
    if (view?.step === 'withdraw' || view?.step === 'store')
      this.sheet.scene?.registry?.get?.('hints')?.markSeen?.('guide_convoy');
  }

  /** The sheet applied an action: count it toward the lesson, then save. */
  observe(event) {
    if (this.destroyed || !event) return [];
    const done = observeRosterAction(this.run, event);
    if (done.length) {
      const titles = done.map((step) => rosterLessonCopy(step, {})?.title).filter(Boolean);
      this.message = `${titles.join(' and ')}: done.`;
      this.markTaught();
    }
    return done;
  }

  skipStep() {
    if (this.destroyed) return;
    skipRosterLessonStep(this.run);
    this.message = '';
    this.markTaught();
    const warning = this.sheet.persistNow?.() || '';
    this.sheet.render(warning.trim());
  }

  skipLesson() {
    if (this.destroyed) return;
    dismissRosterLesson(this.run);
    this.message = '';
    const warning = this.sheet.persistNow?.() || '';
    this.sheet.render(`Roster lesson skipped.${warning}`);
  }

  /** Copy context for the current step. */
  context(view) {
    const t = view?.target || {};
    return {
      subject: view?.subject || 'Tamsin',
      unit: t.unit || null,
      giver: t.giver || null,
      item: t.item || null,
      touch: Boolean(this.sheet.scene?.isMobileInput),
    };
  }

  /** The strip, at the top of the sheet's content (rebuilt with every render). */
  render(container) {
    if (this.destroyed || !container) return null;
    const view = rosterLessonView(this.run);
    const box = el('section', null, 'mr-lesson');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Roster lesson');
    if (!view) {
      if (!this.message) return null;
      box.append(el('p', `${this.message} Roster lesson complete.`, 'mr-lesson-done'));
      this.message = '';
      container.prepend(box);
      this.root = box;
      return box;
    }
    const ctx = this.context(view);
    const copy = rosterLessonCopy(view.step, ctx);
    box.dataset.step = view.step;
    box.append(el('p', `Roster lesson · ${view.index} of ${view.total} · ${copy.title}`, 'mr-lesson-kicker')); // prettier-ignore
    if (this.message) box.append(el('p', this.message, 'mr-lesson-done'));
    box.append(el('h4', copy.goal, 'mr-lesson-goal'));
    const text = view.step === 'withdraw' ? `${guidanceText('guide_convoy')} ${copy.text}` : copy.text; // prettier-ignore
    box.append(el('p', text, 'mr-lesson-text'));
    if (!view.target.available && view.target.reason)
      box.append(el('p', rosterLessonSkipText(view.target.reason, ctx), 'mr-lesson-text'));
    const actions = el('div', null, 'mr-lesson-actions');
    const skip = this.sheet.button('Skip step', () => this.skipStep());
    skip.dataset.lessonAction = 'skip-step';
    const leave = this.sheet.button('Skip lesson', () => this.skipLesson());
    leave.dataset.lessonAction = 'skip-lesson';
    actions.append(skip, leave);
    box.append(actions);
    container.prepend(box);
    this.root = box;
    return box;
  }
}
