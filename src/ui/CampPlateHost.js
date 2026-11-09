// CampPlateHost.js — the Home Base camp plate's DOM host (art: art/keyart/campPlate.js).
// One persistent, inert box the lords list re-appends on every render; the plate is painted
// once and kept. Decoration: any failure leaves an empty box.

import { mountKeyArtBackdrop } from '../art/keyart/keyArtBackdrop.js';
import { createCampScene } from '../art/keyart/campPlate.js';

/** Below this height (CSS px) the camp cannot be read, so the box stays empty. */
export const CAMP_MIN_HEIGHT = 56;

function systemReducedMotion() {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export class CampPlateHost {
  /** @param {() => ({ getReduceMotion?: () => boolean } | null | undefined)} getSettings */
  constructor(getSettings = () => null) {
    this.getSettings = getSettings;
    this.el = null;
    this.backdrop = null;
    this.mounted = false;
    this.observer = null;
  }

  /** The box to append; mounts the plate the first time. */
  element() {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'mh-camp';
      this.el.setAttribute('aria-hidden', 'true');
      if (typeof ResizeObserver === 'function') {
        this.observer = new ResizeObserver(() => this._fit());
        this.observer.observe(this.el);
      }
    }
    if (!this.mounted) {
      this.mounted = true;
      try {
        const reduced = !!this.getSettings()?.getReduceMotion?.() || systemReducedMotion();
        if (typeof globalThis.requestAnimationFrame === 'function')
          this.backdrop = mountKeyArtBackdrop(this.el, {
            fit: 'compose',
            // The act vistas' pixel size on a phone held upright.
            target: 137,
            maxSide: 300,
            fps: 18,
            reducedMotion: reduced,
            createScene: (o) => createCampScene(o),
          });
      } catch {
        this.backdrop = null;
      }
    }
    return this.el;
  }

  _fit() {
    if (!this.el) return;
    const h = this.el.getBoundingClientRect().height;
    this.el.classList.toggle('mh-camp-small', h > 0 && h < CAMP_MIN_HEIGHT);
  }

  _unmount() {
    try {
      this.backdrop?.destroy?.();
    } catch {
      /* decoration */
    }
    this.backdrop = null;
    this.mounted = false;
    this.el?.replaceChildren();
    this.el?.classList.remove('re-keyart-ready');
  }

  destroy() {
    this._unmount();
    this.observer?.disconnect();
    this.observer = null;
    this.el?.remove();
    this.el = null;
  }
}
