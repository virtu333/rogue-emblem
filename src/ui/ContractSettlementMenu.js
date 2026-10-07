// ContractSettlementMenu — the page of a contract's earned settlement that has not been delivered
// (docs/specs/event-nodes-phase2.md "Contract settlement recovery"). It draws what
// contractSettlementModel says and calls the controller; it holds NO rules (what is owed, why it
// waits and whether it can be paid are the engine's). Built on MenuSurface and the Event page's
// own look (eventMenu.css), like the spoils page it follows (EventMenu.renderSpoilsOwed).
//
//   owed       the contract's kept reward is earned and waiting (or its penalty could not be applied):
//              what is owed, why it waits, then Claim (the delivery again), Roster (make room; the
//              page returns), Back to map (everything stays owed and the party stays here) and,
//              for a reward only, Give up, behind a confirmation.
//   paid       a Claim delivered it: what arrived; Continue.
//   forfeited  the reward was given up: said plainly; Continue.
//
// ESC / the header button: Back to map while owed (the page reopens by tapping the held node or
// the contract chip); Continue once it is settled.

import { MenuSurface, element as el, button } from './MenuSurface.js';
import { ChoicePicker } from './ChoicePicker.js';
import { MobileRosterSheet } from './MobileRosterSheet.js';
import { itemIcon } from './itemIcons.js';
import { createEventBand } from './eventBand.js';
import { saveServiceRun } from './serviceSave.js';
import {
  claimStillWaitingLine,
  contractSettlementCloseLabel,
  contractSettlementView,
} from './contractSettlementModel.js';

export class ContractSettlementMenu {
  constructor(controller) {
    this.c = controller;
    this.scene = controller.scene;
    this.status = '';
    this.open();
  }

  get run() {
    return this.scene.runManager;
  }

  view() {
    return contractSettlementView(this.run, this.c.outcome, { gameData: this.scene.gameData });
  }

  open() {
    if (this.surface || this.destroyed) return;
    this.surface = new MenuSurface(this.scene, 'Contract', () => this.requestClose());
    this.surface.root.classList.add('service-menu', 'ev-menu', 'ev-contract-menu');
    const heading = this.surface.header.querySelector?.('h2');
    if (heading) heading.textContent = 'Contract';
    this.closeButton = this.surface.header.querySelector('button');
    this.gold = el('span', '', 'shop-gold');
    this.surface.header.insertBefore(this.gold, this.surface.header.lastChild);
    this.render();
    this.focusPrimary();
  }

  /** ESC and the header button: the map while owed, Continue once settled. */
  requestClose() {
    if (this.child || this.destroyed) return;
    if (this.view()?.phase === 'owed') this.c.closeToMap();
    else this.c.finish();
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
    this.gold.textContent = `${this.run.gold} G`;
    const view = this.view();
    this.closeButton.textContent = contractSettlementCloseLabel(view);
    if (!view) {
      this.renderGone(body);
      return;
    }
    const head = el('div', null, 'ev-head');
    const hero = el('header', null, 'ev-hero');
    hero.append(el('p', view.kicker, 'ev-kicker'), el('h3', view.title, 'ev-title'));
    head.append(createEventBand(view.eventId, this.scene), hero);
    body.append(head);
    if (this.status) {
      const status = el('p', this.status, 'ev-status');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      body.append(status);
    }
    if (view.phase === 'owed') this.renderOwed(body, view);
    else this.renderDone(body, view);
    body.scrollTop = scroll;
  }

