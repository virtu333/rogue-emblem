// ceremonyDom — DOM plumbing shared by every ceremony.
//
// Ceremonies are DOM (crisp type on retina) laid over a *frame*:
//  - 'map': the battlefield canvas. On phones that is the area left of the
//    command rail (the rail stays live); on desktop it is the letterboxed
//    640×480 canvas.
//  - 'screen': the whole game wrapper (act titles, the end of a run).
// The layer tracks its frame through resizes and rotation, exposes a
// --ce-scale that grows type on large desktop canvases, and owns nothing but
// presentation: no game state, no RNG, no saves.

import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import { DOM_INPUT_EVENTS, hasDOMHost } from '../utils/domUI.js';
import { pushInputScope, popInputScope, hasInputFocus } from '../utils/inputFocus.js';
import { pushOverlay, removeOverlay } from '../utils/overlayStack.js';
import { InputAction } from '../utils/InputActions.js';
import { ignoreRepeatedActivation } from '../utils/domInputBoundary.js';
import { rebuiltPortraitKey } from './RebuiltPortraits.js';
import portraitManifest from './RebuiltPortraitManifest.json';
import { textureImageSource } from './textureImageSource.js';
import { portraitFraming } from './ceremonyContent.js';
import {
  PC98_MASTER,
  pc98FigureUrl,
  portraitFaction,
  portraitIdForUnit,
  usePc98,
} from './portraitArt.js';
import { DISPLAY_FONT_PROBE } from '../utils/loadGameFont.js';

