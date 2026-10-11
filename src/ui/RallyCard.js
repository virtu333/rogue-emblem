// RallyCard — the Entity rally's speaker card: the speaker's portrait, name and class, the line,
// and a Skip control, docked on the battlefield's bottom (or top) edge.
//
// One card for the whole rally; each beat swaps what it shows. Everything but the Skip button is
// click-through, so the battle stays playable under it and a tap on the card never reaches the
// board. It takes no input scope and no overlay-stack entry: an explicit Cancel reaches it through
// the scene's requestCancel (`cancelAction`, EntityRallyController). Reduced motion (and Instant effects) cut instead of fade.
//
// Presentation only: no game state, no RNG.

import { DOM_INPUT_EVENTS } from '../utils/domUI.js';
import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import {
  CeremonyLayer,
  canRenderCeremony,
  el,
  measureFrame,
  measureMapRect,
} from './ceremonyDom.js';
import { unitPortrait } from './unitPortrait.js';
import { RALLY_FADE_MS, rallyCardInsets } from './rallyCardModel.js';
import './rallyCard.css';

/**
 * Open the card (hidden until `show`). Returns null without a DOM host.
 * @param {object} scene BattleScene
 * @param {{ onSkip: Function, reduceMotion?: boolean }} options
 */
export function createRallyCard(scene, { onSkip, reduceMotion = false } = {}) {
  if (!canRenderCeremony()) return null;
  const layer = new CeremonyLayer(scene, {
    frame: 'map',
    className: `ce-rally-layer${reduceMotion ? ' is-static' : ''}`,
    depth: DOM_UI_DEPTHS.RALLY,
    label: 'The army rallies',
  });
  const root = layer.root;

  const card = el('div', 'rc-card');
  card.hidden = true;
  const faceSlot = el('div', 'rc-face-slot');
  const name = el('span', 'rc-name');
  const sub = el('span', 'rc-sub');
  const count = el('span', 'rc-count');
  const skip = el('button', 'rc-skip', 'Skip');
  skip.type = 'button';
  skip.title = 'Skip the rally (Esc)';
  skip.setAttribute('aria-label', 'Skip the rally');
  const head = el('div', 'rc-head');
  head.append(name, sub, count, skip);
  const line = el('p', 'rc-line');
  const body = el('div', 'rc-body');
  body.append(head, line);
  card.append(faceSlot, body);
  root.append(card);

  // Only the Skip button takes input; its presses must not reach the board or the scene's keys.
  for (const type of DOM_INPUT_EVENTS)
    card.addEventListener(type, (e) => {
      if (e.target?.closest?.('button')) e.stopPropagation();
    });
  skip.addEventListener('click', () => onSkip?.());
  card.addEventListener('keyup', (e) => e.stopPropagation());
  card.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault?.();
      onSkip?.();
    }
  });

  let destroyed = false;
  let leaving = null;
  let visible = false;
  let edge = 'bottom';
  const cancelLeave = () => {
    if (leaving) clearTimeout(leaving);
    leaving = null;
    card.classList.remove('is-leaving');
  };

  // Sit on the battlefield's own edge: not over the letterbox, nor a HUD plate beside the board.
  const place = () => {
    if (destroyed) return;
    const frame = measureFrame(scene, 'map');
    const insets = rallyCardInsets(frame, measureMapRect(scene));
    root.style.setProperty('--rc-inset-top', `${insets.top}px`);
    root.style.setProperty('--rc-inset-bottom', `${insets.bottom}px`);
  };
  const onResize = () => place();
  globalThis.addEventListener?.('resize', onResize);
  globalThis.addEventListener?.('orientationchange', onResize);

  const handle = {
    root,
    card,
    get visible() {
      return visible;
    },
    get edge() {
      return edge;
    },
    /** The layer's frame, the card's distance from each edge and its height (CSS px). */
    metrics() {
      const frame = measureFrame(scene, 'map');
      const height = card.getBoundingClientRect?.().height || 0;
      return { frame, insets: rallyCardInsets(frame, measureMapRect(scene)), height };
    },
    /** Dock to 'top' or 'bottom' (a cut, never a slide). */
    setEdge(next) {
      edge = next === 'top' ? 'top' : 'bottom';
      root.dataset.edge = edge;
      place();
    },
    /** Show a beat: `model` from rallyCardModel, `unit` for its face. */
    show(model, unit) {
      if (destroyed) return;
      cancelLeave();
      place();
      let face;
      try {
        face = unitPortrait(scene, scene.gameData || {}, unit, 'rc-face');
      } catch {
        face = null; // a face is decoration: the card works without it
      }
      faceSlot.replaceChildren(...(face ? [face] : []));
      card.classList.toggle('is-faceless', !face);
      name.textContent = model.name;
      sub.textContent = model.className;
      count.textContent = model.counter;
      line.textContent = model.line;
      card.dataset.speaker = model.name;
      root.setAttribute('aria-label', model.label || 'The army rallies');
      card.hidden = false;
      visible = true;
      // Replay the arrival on each beat (a CSS animation restarts on a class toggle after reflow).
      card.classList.remove('is-in');
      void card.offsetWidth;
      card.classList.add('is-in');
    },
    /** End the card: faded over RALLY_FADE_MS, or at once. */
    hide({ fade = false } = {}) {
      if (destroyed || !visible) return;
      visible = false;
      if (!fade || reduceMotion) {
        cancelLeave();
        card.hidden = true;
        return;
      }
      card.classList.add('is-leaving');
      leaving = setTimeout(() => {
        leaving = null;
        card.classList.remove('is-leaving');
        card.hidden = true;
      }, RALLY_FADE_MS);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      visible = false;
      cancelLeave();
      globalThis.removeEventListener?.('resize', onResize);
      globalThis.removeEventListener?.('orientationchange', onResize);
      layer.destroy();
    },
  };
  root.dataset.edge = edge;
  place();
  return handle;
}
