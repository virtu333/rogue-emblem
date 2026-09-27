// "The Night Before" — prologue draft, on the title theme (temp score).
// Storyboard: docs/specs/cutscenes.md → 2 · Prologue. Every time below is a bar and
// beat of music_title, resolved through the cue sheet; nothing is typed in seconds.

import {
  ART_W,
  ART_H,
  WIN,
  INK,
  OUT_W,
  OUT_H,
  SCALE,
  makeClock,
  indexPlate,
  drawPlate,
  ditherMix,
  ditherToInk,
  particles,
  putPx,
  hexRgb,
  prog,
  lerp,
  easeInOut,
  clamp,
} from './engine.js';
import { pen, strike, stamp, label, title, speech, BAND } from './hands.js';

const RGB = Object.fromEntries(Object.entries(INK).map(([k, v]) => [k, hexRgb(v)]));
const MOTES = [RGB.ember6, RGB.ember5, RGB.ember4, RGB.ember3];
const EMBERS = [RGB.ember6, RGB.ember5, RGB.ember4, RGB.ember3, RGB.ember2];
const ASH = [RGB.ink10, RGB.ink8, RGB.ink7];

export async function loadPrologue(base = '.') {
  const cue = await (await fetch(`${base}/cues/music_title.json`)).json();
  const names = ['spending', 'hallow', 'ford', 'hearth', 'unsworn', 'night_before'];
  const imgs = await Promise.all(
    names.map(async (n) =>
      createImageBitmap(await (await fetch(`${base}/plates/${n}.png`)).blob()),
    ),
  );
  const plates = Object.fromEntries(names.map((n, i) => [n, indexPlate(imgs[i])]));
  const sera = await createImageBitmap(
    await (await fetch('/assets/portraits/pc98/40/lord_sera.png')).blob(),
  );
  return build(cue, plates, { sera });
}

