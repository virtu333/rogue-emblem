// EventMenu — the renderer of a story Event on the route map (docs/specs/event-nodes.md §10).
// It draws what EventCommands.eventView() says and calls the commands; it holds NO event
// logic (no odds, no outcomes, no eligibility: the engine answers all three). Built on
// MenuSurface like ChurchMenu, so ESC, the overlay stack, gamepad focus and teardown are
// the shared ones. EventController owns the lifecycle (open, Fight, Continue, close).
//
// Pages (eventView().phase):
//   choosing  kicker, title, intro, one large button per choice (label, hint, cost seal,
//             the reason when greyed). A choice opens a confirmation (a unit picker with
//             faces for a choice that needs a target); nothing is shown of what it brings.
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
import {
  eventCloseLabel,
  eventConfirmLabel,
  eventCostSeal,
  eventResultLines,
  eventTargetLine,
} from './eventMenuModel.js';

export class EventMenu {
  constructor(controller) {
    this.c = controller;
    this.scene = controller.scene;
    this.nodeId = this.scene._eventNode?.id;
    this.status = '';
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
    if (view.phase === 'choosing') this.renderChoices(body, view);
    else this.renderOutcome(body, view);
    body.scrollTop = scroll;
  }

  hero(view) {
    const hero = el('header', null, 'ev-hero');
    hero.append(el('p', 'EVENT', 'ev-kicker'), el('h3', view.title, 'ev-title'));
    return hero;
  }

  // ── Choosing ──────────────────────────────────────────────────────────

  renderChoices(body, view) {
    body.append(el('p', view.intro, 'ev-intro'));
    const list = el('div', null, 'ev-choices');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Choices');
    for (const choice of view.choices) {
      const b = button(null, () => this.pick(choice), 're-btn ev-choice');
      b.disabled = !!choice.block;
      b.dataset.choice = choice.id;
      const main = el('span', null, 'ev-choice-main');
      main.append(el('strong', choice.label, 'ev-choice-label'));
      if (choice.hint) main.append(el('small', choice.hint, 'ev-choice-hint'));
      if (choice.block) main.append(el('small', choice.block, 'ev-choice-block'));
      b.append(main);
      const seal = eventCostSeal(choice.cost);
      if (seal) b.append(el('span', seal, 'ev-seal'));
      list.append(b);
    }
    body.append(list);
    body.append(this.tools());
  }

  /** A choice opens its confirmation: the unit picker (with faces), or a plain confirm. */
  pick(choice) {
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
        apply: (row) => this.commit(choice, row.uid),
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
      apply: (c) => this.commit(c, null),
    });
  }

  face(unit) {
    if (!unit || typeof unit !== 'object') return null;
    try {
      return unitPortrait(this.scene, this.scene.gameData, unit, 'mr-unit-face');
    } catch {
      return null; // decoration only
    }
  }

  /** The commit: the engine decides, the page saves at once (a refresh reopens the outcome). */
  commit(choice, targetUid) {
    const result = chooseEventOption(this.run, this.nodeId, choice.id, {
      targetUid: targetUid || null,
    });
    if (!result.ok) return result;
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
    if (outcome) {
      const who = outcome.targetName ? ` · ${outcome.targetName}` : '';
      body.append(el('p', `You chose: ${outcome.choiceLabel}${who}`, 'ev-chosen'));
    }
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
    const lines = eventResultLines(results, { gameData: this.scene.gameData });
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
      lead.append(el('span', line.chip, 'ev-chip'));
      const text = el('span', null, 'ev-result-text');
      text.append(el('strong', line.text, 'ev-result-line'));
      if (line.detail) text.append(el('small', line.detail, 'ev-result-detail'));
      item.append(lead, text);
      list.append(item);
    }
    body.append(list);
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
