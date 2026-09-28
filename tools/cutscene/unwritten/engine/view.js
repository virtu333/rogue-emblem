// The camera. A layer is placed on the page by an affine transform (position, scale,
// rotation, flip) and seen through a camera (pan, zoom, roll) with a parallax factor, so
// one painting can be pushed into, panned across, tumbled or thrown past the lens. The
// paint stages sample through the same transform, so a layer can move and lose its
// paint at the same time.
//
// Sampling is nearest-pixel on purpose: the result stays crisp art pixels at any zoom.
// Build a layer at about the size it is seen at (its largest scale on screen should be
// near 1) and nothing shimmers.

import { bayer } from './raster.js';
import { C, SKIN_ALPHA } from './palette.js';
import { hexToRgb } from './raster.js';

const INK = hexToRgb(C.sepia);
const GRAPHITE = hexToRgb(C.graphite);

/** A camera looking at page point (x, y), zoom z, roll rot (radians). */
export const cam = (x, y, zoom = 1, rot = 0) => ({ x, y, zoom, rot });

/** The camera as a layer at parallax `par` sees it (0: fixed to the screen, 1: the page). */
export function parallax(c, par, fw, fh) {
  if (par === 1) return c;
  return {
    x: c.x * par + (fw / 2) * (1 - par),
    y: c.y * par + (fh / 2) * (1 - par),
    zoom: 1 + (c.zoom - 1) * par,
    rot: c.rot * par,
  };
}

/**
 * Layer px -> screen px as a 2x3 matrix [a, b, c, d, e, f]: sx = a*u + b*v + c,
 * sy = d*u + e*v + f.
 *   xf: { x, y, scale = 1, rot = 0, ax = 0, ay = 0, flip = false, sx = 1, sy = 1 }
 *       the layer's anchor (ax, ay) lands on page point (x, y); sx/sy squash and stretch.
 */
export function layerMatrix(xf, c, fw, fh) {
  const s = xf.scale ?? 1;
  const fx = (xf.flip ? -1 : 1) * s * (xf.sx ?? 1);
  const fy = s * (xf.sy ?? 1);
  const lr = xf.rot || 0;
  const lc = Math.cos(lr);
  const ls = Math.sin(lr);
  // layer -> page: P = (x, y) + R_l * ((u - ax) * fx, (v - ay) * fy)
  const pa = lc * fx;
  const pb = -ls * fy;
  const pd = ls * fx;
  const pe = lc * fy;
  const pc = xf.x - pa * (xf.ax || 0) - pb * (xf.ay || 0);
  const pf = xf.y - pd * (xf.ax || 0) - pe * (xf.ay || 0);
  // page -> screen: S = Z * R_c * (P - C) + centre
  const z = c.zoom;
  const cc = Math.cos(c.rot) * z;
  const cs = Math.sin(c.rot) * z;
  const a = cc * pa - cs * pd;
  const b = cc * pb - cs * pe;
  const d = cs * pa + cc * pd;
  const e = cs * pb + cc * pe;
  const tx = pc - c.x;
  const ty = pf - c.y;
  return [a, b, cc * tx - cs * ty + fw / 2, d, e, cs * tx + cc * ty + fh / 2];
}

const invert = ([a, b, c, d, e, f]) => {
  const det = a * e - b * d;
  const ia = e / det;
  const ib = -b / det;
  const id = -d / det;
  const ie = a / det;
  return [ia, ib, -(ia * c + ib * f), id, ie, -(id * c + ie * f)];
};

const warpOut = new Float32Array(2);

/**
 * Draw a layer (compositor.Layer) at paint stage s (0 wash .. 3 paper) through transform
 * xf and camera c.
 * opts:
 *   par        parallax factor for the camera (default 1)
 *   opacity    0..1, an ordered-dither transparency (no blending: pixels are on or off)
 *   inkOnly    draw only the ink of the lines/pencil stage (a ghost of an old painting)
 *   silhouette [r, g, b]: fill the figure with one colour
 *   rim        { dir: [dx, dy] toward the light in layer px, w: px, color: [r, g, b] }
 *   warp       (u, v, out) => void, writes a displacement in layer px (wind, breath)
 *   tint       [r, g, b] multiply on the wash
 *   clip       [x0, y0, x1, y1] screen rectangle
 *   ink        [r, g, b] line colour (default sepia)
 */
