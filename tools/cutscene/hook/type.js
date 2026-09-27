// The words of "The Roll". Two faces only: Cinzel (the ceremony: capitals that are
// set, slammed, stamped) and Cormorant Garamond italic (the pen: names and speech,
// written glyph by glyph). Gold is a name someone holds, red a name the Roll holds.

import { hash2, clamp, prog, lerp, easeOut } from '../pilot/engine.js';
import { COL, boil } from './fx.js';

export { pen, stamp, strike } from '../pilot/hands.js';

const CINZEL = (w, s) => `${w} ${s}px Cinzel, "Times New Roman", serif`;
const PEN = (s) => `italic 500 ${s}px "Cormorant Garamond", Georgia, serif`;

const fadeA = (t, o, fin = 0.3, fout = 0.4) =>
  Math.min(fin ? prog(t, o.t0, o.t0 + fin) : 1, o.t1 != null ? 1 - prog(t, o.t1, o.t1 + fout) : 1);
const live = (t, o, fout = 0.4) => t >= o.t0 && (o.t1 == null || t < o.t1 + fout);

/**
 * Capitals that arrive all at once on a hit and, from `erode`, forget themselves:
 * each letter lets go in its own time, drifts up and fades.
 * o: { t0, t1, text, y, size, color, spacing, erode, erodeDur, weight }
 */
export function slam(g, t, o) {
  if (!live(t, o, 0)) return;
  const size = o.size ?? 64;
  g.save();
  g.font = CINZEL(o.weight ?? 700, size);
  g.letterSpacing = `${o.spacing ?? 10}px`;
  g.textBaseline = 'middle';
  const W = g.canvas.width;
  const text = o.text;
  const full = g.measureText(text).width;
  const x0 = (W - full) / 2;
  const settle = 1 + 0.06 * (1 - easeOut(prog(t, o.t0, o.t0 + 0.18)));
  const y = o.y ?? g.canvas.height / 2;
  g.translate(W / 2, y);
  g.scale(settle, settle);
  g.translate(-W / 2, -y);
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ') continue;
    const x = x0 + g.measureText(text.slice(0, i)).width;
    let a = 1;
    let dy = 0;
    let dx = 0;
    if (o.erode != null) {
      const s = o.erode + hash2(i, 41) * (o.erodeDur ?? 1.2);
      const k = prog(t, s, s + 0.9);
      a = 1 - k;
      dy = -k * k * 60 * (0.5 + hash2(i, 43));
      dx = (hash2(i, 44) - 0.5) * k * 30;
    }
    if (o.t1 != null) a *= 1 - prog(t, o.t1, o.t1 + 0.01);
    if (a <= 0) continue;
    g.globalAlpha = a;
    g.fillStyle = o.color ?? COL.bone;
    g.shadowColor = 'rgba(0,0,0,0.8)';
    g.shadowBlur = 12;
    g.fillText(text[i], x + dx, y + dy);
  }
  g.restore();
}

/**
 * Set capitals, revealed word by word on the given times (one per word).
 * o: { t0, t1, words: [[text, t]...], y, size, color, spacing }
 */
