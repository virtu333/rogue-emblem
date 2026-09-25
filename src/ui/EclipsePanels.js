// EclipsePanels — DOM pieces of the Eclipse on the route (docs/specs/eclipse.md):
// the header medallion (the Hollow Sun being eaten, phase kicker, shadow number) and
// the explainer card it opens. Presentation only: reads RunManager.getEclipseView().

import { MenuSurface, element, button } from './MenuSurface.js';
import { createEclipseSunCanvas } from '../art/eclipse/eclipseSun.js';
import { eclipseExplainer } from './eclipseContent.js';

function dpr() {
  return Math.min(3, Math.max(1, globalThis.window?.devicePixelRatio || 1));
}

/**
 * Header medallion button. Collapses to a 28px glyph + number on narrow screens (CSS).
 * @param {object} view - RunManager.getEclipseView()
 * @param {() => void} onOpen
 */
export function createEclipseMedallion(view, onOpen) {
  const b = button(null, onOpen, `re-eclipse-medal is-${view.phase.id}`);
  b.dataset.phase = view.phase.id;
  b.setAttribute(
    'aria-label',
    `The Eclipse: ${view.phase.name}, ${view.shadow} shadow. Open the Eclipse.`,
  );
  b.append(
    createEclipseSunCanvas((tag) => element(tag), {
      size: 28,
      shadow: view.shadow,
      cap: view.cap,
      phaseIndex: view.phase.index,
      dpr: dpr(),
      seed: 'medal',
    }),
  );
  const text = element('span', null, 're-eclipse-medal-text');
  text.append(
    element('span', view.phase.name.toUpperCase(), 're-eclipse-phase'),
    element('span', String(view.shadow), 're-eclipse-num'),
  );
  b.append(text);
  if (view.nextFall != null && view.nextFall <= 3) b.classList.add('is-imminent');
  return b;
}

/** The phase scale: five named bands along 0..cap with the run's shadow marked. */
function phaseScale(view, config) {
  const wrap = element('div', null, 're-eclipse-scale');
  wrap.setAttribute('aria-hidden', 'true');
  const phases = Array.isArray(config?.phases) ? config.phases : [];
  const cap = Math.max(1, view.cap);
  const track = element('div', null, 're-eclipse-track');
  const fill = element('span', null, 're-eclipse-fill');
  fill.style.width = `${Math.min(100, (view.shadow / cap) * 100)}%`;
  track.append(fill);
  for (const p of phases) {
    if (p.min <= 0 || p.min > cap) continue;
    const tick = element('span', null, 're-eclipse-tick');
    tick.style.left = `${(p.min / cap) * 100}%`;
    track.append(tick);
  }
  const names = element('div', null, 're-eclipse-names');
  for (const p of phases) {
    const n = element('span', p.name, p.id === view.phase.id ? 'is-now' : '');
    names.append(n);
  }
  wrap.append(track, names);
  return wrap;
}

/**
 * The explainer: what darkens it, what it does now, how close the next fall is.
 * @returns {{ destroy(): void }}
 */
export function openEclipseCard(scene, { view, config, kindlePrice = null, onClose = null }) {
  const info = eclipseExplainer(view, config, { kindlePrice });
  let surface = null;
  const close = () => {
    surface?.destroy();
    onClose?.();
  };
  surface = new MenuSurface(scene, 'The Eclipse', close, { modal: true });
  surface.root.classList.add('re-eclipse-card');
  const body = surface.body;
  body.classList.add('re-scroll');
  const hero = element('div', null, 're-eclipse-hero');
  hero.append(
    createEclipseSunCanvas((tag) => element(tag), {
      size: 88,
      shadow: view.shadow,
      cap: view.cap,
      phaseIndex: view.phase.index,
      dpr: dpr(),
      seed: 'card',
    }),
  );
  const reading = element('div', null, 're-eclipse-reading');
  reading.append(
    element('p', info.phase.toUpperCase(), 're-eclipse-card-phase'),
    element('p', `${info.shadow} shadow`, 're-eclipse-card-shadow'),
    element(
      'p',
      view.nextFall == null
        ? 'The land within reach is safe this act.'
        : `Next fall in ${view.nextFall} shadow`,
      `re-eclipse-card-next${view.nextFall != null && view.nextFall <= 3 ? ' is-imminent' : ''}`,
    ),
  );
  hero.append(reading);
  body.append(hero, phaseScale(view, config));
  for (const section of info.sections) {
    const block = element('section', null, 're-eclipse-section');
    block.append(element('h3', section.title));
    for (const line of section.lines) block.append(element('p', line));
    body.append(block);
  }
  surface.focusContent();
  return { destroy: () => surface?.destroy(), surface };
}