export function drawSprite(frame, fw, fh, paper, layer, s, xf, c, opts = {}) {
  if (s >= 3) return;
  s = Math.max(0, s);
  const { st, mask } = layer;
  const par = opts.par ?? 1;
  const m = layerMatrix(xf, parallax(c, par, fw, fh), fw, fh);
  const [ia, ib, ic, id, ie, iff] = invert(m);
  // screen bounding box of the layer
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const pad = opts.warp ? 8 : 1;
  for (const [u, v] of [
    [0, 0],
    [st.w, 0],
    [0, st.h],
    [st.w, st.h],
  ]) {
    const X = m[0] * u + m[1] * v + m[2];
    const Y = m[3] * u + m[4] * v + m[5];
    x0 = Math.min(x0, X);
    y0 = Math.min(y0, Y);
    x1 = Math.max(x1, X);
    y1 = Math.max(y1, Y);
  }
  const cl = opts.clip || [0, 0, fw, fh];
  const X0 = Math.max(cl[0], Math.floor(x0 - pad));
  const Y0 = Math.max(cl[1], Math.floor(y0 - pad));
  const X1 = Math.min(cl[2], Math.ceil(x1 + pad));
  const Y1 = Math.min(cl[3], Math.ceil(y1 + pad));
  if (X0 >= X1 || Y0 >= Y1) return;

  const k = Math.floor(s);
  const f = s - k;
  const opacity = opts.opacity ?? 1;
  const tint = opts.tint || layer.tintRGB;
  const sil = opts.silhouette;
  const rim = opts.rim;
  const warp = opts.warp;
  const inkC = opts.ink || INK;
  const inkOnly = !!opts.inkOnly;
  // people may use the skin ramp when the frame is snapped to the palette
  const flag = layer.skin ? SKIN_ALPHA : 255;
  const W = st.w;
  const H = st.h;
  const alphaAt = (u, v) => {
    const iu = Math.floor(u);
    const iv = Math.floor(v);
    return iu >= 0 && iv >= 0 && iu < W && iv < H && st.alpha[iv * W + iu];
  };
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      let u = ia * (x + 0.5) + ib * (y + 0.5) + ic;
      let v = id * (x + 0.5) + ie * (y + 0.5) + iff;
      if (warp) {
        warp(u, v, warpOut);
        u += warpOut[0];
        v += warpOut[1];
      }
      const iu = Math.floor(u);
      const iv = Math.floor(v);
      if (iu < 0 || iv < 0 || iu >= W || iv >= H) continue;
      const j = iv * W + iu;
      if (!st.alpha[j]) continue;
      if (opacity < 1 && bayer(x + 1, y + 2) >= opacity) continue;
      const o = (y * fw + x) * 4;
      frame[o + 3] = flag;
      if (sil) {
        let col = sil;
        if (rim && !alphaAt(u + rim.dir[0] * rim.w, v + rim.dir[1] * rim.w)) col = rim.color;
        frame[o] = col[0];
        frame[o + 1] = col[1];
        frame[o + 2] = col[2];
        continue;
      }
      const thr = 0.8 * mask[j] + 0.2 * bayer(x, y);
      const stage = f > thr ? k + 1 : k;
      if (stage >= 3) continue;
      if (stage === 0 && !inkOnly) {
        if (rim && !alphaAt(u + rim.dir[0] * rim.w, v + rim.dir[1] * rim.w)) {
          frame[o] = rim.color[0];
          frame[o + 1] = rim.color[1];
          frame[o + 2] = rim.color[2];
          continue;
        }
        let r = st.wash[j * 4];
        let g = st.wash[j * 4 + 1];
        let b = st.wash[j * 4 + 2];
        if (tint) {
          r *= tint[0];
          g *= tint[1];
          b *= tint[2];
        }
        frame[o] = r;
        frame[o + 1] = g;
        frame[o + 2] = b;
        continue;
      }
      const st1 = stage === 0 ? 1 : stage;
      const cov = st1 === 1 ? st.line[j] : st.pencil[j];
      const inkOn = cov > bayer(x + 3, y + 5) * 0.9 + 0.05;
      if (inkOn) {
        const col = st1 === 1 ? inkC : GRAPHITE;
        frame[o] = col[0];
        frame[o + 1] = col[1];
        frame[o + 2] = col[2];
      } else if (inkOnly) {
        frame[o + 3] = 255;
        continue;
      } else if (st.figure) {
        const t = st1 === 1 ? st.tint : 0;
        frame[o] = paper[o] * (1 - t) + st.wash[j * 4] * t;
        frame[o + 1] = paper[o + 1] * (1 - t) + st.wash[j * 4 + 1] * t;
        frame[o + 2] = paper[o + 2] * (1 - t) + st.wash[j * 4 + 2] * t;
      } else {
        // a plate in the lines stage: the page, with a hint of the wash
        const t = st1 === 1 ? st.tint : 0;
        frame[o] = paper[o] * (1 - t) + st.wash[j * 4] * t;
        frame[o + 1] = paper[o + 1] * (1 - t) + st.wash[j * 4 + 1] * t;
        frame[o + 2] = paper[o + 2] * (1 - t) + st.wash[j * 4 + 2] * t;
      }
    }
  }
}

/**
 * Motion smear: the layer drawn again behind itself along its velocity, a few ghosts
 * thinning out, the anime smear frame in pixel form. (vx, vy): screen px per frame.
 */
export function drawSmear(frame, fw, fh, paper, layer, s, xf, c, opts, vx, vy, n = 4) {
  for (let i = n; i >= 1; i--) {
    const k = i / (n + 1);
    drawSprite(
      frame,
      fw,
      fh,
      paper,
      layer,
      Math.max(s, 1),
      { ...xf, x: xf.x - vx * i * 0.8, y: xf.y - vy * i * 0.8 },
      c,
      { ...opts, opacity: (1 - k) * 0.55, inkOnly: true, rim: null },
    );
  }
}
