// GiftReveal — the shrine's reveal of a taken start gift (giftRevealModel): one tarot card, the
// shrine's own (choiceCards.blessingTarotCard), and Begin. A blessing gift's card is the blessing
// it rolled, so the player knows what the Sealed Reliquary held before the run begins.
//
// The gift is already taken when this opens: there is no going back, so Begin, Escape, a
// controller's Cancel and the header's button all close it and the run begins. Pause is
// swallowed (nothing behind it may open).

import { MenuSurface, element, button } from './MenuSurface.js';
import { blessingTarotCard, choiceReducedMotion, draftRow, fitDraft } from './choiceCards.js';
import { GIFT_REVEAL_BEGIN } from './giftRevealModel.js';
import { InputAction } from '../utils/InputActions.js';
import { hasDOMHost } from '../utils/domUI.js';

/**
 * Show the reveal and wait for Begin. Returns null (nothing drawn) when there is no document or
 * no model, else a promise that resolves once the reveal closes (never if the scene shuts down
 * under it).
 * @param {object} scene - the shrine
 * @param {object|null} model - giftRevealModel(run)
 * @returns {Promise<void>|null}
 */
export function presentGiftReveal(scene, model) {
  if (!model || !hasDOMHost()) return null;
  let surface = null;
  let fitStop = null;
  let resolve = null;
  let closed = false;
  const done = new Promise((r) => {
    resolve = r;
  });
  const close = () => {
    if (closed) return;
    closed = true;
    fitStop?.();
    surface?.destroy();
    resolve();
  };
  try {
    surface = new MenuSurface(scene, model.title, close, { modal: true });
    surface.root.classList.add('ch-earned-pick', 'ch-gift-reveal');
    surface.root.classList.toggle('is-still', choiceReducedMotion(scene));
    surface.header.querySelector('button').textContent = 'Begin';
    surface.onAction = (action) => {
      if (action === InputAction.PAUSE) return true;
      if (action === InputAction.CANCEL) {
        close();
        return true;
      }
      return false;
    };
    const row = draftRow(1, 'ch-tarots ch-earned-cards');
    const card = blessingTarotCard(model.content, {
      selected: true,
      onSelect: () => {},
      terms: model.terms,
    });
    card.dataset.focus = 'choice-0';
    if (model.blessingId) card.dataset.blessing = model.blessingId;
    else card.dataset.gift = model.giftId;
    row.append(card);
    const footer = element('footer', null, 're-footer ch-footer');
    const lead = element('p', null, 'ch-footer-lead');
    lead.setAttribute('role', 'status');
    lead.append(element('span', model.lead, 'ch-gift-reveal-lead'));
    const begin = button(GIFT_REVEAL_BEGIN, close, 're-btn re-btn--primary');
    begin.dataset.focus = 'confirm';
    footer.append(lead, begin);
    surface.body.replaceChildren(row, footer);
    fitStop = fitDraft(surface.body, '.ch-tarot-name', { min: 10 });
    begin.focus({ preventScroll: true });
  } catch (err) {
    console.warn('[GiftReveal] could not open:', err);
    closed = true;
    fitStop?.();
    surface?.destroy();
    return null;
  }
  return done;
}
