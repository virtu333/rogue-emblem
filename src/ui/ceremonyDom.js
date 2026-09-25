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

import { snapPixelFontSize } from '../utils/pixelFontGrid.js';
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
  return typeof document?.getElementById === 'function'
    ? document.getElementById('game-wrapper')
    : null;
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

/**
 * Horizontal span a band should occupy inside a 'map' frame: the battlefield as
 * drawn (letterbox margins beside a small or overview-zoomed map excluded),
 * widened symmetrically to at least `minWidth` so the card's type still fits.
 * Pure: `map` is the map's on-screen rect (or null), `frame` the layer rect.
 * @returns {{ left:number, right:number, width:number }} insets from the frame edges
 */
export function bandSpan(frame, map, minWidth = 520) {
  const full = { left: 0, right: 0, width: frame?.width || 0 };
  if (!frame || !map || !(map.width > 0)) return full;
  const fl = frame.left;
  const fr = frame.left + frame.width;
  let l = Math.max(fl, map.left);
  let r = Math.min(fr, map.left + map.width);
  if (r <= l) return full;
  const want = Math.min(frame.width, Math.max(minWidth, 0));
  if (r - l < want) {
    const center = (l + r) / 2;
    l = Math.max(fl, center - want / 2);
    r = Math.min(fr, l + want);
    l = Math.max(fl, r - want);
  }
  return { left: Math.round(l - fl), right: Math.round(fr - r), width: Math.round(r - l) };
}

/** The battlefield's on-screen rect (CSS px) for a BattleScene, else null. */
export function measureMapRect(scene) {
  const bounds = scene?._getBattleMapBounds?.();
  const canvas = scene?.game?.canvas;
  if (!bounds || !canvas || typeof scene._worldToScreen !== 'function') return null;
  const rect = canvas.getBoundingClientRect?.();
  const sw = scene.scale?.width;
  const sh = scene.scale?.height;
  if (!rect || !sw || !sh) return null;
  try {
    const a = scene._worldToScreen(bounds.left, bounds.top);
    const b = scene._worldToScreen(bounds.left + bounds.width, bounds.top + bounds.height);
    const x1 = rect.left + (Math.min(a.x, b.x) * rect.width) / sw;
    const x2 = rect.left + (Math.max(a.x, b.x) * rect.width) / sw;
    const y1 = rect.top + (Math.min(a.y, b.y) * rect.height) / sh;
    const y2 = rect.top + (Math.max(a.y, b.y) * rect.height) / sh;
    if (!(x2 > x1) || !(y2 > y1)) return null;
    return { left: x1, top: y1, width: x2 - x1, height: y2 - y1 };
  } catch {
    return null;
  }
}

/** Type grows with large desktop canvases; phones stay at design size. */
export function frameScale(rect) {
  if (!rect) return 1;
  const s = Math.min(rect.width / 640, rect.height / 480);
  return Math.max(1, Math.min(2, Number.isFinite(s) ? s : 1));
}

/**
 * Pixel-font kickers grow with --ce-scale (calc(8px * scale)); publish the
 * nearest sizes that land on whole device pixels as --ce-pf-7 / --ce-pf-8.
 */
export function applyCeremonyPixelFonts(style, rect) {
  const dpr = globalThis.devicePixelRatio || 1;
  const scale = frameScale(rect);
  for (const size of [6, 7, 8])
    style?.setProperty?.(`--ce-pf-${size}`, `${snapPixelFontSize(size * scale, { dpr })}px`);
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
    // Cards append their content right after the layer opens.
    this._kickerFrame = globalThis.requestAnimationFrame?.(() => this.fitKickers());
  }

  /** Kickers read in full: shrink (to 6px) and then wrap, never ellipsize. */
  fitKickers() {
    if (this.destroyed) return;
    for (const node of this.root.querySelectorAll('.gr-kicker, .ce-kicker')) {
      node.style.textOverflow = 'clip';
      fitText(node, { min: 6 });
    }
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
    applyCeremonyPixelFonts(style, rect);
    style.setProperty('--ce-px', String(portraitPixelScale(rect)));
    style.setProperty('--ce-bust-px', String(bustPixelScale(rect)));
    style.setProperty('--ce-w', `${Math.round(rect.width)}px`);
    style.setProperty('--ce-h', `${Math.round(rect.height)}px`);
    // Bands sit over the battlefield itself, not the letterbox beside it.
    const span =
      this.frame === 'map' ? bandSpan(rect, measureMapRect(this.scene)) : bandSpan(rect, null);
    style.setProperty('--ce-band-l', `${span.left}px`);
    style.setProperty('--ce-band-r', `${span.right}px`);
    style.setProperty('--ce-band-w', `${span.width}px`);
    for (const fn of this._fitters || []) fn();
    this.fitKickers();
  }

  /** Re-run a text fit whenever the frame changes (rotation, resize). */
  addFitter(fn) {
    (this._fitters ||= []).push(fn);
    fn();
    this.fitKickers();
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
    if (this._kickerFrame) globalThis.cancelAnimationFrame?.(this._kickerFrame);
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
  const style = globalThis.getComputedStyle?.(node);
  const computed = parseFloat(style?.fontSize) || 16;
  // Press Start 2P shrinks along the device-pixel grid so it stays crisp.
  const pixel = /Press Start/i.test(style?.fontFamily || '');
  const dpr = globalThis.devicePixelRatio || 1;
  const smaller = (value) =>
    pixel
      ? snapPixelFontSize(value - 0.01, { dpr, mode: 'down', tolerance: 1 })
      : Math.max(min, value - 1);
  let size = max ? Math.min(max, computed) : computed;
  node.style.fontSize = `${size}px`;
  let guard = 60;
  while (node.scrollWidth > node.clientWidth + 1 && size > min && guard-- > 0) {
    const next = smaller(size);
    if (!(next < size) || next < min) break;
    size = next;
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