function build(cue, plates, portraits) {
  const C = makeClock(cue);
  const { T } = C;
  const solo = cue.parts.solo;
  const celesta = cue.parts.celesta;
  const bells = cue.parts.bells;

  // ------------------------------------------------------------------ shots
  // plate coords: effects' rects and particle spawns are in the plate's pixels;
  // `pan` is the plate offset under the window (0..32 x, 0..12 y), whole pixels only.
  const shots = [
    { id: 'before', from: T(1), to: T(3), plate: null, draw: drawFallingLights },
    {
      id: 'spending',
      from: T(3),
      to: T(5),
      plate: 'spending',
      enter: T(3, 3) - T(3),
      pan: [
        [16, 12],
        [16, 0],
      ],
      fx: (t) => [
        { kind: 'pulse', rect: [360, 0, 90, 90], value: t > T(4, 3) ? 1 + C.pulse(t, 3) : 0 },
        { kind: 'shimmer', rect: [170, 150, 300, 70], amp: 1, speed: 0.6 },
      ],
      draw: (img, t, off) =>
        particles(img, t, {
          seed: 11,
          n: 150,
          t0: T(3),
          t1: T(5),
          life: 5,
          spawn: (i) => [260 + ((i * 37) % 110) - off[0], -8 - (i % 5) * 6 - off[1]],
          vel: [0, 22],
          wobble: 1.5,
          colors: MOTES,
        }),
    },
    {
      id: 'hallow',
      from: T(5),
      to: T(13),
      plate: 'hallow',
      enter: T(5, 2) - T(5),
      pan: [
        [0, 6],
        [32, 6],
      ],
      fx: () => [
        { kind: 'shimmer', rect: [0, 72, 640, 34], amp: 1.6 },
        { kind: 'shimmer', rect: [0, 105, 140, 70], amp: 1.2, speed: 0.7 },
        { kind: 'flicker', rect: [180, 150, 70, 40], amp: 1 },
      ],
      // the gold thread follows the violin's Thread, note for note
      draw: (img, t, off) => drawThread(img, t, solo, T(5), T(13), off, { yA4: 150, step: 3.6 }),
    },
    {
      id: 'ford',
      from: T(13),
      to: T(21),
      plate: 'ford',
      pan: [
        [16, 12],
        [16, 0],
      ],
      fx: (t) => [
        ...[40, 140, 205, 238, 428, 452, 488, 560].map((x) => ({
          kind: 'flicker',
          rect: [x, 88, 36, 50],
          amp: 1.6,
        })),
        { kind: 'shimmer', rect: [110, 138, 430, 134], amp: 1.3 },
        { kind: 'pulse', rect: [280, 5, 80, 80], value: C.pulse(t, 4) > 0.6 ? 1 : 0 },
      ],
      draw: (img, t, off) =>
        particles(img, t, {
          seed: 23,
          n: 90,
          t0: T(13),
          t1: T(21),
          life: 3,
          spawn: (i) => [[58, 158, 222, 254, 446, 470, 506, 578][i % 8] - off[0], 96 - off[1]],
          vel: [2, -9],
          wobble: 2,
          colors: EMBERS,
        }),
    },
    {
      id: 'hearth',
      from: T(21),
      to: T(25),
      plate: 'hearth',
      pan: [
        [32, 6],
        [0, 6],
      ],
      fx: () => [
        { kind: 'flicker', rect: [150, 20, 230, 180], amp: 1.3 },
        { kind: 'flicker', rect: [60, 170, 60, 60], amp: 1.5 },
        { kind: 'flicker', rect: [560, 160, 70, 60], amp: 1.5 },
      ],
      draw: (img, t) =>
        particles(img, t, {
          seed: 31,
          n: 220,
          t0: T(21) - 6,
          t1: T(25),
          life: 7,
          spawn: (i) => [(i * 53) % 620, -4],
          vel: [-3, 16],
          wobble: 3,
          colors: ASH,
        }),
    },
    {
      id: 'unsworn',
      from: T(25),
      to: T(28),
      plate: 'unsworn',
      pan: [
        [16, 0],
        [16, 12],
      ],
      fx: (t) => [
        { kind: 'pulse', rect: [250, 30, 380, 230], value: Math.round(C.pulse(t, 5) * 1.4) },
      ],
    },
    { id: 'hole', from: T(28), to: T(29), plate: null },
    {
      id: 'night_before',
      from: T(29),
      to: T(33) + 4,
      plate: 'night_before',
      enter: T(29, 3) - T(29),
      pan: [
        [0, 8],
        [24, 8],
      ],
      fx: () => [
        { kind: 'flicker', rect: [128, 150, 50, 48], amp: 1.8 },
        { kind: 'shimmer', rect: [170, 140, 470, 132], amp: 1.4, speed: 0.8 },
      ],
      draw: (img, t, off) => {
        particles(img, t, {
          seed: 41,
          n: 70,
          t0: T(29) - 3,
          t1: T(33) + 4,
          life: 3.2,
          spawn: (i) => [148 + (i % 7) * 2 - off[0], 170 - off[1]],
          vel: [1.5, -13],
          wobble: 2.5,
          colors: EMBERS,
        });
        // the celesta's Thread, laid along the river: the thread becomes the water
        drawThread(img, t, celesta, T(29), T(33), off, { yA4: 222, step: 2.2, x0: 250, x1: 600 });
      },
    },
  ];
  const END = T(33) + 3.2;

  // ------------------------------------------------------------------ words
  const oath = [
    'The strong serve the weak.',
    'Every name is kept.',
    'The crown is a debt, and the king pays first.',
    'What sleeps is not woken, and what wakes it is not suffered.',
  ];
  const condemned = [
    'Tobin Marsh',
    'Edda Fell',
    'Col Harrow',
    'Wenna Pike',
    'Aske Morrow',
    'Hild Carter',
    'Rafe Tanner',
    'Old Maddock',
    'Lise of the Sallows',
    'Brand the Tinker',
    'Ysolt',
  ];

  function words(g, t) {
    const winMid = (BAND.win.y0 + BAND.win.y1) / 2;
    // 1 · before
    pen(g, t, {
      t0: T(1, 1.5),
      t1: T(2, 4),
      text: 'Before her, nothing came next.',
      y: winMid,
      size: 38,
      write: 2.2,
    });
    // 2 · the spending
    label(g, t, { t0: T(3), t1: T(4, 4), text: 'THE STARFALL' });
    pen(g, t, {
      t0: T(3, 3),
      t1: T(4, 2),
      text: 'She had nothing left to give but her name, and she paid it out.',
      band: 'low',
      write: 3,
    });
    pen(g, t, {
      t0: T(4, 3),
      t1: T(5),
      text: 'Look up. The rim is what is left.',
      band: 'low',
      write: 1.6,
    });
    // 3 · the long dusk
    label(g, t, { t0: T(5, 2), t1: T(12, 3), text: 'THE LONG DUSK' });
    pen(g, t, {
      t0: T(6),
      t1: T(8, 4),
      text: 'The fen children looked into the water and saw what had not happened yet.',
      band: 'low',
      write: 3.4,
    });
    pen(g, t, {
      t0: T(9, 2),
      t1: T(12, 3),
      text: 'The seers called it the Thread.',
      band: 'low',
      write: 1.8,
    });
    // 4 · the oath: one line every two bars, on the horn's entries
    label(g, t, { t0: T(13), t1: T(20, 3), text: 'THE OATH AT THE FORD' });
    oath.forEach((text, i) => {
      const t0 = T(13 + i * 2, 1.5);
      const next = i < 3 ? T(15 + i * 2, 1.5) : null;
      const low = BAND.low;
      // the newest line sits on the band's centre; the one before it rises and dims
      const rise = next ? prog(t, next - 0.45, next - 0.05) : 0;
      const y = (low.y0 + low.y1) / 2 + 6 - rise * 34;
      pen(g, t, {
        t0,
        t1: next ? Math.min(T(17 + i * 2, 1.5) - 0.5, T(20, 3)) : T(20, 3),
        fadeOut: 0.35,
        text,
        y,
        dim: 1 - rise * 0.55,
        size: 28,
        write: Math.max(1.2, text.length * 0.04),
      });
    });
    // 5 · the seat
    label(g, t, { t0: T(21), t1: T(24, 4), text: 'YEAR ONE OF THE SEAT', color: INK.blood5 });
    pen(g, t, {
      t0: T(21, 2),
      t1: T(23, 4),
      text: 'Every soul within the Empire shall be entered in the Roll.',
      band: 'low',
      color: INK.blood4,
      write: 2.4,
    });
    let shake = stamp(g, t, {
      t0: T(24),
      t1: T(24, 4),
      text: 'WHAT IS, REMAINS.',
      band: 'low',
      rules: true,
    });
    // 6 · the unsworn night: names written in red and struck, one a beat
    label(g, t, { t0: T(25), t1: T(27, 4), text: 'THE UNSWORN NIGHT', color: INK.blood5 });
    rollTicker(g, t, condemned);
    // 7 · the hole: a held breath, a bell, one red stroke through nothing
    strike(g, t, {
      t0: T(28, 2),
      dur: 0.5,
      x0: OUT_W / 2 - 160,
      x1: OUT_W / 2 + 160,
      y: winMid,
      t1: T(29) + 0.3,
      width: 3,
    });
    // 8 · the night before
    label(g, t, { t0: T(29, 2), t1: T(32, 4), text: 'YEAR 34 OF THE SEAT · THE NIGHT BEFORE' });
    shake =
      stamp(g, t, {
        t0: T(30),
        t1: T(30, 4),
        text: 'A ROGUE DAWN IN THE WEST.',
        band: 'low',
        color: INK.ink10,
        size: 26,
        spacing: 5,
      }) || shake;
    title(g, t, { t0: T(31), t1: T(32, 1), text: 'ROGUE DAWN', y: 300 });
    speech(g, t, {
      t0: T(32, 1),
      t1: T(33, 3),
      speaker: 'Sera',
      portrait: portraits.sera,
      text: 'I see a path... fragmented, but there. Stay close, Edric.',
    });
    return shake;
  }

  function rollTicker(g, t, list) {
    const y = (BAND.low.y0 + BAND.low.y1) / 2;
    g.save();
    g.font = 'italic 500 28px "Cormorant Garamond", Georgia, serif';
    const gap = 44;
    const widths = list.map((n) => g.measureText(n).width);
    g.restore();
    const beat = (i) => T(25, 1 + i);
    // the row slides so the newest name sits at the centre
    const cur = clamp(C.beatAt(t) - C.beatAt(T(25)), 0, list.length - 1);
    const lefts = [];
    let x = 0;
    list.forEach((_, i) => {
      lefts.push(x);
      x += widths[i] + gap;
    });
    const ci = Math.floor(cur);
    const fr = cur - ci;
    const centreOf = (i) => lefts[i] + widths[i] / 2;
    const cx = lerp(
      centreOf(ci),
      centreOf(Math.min(ci + 1, list.length - 1)),
      easeInOut(clamp(fr * 2.5 - 1.2)),
    );
    const shift = OUT_W / 2 - cx;
    list.forEach((name, i) => {
      const t0 = beat(i);
      const x0 = lefts[i] + shift;
      const r = pen(g, t, {
        t0,
        t1: T(28) - 0.05,
        fadeOut: 0.05,
        text: name,
        x: x0,
        y,
        size: 28,
        color: INK.blood4,
        write: 0.35,
        ink: 0.1,
      });
      if (r)
        strike(g, t, {
          t0: t0 + (T(25, 2) - T(25)) * 0.72,
          x0: r.x0,
          x1: r.x1,
          y,
          t1: T(28) - 0.05,
          fadeOut: 0.05,
        });
    });
  }

  // ------------------------------------------------------------------ pictures

  function drawFallingLights(img, t) {
    // bells A-G-E: three lights fall, one per stroke
    bells.slice(0, 3).forEach(([t0], i) => {
      const age = t - t0;
      if (age < 0 || age > 6) return;
      const x = WIN.x + [250, 330, 290][i];
      const y = WIN.y + 20 + age * 30 + age * age * 3;
      // a falling star: a 2×2 head with a halo and a long cooling trail
      for (let k = 0; k < 16; k++) {
        const c =
          k < 2
            ? RGB.ember6
            : k < 5
              ? RGB.ember5
              : k < 9
                ? RGB.ember4
                : k < 12
                  ? RGB.ember3
                  : RGB.ember2;
        putPx(img, x, y - k, c);
        if (k < 3) putPx(img, x + 1, y - k, c);
      }
      putPx(img, x - 1, y, RGB.ember4);
      putPx(img, x + 2, y, RGB.ember4);
      putPx(img, x, y + 1, RGB.ember4);
      putPx(img, x + 1, y + 1, RGB.ember4);
    });
  }

  /**
   * A melody drawn as a gold thread: each note a level run at its pitch, joined by
   * short slants, laid down as the note sounds. Drawn in the art grid.
   */
  function drawThread(img, t, notes, t0, t1, off, o) {
    const x0 = o.x0 ?? 24;
    const x1 = o.x1 ?? 600;
    const span = t1 - t0;
    const X = (tt) => x0 + ((tt - t0) / span) * (x1 - x0) - off[0] + 16;
    const Y = (midi) => o.yA4 - (midi - 69) * o.step - off[1] + 6;
    const inWin = notes.filter(([s]) => s >= t0 - 0.01 && s < t1);
    let prev = null;
    for (const [s, d, midi] of inWin) {
      if (t < s) break;
      const end = Math.min(s + d, t);
      const xa = X(s);
      const xb = X(end);
      const y = Y(midi);
      if (prev) {
        // slant from the previous level
        const n = Math.max(1, Math.round(Math.abs(y - prev.y) / 1.5));
        for (let k = 0; k <= n; k++) {
          putPx(img, WIN.x + lerp(prev.x, xa, k / n), WIN.y + lerp(prev.y, y, k / n), RGB.ember5);
        }
      }
      for (let x = xa; x <= xb; x++) {
        putPx(img, WIN.x + x, WIN.y + y, RGB.ember5);
        putPx(img, WIN.x + x, WIN.y + y + 1, RGB.ember2);
      }
      prev = { x: xb, y };
      if (t < s + d) {
        // the head: a bright point that breathes on the beat
        putPx(img, WIN.x + xb, WIN.y + y, RGB.ember6);
        putPx(img, WIN.x + xb + 1, WIN.y + y, RGB.ember6);
        if (C.pulse(t, 4) > 0.5) putPx(img, WIN.x + xb, WIN.y + y - 1, RGB.ember6);
      }
    }
  }

  // ------------------------------------------------------------------ frame

  const art = new OffscreenCanvas(ART_W, ART_H);
  const ag = art.getContext('2d', { willReadFrequently: true });
  const scratch = new OffscreenCanvas(ART_W, ART_H).getContext('2d', { willReadFrequently: true });

  function renderShot(g, shot, t) {
    g.fillStyle = INK.ink0;
    g.fillRect(0, 0, ART_W, ART_H);
    const img = g.getImageData(0, 0, ART_W, ART_H);
    let off = [16, 6];
    if (shot.plate) {
      const k = easeInOut(prog(t, shot.from, shot.to));
      off = [
        Math.round(lerp(shot.pan[0][0], shot.pan[1][0], k)),
        Math.round(lerp(shot.pan[0][1], shot.pan[1][1], k)),
      ];
      drawPlate(img, plates[shot.plate], off[0], off[1], t, shot.fx ? shot.fx(t) : []);
    }
    if (shot.draw) shot.draw(img, t, off);
    return img;
  }

  function shotAt(t) {
    let i = shots.findIndex((s) => t >= s.from && t < s.to);
    if (i < 0) i = t < shots[0].from ? 0 : shots.length - 1;
    return i;
  }

  /** Paint the frame at time t into a 2D context of OUT_W × OUT_H. */
  function render(out, t) {
    const i = shotAt(t);
    const shot = shots[i];
    const img = renderShot(ag, shot, t);
    if (shot.enter && t < shot.from + shot.enter && i > 0) {
      // ordered-dither dissolve from the previous shot
      const prev = renderShot(scratch, shots[i - 1], t);
      ditherMix(prev, img, prog(t, shot.from, shot.from + shot.enter));
      ag.putImageData(prev, 0, 0);
    } else {
      ag.putImageData(img, 0, 0);
    }
    // the end: dissolve to ink
    if (t > END - 2.4) {
      const d = ag.getImageData(0, 0, ART_W, ART_H);
      ditherToInk(d, prog(t, END - 2.4, END - 0.4));
      ag.putImageData(d, 0, 0);
    }
    out.imageSmoothingEnabled = false;
    out.fillStyle = INK.ink0;
    out.fillRect(0, 0, OUT_W, OUT_H);
    // type first measures whether a stamp is landing (the frame shakes one art pixel)
    const typeLayer = new OffscreenCanvas(OUT_W, OUT_H);
    const tg = typeLayer.getContext('2d');
    const shake = words(tg, t);
    const sy = shake ? SCALE : 0;
    out.drawImage(art, 0, sy, OUT_W, OUT_H);
    // a thin ink frame around the painting
    out.strokeStyle = INK.ink3;
    out.lineWidth = 2;
    out.strokeRect(WIN.x * SCALE - 1, WIN.y * SCALE - 1 + sy, WIN.w * SCALE + 2, WIN.h * SCALE + 2);
    if (t > END - 1.5) {
      tg.globalCompositeOperation = 'destination-out';
      tg.fillStyle = `rgba(0,0,0,${prog(t, END - 1.5, END - 0.3)})`;
      tg.fillRect(0, 0, OUT_W, OUT_H);
    }
    out.drawImage(typeLayer, 0, 0);
  }

  const cuts = shots.flatMap((s) => [s.from + 0.05, s.to - 0.05]).filter((t) => t < END);
  return {
    render,
    duration: END,
    cuts,
    shots: shots.map((s) => ({ id: s.id, from: s.from, to: s.to })),
  };
}
