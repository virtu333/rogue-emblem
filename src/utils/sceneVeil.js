// sceneVeil.js — a short veil over every scene change, so screens no longer hard-cut.
//
// One DOM layer over the canvas and the DOM menus alike (most screens are DOM, so a
// camera fade would not cover them). As a transition starts the veil closes (ink, with
// the menus' gold thread drawn across it); the next scene starts underneath; when that
// scene has been created the veil opens again. A battle holds it until its painted
// terrain is in, so the board never shows its placeholder tiles first.
//
// It never takes input (pointer-events: none), never changes which scene starts, and
// adds at most CLOSE_MS to a transition. Under Reduce motion, outside a browser, or
// until enableSceneVeil() is called (main.js; tests never call it) it does nothing.

import { DOM_UI_DEPTHS } from './uiDepths.js';

export const SCENE_VEIL = Object.freeze({
  closeMs: 110,
  openMs: 260,
  maxHoldMs: 1400, // never keep a scene covered longer than this
  battleHoldMs: 900, // how long a battle may wait for its terrain
});

let enabled = false;
let el = null;
let token = 0;
let failSafe = null;

export function enableSceneVeil() {
  enabled = typeof document !== 'undefined';
}

export function sceneVeilEnabled() {
  return enabled;
}

function reducedMotion(scene) {
  try {
    const settings = scene?.registry?.get?.('settings');
    if (typeof settings?.getReduceMotion === 'function') return Boolean(settings.getReduceMotion());
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

function ensureElement() {
  if (el?.isConnected) return el;
  el = document.createElement('div');
  el.className = 're-scene-veil';
  el.setAttribute('aria-hidden', 'true');
  el.style.zIndex = String(DOM_UI_DEPTHS.VEIL);
  const thread = document.createElement('i');
  thread.className = 're-scene-veil-thread';
  const knot = document.createElement('i');
  knot.className = 're-scene-veil-knot';
  el.append(thread, knot);
  document.body.append(el);
  return el;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Close the veil. Resolves once the screen is covered (at once when the veil is off).
 * @returns {Promise<number>} a token for openSceneVeil (0 when nothing was raised)
 */
export async function closeSceneVeil(scene) {
  if (!enabled || reducedMotion(scene)) return 0;
  try {
    const veil = ensureElement();
    const mine = ++token;
    clearTimeout(failSafe);
    veil.style.setProperty('--veil-ms', `${SCENE_VEIL.closeMs}ms`);
    // Restart the thread's draw for this transition.
    veil.classList.remove('is-open');
    void veil.offsetWidth;
    veil.classList.add('is-closed');
    failSafe = setTimeout(() => openSceneVeil(mine), SCENE_VEIL.maxHoldMs);
    await wait(SCENE_VEIL.closeMs);
    return mine;
  } catch {
    return 0;
  }
}

/** Open the veil raised with `mine` (a newer transition's veil is left alone). */
export function openSceneVeil(mine) {
  if (!mine || mine !== token || !el) return;
  clearTimeout(failSafe);
  el.style.setProperty('--veil-ms', `${SCENE_VEIL.openMs}ms`);
  el.classList.remove('is-closed');
  el.classList.add('is-open');
}

/**
 * Open the veil when the scene that was started is ready to be seen: once it has been
 * created and, for a battle, once its terrain is painted (bounded).
 */
export function openSceneVeilWhenReady(mine, manager, key) {
  if (!mine) return;
  const open = () => openSceneVeil(mine);
  try {
    const target = manager?.get?.(key);
    const created = () => {
      const terrain = target?._battlefieldTerrain?.ready;
      if (terrain && typeof terrain.then === 'function') {
        Promise.race([terrain, wait(SCENE_VEIL.battleHoldMs)]).then(open, open);
      } else {
        // One frame, so the new scene's first paint is under the veil.
        (globalThis.requestAnimationFrame || setTimeout)(open);
      }
    };
    if (target?.events?.once) target.events.once('create', created);
    else open();
  } catch {
    open();
  }
}
