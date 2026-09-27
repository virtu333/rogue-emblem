// "The Far Side of the Glass": the player.
//
// Everything is drawn into one 480x270 buffer of art pixels and scaled up by a whole
// number with no smoothing, so the film is pixel art from edge to edge: the traced
// clips (pixel.py sheets, palette-indexed), the thread and the Hollow Sun (plotted
// pixel by pixel), and the words (Press Start 2P at its native 8 px for the narrator,
// Cinzel snapped to the grid for titles). Transitions are ordered-dither dissolves,
// never alpha blends. A frame is a pure function of t, on the score's clock.

import { EDIT, clipTime } from './edit.mjs';

export const W = 480;
export const H = 270;
const BAR = 33; // letterbox: 2.35:1 inside 16:9

const BAYER8 = [
  0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31, 8, 56, 4, 52, 11, 59, 7, 55, 40, 24,
  36, 20, 43, 27, 39, 23, 2, 50, 14, 62, 1, 49, 13, 61, 34, 18, 46, 30, 33, 17, 45, 29, 10, 58, 6,
  54, 9, 57, 5, 53, 42, 26, 38, 22, 41, 25, 37, 21,
];
const bayer = (x, y) => (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const prog = (t, a, b) => clamp((t - a) / (b - a));

// the art bible's ramps (docs/art-direction/ART_BIBLE.md), as needed here
const C = {
  ink: '#07060b',
  bone: '#ddd0bd',
  paper: '#f4ecdb',
  emberDark: '#4f2c16',
  ember: '#b3702c',
  gold: '#dca044',
  goldHi: '#f3cb6c',
  goldWhite: '#fff0bd',
  crimson: '#cc4038',
  blood: '#6e1a28',
};
const rgb32 = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return (0xff << 24) | ((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff);
};
const INK32 = rgb32(C.ink);
const scale32 = (c, k) => {
  const r = Math.round((c & 0xff) * k);
  const g = Math.round(((c >> 8) & 0xff) * k);
  const b = Math.round(((c >> 16) & 0xff) * k);
  return (0xff << 24) | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r);
};

/** A colour pulled toward the unlight ramp by k (0..1), matched by brightness. */
function drain32(c, k) {
  const r = c & 0xff;
  const g = (c >> 8) & 0xff;
  const b = (c >> 16) & 0xff;
  const l = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
  const u = UNLIGHT[Math.min(5, Math.floor(l * 6))];
  const mix = (x, y) => Math.round(x + (y - x) * k);
  return (
    (0xff << 24) |
    (mix(b, (u >> 16) & 0xff) << 16) |
    (mix(g, (u >> 8) & 0xff) << 8) |
    mix(r, u & 0xff)
  );
}

// How each shot comes in (IN: dither dissolve from the shot before, seconds; FADE_IN:
// up from black) and goes out (FADE_OUT: down to black). Hard cuts are the default and
// are kept for hits: the quake, "one list", midnight, the drill, the officers, deaths.
const IN = {
  weave: 1.2,
  dragons: 1.0,
  first_names: 0.8,
  kneel: 0.8,
  starfall: 0.8,
  dragons_lie: 1.0,
  hollow: 1.2,
  oath: 1.0,
  hearth: 0.8,
  crown: 0.6,
  ledger: 0.5,
  read: 0.4,
  counting: 1.0,
  glass: 1.0,
  camp: 0.8,
  reveal: 1.2,
};
const FADE_IN = { oath: 1.2, stair: 1.6, unsworn: 0.4, king: 1.2, wendhall: 0.8, sink: 1.0 };
const FADE_OUT = {
  hollow: 1.6,
  oath: 1.4,
  hearth: 0.5,
  read: 0.3,
  o_emperor: 0.6,
  camp: 1.2,
  reveal: 0.35,
};
// the unlight ramp: colour drains toward it where the Sleeper stirs
const UNLIGHT = ['#170c24', '#2c1645', '#4a2270', '#763aa0', '#a863cc', '#dcaaf0'].map(rgb32);

// ------------------------------------------------------------------ loading

async function loadSheet(base, shot) {
  const meta = await (await fetch(`${base}/px/${shot}.json`)).json();
  const img = new Image();
  img.src = `${base}/px/${shot}.webp`;
  try {
    await img.decode();
  } catch (err) {
    throw new Error(`${img.src}: ${err.message}`, { cause: err });
  }
  const c = new OffscreenCanvas(img.width, img.height);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const rgba = x.getImageData(0, 0, img.width, img.height).data;
  const idx = new Uint8Array(img.width * img.height);
  for (let i = 0; i < idx.length; i++) idx[i] = rgba[i * 4];
  return {
    ...meta,
    sheetW: img.width,
    idx,
    lut: Uint32Array.from(meta.palette.map((h) => rgb32(h))),
  };
}

