// EventMenu — the renderer of a story Event on the route map (docs/specs/event-nodes.md §10).
// It draws what EventCommands.eventView() says and calls the commands; it holds NO event
// logic (no odds, no outcomes, no eligibility: the engine answers all three). Built on
// MenuSurface like ChurchMenu, so ESC, the overlay stack, gamepad focus and teardown are
// the shared ones. EventController owns the lifecycle (open, Fight, Continue, close).
//
// Pages (eventView().phase):
//   choosing  kicker, title, the event's counters ("Torches 2/3"), the steps taken so far
//             (the one just taken in full, the older ones behind a toggle), the page's intro,
//             one large button per choice (label, hint, cost seal, the reason when greyed, and
//             under it the roster tells: a unit's face and line). A choice opens a
//             confirmation (a unit picker with faces for a choice that needs a target);
//             nothing is shown of what it brings. A multi-page event comes back here, on its
//             next page, after each step that has one.
//   outcome   what happened: the outcome text, one line per result (chip, text, detail);
//             Continue, or only Fight while a battle is owed.
//   victory   the fight was won: the spoils' text and result lines; Continue.
//
// ESC / the header button: before choosing, or while a fight is owed, it returns to the
// route map with the event still current (re-entry reopens this page); after choosing it
// is Continue.

import { MenuSurface, element as el, button } from './MenuSurface.js';
import { ChoicePicker } from './ChoicePicker.js';
import { MobileRosterSheet } from './MobileRosterSheet.js';
import { unitPortrait } from './unitPortrait.js';
import { itemIcon } from './itemIcons.js';
import { createEventBand } from './eventBand.js';
import { saveServiceRun } from './serviceSave.js';
import { canShowRunNote, markNoteSeen } from './guidanceGate.js';
import { guidanceText } from '../engine/Guidance.js';
import { chooseEventOption, eventTargets, eventView } from '../engine/EventCommands.js';
import { findRosterUnit } from '../engine/EventSystem.js';
import {
  PAGE_MOVED_ON_LINE,
  eventChosenLine,
  eventCloseLabel,
  eventConfirmLabel,
  eventCostSeal,
  eventCounterModel,
  eventResultLines,
  eventTargetLine,
  eventTellModel,
  eventTrailModel,
} from './eventMenuModel.js';

export class EventMenu {
  constructor(controller) {
    this.c = controller;
    this.scene = controller.scene;
    this.nodeId = this.scene._eventNode?.id;
    this.status = '';
    // The steps behind the page: the toggle's state (collapsed on each new page) and
    // the step count the player just took in this sitting (shown in full, not behind the toggle).
    this.trailOpen = false;
    this.trailPage = null;
    this.justNow = null;
    // The page the player is looking at: a commit carries it, so a stale tap is refused.
    this.shown = null;
    // A real run's first event says what an event is, as its status line on the page
    // that offers the choices (never over a result): once per slot (guidanceGate).
    if (eventView(this.run, this.nodeId)?.phase === 'choosing') {
      if (canShowRunNote(this.scene, 'guide_first_event')) {
        this.status = guidanceText('guide_first_event');
        markNoteSeen(this.scene, 'guide_first_event');
      }
    }
    this.open();
  }

  get run() {
    return this.scene.runManager;
  }

  open() {
    if (this.surface || this.destroyed) return;
    const view = eventView(this.run, this.nodeId);
    this.surface = new MenuSurface(this.scene, view?.title || 'Event', () => this.requestClose());
    this.surface.root.classList.add('service-menu', 'ev-menu');
    // A Dark Omen is the same event with its darker face: the band keeps the painting, dimmed.
    this.surface.root.classList.toggle('is-dark-omen', view?.dark === true);
    const heading = this.surface.header.querySelector?.('h2');
    if (heading) heading.textContent = 'Event';
    this.closeButton = this.surface.header.querySelector('button');
    this.gold = el('span', '', 'shop-gold');
    this.surface.header.insertBefore(this.gold, this.surface.header.lastChild);
    this.render();
    this.focusPrimary();
  }

  /** ESC and the header button: the map, or Continue once something was chosen. */
  requestClose() {
    if (this.child || this.destroyed) return;
    const view = eventView(this.run, this.nodeId);
    if (!view || view.phase === 'choosing' || view.canFight) this.c.closeToMap();
    else this.c.continueEvent();
  }

  focusPrimary() {
    if (this.primary) this.primary.focus();
    else this.surface?.focusContent();
  }