  /** What is owed and why it waits, then the ways on. */
  renderOwed(body, view) {
    // What waits comes first (on a short screen it must not hide under the action row).
    const failed = el('div', null, 'ev-failed ev-contract-owed');
    failed.setAttribute('role', 'alert');
    failed.append(
      el('strong', view.headline, 'ev-failed-title'),
      el('span', view.why || 'It is not settled yet.', 'ev-failed-why'),
      el('small', view.hint),
    );
    body.append(failed);
    if (view.goal) body.append(el('p', `Goal: ${view.goal}`, 'ev-chosen'));
    if (view.owed.length) {
      const list = el('ul', null, 'ev-results');
      list.setAttribute('aria-label', view.kept ? 'The reward owed' : 'The penalty owed');
      for (const phrase of view.owed) {
        const item = el('li', null, 'ev-result is-plain');
        item.dataset.kind = 'owed';
        const lead = el('span', null, 'ev-lead');
        lead.append(el('span', view.kept ? 'OWED' : 'DUE', 'ev-chip'));
        const text = el('span', null, 'ev-result-text');
        text.append(el('strong', phrase, 'ev-result-line'));
        item.append(lead, text);
        list.append(item);
      }
      body.append(list);
    }
    const actions = el('div', null, 'ev-actions ev-actions--owed');
    this.primary = button(
      view.claimLabel,
      () => this.claim(),
      're-btn re-btn--primary ev-primary ev-claim',
    );
    actions.append(
      this.primary,
      button('Back to map', () => this.c.closeToMap(), 're-btn ev-back'),
    );
    if (view.canGiveUp)
      actions.append(
        button('Give up the reward', () => this.confirmForfeit(), 're-btn ev-forfeit'),
      );
    actions.append(button('Roster', () => this.roster(), 're-btn ev-roster'));
    body.append(actions);
  }

  /** What arrived (or that it was given up), then Continue. */
  renderDone(body, view) {
    body.append(el('p', view.headline, 'ev-chosen ev-won'));
    this.appendResults(body, view.lines || []);
    const actions = el('div', null, 'ev-actions');
    this.primary = button(
      'Continue',
      () => this.c.finish(),
      're-btn re-btn--primary ev-primary ev-continue',
    );
    actions.append(this.primary);
    body.append(actions);
  }

  /** Nothing is owed any more and nothing was just settled (a stale page): the way out. */
  renderGone(body) {
    body.append(el('p', 'Nothing is owed here.', 'ev-intro'));
    const actions = el('div', null, 'ev-actions');
    this.primary = button(
      'Continue',
      () => this.c.finish(),
      're-btn re-btn--primary ev-primary ev-continue',
    );
    actions.append(this.primary);
    body.append(actions);
  }

  claim() {
    if (this.child || !this.surface) return;
    const result = this.c.claim();
    if (!result.ok) this.render(claimStillWaitingLine(result.reason));
    else this.render('');
    this.focusPrimary();
  }

  /** Giving the reward up is final: a confirmation first, like a choice's. */
  confirmForfeit() {
    if (this.child || !this.surface) return;
    this.surface.root.inert = true;
    this.child = new ChoicePicker({
      scene: this.scene,
      title: 'Give up the reward?',
      choices: [{ id: 'forfeit' }],
      confirmation: true,
      confirmLabel: 'Give up the reward',
      closeLabel: 'Keep it owed',
      label: () => 'Give up the reward',
      describe: () =>
        'The contract was kept, but what it earned is lost for good. The road goes on. This cannot be undone.',
      blocked: () => '',
      apply: () => this.c.forfeit(),
      onClose: () => {
        this.child = null;
        if (!this.surface || this.destroyed) return;
        this.surface.root.inert = false;
        this.render();
        this.focusPrimary();
      },
    });
  }

  /** One row per result line: a chip (and an item's icon), the words, a detail. */
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
      lead.append(el('span', line.chip, 'ev-chip'));
      const text = el('span', null, 'ev-result-text');
      text.append(el('strong', line.text, 'ev-result-line'));
      if (line.detail) text.append(el('small', line.detail, 'ev-result-detail'));
      item.append(lead, text);
      list.append(item);
    }
    parent.append(list);
  }

  /** The roster, to make room; what it changed is saved and the page asks the engine again. */
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