export function el(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function ceremonyHost() {
  return typeof document === 'undefined' ? null : document.getElementById('game-wrapper');
}

/** A live DOM host exists (headless harnesses may report a host without a document). */
export function canRenderCeremony() {
  return typeof document !== 'undefined' && hasDOMHost() && Boolean(ceremonyHost()?.append);
}

function rectOf(node) {
  const r = node?.getBoundingClientRect?.();
  if (!r || !(r.width > 0) || !(r.height > 0)) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function intersect(a, b) {
  if (!a) return b;
  if (!b) return a;
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (right <= left || bottom <= top) return a;
  return { left, top, width: right - left, height: bottom - top };
}

/** Viewport rect a ceremony may cover. */
export function measureFrame(scene, frame = 'map') {
  const host = ceremonyHost();
  const viewport = {
    left: 0,
    top: 0,
    width: globalThis.innerWidth || 640,
    height: globalThis.innerHeight || 480,
  };
  if (frame === 'screen') return rectOf(host) || viewport;
  const canvas = scene?.game?.canvas || host?.querySelector?.('canvas');
  const container = document.getElementById('game-container');
  return intersect(rectOf(container), rectOf(canvas)) || rectOf(host) || viewport;
}

/** Type grows with large desktop canvases; phones stay at design size. */
export function frameScale(rect) {
  if (!rect) return 1;
  const s = Math.min(rect.width / 640, rect.height / 480);
  return Math.max(1, Math.min(2, Number.isFinite(s) ? s : 1));
}

/**
 * Integer pixel scale for PC-98 portraits (dither must not be resampled):
 * the scale nearest the fluid --ce-scale.
 */
export function portraitPixelScale(rect) {
  return Math.max(1, Math.round(frameScale(rect)));
}

/**
 * Integer scale for the 192px boss bust: nearest the 190px design size at
 * --ce-scale, but never wider than the 36% of the frame the card allows.
 */
export function bustPixelScale(rect, master = 192) {
  const scale = frameScale(rect);
  let k = Math.max(1, Math.round((190 * scale) / master));
  const width = rect?.width || 0;
  // A few px over the 36% cap is fine: CSS min() clamps it to a near-integer scale.
  while (k > 1 && master * k > width * 0.36 * 1.04) k--;
  return k;
}

/**
 * A positioned element that follows its frame. `blocking` layers take
 * pointer input (tap to skip); others let every touch through to the map.
 */
export class CeremonyLayer {
  constructor(scene, { frame = 'map', className = '', blocking = false, depth, label = '' } = {}) {
    this.scene = scene;
    this.frame = frame;
    this.root = el('div', `ce-layer ${className}`.trim());
    this.root.dataset.frame = frame;
    if (blocking) this.root.classList.add('is-blocking');
    this.root.style.zIndex = String(depth ?? DOM_UI_DEPTHS.CEREMONY);
    if (label) this.root.setAttribute('aria-label', label);
    this.root.setAttribute('role', 'status');
    this._onResize = () => this.applyFrame();
    globalThis.addEventListener?.('resize', this._onResize);
    globalThis.addEventListener?.('orientationchange', this._onResize);
    const Observer = globalThis.ResizeObserver;
    if (Observer) {
      this._observer = new Observer(() => this.applyFrame());
      const canvas = scene?.game?.canvas;
      const container = document.getElementById('game-container');
      for (const node of [canvas, container, ceremonyHost()])
        if (node) this._observer.observe(node);
    }
    ceremonyHost()?.append(this.root);
    this.applyFrame();
  }

  applyFrame() {
    if (this.destroyed) return;
    const rect = measureFrame(this.scene, this.frame);
    const style = this.root.style;
    style.left = `${Math.round(rect.left)}px`;
    style.top = `${Math.round(rect.top)}px`;
    style.width = `${Math.round(rect.width)}px`;
    style.height = `${Math.round(rect.height)}px`;
    style.setProperty('--ce-scale', String(frameScale(rect)));
    style.setProperty('--ce-px', String(portraitPixelScale(rect)));
    style.setProperty('--ce-bust-px', String(bustPixelScale(rect)));
    style.setProperty('--ce-w', `${Math.round(rect.width)}px`);
    style.setProperty('--ce-h', `${Math.round(rect.height)}px`);
    for (const fn of this._fitters || []) fn();
  }

  /** Re-run a text fit whenever the frame changes (rotation, resize). */
  addFitter(fn) {
    (this._fitters ||= []).push(fn);
    fn();
    // The display face may still be arriving on a cold start; refit once it lands.
    try {
      globalThis.document?.fonts
        ?.load?.(DISPLAY_FONT_PROBE)
        ?.then?.(() => !this.destroyed && fn())
        ?.catch?.(() => {});
    } catch {
      /* optional */
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    globalThis.removeEventListener?.('resize', this._onResize);
    globalThis.removeEventListener?.('orientationchange', this._onResize);
    this._observer?.disconnect();
    this._observer = null;
    this._fitters = null;
    this.root.remove();
  }
}

/**
 * Shrink a single-line element's font until it fits its box; below `min`
 * it may wrap. Measures the laid-out DOM, so call after it is attached.
 */
export function fitText(node, { max = null, min = 12 } = {}) {
  if (!node?.isConnected) return;
  node.style.fontSize = '';
  node.style.whiteSpace = 'nowrap';
  const computed = parseFloat(globalThis.getComputedStyle?.(node)?.fontSize) || 16;
  let size = max ? Math.min(max, computed) : computed;
  node.style.fontSize = `${size}px`;
  let guard = 60;
  while (node.scrollWidth > node.clientWidth + 1 && size > min && guard-- > 0) {
    size = Math.max(min, size - 1);
    node.style.fontSize = `${size}px`;
  }
  if (node.scrollWidth > node.clientWidth + 1) node.style.whiteSpace = 'normal';
}

/**
 * Tap / Enter / Space / Esc / gamepad confirm or back skips a blocking
 * ceremony. The ceremony owns the overlay and input-focus stacks while it
 * shows, so the rail's Back and the pad's B route here and nothing reaches
 * the scene underneath. Returns an unbind function (idempotent).
 */
export function bindCeremonySkip(scene, root, onSkip, { name = 'Ceremony', guardMs = 180 } = {}) {
  const owner = { ceremony: name };
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const openedAt = now();
  let bound = true;
  const trigger = () => {
    if (!bound || now() - openedAt < guardMs) return;
    onSkip();
  };
  const stop = (event) => event.stopPropagation();
  const press = (event) => {
    event.stopPropagation();
    if (event.button !== undefined && event.button !== 0) return;
    trigger();
  };
  for (const type of DOM_INPUT_EVENTS) root.addEventListener(type, stop);
  root.addEventListener('pointerdown', press);
  const onKey = (event) => {
    if (!hasInputFocus(owner)) return;
    if (ignoreRepeatedActivation(event)) return;
    if (!['Enter', ' ', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    trigger();
  };
  globalThis.addEventListener?.('keydown', onKey, true);
  pushInputScope(owner, (action) => {
    if ([InputAction.CONFIRM, InputAction.CANCEL, InputAction.PAUSE].includes(action)) trigger();
  });
  const token = pushOverlay(scene, {
    name,
    onCancel: () => {
      trigger();
      return true;
    },
  });
  return () => {
    if (!bound) return;
    bound = false;
    for (const type of DOM_INPUT_EVENTS) root.removeEventListener(type, stop);
    root.removeEventListener('pointerdown', press);
    globalThis.removeEventListener?.('keydown', onKey, true);
    popInputScope(owner);
    removeOverlay(scene, token);
  };
}

/**
 * Timers on the scene clock (it stops with the game loop, so nothing runs
 * while the page is hidden); every pending wait resolves on cancel so an
 * awaiting flow can never hang past scene shutdown.
 */
export class CeremonyClock {
  constructor(scene) {
    this.scene = scene;
    this._pending = new Set();
  }

  wait(ms) {
    return new Promise((resolve) => {
      const entry = { resolve, handle: null, timeout: null };
      const finish = (value) => {
        if (!this._pending.has(entry)) return;
        this._pending.delete(entry);
        entry.handle?.remove?.(false);
        if (entry.timeout) clearTimeout(entry.timeout);
        resolve(value);
      };
      entry.finish = finish;
      this._pending.add(entry);
      const delay = Math.max(0, Number(ms) || 0);
      const time = this.scene?.time;
      if (delay > 0 && typeof time?.delayedCall === 'function' && this.scene.sys?.isActive?.()) {
        entry.handle = time.delayedCall(delay, () => finish('elapsed'));
      } else {
        entry.timeout = setTimeout(() => finish('elapsed'), delay);
      }
    });
  }

  cancelAll() {
    for (const entry of [...this._pending]) entry.finish('cancelled');
  }
}

// ── Pieces ───────────────────────────────────────────────────────────────

export function hairline(tone = 'gold') {
  return el('div', `ce-hairline ce-hairline--${tone}`);
}

export function skipHint() {
  const hint = el('div', 'ce-skip', 'Tap to continue');
  hint.setAttribute('aria-hidden', 'true');
  return hint;
}

/**
 * The approved portrait for a unit as a URL the DOM can load directly.
 * PC-98 art (default): the 192px transparent figure for the unit's portrait
 * id (rebuilt source preferred), with its eye-line framing and plate
 * faction. Classic art: rebuilt art from its asset path, else the legacy
 * 128px texture. `id` keys the eye-line framing.
 */
export function ceremonyPortrait(scene, unit) {
  if (!scene || !unit) return null;
  try {
    if (usePc98()) {
      const id = portraitIdForUnit(unit, scene.gameData || {});
      if (!id) return null;
      return {
        id,
        src: pc98FigureUrl(id, PC98_MASTER),
        framing: portraitFraming(id),
        rebuilt: true,
        pc98: true,
        faction: portraitFaction(unit, id),
      };
    }
    const key = rebuiltPortraitKey(scene, unit);
    const id = key?.replace(/^rebuilt-portrait-/, '');
    const file = id && portraitManifest[id]?.file;
    if (file) {
      const base = import.meta.env?.BASE_URL ?? '/';
      return {
        id,
        src: `${base}assets/portraits/rebuilt/${file}`,
        framing: portraitFraming(id),
        rebuilt: true,
      };
    }
    const legacy = scene._getPortraitKey?.(unit);
    if (legacy && scene.textures?.exists?.(legacy)) {
      const src = textureImageSource(scene.textures.get(legacy));
      if (src) return { id: null, src, framing: portraitFraming(null), rebuilt: false };
    }
  } catch {
    /* portraits are decoration */
  }
  return null;
}

// Decode rebuilt portraits ahead of their first cut-in so the strip never
// flashes empty mid-combat. Kept per page; the browser owns the memory.
const warmed = new Map();
export function warmPortrait(src) {
  if (!src || warmed.has(src) || typeof Image === 'undefined') return;
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  warmed.set(src, image);
  image.decode?.().catch(() => warmed.delete(src));
  if (warmed.size > 16) warmed.delete(warmed.keys().next().value);
}