  render(message) {
    if (!this.surface || this.surface.destroyed) return;
    if (message != null) this.status = message;
    const body = this.surface.body;
    const scroll = body.scrollTop;
    body.replaceChildren();
    this.primary = null;
    const run = this.run;
    this.gold.textContent = `${run.gold} G`;
    const view = eventView(run, this.nodeId);
    this.closeButton.textContent = eventCloseLabel(view);
    if (!view) {
      this.renderUnknown(body);
      return;
    }
    // The head: the painted band (art never gates the page: a plain strip until or unless it
    // loads) with the kicker and title, stacked on a narrow screen and overlaid on a wide one.
    const head = el('div', null, 'ev-head');
    head.append(createEventBand(view.eventId, this.scene), this.hero(view));
    body.append(head);
    const status = el('p', this.status, 'ev-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    if (this.status) body.append(status);
    this.shown = { page: view.page, phase: view.phase };
    this.renderCounters(body, view);
    this.renderTrail(body, view);
    if (view.phase === 'choosing') this.renderChoices(body, view);
    else this.renderOutcome(body, view);
    body.scrollTop = scroll;
    // A step was just taken: the page comes up at what just happened, then the new page under it
    // (not wherever the last page's choices had been scrolled to).
    if (this.scrollToRecent) {
      this.scrollToRecent = false;
      body.querySelector?.('.ev-recent')?.scrollIntoView?.({ block: 'start' });
    }
  }

  // ── The event's counters and the steps behind this page ───────────────

  /** "Torches 2/3" with a pip per point (a counter at 0 is said plainly). */
  renderCounters(body, view) {
    const counters = (view.counters || []).map(eventCounterModel);
    if (!counters.length) return;
    const row = el('ul', null, 'ev-counters');
    row.setAttribute('aria-label', 'This event keeps count');
    for (const counter of counters) {
      const item = el('li', null, `ev-counter${counter.empty ? ' is-empty' : ''}`);
      item.dataset.counter = counter.key;
      item.setAttribute('aria-label', counter.speech);
      const pips = el('span', null, 'ev-pips');
      pips.setAttribute('aria-hidden', 'true');
      for (const lit of counter.pips)
        pips.append(el('span', null, `ev-pip${lit ? ' is-lit' : ''}`));
      const text = el('span', counter.text, 'ev-counter-text');
      text.setAttribute('aria-hidden', 'true');
      if (counter.pips.length) item.append(pips);
      item.append(text);
      row.append(item);
    }
    body.append(row);
  }

  /**
   * The steps taken before this page. The step just taken is told in full above the new
   * page (its news is never only a tap away); older ones sit behind a toggle, collapsed.
   */
  renderTrail(body, view) {
    const trail = view.trail || [];
    if (!trail.length) {
      this.trailPage = null;
      return;
    }
    // Each new page (a step taken, or the last one's outcome) shows the toggle collapsed again:
    // "collapsed by default" holds on every page; a redraw of the same page keeps it as it is.
    const here = `${trail.length}:${view.phase}`;
    if (here !== this.trailPage) {
      this.trailPage = here;
      this.trailOpen = false;
    }
    const model = eventTrailModel(trail, {
      justNow: view.phase === 'choosing' && this.justNow === trail.length,
      gameData: this.scene.gameData,
    });
    if (model.recent) {
      const recent = el('section', null, 'ev-recent');
      recent.setAttribute('aria-label', 'What just happened');
      recent.append(
        el('p', 'Just now', 'ev-recent-kicker'),
        el('p', model.recent.chosen, 'ev-chosen'),
      );
      if (model.recent.text) recent.append(el('p', model.recent.text, 'ev-outcome'));
      this.appendResults(recent, model.recent.lines);
      body.append(recent);
    }
    if (!model.steps.length) return;
    const toggle = button(
      null,
      () => {
        this.trailOpen = !this.trailOpen;
        this.render();
        this.trailToggle?.focus({ preventScroll: true });
      },
      're-btn ev-trail-toggle',
    );
    toggle.setAttribute('aria-expanded', String(this.trailOpen));
    toggle.append(
      el('span', model.toggle, 'ev-trail-name'),
      el('span', this.trailOpen ? 'Hide' : 'Show', 'ev-trail-mark'),
    );
    this.trailToggle = toggle;
    body.append(toggle);
    if (!this.trailOpen) return;
    const list = el('ol', null, 'ev-trail');
    list.setAttribute('aria-label', 'Earlier steps');
    for (const step of model.steps) {
      const item = el('li', null, 'ev-step');
      item.dataset.page = step.page;
      item.append(el('p', step.chosen, 'ev-chosen'));
      if (step.text) item.append(el('p', step.text, 'ev-outcome'));
      this.appendResults(item, step.lines);
      list.append(item);
    }
    body.append(list);
  }

  hero(view) {
    const hero = el('header', null, 'ev-hero');
    hero.append(
      el('p', view.dark ? 'DARK OMEN' : 'EVENT', 'ev-kicker'),
      el('h3', view.title, 'ev-title'),
    );
    return hero;
  }

  // ── Choosing ──────────────────────────────────────────────────────────

  renderChoices(body, view) {
    body.append(el('p', view.intro, 'ev-intro'));
    const list = el('div', null, 'ev-choices');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Choices');
    for (const choice of view.choices) {
      const b = button(null, () => this.pick(choice, view.page), 're-btn ev-choice');
      b.disabled = !!choice.block;
      b.dataset.choice = choice.id;
      const main = el('span', null, 'ev-choice-main');
      main.append(el('strong', choice.label, 'ev-choice-label'));
      if (choice.hint) main.append(el('small', choice.hint, 'ev-choice-hint'));
      if (choice.block) main.append(el('small', choice.block, 'ev-choice-block'));
      b.append(main);
      const seal = eventCostSeal(choice.cost);
      if (seal) b.append(el('span', seal, 'ev-seal'));
      const tells = this.tellsFor(choice);
      if (!tells) {
        list.append(b);
        continue;
      }
      // The voice stands under the choice it speaks to; the button stays the one control.
      const row = el('div', null, 'ev-choice-row');
      row.append(b, tells);
      list.append(row);
    }
    body.append(list);
    body.append(this.tools());
  }

  /** The roster tells under a choice: each a unit's face and what it says (never a number). */
  tellsFor(choice) {
    const tells = (choice.tells || []).map(eventTellModel).filter(Boolean);
    if (!tells.length) return null;
    const list = el('ul', null, 'ev-tells');
    list.setAttribute('aria-label', 'Someone speaks up');
    for (const tell of tells) {
      const item = el('li', null, 'ev-tell');
      item.dataset.speaker = tell.name;
      const unit = tell.uid || tell.name ? findRosterUnit(this.run, tell.uid || tell.name) : null;
      const face = this.face(unit);
      if (face) item.append(face);
      const words = el('span', null, 'ev-tell-words');
      words.append(el('span', tell.line, 'ev-tell-line'));
      if (tell.caption) words.append(el('small', tell.caption, 'ev-tell-name'));
      item.append(words);
      list.append(item);
    }
    return list;
  }

  /** A choice opens its confirmation: the unit picker (with faces), or a plain confirm. */
  pick(choice, page = this.shown?.page ?? null) {
    if (this.child || !this.surface) return;
    const label = eventConfirmLabel(choice);
    const first = (rows) => rows.find((row) => row.ok);
    if (choice.target) {
      const rows = eventTargets(this.run, this.nodeId, choice.id);
      this.picker({
        title: choice.target.prompt,
        choices: rows,
        initialChoice: first(rows),
        label: (row) => row.name,
        describe: (row) => eventTargetLine(row),
        blocked: (row) => (row.ok ? '' : row.reason || 'Not this one.'),
        face: (row) => this.face(row.unit),
        confirmLabel: label,
        apply: (row) => this.commit(choice, row.uid, page),
      });
      return;
    }
    this.picker({
      title: choice.label,
      choices: [choice],
      confirmation: true,
      confirmLabel: label,
      label: (c) => c.label,
      describe: (c) =>
        [
          c.hint,
          eventCostSeal(c.cost) ? `It costs ${eventCostSeal(c.cost)}.` : '',
          'This cannot be undone.',
        ]
          .filter(Boolean)
          .join(' '),
      blocked: () => '',
      apply: (c) => this.commit(c, null, page),
    });
  }

  face(unit, className = 'mr-unit-face') {
    if (!unit || typeof unit !== 'object') return null;
    try {
      return unitPortrait(this.scene, this.scene.gameData, unit, className);
    } catch {
      return null; // decoration only
    }
  }

  /**
   * The commit: the engine decides, the page saves at once (a refresh reopens the outcome).
   * The page the choice was shown on rides along, so a tap on a page that has since moved on
   * (a second tap on a choice both pages carry) is refused by the engine, never taken twice.
   * Such a refusal closes the picker and reads the page again (`ok: true` to the picker, with the
   * page's own line saying to look again): nothing was committed, nothing is left stale.
   */
  commit(choice, targetUid, page = null) {
    const result = chooseEventOption(this.run, this.nodeId, choice.id, {
      targetUid: targetUid || null,
      page,
    });
    if (!result.ok) {
      const now = eventView(this.run, this.nodeId);
      // Moved on: the event is no longer on the page the choice was made on (a step was taken since),
      // or no longer choosing at all. Any other refusal (gold, a target, a block) stays a refusal.
      const from = page ?? this.shown?.page ?? null;
      const moved = !!now && ((from !== null && now.page !== from) || now.phase !== 'choosing');
      if (!moved) return result;
      this.status = PAGE_MOVED_ON_LINE;
      return { ok: true, movedOn: true };
    }
    this.justNow = result.next ? (eventView(this.run, this.nodeId)?.trail || []).length : null;
    this.scrollToRecent = Boolean(result.next);
    // A road drawn or a place changed: the route map shows what moved when it comes back.
    this.c.noteRouteChange?.(result.results);
    const warning = saveServiceRun(this.scene);
    this.status = warning.trim();
    return result;
  }

  picker(options) {
    if (this.child || !this.surface) return;
    this.surface.root.inert = true;
    this.child = new ChoicePicker({
      scene: this.scene,
      ...options,
      onClose: () => {
        this.child = null;
        if (!this.surface || this.destroyed) return;
        this.surface.root.inert = false;
        this.render();
        this.focusPrimary();
      },
    });
  }

  // ── The outcome and the victory ───────────────────────────────────────

  renderOutcome(body, view) {
    const victory = view.phase === 'victory';
    const outcome = view.outcome;
    if (outcome) body.append(el('p', eventChosenLine(outcome), 'ev-chosen'));
    if (outcome?.text) body.append(el('p', outcome.text, 'ev-outcome'));
    this.renderResults(body, outcome?.results || []);
    if (victory) {
      body.append(el('p', 'The fight is won.', 'ev-chosen ev-won'));
      if (view.victory?.text) body.append(el('p', view.victory.text, 'ev-outcome'));
      this.renderResults(body, view.victory?.results || []);
    }
    const actions = el('div', null, 'ev-actions');
    actions.append(button('Roster', () => this.roster(), 're-btn ev-roster'));
    if (view.canFight) {
      body.append(el('p', 'There is no way around this fight.', 'ev-owed'));
      this.primary = button('Fight', () => this.c.fight(), 're-btn re-btn--primary ev-primary');
    } else if (view.canLeave) {
      this.primary = button(
        'Continue',
        () => this.c.continueEvent(),
        're-btn re-btn--primary ev-primary',
      );
    }
    if (this.primary) actions.append(this.primary);
    body.append(actions);
  }

  renderResults(body, results) {
    this.appendResults(body, eventResultLines(results, { gameData: this.scene.gameData }));
  }

  /** One row per result line: a chip (and an item's icon or a new unit's face), the words, a detail. */
  appendResults(parent, lines) {
    if (!lines.length) return;
    const list = el('ul', null, 'ev-results');
    list.setAttribute('aria-label', 'What came of it');
    for (const line of lines) {
      const item = el('li', null, `ev-result is-${line.tone}`);
      item.dataset.kind = line.kind;
      const lead = el('span', null, 'ev-lead');
      if (line.item) {
        try {
          lead.append(itemIcon(line.item, { size: 32 }));
        } catch {
          /* a picture is decoration: the line reads without it */
        }
      }
      if (line.unit) {
        // Someone joined: their face leads the line (the line reads without it).
        const face = this.face(findRosterUnit(this.run, line.unit.uid || line.unit.name));
        if (face) lead.append(face);
      }
      lead.append(el('span', line.chip, 'ev-chip'));
      const text = el('span', null, 'ev-result-text');
      text.append(el('strong', line.text, 'ev-result-line'));
      if (line.detail) text.append(el('small', line.detail, 'ev-result-detail'));
      item.append(lead, text);
      list.append(item);
    }
    parent.append(list);
  }

  /** The recorded event is not in this build's catalog: the only way on is to walk past. */
  renderUnknown(body) {
    body.append(el('p', 'Whatever waited here has gone from the road.', 'ev-intro'));
    this.primary = button(
      'Walk on',
      () => this.c.continueUnknown(),
      're-btn re-btn--primary ev-primary',
    );
    const actions = el('div', null, 'ev-actions');
    actions.append(this.primary);
    body.append(actions);
  }

  tools() {
    const tools = el('div', null, 'shop-tools ev-tools');
    tools.append(button('Roster', () => this.roster(), 're-btn ev-roster'));
    return tools;
  }

  roster() {
    if (this.child || !this.surface) return;
    this.surface.root.inert = true;
    this.child = new MobileRosterSheet({
      scene: this.scene,
      run: this.run,
      units: this.run.roster,
      gameData: this.scene.gameData,
      onClose: () => {
        this.child.destroy();
        this.child = null;
        if (!this.surface || this.destroyed) return;
        this.surface.root.inert = false;
        // What the roster changed (a bag emptied, an item moved) re-asks the engine, and
        // is saved like any service's.
        const warning = saveServiceRun(this.scene).trim();
        this.render(warning || this.status);
        this.focusPrimary();
      },
    });
  }

  setVisible(visible) {
    if (visible) this.open();
    else {
      this.child?.destroy();
      this.child = null;
      this.surface?.destroy();
      this.surface = null;
    }
  }

  destroy() {
    this.destroyed = true;
    this.setVisible(false);
  }
}