export function words(g, t, o) {
  if (!live(t, o)) return;
  const size = o.size ?? 44;
  g.save();
  g.font = CINZEL(o.weight ?? 600, size);
  g.letterSpacing = `${o.spacing ?? 8}px`;
  g.textBaseline = 'middle';
  const W = g.canvas.width;
  const gap = size * 0.55;
  const widths = o.words.map(([w]) => g.measureText(w).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (o.words.length - 1);
  let x = o.x ?? (W - total) / 2;
  const y = o.y ?? g.canvas.height / 2;
  const out = o.t1 != null ? 1 - prog(t, o.t1, o.t1 + 0.4) : 1;
  o.words.forEach(([w, tw], i) => {
    const k = prog(t, tw, tw + 0.12);
    if (k > 0) {
      g.globalAlpha = k * out;
      g.fillStyle = o.colors?.[i] ?? o.color ?? COL.bone;
      g.shadowColor = 'rgba(0,0,0,0.85)';
      g.shadowBlur = 14;
      g.fillText(w, x, y + (1 - easeOut(k)) * 8);
    }
    x += widths[i] + gap;
  });
  g.restore();
}

/**
 * A name annotating a figure: written in the pen with a hairline to the figure.
 * o: { t0, t1, text, x, y, to: [x, y], color, size, red: t, redDur, strike: t,
 *      unred: t, align }
 */
export function nameTag(g, t, o) {
  if (!live(t, o)) return;
  const size = o.size ?? 34;
  const a = fadeA(t, o, 0.2, 0.5);
  g.save();
  g.font = PEN(size);
  g.textBaseline = 'middle';
  const text = o.text;
  const full = g.measureText(text).width;
  const x0 = o.align === 'right' ? o.x - full : o.x;
  // the hairline
  if (o.to) {
    const k = easeOut(prog(t, o.t0, o.t0 + 0.5));
    const sx = o.align === 'right' ? x0 + full + 10 : x0 - 10;
    g.globalAlpha = a * 0.7;
    g.strokeStyle = o.lineColor ?? COL.goldDim;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(sx, o.y);
    g.lineTo(lerp(sx, o.to[0], k), lerp(o.y, o.to[1], k));
    g.stroke();
    g.fillStyle = o.lineColor ?? COL.goldDim;
    if (k >= 1) {
      g.beginPath();
      g.arc(o.to[0], o.to[1], 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  const per = (o.write ?? 0.5) / text.length;
  for (let i = 0; i < text.length; i++) {
    const k = prog(t, o.t0 + i * per, o.t0 + i * per + 0.15);
    if (k <= 0) break;
    // letters turn red one by one from `red`, and back to gold from `unred`
    let col = o.color ?? COL.gold;
    if (o.red != null) {
      const ri = o.red + (i / text.length) * (o.redDur ?? 1);
      const back = o.unred != null ? o.unred + (i / text.length) * 0.3 : Infinity;
      if (t >= ri && t < back) col = COL.red;
    }
    g.globalAlpha = a * k;
    g.fillStyle = col;
    g.shadowColor = col;
    g.shadowBlur = 8;
    g.fillText(text[i], x0 + g.measureText(text.slice(0, i)).width, o.y);
  }
  g.shadowBlur = 0;
  if (o.strike != null && t >= o.strike) {
    const k = easeOut(prog(t, o.strike, o.strike + 0.2));
    g.globalAlpha = a;
    g.strokeStyle = COL.red;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(x0 - 6, o.y + 2);
    g.lineTo(x0 - 6 + (full + 12) * k, o.y - 3 * k);
    g.stroke();
  }
  g.restore();
}

/** A line of speech: the speaker in small capitals, the words in the pen. */
export function say(g, t, o) {
  if (!live(t, o)) return;
  const a = fadeA(t, o, 0.25, 0.4);
  const W = g.canvas.width;
  const y = o.y ?? g.canvas.height - 92;
  g.save();
  // a scrim under the words, so they read over a lit face
  const sc = g.createLinearGradient(0, y - 90, 0, y + 60);
  sc.addColorStop(0, 'rgba(7,6,11,0)');
  sc.addColorStop(0.55, `rgba(7,6,11,${0.72 * a})`);
  sc.addColorStop(1, `rgba(7,6,11,${0.8 * a})`);
  g.fillStyle = sc;
  g.fillRect(0, y - 90, W, 150);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (o.speaker) {
    g.font = CINZEL(700, 19);
    g.letterSpacing = '7px';
    g.globalAlpha = a;
    g.fillStyle = o.speakerColor ?? COL.gold;
    g.fillText(o.speaker.toUpperCase(), W / 2 + 3, y - 36);
  }
  g.letterSpacing = '0px';
  g.font = PEN(o.size ?? 38);
  const n = Math.floor(
    o.text.length * prog(t, o.t0 + 0.1, o.t0 + 0.1 + o.text.length * (o.rate ?? 0.035)),
  );
  // centre on the full line so typing doesn't slide
  const full = g.measureText(o.text).width;
  g.textAlign = 'left';
  g.globalAlpha = a;
  g.fillStyle = o.color ?? COL.bone;
  g.shadowColor = 'rgba(0,0,0,0.9)';
  g.shadowBlur = 12;
  g.fillText(o.text.slice(0, n), W / 2 - full / 2, y);
  g.restore();
}

/** A hero's name: gold capitals with the thread drawn under them. */
export function hero(g, t, o) {
  if (!live(t, o, 0.25)) return;
  const a = fadeA(t, o, 0.08, 0.25);
  g.save();
  g.font = CINZEL(700, o.size ?? 54);
  g.letterSpacing = `${o.spacing ?? 16}px`;
  g.textBaseline = 'middle';
  g.textAlign = o.align ?? 'left';
  const x = o.x;
  const y = o.y;
  const w = g.measureText(o.text).width;
  const k = easeOut(prog(t, o.t0, o.t0 + 0.35));
  g.globalAlpha = a;
  g.fillStyle = o.color ?? COL.goldHi;
  g.shadowColor = o.glow ?? COL.gold;
  g.shadowBlur = 18;
  g.fillText(o.text, x + (1 - k) * 24 * (o.align === 'right' ? 1 : -1), y);
  const lx = o.align === 'right' ? x - w : x;
  g.fillStyle = o.color ?? COL.gold;
  g.fillRect(lx, y + (o.size ?? 54) * 0.62, w * k, 2);
  if (o.sub) {
    g.font = PEN(24);
    g.letterSpacing = '1px';
    g.shadowBlur = 8;
    g.globalAlpha = a * prog(t, o.t0 + 0.2, o.t0 + 0.5);
    g.fillStyle = COL.bone;
    g.fillText(o.sub, x, y + (o.size ?? 54) * 1.1);
  }
  g.restore();
}

/** Red ledger lines (enemy "names" in the Roll), struck on the beat. */
export function ledger(g, t, o) {
  if (!live(t, o)) return;
  const a = fadeA(t, o, 0.1, 0.3);
  g.save();
  g.font = PEN(o.size ?? 22);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  o.lines.forEach(([text, strikeAt], i) => {
    const y = o.y + i * (o.size ?? 22) * 1.35;
    const k = prog(t, o.t0 + i * 0.06, o.t0 + i * 0.06 + 0.2);
    g.globalAlpha = a * k * 0.9;
    g.fillStyle = COL.red;
    g.fillText(text, o.x, y);
    if (strikeAt != null && t >= strikeAt) {
      const w = g.measureText(text).width;
      const s = easeOut(prog(t, strikeAt, strikeAt + 0.12));
      g.strokeStyle = COL.redHi;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(o.x - 4, y + 1);
      g.lineTo(o.x - 4 + (w + 8) * s, y - 2 * s);
      g.stroke();
    }
  });
  g.restore();
}

/** Shaken frames: a 1-3 px offset on the boil clock while `k` > 0. */
export function shake(t, k, amp = 3) {
  if (k <= 0) return [0, 0];
  const f = boil(t, 24);
  return [(hash2(f, 1) - 0.5) * 2 * amp * k, (hash2(f, 2) - 0.5) * 2 * amp * k];
}

export { clamp };
