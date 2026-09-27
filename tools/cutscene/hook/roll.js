// "The Roll": the opening cutscene, as a pure function of time.
//
// Every cut and word is a bar or beat of the score (cues.json, from score.py).
// Every figure is a traced drawing (trace.py) of a generated clip that is never
// shown; the player redraws the shapes in its own ink. See
// docs/specs/cutscene-the-roll.md for the storyboard this follows.

import { clamp, prog, lerp, easeOut, easeInOut, hash2 } from '../pilot/engine.js';
import { title as titleCard } from '../pilot/hands.js';
import { loadTrace, drawTrace, frameAt, samplePoints, toOut, PALETTES, TW, TH } from './trace.js';
import {
  COL,
  thread,
  spline,
  peel,
  converge,
  branches,
  grid,
  hollowSun,
  fire,
  rays,
  finish,
  flash,
  boil,
} from './fx.js';
import { slam, words, nameTag, say, hero, ledger, shake, pen, stamp } from './type.js';

const TRACES = [
  'hearth',
  'hearth_empty',
  'door',
  'quill',
  'wren',
  'capital',
  'edric_hand',
  'grab',
  'sera_eyes',
  'kira',
  'rowan',
  'astrid',
  'cael',
  'voss',
  'sera_light',
  'edric_clash',
  'helmet',
  'march',
];

function makeClock(cue) {
  const start = [0];
  cue.barBeats.forEach((b, i) => start.push(start[i] + b));
  const beat = (idx) => {
    const b = cue.beats;
    const i = Math.floor(idx);
    if (i >= b.length - 1)
      return b[b.length - 1] + (idx - (b.length - 1)) * (b[b.length - 1] - b[b.length - 2]);
    return b[i] + (b[i + 1] - b[i]) * (idx - i);
  };
  /** Bar `bar` (1-based), beat `bt` (1-based, fractional). */
  const T = (bar, bt = 1) => beat(start[bar - 1] + bt - 1);
  const notes = (part, t0 = 0, t1 = Infinity) =>
    (cue.parts[part] || []).filter(([s]) => s >= t0 - 1e-6 && s < t1 - 1e-6);
  return { T, notes };
}

