// The type layer: the three hands (docs/specs/cutscenes.md → Typography).
//   ceremony — Cinzel capitals: chapter labels, the title
//   speech   — the body face with a portrait: lines from dialogue.json
//   pen      — a book italic written glyph by glyph; gold for names held, red for the Roll
// All drawn at output resolution. Every function is a pure function of t.

import { INK, SCALE, WIN, OUT_W, prog, clamp, easeOut, boilFrame, hash2 } from './engine.js';

export const FONTS = {
  pen: 'italic 500 {s}px "Cormorant Garamond", Georgia, serif',
  ceremony: '{w} {s}px Cinzel, "Times New Roman", serif',
  body: '{w} {s}px system-ui, -apple-system, "Segoe UI", sans-serif',
};
const font = (f, s, w = 500) => f.replace('{s}', s).replace('{w}', w);

// Bands in output pixels.
export const BAND = {
  top: { y0: 0, y1: WIN.y * SCALE },
  low: { y0: (WIN.y + WIN.h) * SCALE, y1: 360 * SCALE },
  win: { y0: WIN.y * SCALE, y1: (WIN.y + WIN.h) * SCALE },
};
const bandMid = (b) => (BAND[b].y0 + BAND[b].y1) / 2;

function alphaFor(t, o) {
  const inK = o.fadeIn ? prog(t, o.t0, o.t0 + o.fadeIn) : 1;
  const outK = o.t1 != null ? 1 - prog(t, o.t1, o.t1 + (o.fadeOut ?? 0.45)) : 1;
  return clamp(Math.min(inK, outK));
}
const live = (t, o) => t >= o.t0 && (o.t1 == null || t < o.t1 + (o.fadeOut ?? 0.45));

/**
 * The pen: `text` is written from t0 over `write` seconds, one glyph at a time, each
 * glyph inking in over `ink` seconds behind a small bright nib.
 * o: { t0, t1, write, text, ink?, size?, band?|y?, color?, dim?, align? }
 */
