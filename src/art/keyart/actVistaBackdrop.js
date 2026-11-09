// actVistaBackdrop.js — mount an act's vista (actVista.js) into a host element, through the
// shared key art backdrop helper (integer scale, nearest-neighbour, the loop only while
// visible, one frozen frame under reduced motion). Decoration: every failure leaves the
// host's own background and returns null.

import { mountKeyArtBackdrop } from './keyArtBackdrop.js';
import { createActVistaScene, actVistaId } from './actVista.js';

function canMount(host) {
  return (
    typeof document !== 'undefined' &&
    typeof host?.getBoundingClientRect === 'function' &&
    typeof globalThis.requestAnimationFrame === 'function' &&
    typeof document.createElement('canvas')?.getContext === 'function'
  );
}

/**
 * @param {HTMLElement} host  a positioned box; the vista is composed for its size
 * @param {object} o
 * @param {string} o.actId    act1..act4, finalBoss, secretAct (others show the Border Marches)
 * @param {boolean|(() => boolean)} [o.reducedMotion]  defaults to the OS setting
 * @returns {{ destroy(): void, refreshMotion(): void } | null}
 */
export function mountActVista(host, { actId, reducedMotion, seed = 7, fps = 20 } = {}) {
  try {
    if (!canMount(host)) return null;
    const act = actVistaId(actId);
    host.dataset.vista = act;
    return mountKeyArtBackdrop(host, {
      fit: 'compose',
      seed,
      fps,
      reducedMotion,
      createScene: (o) => createActVistaScene({ ...o, act }),
    });
  } catch {
    return null;
  }
}
