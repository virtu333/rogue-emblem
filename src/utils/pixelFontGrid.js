// pixelFontGrid — keep Press Start 2P on whole device pixels.
//
// Press Start 2P is drawn on an 8×8 grid: at 8 CSS px one font pixel is one CSS
// pixel. It only looks crisp when each font pixel covers a whole number of
// *device* pixels, i.e. when size × devicePixelRatio × scale is a multiple of 8.
// A 9px or 10px label on a Retina Mac (DPR 2) gets 2.25 / 2.5 device pixels per
// font pixel, so some strokes are two pixels wide and some three: the "chunky"
// look players reported on macOS. The same happens under browser zoom (DPR 2.2,
// 1.8…) and when a transform scales a design box (the desktop title).
//
// This module computes the nearest crisp size for each design size and exposes
// them as CSS custom properties (--re-pf-7 … --re-pf-24) on :root. Stylesheets use
// `var(--re-pf-9, 9px)` so they still work before (or without) this script. The
// grid follows DPR changes (moving a window between displays, browser zoom).
// Pure math is exported for tests and for transform-scaled boxes.

export const PIXEL_FONT_NATIVE = 8;
export const PIXEL_FONT_SIZES = Object.freeze([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24]);

/**
 * Nearest size (CSS px, before `scale`) whose font pixels land on whole device
 * pixels. Ties go down (a label never grows into its neighbour). A snap that would
 * change the size by more than `tolerance` (e.g. 12px at DPR 1 -> 8 or 16) keeps
 * the design size instead.
 */
export function snapPixelFontSize(size, { dpr = 1, scale = 1, tolerance = 0.3, mode } = {}) {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return size;
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const step = PIXEL_FONT_NATIVE / (d * k);
  const units = n / step;
  const down = Math.max(1, Math.floor(units + 1e-6)) * step;
  const up = Math.max(1, Math.ceil(units - 1e-6)) * step;
  const candidates = mode === 'down' ? [down] : up - n < n - down - 1e-6 ? [up, down] : [down, up];
  for (const candidate of candidates) {
    if (Math.abs(candidate - n) / n <= tolerance + 1e-9) return Math.round(candidate * 1000) / 1000;
  }
  return n;
}

/** True when `size` CSS px (after `scale`) renders on whole device pixels. */
export function isCrispPixelFontSize(size, dpr = 1, scale = 1, epsilon = 0.02) {
  const fontPx = (Number(size) * scale * dpr) / PIXEL_FONT_NATIVE;
  return Number.isFinite(fontPx) && Math.abs(fontPx - Math.round(fontPx)) <= epsilon;
}

/** { '--re-pf-9': '8px', … } for a DPR (and optional scale / prefix). */
export function pixelFontVariables(dpr = 1, { scale = 1, prefix = '--re-pf-' } = {}) {
  const vars = {};
  for (const size of PIXEL_FONT_SIZES) {
    vars[`${prefix}${size}`] = `${snapPixelFontSize(size, { dpr, scale })}px`;
  }
  return vars;
}

export function applyPixelFontVariables(target, dpr, options) {
  const style = target?.style;
  if (!style?.setProperty) return;
  for (const [name, value] of Object.entries(pixelFontVariables(dpr, options))) {
    style.setProperty(name, value);
  }
}

/**
 * Install the grid on :root and keep it current. Returns an uninstall function.
 * Safe to call once at boot; a second call replaces the first.
 */
let uninstallCurrent = null;
export function installPixelFontGrid(win = globalThis.window) {
  uninstallCurrent?.();
  const doc = win?.document;
  const root = doc?.documentElement;
  if (!root) return () => {};
  let media = null;
  let lastDpr = null;
  const onChange = () => apply();
  function apply() {
    const dpr = Number(win.devicePixelRatio) || 1;
    if (dpr !== lastDpr) {
      lastDpr = dpr;
      applyPixelFontVariables(root, dpr);
      root.style.setProperty('--re-dpr', String(dpr));
      root.dataset.pixelDpr = String(dpr);
    }
    // A resolution query fires once when DPR changes (zoom, another display).
    media?.removeEventListener?.('change', onChange);
    media = win.matchMedia?.(`(resolution: ${dpr}dppx)`) || null;
    media?.addEventListener?.('change', onChange);
  }
  apply();
  win.addEventListener?.('resize', onChange);
  uninstallCurrent = () => {
    media?.removeEventListener?.('change', onChange);
    win.removeEventListener?.('resize', onChange);
    uninstallCurrent = null;
  };
  return uninstallCurrent;
}
