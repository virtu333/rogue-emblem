// FateDecisionStage — restages the lord-death decision as a ceremony.
//
// VisionRewindController keeps owning the decision: its MenuSurface modal,
// visionDialog record, confirm/cancel callbacks (each exactly once), overlay
// and input-focus scopes, keyboard/gamepad routing and focus handling are
// untouched. This only rearranges that surface's DOM into a crimson FALLEN
// band over the map with Sera's offer beneath ("Rewind · N left" primary,
// "Accept fate"), follows the map frame through resizes, and leaves the
// command rail visible but inert underneath.

import { fallenContent, fateOfferContent } from './ceremonyContent.js';
import {
  ceremonyPortrait,
  el,
  fitText,
  frameScale,
  hairline,
  measureFrame,
} from './ceremonyDom.js';

/**
 * @param {object} scene
 * @param {object} surface  MenuSurface built with { modal: true }
 * @param {{ fallen: {name, className}|null, sera: object|null, seraPresent: boolean,
 *           remaining: number, reducedMotion?: boolean }} options
 */
export function stageFateDecision(scene, surface, options) {
  if (typeof document === 'undefined' || !surface?.root?.classList || !surface.header)
    return surface;
  const { fallen, sera, seraPresent, remaining, reducedMotion = false } = options;
  const band = fallenContent({ name: fallen?.name, className: fallen?.className });
  const offer = fateOfferContent({ seraPresent, remaining });
  const root = surface.root;
  const shield = surface.shield;
  const cancel = surface.header.querySelector('button');

  root.classList.add('ce-fate');
  root.classList.remove('re-compact-menu');
  if (reducedMotion) root.classList.add('is-static');
  shield?.classList.add('ce-fate-shield');
  shield?.prepend(el('div', 'ce-fate-veil'));

  const bandEl = el('div', 'ce-band ce-band--crimson');
  const word = el('div', 'ce-band-word', band.word);
  bandEl.append(word);
  if (band.sub) bandEl.append(el('div', 'ce-band-sub', band.sub));
  bandEl.append(hairline('crimson'));

  const card = el('div', 'ce-offer');
  const portrait = seraPresent ? ceremonyPortrait(scene, sera) : null;
  if (portrait?.src) {
    const face = el('img', 'ce-offer-face');
    face.src = portrait.src;
    face.alt = '';
    card.append(face);
  }
  const line = el('p', 'ce-offer-line');
  if (offer.speaker) line.append(el('b', '', offer.speaker.toUpperCase()));
  line.append(document.createTextNode(offer.line));
  const actions = el('div', 'ce-offer-actions');
  card.append(line, actions);

  // The body's existing primary button keeps its handler; relabel it and seat
  // it with the header's cancel button (Accept fate) in the offer's row.
  const primary = surface.body.querySelector('button');
  surface.body.replaceChildren(bandEl, card);
  if (primary) {
    primary.textContent = offer.rewindLabel;
    actions.append(primary);
  }
  if (cancel) {
    cancel.textContent = offer.acceptLabel;
    cancel.className = 're-btn';
    actions.append(cancel);
  }

  // Follow the map frame (phones: left of the rail; desktop: the canvas).
  const place = () => {
    const rect = measureFrame(scene, 'map');
    const style = root.style;
    style.left = `${Math.round(rect.left)}px`;
    style.top = `${Math.round(rect.top)}px`;
    style.width = `${Math.round(rect.width)}px`;
    style.height = `${Math.round(rect.height)}px`;
    style.setProperty('--ce-scale', String(frameScale(rect)));
    style.setProperty('--ce-w', `${Math.round(rect.width)}px`);
    fitText(word, { min: 20 });
  };
  place();
  globalThis.addEventListener?.('resize', place);
  globalThis.addEventListener?.('orientationchange', place);

  // The rail stays in view under a light veil but cannot be reached.
  const hud = [...(document.getElementById('game-wrapper')?.children || [])].find((node) =>
    node.classList?.contains('mobile-battle-hud'),
  );
  const hudWasInert = hud ? hud.inert : false;
  if (hud) hud.inert = true;

  const destroy = surface.destroy.bind(surface);
  surface.destroy = () => {
    if (surface.destroyed) return;
    globalThis.removeEventListener?.('resize', place);
    globalThis.removeEventListener?.('orientationchange', place);
    if (hud) hud.inert = hudWasInert;
    destroy();
  };
  return surface;
}