// ------------------------------------------------------------------ pixel ops

/** Copy drawing i of a sheet into dst (Uint32 W*H), through its palette. */
function blit(dst, s, i, o = {}) {
  const n = clamp(Math.floor(i), 0, s.n - 1);
  const col = n % s.cols;
  const row = Math.floor(n / s.cols);
  const lut = o.lut || s.lut;
  const dx = Math.round(o.dx || 0);
  const dy = Math.round(o.dy || 0);
  const y0 = o.y0 ?? 0;
  const y1 = o.y1 ?? H;
  if (o.map) {
    for (let y = y0; y < y1; y++)
      for (let x = 0; x < W; x++) {
        const [sx, sy] = o.map(x, y);
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
        if (o.mask && !o.mask(x, y)) continue;
        dst[y * W + x] = lut[s.idx[(row * H + sy) * s.sheetW + col * W + sx]];
      }
    return;
  }
  for (let y = y0; y < y1; y++) {
    let sy = y - dy;
    if (o.flipY) sy = o.flipY - sy;
    if (o.half) sy = sy * 2;
    if (sy < 0 || sy >= H) continue;
    const srow = (row * H + sy) * s.sheetW + col * W;
    const ripple = o.ripple ? o.ripple(y) : 0;
    for (let x = 0; x < W; x++) {
      let sx = x - dx + ripple;
      if (o.half) sx = (sx - (o.hx || 0)) * 2;
      if (sx < 0 || sx >= W) continue;
      if (o.mask && !o.mask(x, y)) continue;
      dst[y * W + x] = lut[s.idx[srow + sx]];
    }
  }
}

/** Ordered-dither dissolve: where the Bayer threshold is under k, take b. */
function dissolve(a, b, k) {
  if (k <= 0) return;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (bayer(x, y) < k) a[y * W + x] = b[y * W + x];
}

/** Fade toward ink by dithering: k = 1 is black. */
function toInk(a, k, y0 = 0, y1 = H) {
  if (k <= 0) return;
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < W; x++) if (bayer(x, y) < k) a[y * W + x] = INK32;
}

function flash(a, k, color = C.paper) {
  const c = rgb32(color);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (bayer(x, y) < k) a[y * W + x] = c;
}

function px(a, x, y, c) {
  x = Math.round(x);
  y = Math.round(y);
  if (x >= 0 && x < W && y >= 0 && y < H) a[y * W + x] = c;
}

/** A glowing 1-pixel line through points: the core, and a dithered halo. */
function glowLine(a, pts, core, halo, haloK = 0.5) {
  const c = rgb32(core);
  const h = rgb32(halo);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const y = y0 + ((y1 - y0) * k) / n;
      for (const [ox, oy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ])
        if (bayer(Math.round(x + ox), Math.round(y + oy)) < haloK) px(a, x + ox, y + oy, h);
    }
  }
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 0; k <= n; k++) px(a, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, c);
  }
}

// ------------------------------------------------------------------ words

const textCanvas = new OffscreenCanvas(W, H);
const tx = textCanvas.getContext('2d', { willReadFrequently: true });

/**
 * Draw text snapped to the art grid: rendered, then thresholded, so every pixel is
 * either the colour or nothing. `shadow` adds a one-pixel ink drop to the lower right.
 */
function pixelText(a, lines, o) {
  tx.clearRect(0, 0, W, H);
  tx.font = o.font;
  tx.letterSpacing = o.spacing || '0px';
  tx.textBaseline = 'top';
  tx.fillStyle = '#fff';
  const lh = o.lineHeight;
  let minX = W;
  let maxX = 0;
  lines.forEach((line, i) => {
    const w = tx.measureText(line).width;
    const x = o.align === 'left' ? o.x : Math.round(o.x - w / 2);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + w);
    tx.fillText(line, x, o.y + i * lh);
  });
  const y0 = Math.max(0, o.y - 4);
  const y1 = Math.min(H, o.y + lines.length * lh + 8);
  const x0 = Math.max(0, Math.floor(minX) - 4);
  const x1 = Math.min(W, Math.ceil(maxX) + 4);
  if (x1 <= x0) return;
  const d = tx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const ww = x1 - x0;
  const on = (x, y) => d[((y - y0) * ww + (x - x0)) * 4 + 3] > (o.threshold ?? 110);
  // fades step through the colour toward ink (as a palette fade would), never dither:
  // dithered letters at 8 px stop being letters
  const k = o.alpha ?? 1;
  if (k <= 0) return;
  const step = Math.ceil(k * 4) / 4;
  const base = typeof o.color === 'function' ? o.color : () => rgb32(o.color);
  const col = step >= 1 ? base : (x, y) => scale32(base(x, y), step);
  if (o.outline)
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        if (!on(x, y)) continue;
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const X = x + ox;
            const Y = y + oy;
            if (X >= x0 && X < x1 && Y >= y0 && Y < y1 && !on(X, Y)) a[Y * W + X] = INK32;
          }
      }
  else if (o.shadow)
    for (let y = y0; y < y1 - 1; y++)
      for (let x = x0; x < x1 - 1; x++) if (on(x, y)) a[(y + 1) * W + x + 1] = INK32;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) if (on(x, y)) a[y * W + x] = col(x, y);
}

