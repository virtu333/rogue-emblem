// keyArtBackdrop.js — the one "mount backdrop" helper for The Hollow Sun key art.
// Used by TitleScene (behind the DOM lockup and menu) and by the pre-Phaser auth
// screen in index.html (via main.js), so both show the same plate, crop and variant.
//
// Rendering: the scene paints its 424x240 plate; only the visible crop is drawn, 1:1,
// into a small canvas that CSS scales up with nearest-neighbour. The device-pixel scale
// is snapped to an integer (every plate pixel becomes an exact k x k block) whenever
// that crops no more than `maxCrop` extra; otherwise it falls back to the exact cover
// scale. Dependency-light on purpose: imports only the art module.
//
// Lifecycle: the plate is built after the first paint (building takes ~100 ms, so the
// menu is interactive first) and fades in. The loop runs at `fps`, only while visible,
// not paused and not under reduced motion (which shows one frozen frame). destroy()
// cancels everything, disconnects observers and releases canvas memory.

import { createHollowSunScene, PLATE_W, PLATE_H } from './hollowSun.js';

/**
 * Cover-crop maths for a `width` x `height` CSS px box at `dpr`.
 * @returns {{ scale:number, integer:boolean, sx:number, sy:number, cw:number, ch:number,
 *   cssW:number, cssH:number }}  `scale` is device px per plate px; `cw`x`ch` the canvas
 *   size in plate px; `cssW`x`cssH` its CSS size (>= the box).
 */
export function computeBackdropFrame({
  width,
  height,
  dpr = 1,
  maxCrop = 1.12,
  anchorX = 0.5,
  anchorY = 0.44,
  plateW = PLATE_W,
  plateH = PLATE_H,
} = {}) {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const devW = Math.max(1, Math.round(Math.max(0, width || 0) * ratio));
  const devH = Math.max(1, Math.round(Math.max(0, height || 0) * ratio));
  const cover = Math.max(devW / plateW, devH / plateH);
  const snapped = Math.max(1, Math.ceil(cover - 1e-6));
  const integer = snapped / cover <= maxCrop;
  const scale = integer ? snapped : cover;
  const cw = Math.min(plateW, Math.ceil(devW / scale - 1e-6));
  const ch = Math.min(plateH, Math.ceil(devH / scale - 1e-6));
  const clampX = (v) => Math.max(0, Math.min(plateW - cw, v));
  const clampY = (v) => Math.max(0, Math.min(plateH - ch, v));
  return {
    scale,
    integer,
    sx: clampX(Math.round((plateW - devW / scale) * anchorX)),
    sy: clampY(Math.round((plateH - devH / scale) * anchorY)),
    cw,
    ch,
    cssW: (cw * scale) / ratio,
    cssH: (ch * scale) / ratio,
  };
}

/** Plate coordinates -> CSS px inside the backdrop box, for laying UI over the art. */
export function plateToView(frame, px, py, dpr = 1) {
  const k = frame.scale / (dpr || 1);
  return { x: (px - frame.sx) * k, y: (py - frame.sy) * k };
}