export async function loadRoll(base = '.') {
  const cue = await (await fetch(`${base}/cues.json`)).json();
  const { T, notes } = makeClock(cue);
  const tr = {};
  await Promise.all(
    TRACES.map(async (id) => {
      try {
        tr[id] = await loadTrace(`${base}/traces/${id}.json.gz`);
      } catch (e) {
        console.warn(`trace ${id} missing`, e.message);
      }
    }),
  );
  const W = 1280;
  const H = 720;
  const S = W / TW; // frame px -> output px at zoom 1
  const END = T(45) + 1.6;

  /** Draw a trace shot: clip time from shot time, camera, palette. */
  const shotTrace = (g, id, c, o = {}) => {
    const x = tr[id];
    if (!x) return;
    drawTrace(g, x, frameAt(x, c, o.loop ?? 'pingpong'), o);
  };
  const camAt = (t, t0, t1, a, b, ease = easeInOut) => {
    const k = ease(prog(t, t0, t1));
    return { z: lerp(a.z, b.z, k), x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
  };

  // ------------------------------------------------------------ fixed geometry
  // (frame coordinates, 960x540, read off the traced drawings)
  const MOTHER = { x0: 80, x1: 505 };
  const threadNotes = notes('celesta', 0, T(3)).slice(0, 4);
  const threadPts = threadNotes.map(([, , p], i) => [300 + i * 230, 520 - (p - 69) * 16]);
  const peelMother = tr.hearth
    ? samplePoints(
        tr.hearth,
        frameAt(tr.hearth, (T(13) - T(3)) * 0.9, 'pingpong'),
        't1',
        700,
        3,
        (x) => x > MOTHER.x0 && x < MOTHER.x1,
      )
    : [];
  const HAND = { x0: 200, x1: 470, y0: 60, y1: 330 };
  const peelHand = tr.edric_hand
    ? samplePoints(
        tr.edric_hand,
        12,
        'fg',
        260,
        9,
        (x, y) => x > HAND.x0 && x < HAND.x1 && y > HAND.y0 && y < HAND.y1,
      )
    : [];
  const ARMY = ['EDRIC', 'SERA', 'KIRA', 'ROWAN', 'ASTRID', 'CAEL', 'VOSS'];
  const MARCH_NAMES = [
    'Edric',
    'Sera',
    'Kira',
    'Rowan',
    'Astrid',
    'Cael',
    'Voss',
    'Hale',
    'Mirren',
    'Oswin',
    'Tamsin',
    'Bram',
  ];

  // ------------------------------------------------------------ the shots
  const shots = [
    // I. ------------------------------------------------------ the name
    {
      id: 'open',
      from: 0,
      to: T(3),
      draw(g, t) {
        const [a, , , d] = threadNotes;
        // the thread reaches each note's point as the note sounds
        let k = 0;
        for (let i = 1; i < threadNotes.length; i++) {
          const s0 = threadNotes[i - 1][0];
          const s1 = threadNotes[i][0];
          if (t >= s0) k = (i - 1 + easeOut(prog(t, s0, s1))) / (threadNotes.length - 1);
        }
        if (t < a[0]) return;
        const sway = Math.sin(t * 1.3) * 3;
        const pts = spline(
          threadPts.map(([x, y], i) => [x, y + (i % 2 ? sway : -sway)]),
          18,
        );
        thread(g, pts, t < d[0] ? k : 1, { width: 2.4 });
        pen(g, t, {
          t0: T(1, 2),
          t1: T(3) - 0.5,
          text: 'Every name is written down.',
          size: 34,
          y: 640,
          color: COL.bone,
        });
      },
    },
    {
      id: 'hearth',
      from: T(3),
      to: T(7),
      draw(g, t) {
        const cam = camAt(t, T(3), T(7), { z: 1.02, x: 470, y: 280 }, { z: 1.12, x: 420, y: 250 });
        const a = prog(t, T(3), T(3) + 1.2);
        const fx = toOut(W, H, cam, 190, 300);
        g.save();
        g.globalAlpha = a;
        fire(g, t, { x: fx[0], y: fx[1], s: 2.2 * cam.z });
        g.restore();
        shotTrace(g, 'hearth', (t - T(3)) * 0.9, { pal: 'gold', cam, alpha: a, glow: false });
        // the thread from the opening fades into her hair
        thread(g, spline(threadPts, 18), 1, { alpha: 1 - a, width: 2.4 });
        const head = toOut(W, H, cam, 380, 90);
        nameTag(g, t, {
          t0: T(4),
          t1: T(7) - 0.2,
          text: 'Maren',
          x: head[0] - 150,
          y: head[1] - 40,
          to: [head[0] - 25, head[1]],
          align: 'right',
        });
        const girl = toOut(W, H, cam, 690, 135);
        nameTag(g, t, {
          t0: T(6),
          t1: T(7) - 0.2,
          text: 'Wren',
          x: girl[0] + 150,
          y: girl[1] - 50,
          to: [girl[0] + 35, girl[1]],
        });
      },
    },
    {
      id: 'hearth_close',
      from: T(7),
      to: T(10),
      draw(g, t) {
        const cam = camAt(t, T(7), T(10), { z: 2.0, x: 450, y: 190 }, { z: 2.3, x: 470, y: 200 });
        shotTrace(g, 'hearth', (t - T(3)) * 0.9, { pal: 'gold', cam, glow: false });
        const head = toOut(W, H, cam, 380, 90);
        nameTag(g, t, {
          t0: T(7) + 0.1,
          t1: T(10) - 0.3,
          text: 'Maren',
          x: 120,
          y: 120,
          to: [Math.max(200, head[0] - 20), Math.max(150, head[1])],
          write: 0.01,
        });
      },
    },
    {
      id: 'knock',
      from: T(10),
      to: T(11),
      draw(g, t) {
        const ks = notes('knock', T(10), T(11));
        ks.forEach(([s], i) => {
          if (t < s) return;
          const a = Math.exp(-(t - s) * (i === 2 ? 1.5 : 5));
          const w = [3, 5, 10][i] ?? 4;
          g.save();
          g.globalAlpha = a;
          g.fillStyle = COL.red;
          g.shadowColor = COL.red;
          g.shadowBlur = 30;
          g.fillRect(W / 2 - w / 2, 0, w, H);
          g.restore();
        });
        const last = ks[2]?.[0] ?? T(10, 3);
        if (t > last) {
          // the door comes open: the crack widens into red light
          const k = easeOut(prog(t, last + 0.1, T(11)));
          g.save();
          g.globalAlpha = k * 0.35;
          g.fillStyle = COL.red;
          g.fillRect(W / 2 - (k * W) / 2, 0, k * W, H);
          g.restore();
        }
      },
    },
    // II. ----------------------------------------------------- the Roll
    {
      id: 'door',
      from: T(11),
      to: T(12),
      draw(g, t) {
        const cam = camAt(t, T(11), T(12), { z: 1.0, x: 480, y: 250 }, { z: 1.1, x: 480, y: 240 });
        shotTrace(g, 'door', (t - T(11)) * 1.3, { pal: 'red', cam });
      },
    },
    {
      id: 'quill',
      from: T(12),
      to: T(13),
      draw(g, t) {
        const cam = camAt(t, T(12), T(13), { z: 1.1, x: 470, y: 300 }, { z: 1.25, x: 440, y: 320 });
        shotTrace(g, 'quill', 0.6 + (t - T(12)) * 1.0, { pal: 'red', cam });
        g.save();
        g.translate(560, 560);
        g.rotate(-0.16);
        pen(g, t, {
          t0: T(12, 1.5),
          write: T(12, 3.5) - T(12, 1.5),
          text: 'Maren',
          size: 96,
          x: -120,
          y: 0,
          color: COL.red,
          ink: 0.25,
        });
        g.restore();
      },
    },
    {
      id: 'unravel',
      from: T(13),
      to: T(14),
      draw(g, t) {
        const cam = { z: 1.02, x: 470, y: 280 };
        const c = (t - T(3)) * 0.9;
        const empty = (t - T(13)) * 0.9;
        const fx = toOut(W, H, cam, 190, 300);
        fire(g, t, { x: fx[0], y: fx[1], s: 2.2 * cam.z });
        shotTrace(g, 'hearth_empty', empty, { pal: 'gold', cam, loop: 'hold', glow: false });
        // the mother, in the Roll's red now, is pulled away from the top down
        const front = lerp(-40, TH + 40, easeInOut(prog(t, T(13) + 0.3, T(14) - 0.15)));
        const clip = (gg) => {
          const s = S * cam.z;
          const ox = W / 2 - cam.x * s;
          const oy = H / 2 - cam.y * s;
          const p = new Path2D();
          const x0 = ox + MOTHER.x0 * s;
          const x1 = ox + MOTHER.x1 * s;
          p.moveTo(x0, H);
          p.lineTo(x0, oy + front * s);
          for (let x = x0; x <= x1; x += 8)
            p.lineTo(x, oy + (front + (hash2(x | 0, boil(t)) - 0.5) * 28) * s);
          p.lineTo(x1, H);
          p.closePath();
          gg.clip(p);
        };
        shotTrace(g, 'hearth', c, { pal: 'red', cam, clip, glow: false });
        const pts = peelMother.map(([x, y, id]) => [...toOut(W, H, cam, x, y), id]);
        peel(g, t, pts, {
          t0: T(13) + 0.2,
          t1: T(14) - 0.2,
          order: (x, y) =>
            clamp((y - (H / 2 - cam.y * S * cam.z)) / (TH * S * cam.z)) * 0.95 +
            hash2(x | 0, y | 0) * 0.05,
          dir: [0.25, -1],
          speed: 300,
          life: 1.3,
        });
        const head = toOut(W, H, cam, 380, 90);
        nameTag(g, t, {
          t0: T(13),
          t1: T(13, 2.5),
          text: 'Maren',
          x: head[0] - 150,
          y: head[1] - 40,
          to: [head[0] - 25, head[1]],
          align: 'right',
          write: 0.01,
          strike: T(13) + 0.25,
          color: COL.red,
        });
      },
    },
    {
      id: 'wren',
      from: T(14),
      to: T(15),
      draw(g, t) {
        const cam = camAt(t, T(14), T(15), { z: 1.0, x: 480, y: 270 }, { z: 1.12, x: 470, y: 250 });
        shotTrace(g, 'wren', (t - T(14)) * 1.15, { pal: 'gold', cam, loop: 'hold' });
        const face = toOut(W, H, cam, 470, 180);
        nameTag(g, t, {
          t0: T(14) + 0.3,
          t1: T(15) - 0.1,
          text: 'Wren',
          x: face[0] + 190,
          y: face[1] - 60,
          to: [face[0] + 60, face[1] - 10],
        });
        say(g, t, {
          t0: T(14, 2.5),
          t1: T(15) - 0.15,
          text: 'When the Empire writes your name,',
          size: 40,
          y: 640,
        });
      },
    },
    {
      id: 'forget',
      from: T(15),
      to: T(15, 3),
      draw(g, t) {
        const [dx, dy] = shake(t, 1 - prog(t, T(15), T(15) + 0.3), 5);
        g.save();
        g.translate(dx, dy);
        slam(g, t, {
          t0: T(15),
          text: 'THE WORLD FORGETS YOU.',
          size: 60,
          spacing: 12,
          y: H / 2,
          erode: T(15, 2),
          erodeDur: 1.0,
        });
        g.restore();
      },
    },
    {
      id: 'capital',
      from: T(15, 3),
      to: T(17),
      draw(g, t) {
        const cam = camAt(
          t,
          T(15, 3),
          T(17),
          { z: 1.0, x: 480, y: 270 },
          { z: 1.3, x: 480, y: 300 },
        );
        const a = prog(t, T(15, 3), T(15, 3) + 0.8);
        shotTrace(g, 'capital', (t - T(15, 3)) * 1.1, { pal: 'dusk', cam, alpha: a, loop: 'hold' });
        // the letters of the last line are still eroding over the city
        slam(g, t, {
          t0: T(15),
          text: 'THE WORLD FORGETS YOU.',
          size: 60,
          spacing: 12,
          y: H / 2,
          erode: T(15, 2),
          erodeDur: 1.0,
        });
        const sunC = toOut(W, H, cam, 480, 54);
        g.save();
        g.globalAlpha = a;
        hollowSun(g, t, { x: sunC[0], y: sunC[1], r: 34 * cam.z, bright: 0.7 });
        g.restore();
        const pit = toOut(W, H, cam, 480, 330);
        converge(g, t, {
          t0: T(15, 3.2),
          t1: T(17) - 1.2,
          cx: pit[0],
          cy: pit[1],
          W,
          H,
          n: 170,
          life: 2.6,
        });
        pen(g, t, {
          t0: T(16),
          t1: T(17) - 0.4,
          text: 'They read the names into the dark.',
          size: 38,
          y: 650,
          color: COL.redHi,
        });
      },
    },
    // III. ---------------------------------------------------- the thread
    {
      id: 'edric_written',
      from: T(17),
      to: T(18),
      draw(g, t) {
        const cam = { z: 1.3, x: 430, y: 330 };
        shotTrace(g, 'quill', 3.4 + (t - T(17)) * 0.8, { pal: 'red', cam });
        g.save();
        g.fillStyle = 'rgba(7,6,11,0.45)';
        g.fillRect(0, 0, W, H);
        g.restore();
        const shaking = stamp(g, t, {
          t0: T(17),
          t1: T(18) - 0.2,
          text: 'EDRIC',
          size: 120,
          spacing: 26,
          y: H / 2,
          color: COL.red,
          rules: true,
        });
        if (shaking) flash(g, t, T(17), { dur: 0.15, color: COL.red, peak: 0.35 });
      },
    },
    {
      id: 'edric_hand',
      from: T(18),
      to: T(19),
      draw(g, t) {
        const cam = camAt(
          t,
          T(18),
          T(19),
          { z: 1.05, x: 480, y: 260 },
          { z: 1.25, x: 430, y: 230 },
        );
        const fx = toOut(W, H, cam, 262, 520);
        fire(g, t, { x: fx[0], y: fx[1], s: 2.0 * cam.z, seed: 8 });
        shotTrace(g, 'edric_hand', 1.5 + (t - T(18)) * 1.0, {
          pal: 'night',
          cam,
          loop: 'hold',
          glow: false,
        });
        const pts = peelHand.map(([x, y, id]) => [...toOut(W, H, cam, x, y), id]);
        peel(g, t, pts, {
          t0: T(18, 1.8),
          t1: T(19) - 0.1,
          dir: [0.1, -1],
          speed: 200,
          life: 1.1,
          width: 1.2,
        });
        const head = toOut(W, H, cam, 610, 110);
        nameTag(g, t, {
          t0: T(18) + 0.15,
          t1: T(19) - 0.05,
          text: 'Edric',
          x: head[0] + 150,
          y: head[1] - 30,
          to: [head[0] + 40, head[1]],
          red: T(18, 1.8),
          redDur: 2.2,
        });
      },
    },
    {
      id: 'grab',
      from: T(19),
      to: T(20),
      draw(g, t) {
        const cam = camAt(
          t,
          T(19),
          T(20),
          { z: 1.08, x: 480, y: 280 },
          { z: 1.14, x: 480, y: 280 },
        );
        shotTrace(g, 'grab', (t - T(19)) * 0.9, { pal: 'gold', cam, loop: 'hold' });
        // the thread pulled taut: a string that rings and settles
        const k = easeOut(prog(t, T(19), T(19) + 0.12));
        const amp = 26 * Math.exp(-(t - T(19)) * 2.2);
        const y = H * 0.47;
        const pts = [];
        for (let i = 0; i <= 64; i++) {
          const u = i / 64;
          pts.push([u * W, y + Math.sin(u * Math.PI) * Math.sin(t * 38) * amp]);
        }
        thread(g, pts, k, { width: 2.2, nib: false, blur: 20, color: COL.goldHi });
        flash(g, t, T(19), { dur: 0.22, color: COL.goldHi, peak: 0.8 });
        nameTag(g, t, {
          t0: T(19),
          t1: T(20) - 0.2,
          text: 'Edric',
          x: 900,
          y: 150,
          write: 0.01,
          red: T(19) - 5,
          redDur: 0.01,
          unred: T(19, 1.4),
        });
        say(g, t, {
          t0: T(19, 2.3),
          t1: T(20) - 0.1,
          speaker: 'Sera',
          text: 'Not this time.',
          size: 44,
        });
      },
    },
    {
      id: 'sight',
      from: T(20),
      to: T(23, 3),
      draw(g, t) {
        const cam = camAt(
          t,
          T(20),
          T(23, 3),
          { z: 1.0, x: 480, y: 270 },
          { z: 1.35, x: 480, y: 200 },
        );
        shotTrace(g, 'sera_eyes', (t - T(20)) * 0.78, { pal: 'gold', cam, loop: 'hold' });
        const eye = toOut(W, H, cam, 470, 192);
        const k = easeInOut(prog(t, T(20, 3), T(22, 1)));
        const n = branches(g, t, { x0: eye[0], y0: eye[1], W: W - 90, H, k, depth: 5, seed: 17 });
        if (n > 0) {
          g.save();
          g.font = '700 44px Cinzel, serif';
          g.textAlign = 'right';
          g.fillStyle = COL.red;
          g.shadowColor = COL.red;
          g.shadowBlur = 12;
          g.fillText(String(n), W - 40, 70);
          g.restore();
        }
        say(g, t, {
          t0: T(21),
          t1: T(22, 2.6),
          speaker: 'Sera',
          text: 'I have watched you die here thirty-one times.',
        });
        say(g, t, {
          t0: T(22, 3),
          t1: T(23, 3) - 0.1,
          speaker: 'Sera',
          text: 'Every time, I pull the thread back to the night before.',
        });
      },
    },
    {
      id: 'rewind',
      from: T(23, 3),
      to: T(24),
      draw(g, t) {
        const r = prog(t, T(23, 3), T(24));
        const cEnd = (T(23, 3) - T(20)) * 0.78;
        const cam = { z: lerp(1.35, 1.0, easeInOut(r)), x: 480, y: lerp(200, 270, r) };
        const c = cEnd * (1 - easeInOut(r));
        // a rewind: the drawing runs backwards, doubled in gold and red
        g.save();
        g.globalCompositeOperation = 'lighter';
        drawTrace(g, tr.sera_eyes, frameAt(tr.sera_eyes, c), {
          pal: 'gold',
          cam: { ...cam, x: cam.x - 4 * r },
          alpha: 0.8,
        });
        drawTrace(g, tr.sera_eyes, frameAt(tr.sera_eyes, c + 0.3), {
          pal: 'red',
          cam: { ...cam, x: cam.x + 5 * r },
          alpha: 0.5,
        });
        g.restore();
        const eye = toOut(W, H, cam, 470, 192);
        branches(g, t, {
          x0: eye[0],
          y0: eye[1],
          W: W - 90,
          H,
          k: 1 - easeInOut(r),
          depth: 5,
          seed: 17,
        });
        // tape tears
        g.save();
        for (let i = 0; i < 9; i++) {
          const y = hash2(i, boil(t, 24)) * H;
          g.globalAlpha = 0.25;
          g.fillStyle = COL.gold;
          g.fillRect(0, y, W, 1 + hash2(i, 3) * 3);
        }
        g.restore();
      },
    },
    {
      id: 'grid',
      from: T(24),
      to: T(25),
      draw(g, t) {
        const hits = notes('taiko', T(24), T(25)).map(([s]) => s);
        const k = easeOut(prog(t, T(24), T(24) + 0.4));
        thread(
          g,
          [
            [0, H / 2],
            [W, H / 2],
          ],
          k,
          { width: 2 },
        );
        grid(g, t, { W, H, cell: 80, times: hits, alpha: 0.55 });
      },
    },
    // IV. ----------------------------------------------------- the March
    {
      id: 'kira',
      from: T(25),
      to: T(27),
      draw(g, t) {
        const cam = camAt(t, T(25), T(27), { z: 1.0, x: 480, y: 270 }, { z: 1.12, x: 470, y: 290 });
        shotTrace(g, 'kira', (t - T(25)) * 1.0, { pal: 'gold', cam, loop: 'hold' });
        grid(g, t, { W, H, cell: 80, alpha: 0.18 });
        words(g, t, {
          t0: T(25),
          t1: T(26, 3),
          words: [
            ['GATHER', T(25, 1)],
            ['WHO', T(25, 2)],
            ['YOU', T(25, 3)],
            ['CAN.', T(25, 4)],
          ],
          size: 50,
          y: 110,
        });
        hero(g, t, {
          t0: T(26, 3),
          t1: T(27) - 0.05,
          text: 'KIRA',
          sub: 'Tactician',
          x: 90,
          y: 600,
        });
      },
    },
    ...[
      ['rowan', 27, 1.0, 'ROWAN', 'Chevalier', 'right'],
      ['astrid', 28, 1.0, 'ASTRID', 'Sky Lancer', 'left'],
      ['cael', 29, 0.4, 'CAEL', 'Sentinel', 'left'],
      ['voss', 30, 1.2, 'VOSS', 'Ranger', 'right'],
      ['sera_light', 31, 0.4, 'SERA', 'Light Sage', 'left'],
    ].map(([id, bar, c0, name, cls, side]) => ({
      id,
      from: T(bar),
      to: T(bar + 1),
      draw(g, t) {
        const cam = camAt(
          t,
          T(bar),
          T(bar + 1),
          { z: 1.08, x: 480, y: 270 },
          { z: 1.18, x: 480, y: 270 },
        );
        const light = id === 'sera_light';
        shotTrace(g, id, c0 + (t - T(bar)) * 1.0, {
          pal: 'gold',
          cam,
          loop: 'hold',
          glowGain: light ? 0.12 : 1,
        });
        if (light) {
          const p = toOut(W, H, cam, 600, 200);
          rays(g, t, { x: p[0], y: p[1], t0: T(bar) });
        }
        grid(g, t, { W, H, cell: 80, alpha: 0.1 });
        flash(g, t, T(bar), { dur: 0.12, color: COL.goldHi, peak: 0.35 });
        hero(g, t, {
          t0: T(bar, 1.5),
          t1: T(bar + 1) - 0.05,
          text: name,
          sub: cls,
          x: side === 'left' ? 90 : W - 90,
          y: 600,
          align: side === 'left' ? 'left' : 'right',
        });
      },
    })),
    {
      id: 'edric_clash',
      from: T(32),
      to: T(34),
      draw(g, t) {
        const cam = camAt(t, T(32), T(34), { z: 1.1, x: 480, y: 270 }, { z: 1.25, x: 500, y: 260 });
        const c = (t - T(32)) * 0.95;
        const split = 560;
        const s = S * cam.z;
        const sx = W / 2 + (split - cam.x) * s;
        shotTrace(g, 'edric_clash', c, {
          pal: 'gold',
          cam,
          loop: 'hold',
          clip: (gg) => {
            gg.beginPath();
            gg.rect(0, 0, sx, H);
            gg.clip();
          },
        });
        shotTrace(g, 'edric_clash', c, {
          pal: 'red',
          cam,
          loop: 'hold',
          clip: (gg) => {
            gg.beginPath();
            gg.rect(sx, 0, W - sx, H);
            gg.clip();
          },
        });
        flash(g, t, T(32), { dur: 0.12, color: COL.goldHi, peak: 0.35 });
        hero(g, t, { t0: T(32, 1.5), t1: T(34) - 0.05, text: 'EDRIC', sub: 'Lord', x: 90, y: 600 });
        ledger(g, t, {
          t0: T(32, 3),
          t1: T(34) - 0.1,
          x: W - 330,
          y: 90,
          lines: [
            ['Levy, Fourth Province, no. 118', T(33, 1)],
            ['Levy, Fourth Province, no. 119', T(33, 2)],
            ['Levy, Fourth Province, no. 120', T(33, 3)],
          ],
        });
      },
    },
    {
      id: 'roll_of_the_march',
      from: T(34),
      to: T(35),
      draw(g, t) {
        g.save();
        g.font = '600 30px Cinzel, serif';
        g.letterSpacing = '10px';
        g.textAlign = 'center';
        ARMY.forEach((nm, i) => {
          const s = T(34) + i * 0.13;
          const a = prog(t, s, s + 0.1);
          if (a <= 0) return;
          g.globalAlpha = a;
          g.fillStyle = i === 0 ? COL.goldHi : COL.gold;
          g.shadowColor = COL.gold;
          g.shadowBlur = 12;
          g.fillText(nm, W / 2 + 5, 150 + i * 62);
        });
        g.restore();
      },
    },
    {
      id: 'helmet',
      from: T(35),
      to: T(37),
      draw(g, t) {
        const cam = camAt(t, T(35), T(37), { z: 1.0, x: 480, y: 270 }, { z: 1.15, x: 520, y: 260 });
        shotTrace(g, 'helmet', (t - T(35)) * 1.0, { pal: 'mist', cam, loop: 'hold' });
        words(g, t, {
          t0: T(35),
          t1: T(36, 4),
          words: [
            ['LOSE', T(35, 1)],
            ['WHO', T(35, 2)],
            ['YOU', T(35, 3)],
            ['MUST.', T(35, 4)],
          ],
          size: 40,
          y: 110,
          color: COL.bone,
        });
      },
    },
    {
      id: 'march',
      from: T(37),
      to: T(40),
      draw(g, t) {
        const cam = camAt(t, T(37), T(40), { z: 1.0, x: 480, y: 270 }, { z: 1.1, x: 500, y: 270 });
        shotTrace(g, 'march', (t - T(37)) * 1.0, { pal: 'dusk', cam, loop: 'hold' });
        // every name held brightens the corona
        const shown = MARCH_NAMES.filter((_, i) => t >= T(37, 3) + i * 0.5).length;
        const sun = toOut(W, H, cam, 316, 224);
        hollowSun(g, t, { x: sun[0], y: sun[1], r: 94 * cam.z, bright: 0.5 + shown * 0.07 });
        words(g, t, {
          t0: T(37),
          t1: T(39) - 0.2,
          words: [
            ['REMEMBER', T(37, 1)],
            ['EVERY', T(37, 2)],
            ['NAME.', T(37, 3)],
          ],
          size: 46,
          y: 90,
        });
        g.save();
        g.font = 'italic 500 26px "Cormorant Garamond", serif';
        g.textAlign = 'center';
        MARCH_NAMES.forEach((nm, i) => {
          const s = T(37, 3) + i * 0.5;
          const k = prog(t, s, s + 0.3);
          if (k <= 0) return;
          const x = 610 + i * 54 + (hash2(i, 5) - 0.5) * 16;
          const y = 262 - hash2(i, 6) * 46 - (t - s) * 12;
          g.globalAlpha = k;
          g.fillStyle = COL.goldHi;
          g.shadowColor = COL.gold;
          g.shadowBlur = 10;
          g.fillText(nm, x, y);
        });
        g.restore();
      },
    },
    {
      id: 'hit',
      from: T(40),
      to: T(41),
      draw(g, t) {
        flash(g, t, T(40), { dur: 0.5, color: COL.goldHi, peak: 1 });
      },
    },
    // V. ------------------------------------------------------ the title
    {
      id: 'title',
      from: T(41),
      to: END,
      draw(g, t) {
        const cel = notes('celesta', T(41), T(43));
        const k = cel.length >= 4 ? prog(t, cel[0][0], cel[3][0] + 0.4) : prog(t, T(41), T(42));
        hollowSun(g, t, { x: W / 2, y: 280, r: 120, k: easeInOut(k), bright: 0.4 + 0.6 * k });
        titleCard(g, t, { t0: T(42), text: 'ROGUE DAWN', y: 520, size: 70 });
        const bells = notes('bells', T(43), T(45));
        if (bells.length >= 3) {
          words(g, t, {
            t0: bells[0][0],
            words: [
              ['TAKE BACK', bells[0][0]],
              ['EVERY', bells[1][0]],
              ['NAME.', bells[2][0]],
            ],
            size: 22,
            spacing: 10,
            y: 640,
            color: COL.bone,
          });
        }
      },
    },
  ];

  function render(g, t) {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = COL.ground;
    g.fillRect(0, 0, W, H);
    for (const s of shots) if (t >= s.from && t < s.to) s.draw(g, t);
    finish(g, t);
    // fade out at the very end
    const out = prog(t, END - 1.6, END);
    if (out > 0) {
      g.globalAlpha = out;
      g.fillStyle = COL.ground;
      g.fillRect(0, 0, W, H);
    }
    g.restore();
  }

  return {
    render,
    duration: END,
    shots: shots.map((s) => ({ id: s.id, from: s.from, to: s.to })),
    cuts: shots.map((s) => s.from),
  };
}

export { PALETTES };
