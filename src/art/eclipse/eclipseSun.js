// eclipseSun.js — the Eclipse medallion: the Hollow Sun being eaten by an ink disc.
//
// Drawing language borrowed from the title key art (src/art/keyart/hollowSun.js) and
// the Loom's boss corona (src/art/loom/loomThreads.js): a gold corona with thin rays,
// crimson fractures once the dark is deep. At 0 shadow the sun is whole and warm; as
// shadow rises an ink disc slides across it; at the cap only the corona is left — the
// black Hollow Sun of the title screen. Pure Canvas2D, deterministic, no Math.random.

import { LOOM_RAMP as C, hashString, mulberry32 } from '../loom/loomThreads.js';

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/**
 * Where the ink disc sits for a coverage fraction f (0 whole sun .. 1 total).
 * Returned as an offset from the sun's centre in units of the sun radius.
 */
export function moonOffset(f) {
  const t = clamp01(f);
  // Eased so early shadow reads as a visible bite, and totality closes exactly.
  const d = 2.15 * Math.pow(1 - t, 0.85);
  return { dx: d * 0.8, dy: -d * 0.6 };
}

/**
 * Paint the medallion into `ctx` (already sized to size*dpr square).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ size:number, shadow:number, cap?:number, phaseIndex?:number, dpr?:number,
 *   seed?:string, rays?:boolean, frame?:boolean }} o
 */
export function drawEclipseSun(ctx, o) {
  const size = Math.max(8, Number(o.size) || 28);
  const dpr = Math.max(1, Number(o.dpr) || 1);
  const cap = Math.max(1, Number(o.cap) || 100);
  const f = clamp01((Number(o.shadow) || 0) / cap);
  const phase = Math.max(0, Math.trunc(Number(o.phaseIndex) || 0));
  const cx = size / 2;
  const cy = size / 2;
  const R = size * (o.rays === false ? 0.36 : 0.3);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  // Ink ground (a round medal).
  if (o.frame !== false) {
    const ground = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
    ground.addColorStop(0, C.ink3);
    ground.addColorStop(0.7, C.ink1);
    ground.addColorStop(1, C.ink0);
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Corona: brighter as the disc closes (the light that is left is the rim).
  const coronaGain = 0.55 + 0.45 * f;
  const cor = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, size / 2);
  cor.addColorStop(0, `rgba(255,240,189,${0.5 * coronaGain})`);
  cor.addColorStop(0.18, `rgba(243,203,108,${0.3 * coronaGain})`);
  cor.addColorStop(0.55, `rgba(179,112,44,${0.12 * coronaGain})`);
  cor.addColorStop(1, 'rgba(7,6,11,0)');
  ctx.fillStyle = cor;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fill();

  if (o.rays !== false) {
    const rr = mulberry32(hashString(o.seed || 'eclipse'));
    ctx.lineCap = 'round';
    const count = size >= 64 ? 36 : 18;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + rr() * 0.1;
      const r1 = R * 1.12;
      const r2 = R * (1.3 + rr() * (i % 3 ? 0.25 : 0.55));
      ctx.strokeStyle = i % 3 ? C.gold3 : C.gold4;
      ctx.globalAlpha = (i % 3 ? 0.22 : 0.4) * coronaGain;
      ctx.lineWidth = size >= 64 ? 1 : 0.8;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // The sun's face.
  const face = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
  face.addColorStop(0, C.gold6);
  face.addColorStop(0.45, C.gold5);
  face.addColorStop(0.85, C.gold4);
  face.addColorStop(1, C.gold3);
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // The ink disc eating it.
  const { dx, dy } = moonOffset(f);
  const mx = cx + dx * R;
  const my = cy + dy * R;
  const mR = R * 1.04;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R + 0.5, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = C.ink0;
  ctx.beginPath();
  ctx.arc(mx, my, mR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Lit limb where the disc meets the light (gives the bite an edge at small sizes).
  if (f > 0 && f < 1) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = C.gold2;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(0.8, size / 40);
    ctx.beginPath();
    ctx.arc(mx, my, mR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Totality: a thin gold ring where the sun was (the Hollow Sun).
  if (f >= 0.999) {
    ctx.strokeStyle = C.gold5;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = Math.max(0.8, size / 36);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Umbral and deeper: crimson fractures across the corona (the Loom's boss mark).
  if (phase >= 2) {
    const rr = mulberry32(hashString(`${o.seed || 'eclipse'}:cracks`));
    ctx.strokeStyle = C.blood4;
    ctx.globalAlpha = phase >= 4 ? 0.95 : phase >= 3 ? 0.8 : 0.6;
    ctx.lineWidth = Math.max(0.7, size / 48);
    const cracks = phase >= 3 ? [-0.9, 2.3, 4.0] : [-0.9, 2.3];
    for (const base of cracks) {
      let rad = R * 1.08;
      let ang = base;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
      for (let s = 0; s < 4; s++) {
        rad += R * (0.1 + rr() * 0.1);
        ang += (s % 2 ? 1 : -1) * (0.08 + rr() * 0.08);
        ctx.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Medal rim.
  if (o.frame !== false) {
    ctx.strokeStyle = phase >= 3 ? C.blood3 : C.gold2;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 - 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/**
 * Create a canvas holding the medallion at `size` CSS px (HiDPI aware).
 * @param {(tag: string) => HTMLElement} create - element factory (the menus' `element`,
 *   so headless menu adapters get their own stand-in)
 */
export function createEclipseSunCanvas(create, options) {
  const canvas = create('canvas');
  const size = Math.max(8, Number(options.size) || 28);
  const dpr = Math.min(3, Math.max(1, Number(options.dpr) || 1));
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  if (canvas.style) {
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
  }
  canvas.setAttribute?.('aria-hidden', 'true');
  const ctx = canvas.getContext?.('2d');
  if (ctx) drawEclipseSun(ctx, { ...options, size, dpr });
  return canvas;
}