export function pen(g, t, o) {
  if (!live(t, o)) return null;
  const size = o.size ?? 32;
  g.save();
  g.font = font(FONTS.pen, size);
  g.textBaseline = 'middle';
  const text = o.text;
  const full = g.measureText(text).width;
  const y = o.y ?? bandMid(o.band ?? 'low');
  const x0 = o.x ?? (o.align === 'left' ? 120 : (OUT_W - full) / 2);
  const write = o.write ?? Math.max(0.6, text.length * 0.045);
  const inkS = o.ink ?? 0.18;
  const per = write / Math.max(1, text.length);
  const a = alphaFor(t, o);
  const color = o.color ?? INK.ember5;
  let nibX = null;
  for (let i = 0; i < text.length; i++) {
    const ti = o.t0 + i * per;
    const k = prog(t, ti, ti + inkS);
    if (k <= 0) break;
    const x = x0 + g.measureText(text.slice(0, i)).width;
    g.globalAlpha = a * k * (o.dim ?? 1);
    g.fillStyle = color;
    g.fillText(text[i], x, y);
    if (k < 1) nibX = x + g.measureText(text[i]).width;
  }
  if (nibX != null && a > 0) {
    // the nib: a warm point that shivers on the boil clock
    const j = (hash2(7, boilFrame(t)) - 0.5) * 2;
    g.globalAlpha = a * 0.85;
    g.shadowColor = INK.ember5;
    g.shadowBlur = 10;
    g.fillStyle = INK.ember6;
    g.beginPath();
    g.arc(nibX + 2, y - size * 0.05 + j, 2.2, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
  }
  g.restore();
  return { x0, x1: x0 + full, y };
}

/** A red line drawn through [x0, x1] at y from t0 over dur (a name struck from the Roll). */
export function strike(g, t, o) {
  if (t < o.t0) return;
  const k = easeOut(prog(t, o.t0, o.t0 + (o.dur ?? 0.16)));
  const a = o.t1 != null ? 1 - prog(t, o.t1, o.t1 + (o.fadeOut ?? 0.45)) : 1;
  if (a <= 0) return;
  g.save();
  g.globalAlpha = a;
  g.strokeStyle = o.color ?? INK.blood4;
  g.lineWidth = o.width ?? 3;
  g.lineCap = 'round';
  g.beginPath();
  // a pen stroke, not a ruler: a slight rise across its length
  g.moveTo(o.x0 - 6, o.y + 2);
  g.lineTo(o.x0 - 6 + (o.x1 - o.x0 + 12) * k, o.y + 2 - 4 * k);
  g.stroke();
  g.restore();
}

/** A stamp comes down on a beat: overshoot, settle, ink. */
export function stamp(g, t, o) {
  if (!live(t, o)) return false;
  const k = prog(t, o.t0, o.t0 + 0.11);
  const scale = k < 1 ? 1.35 - 0.35 * easeOut(k) : 1;
  const a = alphaFor(t, { ...o, fadeIn: 0.04 });
  g.save();
  g.globalAlpha = a;
  g.translate(OUT_W / 2, o.y ?? bandMid(o.band ?? 'low'));
  g.scale(scale, scale);
  g.font = font(FONTS.ceremony, o.size ?? 30, 700);
  g.letterSpacing = `${o.spacing ?? 6}px`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = o.color ?? INK.blood4;
  g.fillText(o.text, 0, 0);
  if (o.rules) {
    const w = g.measureText(o.text).width / 2 + 24;
    g.fillRect(-w, -(o.size ?? 30) * 0.8, w * 2, 2);
    g.fillRect(-w, (o.size ?? 30) * 0.8, w * 2, 2);
  }
  g.restore();
  return t - o.t0 < 0.07; // true while the frame should shake
}

/** A ceremony label in the top band: small spaced capitals. */
export function label(g, t, o) {
  if (!live(t, o)) return;
  g.save();
  g.globalAlpha = alphaFor(t, { fadeIn: 0.8, ...o });
  g.font = font(FONTS.ceremony, o.size ?? 21, 600);
  g.letterSpacing = '8px';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = o.color ?? INK.ink8;
  g.fillText(o.text, OUT_W / 2, o.y ?? bandMid('top'));
  g.restore();
}

/** The game's name: Cinzel, a gilt hairline and the ember diamond, as the ceremonies draw it. */
export function title(g, t, o) {
  if (!live(t, o)) return;
  const a = alphaFor(t, { fadeIn: 1.2, ...o });
  const y = o.y ?? 330;
  g.save();
  g.globalAlpha = a;
  g.font = font(FONTS.ceremony, o.size ?? 76, 700);
  g.letterSpacing = '14px';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(7,6,11,0.85)';
  g.shadowBlur = 18;
  g.fillStyle = INK.ember4;
  g.fillText(o.text, OUT_W / 2 + 7, y);
  g.shadowBlur = 0;
  const hw = 240 * easeOut(prog(t, o.t0 + 0.4, o.t0 + 1.6));
  g.fillStyle = INK.ember3;
  g.fillRect(OUT_W / 2 - hw, y + 56, hw * 2, 2);
  g.translate(OUT_W / 2, y + 57);
  g.rotate(Math.PI / 4);
  g.fillStyle = INK.ember5;
  g.fillRect(-5, -5, 10, 10);
  g.restore();
}

/** A spoken line with a PC-98 portrait (integer-scaled), in the low band. */
export function speech(g, t, o) {
  if (!live(t, o)) return;
  const a = alphaFor(t, { fadeIn: 0.35, ...o });
  const y0 = BAND.low.y0 + 10;
  g.save();
  g.globalAlpha = a;
  g.imageSmoothingEnabled = false;
  const px = 96;
  if (o.portrait) g.drawImage(o.portrait, px, y0, 80, 80);
  g.font = font(FONTS.ceremony, 18, 700);
  g.letterSpacing = '3px';
  g.fillStyle = INK.ember5;
  g.textBaseline = 'top';
  g.fillText(o.speaker.toUpperCase(), px + 100, y0 + 8);
  g.letterSpacing = '0px';
  g.font = font(FONTS.body, 22, 400);
  g.fillStyle = INK.ink10;
  // the line types on, a little faster than the pen writes
  const n = Math.floor(o.text.length * prog(t, o.t0 + 0.2, o.t0 + 0.2 + o.text.length * 0.028));
  g.fillText(o.text.slice(0, n), px + 100, y0 + 40);
  g.restore();
}