function wrap(text, max) {
  const words = text.split(' ');
  const out = [''];
  for (const w of words) {
    const cur = out[out.length - 1];
    if ((cur + ' ' + w).trim().length > max) out.push(w);
    else out[out.length - 1] = (cur + ' ' + w).trim();
  }
  return out;
}

// ------------------------------------------------------------------ the film

export async function loadGlass(base = '.') {
  const cues = await (await fetch(`${base}/cues.json`)).json();
  const { LINES } = await import('./script.mjs');
  const text = Object.fromEntries(LINES.map((l) => [l.id, l.text]));
  const names = [...new Set(EDIT.flatMap((e) => [e.shot, e.top]).filter(Boolean))];
  // one at a time: each decoded sheet is ~50 MB of RGBA until its indices are taken
  const sheets = {};
  for (const n of names) sheets[n] = await loadSheet(base, n);
  const duration = cues.end;
  const buf = new Uint32Array(W * H);
  const tmp = new Uint32Array(W * H);
  const art = new OffscreenCanvas(W, H);
  const ax = art.getContext('2d');
  const img = new ImageData(new Uint8ClampedArray(buf.buffer), W, H);

  // the rewound shots, as one span: the thread closes once across all of them
  const mends = EDIT.filter((e) => e.mend);
  const MEND = [mends[0].t0, mends[mends.length - 1].t1];

  const entryAt = (t) => EDIT.findIndex((e) => t >= e.t0 && t < e.t1);

  /** Draw edit entry e at film time t into a (Uint32 buffer). */
  function shot(a, e, t) {
    a.fill(INK32);
    if (e.kind === 'void') return drawVoid(a, t);
    if (e.kind === 'thread') return drawThread(a, t, e);
    if (e.kind === 'title') return drawTitle(a, t, e);
    if (e.kind === 'mirror') return drawMirror(a, t, e);
    const s = sheets[e.shot];
    const ct = clipTime(e, t);
    const i = (ct - s.from) * s.fps;
    const k = prog(t, e.t0, e.t1);
    // drain: the palette slides toward unlight violet (in steps, as a palette fade
    // would) and the frame shudders by a pixel as the thing below turns
    const dk = e.drain ? prog(t, e.t1 - e.drain, e.t1 - 0.2) : 0;
    const lut = dk > 0 ? s.lut.map((c) => drain32(c, (Math.round(dk * 5) / 5) * 0.7)) : s.lut;
    const shake = dk > 0.3 ? Math.round(Math.sin(t * 57) * dk * 1.5) : 0;
    blit(a, s, i, {
      lut,
      dx: (e.pan?.[0] || 0) * k + shake,
      dy: (e.pan?.[1] || 0) * k + (dk > 0.6 ? Math.round(Math.cos(t * 43) * dk) : 0),
    });
    if (e.death) drawSnap(a, t - e.t0);
    // running back: the snapped thread closes up again as the shot rewinds
    if (e.mend) drawSnap(a, 0.55 * (1 - prog(t, MEND[0], MEND[1])), false);
  }

  // black; a point of gold; the thread draws itself on the Thread cell's contour
  function drawVoid(a, t) {
    const cx = 240;
    const cy = 135;
    const p = prog(t, 1.2, 3.2);
    if (p > 0 && t < 5.5) {
      const r = p < 1 ? 0 : 1;
      const c = rgb32(t % 0.5 < 0.25 ? C.goldHi : C.goldWhite);
      px(a, cx, cy, c);
      if (r)
        for (const [ox, oy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          px(a, cx + ox, cy + oy, rgb32(C.ember));
    }
    // the thread: A-D-E-A, a rise of a fourth, a step, a fourth, hold (x: time, y: pitch)
    const k = prog(t, 5.2, 9.6);
    if (k > 0) {
      const contour = [
        [60, 150],
        [170, 150],
        [210, 128],
        [260, 128],
        [290, 120],
        [330, 120],
        [360, 98],
        [430, 98],
      ];
      const pts = [];
      const total = 600;
      const n = Math.floor(total * k);
      for (let i = 0; i <= n; i++) {
        const u = i / total;
        const x = 60 + u * 370;
        let y = 150;
        for (let j = 1; j < contour.length; j++)
          if (x <= contour[j][0]) {
            const [x0, y0] = contour[j - 1];
            const [x1, y1] = contour[j];
            const f = (x - x0) / (x1 - x0);
            y = y0 + (y1 - y0) * (0.5 - 0.5 * Math.cos(Math.PI * f));
            break;
          }
        pts.push([x, y + Math.sin(u * 40 + t * 3) * 0.6]);
      }
      glowLine(a, pts, C.goldHi, C.ember, 0.45);
      if (pts.length) {
        const [hx, hy] = pts[pts.length - 1];
        px(a, hx, hy, rgb32(C.goldWhite));
      }
    }
  }

  // a single gold thread across the dark, trembling
  function drawThread(a, t, e) {
    const pts = [];
    const shake = 0.4 + 1.6 * prog(t, e.t0, e.t1);
    for (let x = 20; x <= 460; x += 2)
      pts.push([x, 135 + Math.sin(x * 0.09 + t * 11) * shake * Math.sin((x / 480) * Math.PI)]);
    glowLine(a, pts, C.goldHi, C.ember, 0.4);
  }

  // on each death: a white flash, and the thread snapping apart
  function drawSnap(a, dt, withFlash = true) {
    if (withFlash && dt < 0.09) flash(a, 1 - dt / 0.09);
    const k = prog(dt, 0, 0.5);
    if (k >= 1) return;
    const gap = 6 + 120 * k;
    const sag = 60 * k * k;
    const L = [];
    const R = [];
    for (let i = 0; i <= 30; i++) {
      const u = i / 30;
      L.push([20 + u * (220 - gap - 20), 135 + sag * u * u]);
      R.push([260 + gap + u * (460 - 260 - gap), 135 + sag * (1 - u) * (1 - u)]);
    }
    const fade = 1 - k;
    glowLine(a, L, fade > 0.5 ? C.goldHi : C.ember, C.emberDark, 0.4 * fade);
    glowLine(a, R, fade > 0.5 ? C.goldHi : C.ember, C.emberDark, 0.4 * fade);
  }

  // Sera over the Glass; in the water, not her reflection but him, upside down
  function drawMirror(a, t, e) {
    const top = sheets[e.top];
    blit(a, top, (e.topAt - top.from) * top.fps);
    const s = sheets[e.shot];
    const i = (clipTime(e, t) - s.from) * s.fps;
    const water = 146;
    const lut = s.lut.map((c) => scale32(c, 0.62));
    const emerge = prog(t, e.t0 + 0.2, e.t0 + 2.2);
    // half size, upside down: his shoulders at the surface, his face deeper, under hers
    blit(a, s, i, {
      lut,
      y0: water + 1,
      y1: H,
      map: (x, y) => {
        const u = y - water;
        const ripple = Math.round(Math.sin(y * 0.5 + t * 4) * 0.7);
        return [(x - 30 + ripple) * 2, 250 - u * 2];
      },
      // an ellipse of dark water under her gaze, its edge dithered away
      mask: (x, y) => {
        const e = ((x - 150) / 100) ** 2 + ((y - 196) / 48) ** 2;
        return bayer(x, y) < emerge * clamp((1 - e) * 2.5) * clamp((y - water) / 8);
      },
    });
    // the surface: a broken gold line
    const surf = rgb32(C.ember);
    for (let x = 40; x < 300; x++)
      if (Math.sin(x * 0.3 + t * 2) > 0.2 && bayer(x, water) < 0.6) px(a, x, water, surf);
  }

  // the Hollow Sun, drawn on the Thread cell; the name
  function drawTitle(a, t, e) {
    const dt = t - e.t0;
    const cx = 240;
    const cy = 112;
    const r = 30;
    const draw = prog(dt, 0.3, 2.3);
    const out = 1 - prog(t, e.t1 - 2.5, e.t1 - 0.3);
    // corona glow: dithered bands
    for (let y = cy - r - 16; y <= cy + r + 16; y++)
      for (let x = cx - r - 16; x <= cx + r + 16; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < r) continue;
        const ang = (Math.atan2(y - cy, x - cx) + Math.PI * 2.5) % (Math.PI * 2);
        if (ang / (Math.PI * 2) > draw) continue;
        const glow = clamp(1 - (d - r) / 16) ** 2 * out;
        if (d < r + 1.5) px(a, x, y, rgb32(bayer(x, y) < out ? C.goldWhite : C.ink));
        else if (bayer(x, y) < glow * 0.9)
          px(a, x, y, rgb32(glow > 0.55 ? C.goldHi : glow > 0.3 ? C.gold : C.ember));
      }
    if (dt > 2.4) {
      const k = prog(dt, 2.4, 3.6) * out;
      const grad = (x, y) => rgb32(y < 176 ? C.goldWhite : y < 181 ? C.goldHi : C.gold);
      pixelText(a, ['ROGUE DAWN'], {
        font: '700 26px Cinzel',
        spacing: '6px',
        x: 240,
        y: 166,
        lineHeight: 30,
        color: grad,
        alpha: k,
        shadow: true,
        threshold: 120,
      });
    }
  }

  function subtitles(a, t) {
    const all = Object.entries(cues.lines);
    for (const [n, [id, L]] of all.entries()) {
      const t0 = L.t - 0.05;
      // a line gives way to the next one, never overlaps it
      const next = all[n + 1]?.[1].t ?? Infinity;
      const t1 = Math.min(L.t + L.dur + 0.5, next - 0.1);
      if (t < t0 || t > t1) continue;
      const k = Math.min(prog(t, t0, t0 + 0.3), 1 - prog(t, t1 - 0.3, t1));
      const lines = wrap(text[id], 54);
      const y = lines.length > 1 ? 243 : 249;
      pixelText(a, lines, {
        font: '8px "Press Start 2P"',
        x: 240,
        y,
        lineHeight: 11,
        color: C.bone,
        alpha: k,
        shadow: true,
        threshold: 100,
      });
    }
  }

  function title(a, t, e) {
    const dt = t - e.t0;
    const k = Math.min(prog(dt, 0.05, 0.25), 1 - prog(t, e.t1 - 0.15, e.t1));
    const gold = e.shot === 'o_emperor';
    pixelText(a, [e.title], {
      font: `700 ${gold ? 18 : 14}px Cinzel`,
      spacing: gold ? '5px' : '3px',
      align: 'left',
      x: 22,
      y: gold ? 196 : 202,
      lineHeight: 20,
      color: gold ? C.goldHi : C.crimson,
      alpha: k,
      outline: true,
      threshold: 110,
    });
  }

  function letterbox(a, t) {
    // the bars open for the last line: the narrator, face to face
    const open = prog(t, 234.4, 236.2) * (1 - prog(t, 239.5, 239.6));
    const b = Math.round(BAR * (1 - open));
    if (b <= 0) return;
    for (let y = 0; y < b; y++) a.fill(INK32, y * W, (y + 1) * W);
    for (let y = H - b; y < H; y++) a.fill(INK32, y * W, (y + 1) * W);
  }

  function render(g, t) {
    const ei = entryAt(Math.min(t, duration - 1e-3));
    const e = EDIT[ei];
    shot(buf, e, t);
    // incoming dissolve: the previous shot runs on under it
    const d = IN[e.shot] || 0;
    if (d && ei > 0 && t < e.t0 + d) {
      shot(tmp, EDIT[ei - 1], t);
      const k = prog(t, e.t0, e.t0 + d);
      dissolve(tmp, buf, k);
      buf.set(tmp);
    }
    if (FADE_IN[e.shot]) toInk(buf, 1 - prog(t, e.t0, e.t0 + FADE_IN[e.shot]));
    if (FADE_OUT[e.shot]) toInk(buf, prog(t, e.t1 - FADE_OUT[e.shot], e.t1));
    // "every oath in the kingdom broke": a white flash on the word
    if (t > 113 && t < 113.12) flash(buf, 1 - (t - 113) / 0.12);
    // each officer and the Emperor land on a hit
    if (e.title && t - e.t0 < 0.06) flash(buf, 0.5, C.bone);
    if (e.kind === 'title' && t - e.t0 < 0.1) flash(buf, 1 - (t - e.t0) / 0.1);
    if (e.title) title(buf, t, e);
    letterbox(buf, t);
    subtitles(buf, t);
    ax.putImageData(img, 0, 0);
    g.save();
    g.imageSmoothingEnabled = false;
    g.drawImage(art, 0, 0, g.canvas.width, g.canvas.height);
    g.restore();
  }

  return {
    render,
    duration,
    shots: EDIT.map((e) => e.shot || e.kind),
    cuts: EDIT.map((e) => e.t0),
  };
}
