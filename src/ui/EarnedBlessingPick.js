// EarnedBlessingPick — an owed earned-blessing pick (docs/specs/blessings-v3.md §6.4): the act
// boss's two cards, or an eclipsed elite's one.
//
// The earned blessings as tarot cards (choiceCards.blessingTarotCard, the shrine's own card):
// choose one and Take it, or Skip (a confirmation: "Leave them" / "Leave it"). The pick was
// rolled at the victory commit (engine/EarnedBlessings.js); this screen only shows the owed entry
// and calls the engine's take/skip by the entry's ledger key (`ledgerKeyOf`), then the host's
// save, then `onDone`. Two hosts share it: the battle scene after a boss's rewards
// (PostCombatController.transitionAfterBattle) and the route map after a reload or an elite's
// victory (NodeMapScene.checkActComplete / _maybeOpenEarnedPick).
//
// Input: Escape, a controller's Cancel and the header's Skip all open the same confirmation (a
// stray Escape never leaves them silently); Pause is swallowed (nothing behind it may open).
// One take or skip at a time (a busy guard), and the engine refuses a second take anyway.

import { MenuSurface, element, button } from './MenuSurface.js';
import { ChoicePicker } from './ChoicePicker.js';
import {
  blessingTarotCard,
  choiceReducedMotion,
  draftRow,
  fitDraft,
  sealChoice,
} from './choiceCards.js';
import {
  EARNED_PICK_SKIP,
  EARNED_PICK_TAKE,
  EARNED_PICK_TITLE,
  earnedPickFooter,
  earnedPickModel,
  earnedSkipConfirm,
} from './earnedBlessingPickModel.js';
import {
  earnedPickOwed,
  ledgerKeyOf,
  skipEarnedBlessing,
  takeEarnedBlessing,
} from '../engine/EarnedBlessings.js';
import { InputAction } from '../utils/InputActions.js';
import { hasDOMHost } from '../utils/domUI.js';

export class EarnedBlessingPick {
  /**
   * @param {object} scene - the host scene (its registry, events and overlay stack)
   * @param {{ run: object, entry?: object, save?: () => any,
   *   onDone?: (result: { outcome: 'taken'|'skipped', blessingId?: string }) => void }} options
   *   `save` writes the run after a take or a skip (the host's own save); `onDone` follows it.
   */
  constructor(scene, { run, entry = null, save = null, onDone = null } = {}) {
    Object.assign(this, { scene, run, save, onDone });
    this.entry = entry || earnedPickOwed(run);
    this.chosen = null;
    this.busy = false;
    this.closed = false;
  }

  /** Build the menu. False (and nothing drawn) when there is no document or nothing owed. */
  create() {
    if (!hasDOMHost()) return false;
    this.model = earnedPickModel(this.run, this.entry);
    if (!this.model) return false;
    const surface = new MenuSurface(this.scene, EARNED_PICK_TITLE, () => this.askSkip(), {
      modal: true,
    });
    this.surface = surface;
    surface.root.classList.add('ch-earned-pick');
    surface.root.classList.toggle('is-still', choiceReducedMotion(this.scene));
    const skip = surface.header.querySelector('button');
    skip.textContent = EARNED_PICK_SKIP;
    skip.dataset.focus = 'skip';
    surface.onAction = (action) => {
      if (action === InputAction.PAUSE) return true;
      if (action === InputAction.CANCEL) {
        this.askSkip();
        return true;
      }
      return false;
    };
    this.render();
    surface.body.querySelector('.ch-card')?.focus({ preventScroll: true });
    return true;
  }

  _audio(key) {
    this.scene?.registry?.get?.('audio')?.playSFX?.(key);
  }

  render(message = '') {
    if (this.closed) return;
    const body = this.surface.body;
    const row = draftRow(this.model.cards.length, 'ch-tarots ch-earned-cards');
    this.model.cards.forEach((card, i) => {
      const node = blessingTarotCard(card.content, {
        selected: card.id === this.chosen,
        onSelect: () => this.select(card.id),
        terms: card.terms,
      });
      node.dataset.focus = `choice-${i}`;
      node.dataset.blessing = card.id;
      row.append(node);
    });
    const footer = element('footer', null, 're-footer ch-footer');
    const lead = element('p', null, 'ch-footer-lead');
    const line = earnedPickFooter(this.model, this.chosen);
    if (line.kind === 'terms') {
      const terms = element('span', null, 'ch-term');
      for (const t of line.terms) terms.append(element('b', `${t.term}:`), ` ${t.text} `);
      lead.append(terms);
    } else lead.append(element('span', line.text, line.kind === 'lore' ? 'ch-lore' : ''));
    const feedback = element('span', message, 'ch-feedback');
    feedback.setAttribute('role', 'status');
    lead.append(feedback);
    const take = button(EARNED_PICK_TAKE, () => this.take(), 're-btn re-btn--primary');
    take.dataset.focus = 'confirm';
    take.disabled = !this.chosen || this.busy;
    footer.append(lead, take);
    body.replaceChildren(row, footer);
    this.row = row;
    this.fitStop?.();
    this.fitStop = fitDraft(body, '.ch-tarot-name', { min: 10 });
  }