function systemReducedMotion() {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Mount the key art into `host` (a positioned element that defines the box).
 * @param {HTMLElement} host
 * @param {object} [opts]
 * @param {'dusk'|'rising'|'ashfall'} [opts.variant]
 * @param {number} [opts.seed]
 * @param {boolean|(() => boolean)} [opts.reducedMotion]  defaults to the OS setting
 * @param {number} [opts.maxCrop]   extra crop allowed to keep an integer scale
 * @param {number} [opts.fps]
 * @param {(box: {width:number,height:number}) => {anchorX?:number, anchorY?:number}} [opts.anchor]
 * @param {HTMLCanvasElement} [opts.canvas]  adopt an existing canvas (auth screen)
 */
export function mountKeyArtBackdrop(host, opts = {}) {
  const canvas = opts.canvas || document.createElement('canvas');
  canvas.classList.add('re-keyart-canvas');
  canvas.setAttribute('aria-hidden', 'true');
  if (!canvas.parentNode) host.prepend(canvas);
  const fps = opts.fps ?? 30;
  const frameMs = 1000 / Math.max(1, fps);
  const reducedOpt = opts.reducedMotion;
  const reduced = () =>
    typeof reducedOpt === 'function'
      ? !!reducedOpt()
      : reducedOpt == null
        ? systemReducedMotion()
        : !!reducedOpt;

  let variant = opts.variant || 'dusk';
  let scene = null;
  let frame = null;
  let dpr = 1;
  let raf = 0;
  let buildTimer = 0;
  let buildRaf = 0;
  let paused = false;
  let destroyed = false;
  let last = -Infinity;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  let resizeObserver = null;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;

  function resize() {
    if (destroyed) return false;
    const rect = host.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (!width || !height) return false;
    dpr = globalThis.devicePixelRatio || 1;
    const anchor = opts.anchor?.({ width, height }) || {};
    frame = computeBackdropFrame({ width, height, dpr, maxCrop: opts.maxCrop ?? 1.12, ...anchor });
    if (canvas.width !== frame.cw) canvas.width = frame.cw;
    if (canvas.height !== frame.ch) canvas.height = frame.ch;
    canvas.style.width = `${frame.cssW}px`;
    canvas.style.height = `${frame.cssH}px`;
    paint(reduced() ? 0 : now());
    return true;
  }

  function paint(timeMs) {
    if (!scene || !frame || destroyed) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, -frame.sx, -frame.sy);
    scene.render(ctx, timeMs);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function hidden() {
    return typeof document !== 'undefined' && document.hidden;
  }

  function loop(time) {
    raf = 0;
    if (destroyed || paused || hidden() || reduced() || !scene) return;
    if (time - last >= frameMs - 1) {
      last = time;
      paint(now());
    }
    raf = requestAnimationFrame(loop);
  }

  function sync() {
    if (destroyed) return;
    scene?.setReducedMotion(reduced());
    const run = !paused && !hidden() && !reduced() && !!scene;
    if (run && !raf) raf = requestAnimationFrame(loop);
    if (!run) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      // Reduced motion shows the frozen frame; a pause keeps the last frame.
      if (scene && reduced()) paint(0);
    }
  }

  function build() {
    buildTimer = 0;
    buildRaf = 0;
    if (destroyed) return;
    try {
      scene?.destroy();
      scene = createHollowSunScene({ seed: opts.seed ?? 7, variant, reducedMotion: reduced() });
    } catch (err) {
      // Art is decoration: the ink host background stays and nothing else breaks.
      scene = null;
      if (typeof console !== 'undefined') console.warn('[keyart] backdrop unavailable', err);
      return;
    }
    resize();
    host.classList.add('re-keyart-ready');
    opts.onReady?.(controller);
    sync();
  }

  function scheduleBuild() {
    // Let the first frame (lockup + menu) paint before the ~100 ms plate build.
    buildRaf = requestAnimationFrame(() => {
      buildRaf = 0;
      buildTimer = setTimeout(build, 0);
    });
  }

  const onVisibility = () => sync();
  const onResize = () => resize();
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(host);
  } else globalThis.addEventListener?.('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  let mediaQuery = null;
  try {
    mediaQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    mediaQuery?.addEventListener?.('change', onVisibility);
  } catch {
    mediaQuery = null;
  }
  scheduleBuild();

  const controller = {
    canvas,
    get frame() {
      return frame;
    },
    get dpr() {
      return dpr;
    },
    get variant() {
      return variant;
    },
    get ready() {
      return !!scene;
    },
    get animating() {
      return raf !== 0;
    },
    resize,
    /** Stop the loop while covered by an opaque screen; keeps the last frame. */
    setPaused(value) {
      paused = !!value;
      sync();
    },
    /** Re-check reduced motion (e.g. after the in-game setting changes). */
    refreshMotion() {
      sync();
    },
    setVariant(next) {
      if (!next || next === variant) return;
      variant = next;
      if (scene) build();
    },
    toView(px, py) {
      return frame ? plateToView(frame, px, py, dpr) : { x: 0, y: 0 };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (buildRaf) cancelAnimationFrame(buildRaf);
      if (buildTimer) clearTimeout(buildTimer);
      raf = buildRaf = buildTimer = 0;
      resizeObserver?.disconnect();
      globalThis.removeEventListener?.('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      mediaQuery?.removeEventListener?.('change', onVisibility);
      scene?.destroy();
      scene = null;
      canvas.width = 0;
      canvas.height = 0;
      host.classList.remove('re-keyart-ready');
      if (!opts.canvas) canvas.remove();
    },
  };
  return controller;
}