  select(id) {
    if (this.busy || this.closed || this.confirm) return;
    if (this.chosen !== id) this._audio('sfx_cursor');
    this.chosen = id;
    this.render();
    this.surface.body
      .querySelector('.ch-card[aria-pressed="true"]')
      ?.focus({ preventScroll: true });
  }

  /** Take the chosen card: the engine adds it, the host saves, the card seals, then onDone. */
  take() {
    if (this.busy || this.closed || this.confirm || !this.chosen) return;
    this.busy = true;
    for (const b of this.surface.root.querySelectorAll('button')) b.disabled = true;
    const blessingId = this.chosen;
    const result = takeEarnedBlessing(this.run, ledgerKeyOf(this.entry), blessingId);
    if (!result.ok) {
      // Refused (nothing changed): the menu comes back whole, the header's Skip too, and focus
      // returns to it, so a refused take never leaves a menu nothing can leave.
      this.busy = false;
      this.surface.header.querySelector('button').disabled = false;
      this.render(result.reason);
      this.surface.focusContent();
      return;
    }
    this._save();
    this._audio('sfx_confirm');
    const card = this.row?.querySelector('.ch-card[aria-pressed="true"]');
    sealChoice(this.row, card, choiceReducedMotion(this.scene), () =>
      this._finish({ outcome: 'taken', blessingId }),
    );
  }

  /** Skip, Escape or Cancel: ask first. "Leave them" skips for good; "Back" returns. */
  askSkip() {
    if (this.busy || this.closed || this.confirm) return;
    let left = false;
    const words = earnedSkipConfirm(this.model.cards.length);
    this.confirm = new ChoicePicker({
      scene: this.scene,
      title: words.title,
      choices: [this.entry],
      label: () => words.heading,
      describe: () => words.text,
      confirmation: true,
      confirmLabel: words.confirmLabel,
      closeLabel: words.closeLabel,
      apply: () => {
        if (this.busy || this.closed) return { ok: false, reason: 'Already chosen.' };
        const result = skipEarnedBlessing(this.run, ledgerKeyOf(this.entry));
        if (!result.ok) return result;
        left = true;
        this.busy = true;
        this._save();
        return { ok: true };
      },
      onClose: () => {
        this.confirm = null;
        if (left) this._finish({ outcome: 'skipped' });
        else if (!this.closed)
          (
            this.surface.body.querySelector('.ch-card[aria-pressed="true"]') ||
            this.surface.body.querySelector('.ch-card')
          )?.focus({ preventScroll: true });
      },
    });
    // Focus starts on Back, never on "Leave them": a stray Enter or Confirm keeps the pick.
    this.confirm.surface.header.querySelector('button')?.focus({ preventScroll: true });
  }

  /** The host's save (it reports a refused write itself); a throw never strands the menu. */
  _save() {
    try {
      this.save?.();
    } catch (err) {
      console.warn('[EarnedBlessingPick] save failed:', err);
    }
  }

  _finish(result) {
    if (this.closed) return;
    this.destroy();
    this.onDone?.(result);
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.fitStop?.();
    this.fitStop = null;
    this.confirm?.destroy();
    this.confirm = null;
    this.surface?.destroy();
  }
}

/**
 * Open the owed pick and wait for it: resolves `{ outcome: 'taken'|'skipped', blessingId? }`,
 * or `{ outcome: 'unavailable' }` at once when it cannot be shown (no document, nothing owed,
 * the menu failed to build). Never resolves if the scene shuts down under it.
 * @param {object} scene
 * @param {{ run: object, entry?: object, save?: () => any }} options
 * @returns {Promise<{ outcome: string, blessingId?: string }>}
 */
export function presentEarnedBlessingPick(scene, options) {
  return new Promise((resolve) => {
    let pick = null;
    try {
      pick = new EarnedBlessingPick(scene, { ...options, onDone: resolve });
      if (pick.create()) return;
    } catch (err) {
      console.warn('[EarnedBlessingPick] could not open:', err);
      pick?.destroy();
    }
    resolve({ outcome: 'unavailable' });
  });
}
