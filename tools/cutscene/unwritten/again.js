// "Again", bars 28-56 of "Under the Broken Sun" (46.4 s): the second half of the
// opening, from the snare roll into the chorus to the title in the silence.
//
//   28      the hit: Sera's eyes; on the roll we rush down the Thread (subliminal frames)
//   29-32   the charge under the Hollow Sun; the hilt; Edric's eye; Sera's thread
//           frays and snaps (three manga panels); Sera runs after it
//   33-36   Edric falls on the hits: ford, bridge, fens, stair. Each future is painted
//           over the last; the earlier falls show through in ink. Each ends sooner.
//   37-40   the army at first light (the Thread runs behind them); Astrid, Rowan, Kira;
//           the battle cry on the drum fill
//   41-44   the lines meet (split panels); the clash; the Hollow Sun opens; Edric alone;
//           struck; the frame freezes on the hit and cracks, with gold behind the page
//   45-48   the hymn: Sera kneels, the pages of that future drift backwards; her hands
//           mend the thread
//   49-52   the rewind: the book riffles back through every page to the camp, which is
//           stripped to paper; the last shot inks itself in
//   53-56   Edric looks up; the Hollow Sun; ROGUE DAWN
//
// Every image was generated once; everything that moves is code, on the score's clock.

import { Piece, crop169 } from './engine/piece.js';
import { T, BEAT, BAR, KIT, hitsIn, pulse } from './engine/score.js';
import { clamp, lerp, prog, smooth, hash, fbm } from './engine/raster.js';
import { cam, layerMatrix, drawSmear, parallax } from './engine/view.js';
import {
  RGB,
  ash,
  easeIn,
  easeInOut,
  easeOut,
  flakes,
  flash,
  focusLines,
  glint,
  glow,
  hollowSunRays,
  impact,
  onTwos,
  put,
  shake,
  slash,
  sparks,
  speedLines,
  splash,
  star,
  stripLive,
  stroke,
  threadPath,
  threadSnap,
  threadTunnel,
  twos,
  wavePts,
} from './engine/anime.js';
import { copyPanel, pageTurn, shatter } from './engine/transitions.js';
import { drain, drawTitle, embers, fireLight, hollowSun, makeTitle, thread } from './engine/fx.js';
import { hexToRgb } from './engine/raster.js';

export const W = 480;
export const H = 270;
export const FIRST_BAR = 28;
export const MUSIC_OFFSET = T(FIRST_BAR); // 43.2 s into the track
export const DURATION = T(57) - MUSIC_OFFSET; // bars 28-56
export { BAR };
/** Piece-local time of bar n, beat b. */
export const at = (bar, beat = 1) => T(bar, beat) - MUSIC_OFFSET;
const local = (name, b0, b1) => hitsIn(name, T(b0), T(b1)).map((x) => x - MUSIC_OFFSET);
const step = (u, n) => Math.floor(clamp(u) * n) / n; // progress in n stutters

const R = '/docs/art-direction/anime-op/refs';
const K = '/docs/art-direction/anime-op/cutouts';
const SRC = {
  seraEyes: `${R}/b21_sera_eyes.webp`,
  lieuEyes: `${R}/b21_lieutenant_eyes.webp`,
  hilt: `${R}/b01_hilt.webp`,
  edricEye: `${R}/b01_edric_eye.webp`,
  ridge: `${R}/b29_ridge_plate.webp`,
  ford: `${R}/b29_ford_plate.webp`,
  bridge: `${R}/b29_bridge_plate.webp`,
  fens: `${R}/b29_fens_plate.webp`,
  stair: `${R}/b29_stair_plate.webp`,
  firstLight: `${R}/b29_first_light_plate.webp`,
  fray: `${R}/b29_sera_hands_fray_strip.webp`,
  hymn: `${R}/b45_hymn_plate.webp`,
  camp: `${R}/b05_camp_night_plate.webp`,
  final: `${R}/b53_edric_final_frame_v2.webp`,
  charge: `${K}/edric_charge.webp`,
  falls: `${K}/edric_falls.webp`,
  collapse: `${K}/edric_collapse.webp`,
  standing: `${K}/edric_standing.webp`,
  seraRun: `${K}/sera_run.webp`,
  seraKneel: `${K}/sera_hymn_kneel.webp`,
  spear: `${K}/ally_spear.webp`,
  astrid: `${K}/astrid.webp`,
  rowan: `${K}/rowan.webp`,
  kira: `${K}/kira.webp`,
  cael: `${K}/cael.webp`,
  voss: `${K}/voss.webp`,
  sera: `${K}/sera.webp`,
  march: `${K}/empire_soldier_march.webp`,
  seraCamp: `${K}/sera_at_camp.webp`,
  edricCamp: `${K}/edric_at_fire.webp`,
  kiraCamp: `${K}/kira_at_camp.webp`,
  hEdric: `${K}/sheets/ms2_edric_heads.webp`,
  hSera: `${K}/sheets/ms2_sera_heads.webp`,
  hKira: `${K}/sheets/ms2_kira_heads.webp`,
  hAstrid: `${K}/sheets/ms2_astrid_heads.webp`,
  hRowan: `${K}/sheets/ms2_rowan_heads.webp`,
  hCael: `${K}/sheets/ms_cael_heads.webp`,
  hVoss: `${K}/sheets/ms_voss_heads.webp`,
};

// generated motion clips (tools/cutscene/unwritten/motion/), used where they exist
const MOTIONS = [
  'rowan_gallop',
  'edric_run',
  'sera_run',
  'astrid_fly',
  'march',
  'edric_fall',
  'edric_tumble',
  'kira_point',
  'sera_kneel',
  'hands_mend',
  'edric_looks_up',
  'sera_eyes',
  'clash',
  'army_ready',
  'edric_stand',
];

const NIGHT = [0.86, 0.74, 0.8];
const GOLD_RIM = { w: 1.6, color: RGB.goldHi };

/** Screen position of page point (x, y) through camera c (no layer transform). */
const scr = (x, y, c) => {
  const dx = (x - c.x) * c.zoom;
  const dy = (y - c.y) * c.zoom;
  const cs = Math.cos(c.rot);
  const sn = Math.sin(c.rot);
  return [cs * dx - sn * dy + W / 2, sn * dx + cs * dy + H / 2];
};

/** Layer point (u, v) of a layer placed by xf, seen through camera c -> screen. */
const toScreen = (xf, c, u, v) => {
  const m = layerMatrix(xf, c, W, H);
  return [m[0] * u + m[1] * v + m[2], m[3] * u + m[4] * v + m[5]];
};

/** Wind in a figure's trailing side (it faces right, so the left): cloth and hair. */
const wind = (l, t, amp = 2, trail = 0.5) => {
  const d = twos(t);
  const w = l.st.w;
  const h = l.st.h;
  return (u, v, out) => {
    const k = clamp((trail - u / w) / trail) * clamp((v / h - 0.08) / 0.3);
    out[0] = k * amp * Math.sin(d * 1.9 + v * 0.09);
    out[1] = k * amp * 0.4 * Math.cos(d * 1.3 + u * 0.12);
  };
};

/** A runner's bob: one stride a beat, held on twos. */
const bob = (t, period = BEAT, amp = 4) =>
  -Math.abs(Math.sin((Math.PI * onTwos(t)) / period)) * amp;

/** A small Hollow Sun (a reflection in an eye). */
function tinySun(f, x, y, r) {
  for (let dy = -r - 2; dy <= r + 2; dy++)
    for (let dx = -r - 2; dx <= r + 2; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= r - 0.5) put(f, W, H, x + dx, y + dy, RGB.ink);
      else if (d <= r + 0.8) put(f, W, H, x + dx, y + dy, RGB.goldHi);
    }
}

/** A flat fill with a ragged top edge: ground in silhouette. */
function ground(f, y0, c, seed = 3, amp = 8) {
  for (let x = 0; x < W; x++) {
    const top = y0 + (fbm(x, 0, seed, 60, 3) - 0.5) * amp * 2;
    for (let y = Math.max(0, Math.floor(top)); y < H; y++) put(f, W, H, x, y, c);
  }
}

/** A thin ink rectangle around a layer drawn with xf/c (a card's edge). */
function cardEdge(f, l, xf, c) {
  const m = layerMatrix(xf, c, W, H);
  const pts = [
    [0, 0],
    [l.st.w, 0],
    [l.st.w, l.st.h],
    [0, l.st.h],
  ].map(([u, v]) => [m[0] * u + m[1] * v + m[2], m[3] * u + m[4] * v + m[5]]);
  for (let i = 0; i < 4; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % 4]];
    stroke(f, W, H, a[0], a[1], b[0], b[1], 1, 1, RGB.sepia, 1, 0);
  }
}

function fill(f, c) {
  for (let i = 0; i < W * H; i++) {
    f[i * 4] = c[0];
    f[i * 4 + 1] = c[1];
    f[i * 4 + 2] = c[2];
  }
}

export class Again extends Piece {
  constructor() {
    super(W, H);
    this.shots = this.makeShots();
  }

  async load() {
    await this.loadImages(SRC);
    await this.loadMotions('/docs/art-direction/anime-op/motion', MOTIONS);
    await document.fonts.load('600 40px Cinzel');
    this.title = makeTitle('ROGUE DAWN', 34, 0.12);
    this.build(this.params);
  }

  // ------------------------------------------------------------------ the layers

  L(name) {
    const I = this.img;
    const P = (k, o) => this.plate(k, I[k], o);
    switch (name) {
      case 'seraEyes':
        return P('seraEyes', { zoom: 1.2, skin: true });
      case 'lieuEyes':
        return P('lieuEyes', { zoom: 1.1, skin: true });
      case 'hilt':
        return P('hilt', { zoom: 1.1, skin: true });
      case 'edricEye':
        return P('edricEye', { zoom: 1.35, skin: true });
      case 'ridge':
        return this.plate('ridge', I.ridge, {
          w: 760,
          h: 507,
          crop: { x: 0, y: 0, w: 1536, h: 1024 },
        });
      case 'sky':
        return this.plate('sky', I.ridge, {
          w: 540,
          h: 304,
          zoom: 1.2,
          crop: { x: 0, y: 0, w: 1536, h: 864 },
          tint: [0.8, 0.76, 0.9],
        });
      case 'ford':
        return P('ford', { zoom: 1.12 });
      case 'bridge':
        return P('bridge', { zoom: 1.12, cool: 1 });
      case 'fens':
        return P('fens', { zoom: 1.2, cool: 1 });
      case 'stair':
        return P('stair', { zoom: 1.12 });
      case 'firstLight':
        return this.plate('firstLight', I.firstLight, {
          w: 700,
          h: 394,
          crop: crop169(I.firstLight, 0.6),
        });
      case 'field':
        return this.plate('field', I.firstLight, {
          w: 600,
          h: 338,
          crop: crop169(I.firstLight, 1),
        });
      case 'hymn': {
        const c = { x: 1536 * 0.07, y: 1024 * 0.12, w: 1536 * 0.86, h: 1536 * 0.86 * (9 / 16) };
        return this.plate('hymn', I.hymn, { zoom: 1.08, crop: c });
      }
      case 'hands0':
      case 'hands1':
      case 'hands2': {
        const i = Number(name.slice(-1));
        return this.plate(name, I.fray, {
          zoom: 1.1,
          crop: { x: i * 512, y: 175, w: 512, h: 288 },
          seed: 60 + i,
          skin: true,
        });
      }
      case 'camp': {
        const s = I.camp.width / W;
        return this.plate('camp', I.camp, {
          crop: { x: 0, y: I.camp.height - H * s, w: I.camp.width, h: H * s },
          lift: 0.14,
        });
      }
      case 'final':
        return P('final', { zoom: 1.06, seed: 31, grain: 30, skin: true });
      case 'titleSky': {
        const s = I.camp.width / W;
        return this.plate('titleSky', I.camp, {
          crop: { x: 0, y: 0, w: I.camp.width, h: H * s },
          tint: [0.7, 0.66, 0.82],
          seed: 41,
        });
      }
      default:
        throw new Error(name);
    }
  }

  fig(name, h, o = {}) {
    return this.figure(name, this.img[name], h, o);
  }

  /** One head from a sheet: col, row of a cols x rows grid. */
  head(name, col, row, cols, rows, h) {
    const im = this.img[name];
    const cw = im.width / cols;
    const ch = im.height / rows;
    return this.figure(`${name}:${col},${row}`, im, h, {
      crop: { x: col * cw, y: row * ch, w: cw, h: ch },
    });
  }

  // ------------------------------------------------------------------ the shots

  makeShots() {
    const S = [];
    const shot = (name, from, to, draw, enter) => S.push({ name, from, to, draw, enter });

    // --- 28.1: the hit. Sera's eyes ------------------------------------------------
    shot('seraEyes', at(28), at(28, 3), (f, t) => {
      const lt = t - at(28);
      const z = 1 + 0.12 * easeOut(lt / 0.8) + 0.1 * pulse(t, [at(28)], 0.12);
      const c = cam(240, 136, z, 0);
      const Me = this.motion('sera_eyes', 270);
      if (Me)
        this.draw(f, Me.layer(Me.index(lt, { mode: 'once', rate: 2.4 })), 0, Me.fill(W, H), c);
      else this.draw(f, this.L('seraEyes'), 0, null, c);
      // the thread, reflected in each iris
      for (const ex of [130, 382]) {
        const [sx, sy] = scr(ex, 136, c);
        threadPath(
          f,
          W,
          H,
          [
            [sx - 6, sy - 5],
            [sx, sy - 6],
            [sx + 6, sy - 5],
          ],
          1,
          { spark: false, halo: 0.3 },
        );
      }
      focusLines(f, W, H, 240, 138, twos(t), { inner: 165, amount: 0.75, aspect: 1.8, width: 7 });
      if (lt < 1 / 24) flash(f, W, H, 1);
      else if (lt < 3 / 24) impact(f, W, H, { mode: 'neg' });
    });

    // --- 28.3: the roll. We rush down the Thread -----------------------------------
    const roll = KIT.roll.map((h) => h.t - MUSIC_OFFSET).filter((x) => x >= at(28, 3) - 1e-6);
    const INSERTS = [
      'hilt',
      'lieuEyes',
      'edricEye',
      'sun',
      'lieuEyes',
      'hands2',
      'seraEyes',
      'sun',
      'hilt',
      'lieuEyes',
    ];
    shot('rush', at(28, 3), at(29), (f, t) => {
      const lt = t - at(28, 3);
      const k = lt / 0.8;
      let hi = -1;
      for (let i = 0; i < roll.length; i++) if (roll[i] <= t + 1e-6) hi = i;
      if (hi >= 0 && t - roll[hi] < 1 / 24 + 1e-3) {
        // a single-frame insert, as a drawing: the future flickering past
        const name = INSERTS[hi % INSERTS.length];
        if (name === 'sun') hollowSun(f, W, H, 240, 135, 70, t, 1);
        else this.draw(f, this.L(name), 0, null, cam(240, 135, 1.1));
      }
      focusLines(f, W, H, 240, 135, twos(t), {
        inner: 26,
        count: 140,
        width: 3,
        color: RGB.graphite,
        amount: 0.35 + 0.5 * k,
        aspect: 1.3,
        jitter: 0.9,
      });
      threadTunnel(f, W, H, 240, 135, t, { speed: 1.1 + 3.5 * k * k, amount: 0.55 + 0.45 * k });
      glow(f, W, H, 240, 135, 30 + 60 * k, 0.6 + 0.4 * k);
      flash(f, W, H, smooth(0.62, 0.8, lt) * 0.95);
    });

    // --- 29: the charge under the Hollow Sun ---------------------------------------
    const kicks29 = local('kick', 29, 30);
    shot('charge', at(29), at(30), (f, t) => {
      const lt = t - at(29);
      const cx = 240 + 150 * lt;
      const z = 1 + 0.12 * pulse(t, [at(29)], 0.2);
      const [sx, sy, sr] = shake(t, kicks29, 2.5, 0.1);
      const c = cam(cx + sx, 135 + sy, z, sr);
      this.draw(f, this.L('ridge'), 0, { x: 340, y: 93, ax: 380, ay: 253, scale: 1 }, c, {
        par: 0.55,
      });
      hollowSun(f, W, H, 172 - (cx - 240) * 0.12, 74, 44, t, 1);
      speedLines(f, W, H, t, {
        y0: 196,
        y1: 270,
        density: 0.32,
        speed: -1100,
        color: RGB.graphite,
        len: 70,
      });
      const Mr = this.motion('edric_run', 214);
      if (Mr) {
        // the generated run: two strides a beat-and-a-bit, drawn on twos
        const i = Mr.index(lt, { rate: 1.05 });
        this.draw(f, Mr.layer(i), 0, Mr.place(cx + 8, 268, 1, 0.02), c, {
          rim: { ...GOLD_RIM, dir: [-0.8, -0.6] },
        });
      } else {
        const E = this.fig('charge', 210);
        const xf = this.at(E, cx + 8, 266 + bob(t), 1, 0.05);
        this.draw(f, E, 0, xf, c, {
          warp: wind(E, t, 2.5),
          rim: { ...GOLD_RIM, dir: [-0.8, -0.6] },
        });
      }
      // dust off the back foot, a puff a stride
      const b = Math.floor(lt / BEAT);
      for (let i = Math.max(0, b - 1); i <= b; i++)
        splash(f, W, H, 214, 262, t, at(29) + i * BEAT, {
          count: 14,
          speed: 70,
          dir: -Math.PI * 0.85,
          spread: 0.5,
          seed: 40 + i,
          colors: [RGB.graphite, hexToRgb('#938c55')],
          life: 0.5,
          gravity: 120,
        });
      ash(f, W, H, t, { count: 50, drift: -220, fall: 20, seed: 7 });
      if (lt < 1 / 24) flash(f, W, H, 0.7);
    });

    // --- 30.1: the hilt, a glint running down the blade ---------------------------
    shot('hilt', at(30), at(30, 3), (f, t) => {
      const lt = t - at(30);
      const z = 1 + 0.06 * easeOut(lt / 0.8) + 0.06 * pulse(t, [at(30)], 0.15);
      const c = cam(240, 135, z, -0.02 * lt);
      this.draw(f, this.L('hilt'), 0, null, c);
      const [x0, y0] = scr(269, 154, c);
      const [x1, y1] = scr(482, 240, c);
      glint(f, W, H, x0, y0, x1, y1, ((lt - 0.12) / 0.5) * 1.25, 8, 0.14);
    });

    // --- 30.3: Edric's eye. The Hollow Sun is in it -------------------------------
    shot('eye', at(30, 3), at(31), (f, t) => {
      const lt = t - at(30, 3);
      const k = easeOut(lt / 0.8);
      const c = cam(lerp(240, 223, k), lerp(135, 113, k), 1 + 0.3 * k, 0);
      this.draw(f, this.L('edricEye'), 0, null, c);
      const [px, py] = scr(223, 113, c);
      if (lt > 0.15) tinySun(f, px + 3, py - 3, Math.round(2 + 3 * smooth(0.15, 0.6, lt)));
      focusLines(f, W, H, px, py, twos(t), { inner: 190, amount: 0.55, aspect: 1.7, width: 6 });
    });

    // --- 31: the thread frays (three panels) and snaps ----------------------------
    const PANELS = [
      [
        [6, 6],
        [154, 6],
        [146, 264],
        [6, 264],
      ],
      [
        [162, 6],
        [314, 6],
        [326, 264],
        [154, 264],
      ],
      [
        [322, 6],
        [474, 6],
        [474, 264],
        [334, 264],
      ],
    ];
    const snapAt = at(31, 4);
    shot(
      'fray',
      at(31),
      at(32),
      (f, t) => {
        const lt = t - at(31);
        const [sx, sy] = t >= snapAt ? shake(t, [snapAt], 5, 0.15) : [0, 0];
        const tmp = this.scratch('fray');
        for (let i = 0; i < 3; i++) {
          const ti = at(31, 1 + i);
          if (t < ti) continue;
          const slide = -34 * (1 - easeOut((t - ti) / 0.12));
          tmp.set(this.paper);
          const l = this.panelLayer(i);
          const cx = [80, 240, 400][i];
          this.draw(tmp, l, 0, {
            x: cx + sx,
            y: 146 + slide + sy,
            ax: l.st.w / 2,
            ay: 140,
            scale: 1,
          });
          copyPanel(f, tmp, W, H, PANELS[i], 2);
        }
        // the thread runs through all three, across the gutters
        const y = 92 + sy;
        if (t < snapAt) {
          threadPath(f, W, H, wavePts(18, y, 462, y, t, 1.2, 3), prog(t, at(31), at(31, 3)));
          // fraying where it will break
          const fr = smooth(at(31, 2.5), snapAt, t);
          for (let k = 0; k < 8 * fr; k++) {
            const a = hash(k, twos(t), 3) * Math.PI * 2;
            const r = 3 + hash(k, twos(t), 4) * 7 * fr;
            put(f, W, H, 394 + Math.cos(a) * r, y + Math.sin(a) * r * 0.6, RGB.goldHi);
          }
        } else threadSnap(f, W, H, 18, y, 462, y, 394, y, t - snapAt);
        if (lt < 1 / 24) flash(f, W, H, 0.5);
      },
      { kind: 'ink', dur: 0.2, cx: 223, cy: 113, seed: 9 },
    );

    // --- 32: Sera runs after it -----------------------------------------------------
    const whip = at(32, 4);
    shot('run', at(32), at(33), (f, t) => {
      const lt = t - at(32);
      const u = Math.max(0, t - whip);
      const cx = 240 + 120 * lt + 2400 * u * u;
      const c = cam(cx, 135, 1, 0);
      speedLines(f, W, H, t, {
        density: 0.24 + u * 1.2,
        speed: -1400 - 9000 * u,
        color: RGB.graphite,
        len: 70 + 400 * u,
        thin: u > 0.1 ? 2 : 1,
      });
      const x = 240 + 120 * lt - 16;
      const Ms = this.motion('sera_run', 210);
      let hx;
      let hy;
      if (Ms) {
        // the generated run, one cycle every two beats; the thread hangs off her hand
        const i = Ms.index(lt, { rate: 0.75 / (2 * BEAT) });
        const xf = Ms.place(x, 268);
        if (u > 0) drawSmear(f, W, H, this.paper, Ms.layer(i), 0, xf, c, {}, 30 + 160 * u, 0, 5);
        this.draw(f, Ms.layer(i), 0, xf, c);
        const hand = Ms.extreme(i, 'right', 0.15, 0.55) || [Ms.w, Ms.h * 0.35];
        [hx, hy] = toScreen(xf, c, hand[0], hand[1]);
      } else {
        const Sr = this.fig('seraRun', 205);
        const xf = this.at(Sr, x, 266 + bob(t, BEAT, 3), 1, 0.03);
        if (u > 0) drawSmear(f, W, H, this.paper, Sr, 0, xf, c, {}, 30 + 160 * u, 0, 5);
        this.draw(f, Sr, 0, xf, c, { warp: wind(Sr, t, 3, 0.55) });
        [hx, hy] = scr(x + (0.87 - 0.5) * Sr.st.w, 266 - 0.65 * Sr.st.h, c);
      }
      // the broken end of the thread, flying ahead of her hand
      const gap = 16 + 70 * lt;
      threadPath(f, W, H, wavePts(hx + gap, hy - 4, 520, hy - 26, t * 3, 7, 2), 1, {
        spark: false,
      });
      star(f, W, H, hx + gap, hy - 4, 3 + (twos(t) % 2), RGB.goldWhite);
    });

    // --- 33-36: the falls ---------------------------------------------------------
    const FALLS = [
      {
        name: 'ford',
        bar: 33,
        hit: 3,
        from: [70, 262, 1],
        to: [236, 258, 1],
        rot: 0,
        z: 1,
        fx: 'water',
      },
      {
        name: 'bridge',
        bar: 34,
        hit: 2.5,
        from: [150, 268, 1.05],
        to: [246, 236, 0.84],
        rot: -0.04,
        z: 1.04,
        fx: 'ash',
      },
      {
        name: 'fens',
        bar: 35,
        hit: 3,
        from: [56, 266, 1.12],
        to: [248, 262, 1.12],
        rot: 0,
        z: 1.12,
        fx: 'water',
        big: true,
      },
      {
        name: 'stair',
        bar: 36,
        hit: 2,
        from: [196, 268, 1],
        to: [236, 222, 0.82],
        rot: 0.05,
        z: 1.02,
        fx: 'dust',
        echo: true,
      },
    ];
    FALLS.forEach((F, i) => {
      F.hitT = at(F.bar, F.hit);
      F.ghosts = FALLS.slice(0, i);
      shot(F.name, at(F.bar), at(F.bar + 1), (f, t) => this.fall(f, t, F, FALLS));
    });

    // --- 37: the army at first light ----------------------------------------------
    const ROW_STILL = [
      ['kira', 160, 170],
      ['cael', 268, 176],
      ['voss', 372, 172],
      ['sera', 478, 166],
    ];
    const ROW = [
      ['rowan', 470, 204],
      ['astrid', 640, 196],
    ];
    shot(
      'army',
      at(37),
      at(39),
      (f, t) => {
        const lt = t - at(37);
        const u = easeInOut(lt / (2 * BAR));
        const camx = 240 + 260 * u;
        const c = cam(camx, 135, 1 + 0.03 * u, 0);
        this.draw(f, this.L('firstLight'), 0, { x: 350, y: 135, ax: 350, ay: 197, scale: 1 }, c, {
          par: 0.45,
        });
        // the back ranks: unfinished, still in line
        const A = this.fig('spear', 84);
        for (let i = 0; i < 12; i++)
          this.draw(f, A, 1, this.at(A, 20 + i * 72 + (i % 2) * 20, 214 + (i % 3) * 3, 1), c, {
            par: 0.8,
          });
        // the Thread runs along behind the front rank, drawn as the camera passes
        const head = camx + 190;
        const pts = wavePts(-40, 158, 900, 150, t, 5, 3, 120);
        const sp = pts.map(([x, y]) => scr(x, y, c));
        threadPath(f, W, H, sp, clamp((head + 40) / 940));
        // the four on foot: the generated clip (breathing, wind, weight shifting); its
        // left edge (where Kira is cut by the clip's frame) stays off screen
        const Ma = this.motion('army_ready', 186);
        if (Ma) {
          const i = Ma.index(lt, { rate: 1 });
          const xf = { x: -24, y: 268, ax: 0, ay: Ma.meta.anchor[1] * Ma.s, scale: 1 };
          this.draw(f, Ma.layer(i), 0, xf, c, {
            rim: head > 150 ? { ...GOLD_RIM, dir: [0.3, -1] } : null,
          });
        } else
          for (const [name, x, h] of ROW_STILL) {
            const l = this.fig(name, h);
            this.draw(f, l, 0, this.at(l, x, 268, 1), c, { warp: wind(l, t + x, 1.5) });
          }
        for (const [name, x, h] of ROW) {
          const l = this.fig(name, h);
          const lit = head > x + 10;
          this.draw(f, l, 0, this.at(l, x, 268, 1), c, {
            warp: wind(l, t + x, 1.5),
            rim: lit ? { ...GOLD_RIM, dir: [0.3, -1] } : null,
          });
        }
        ash(f, W, H, t, { count: 30, fall: -10, drift: -6, seed: 21, palette: [RGB.paperHi] });
      },
      { kind: 'burn', dur: 0.36, cx: 240, cy: 150 },
    );

    // --- 39.1: Astrid flies past --------------------------------------------------
    shot('astrid', at(39), at(39, 3), (f, t) => {
      const lt = t - at(39);
      const u = lt / 0.8;
      const c = cam(240 + 60 * (u - 0.5), 135, 1, 0);
      this.draw(f, this.L('sky'), 0, null, c, { par: 0.3 });
      speedLines(f, W, H, t, { density: 0.22, speed: -1600, color: RGB.paperHi, len: 90 });
      const q = u < 0.5 ? 0.5 - 0.5 * (1 - 2 * u) ** 0.55 : 0.5 + 0.5 * (2 * u - 1) ** 0.55;
      const x = -170 + 820 * q;
      const y = 196 - 44 * Math.sin(Math.PI * u);
      const Mf = this.motion('astrid_fly', 210);
      if (Mf) {
        // the generated wingbeat: one full stroke every two beats
        const i = Mf.index(lt, { rate: 0.75 / (2 * BEAT) });
        const xf = Mf.place(x + 60 * (u - 0.5), y + 20, 1, -0.04);
        drawSmear(f, W, H, this.paper, Mf.layer(i), 0, xf, c, {}, 60, 4, 4);
        this.draw(f, Mf.layer(i), 0, xf, c);
      } else {
        const A = this.fig('astrid', 190);
        const flap = twos(t) % 3 === 0 ? 0.93 : 1;
        const xf = this.at(A, x + 60 * (u - 0.5), y, 1, -0.06, { sy: flap });
        drawSmear(f, W, H, this.paper, A, 0, xf, c, {}, 60, 4, 4);
        this.draw(f, A, 0, xf, c, { warp: wind(A, t, 2, 0.4) });
      }
    });

    // --- 39.3: Rowan's gallop -----------------------------------------------------
    shot('rowan', at(39, 3), at(40), (f, t) => {
      const lt = t - at(39, 3);
      const c = cam(240 + 260 * lt, 135, 1.05, 0);
      this.draw(f, this.L('field'), 0, null, c, { par: 0.18 });
      speedLines(f, W, H, t, {
        y0: 160,
        y1: 270,
        density: 0.55,
        speed: -1900,
        color: RGB.graphite,
        len: 90,
      });
      speedLines(f, W, H, t, {
        y0: 40,
        y1: 160,
        density: 0.12,
        speed: -900,
        color: RGB.paperHi,
        len: 60,
        seed: 4,
      });
      const M = this.motion('rowan_gallop', 214);
      if (M) {
        // the generated gallop: one stride a beat (the clip's stride is 0.5 s)
        const i = M.index(lt, { rate: 0.5 / BEAT });
        this.draw(f, M.layer(i), 0, M.place(228 + 14 * lt, 268), cam(240, 135, 1.05));
      } else {
        const Rw = this.fig('rowan', 200);
        const g = onTwos(lt);
        const y = 272 + bob(lt, 0.2, 6);
        const rot = 0.035 * Math.sin((2 * Math.PI * g) / 0.2);
        this.draw(f, Rw, 0, this.at(Rw, 226 + 14 * lt, y, 1, rot), cam(240, 135, 1.05), {
          warp: wind(Rw, t, 2, 0.45),
        });
      }
      for (let i = 0; i < 4; i++)
        splash(f, W, H, 170, 266, t, at(39, 3) + i * 0.2, {
          count: 16,
          speed: 90,
          dir: -Math.PI * 0.8,
          spread: 0.5,
          seed: 60 + i,
          colors: [hexToRgb('#6e6a3b'), RGB.graphite],
          life: 0.45,
          gravity: 150,
        });
    });

    // --- 40.1: Kira points the way ------------------------------------------------
    shot('kira', at(40), at(40, 3), (f, t) => {
      const lt = t - at(40);
      const z = 1 + 0.06 * easeOut(lt / 0.8);
      const c = cam(240, 135, z, 0);
      focusLines(f, W, H, 310, 128, twos(t), {
        inner: 70,
        amount: 0.8,
        aspect: 1.3,
        color: RGB.graphite,
        width: 5,
      });
      const Mk = this.motion('kira_point', 300);
      if (Mk)
        this.draw(f, Mk.layer(Mk.index(lt, { mode: 'once', rate: 1.4 })), 0, Mk.place(196, 392), c);
      else {
        const Kl = this.fig('kira', 300);
        this.draw(f, Kl, 0, this.at(Kl, 188, 392, 1), c, { warp: wind(Kl, t, 2.5, 0.5) });
      }
    });

    // --- 40.3: the battle cry, a face a sixteenth ---------------------------------
    const CRY = [
      ['hCael', 2, 0, 4, 1, '#6e1a28'],
      ['hVoss', 2, 0, 4, 1, '#2d6450'],
      ['hRowan', 2, 0, 3, 2, '#4f4a2a'],
      ['hAstrid', 2, 0, 3, 2, '#2c4c77'],
      ['hKira', 2, 0, 3, 2, '#44111c'],
      ['hSera', 2, 0, 3, 2, '#4a2270'],
      ['hEdric', 2, 0, 3, 2, '#1b4239'],
      ['hEdric', 2, 0, 3, 2, '#1b4239'],
    ];
    shot('cry', at(40, 3), at(41), (f, t) => {
      const lt = t - at(40, 3);
      const i = Math.min(7, Math.floor(lt / (BEAT / 4)));
      const [name, col, row, cols, rows, bg] = CRY[i];
      fill(f, hexToRgb(bg));
      const u = lt - (i * BEAT) / 4;
      focusLines(f, W, H, i % 2 ? 300 : 180, 130, twos(t) + i, {
        inner: 80,
        amount: 0.7,
        color: RGB.paper,
        width: 5,
        aspect: 1.2,
      });
      const h = i >= 6 ? 300 + 40 * u : 250;
      const Hd = this.head(name, col, row, cols, rows, 250);
      const z = 1 + 0.08 * Math.exp(-u / 0.05);
      this.draw(f, Hd, 0, this.at(Hd, i % 2 ? 290 : 200, 280, (h / 250) * z), cam(240, 135));
    });

    // --- 41: the lines meet --------------------------------------------------------
    shot('lines', at(41), at(42), (f, t) => {
      const lt = t - at(41);
      const k = lt / BAR;
      const z = 1 + 0.08 * k;
      const L = this.bufs[2];
      const Rb = this.bufs[3];
      const inL = -90 * (1 - easeOut(lt / 0.16));
      // ours, charging right
      L.set(this.paper);
      const cL = cam(240 + 60 * lt - inL, 135, z, 0);
      this.draw(L, this.L('ridge'), 0, { x: 340, y: 60, ax: 380, ay: 253, scale: 1 }, cL, {
        par: 0.5,
      });
      speedLines(L, W, H, t, { y0: 180, y1: 270, density: 0.3, speed: -900, color: RGB.graphite });
      const A = this.fig('spear', 120);
      for (let i = 0; i < 4; i++)
        this.draw(
          L,
          A,
          1,
          this.at(A, 150 + 60 * lt + i * 40 - 120, 250 + bob(t + i * 0.13, BEAT, 3), 1, 0.04),
          cL,
        );
      const Mr = this.motion('edric_run', 194);
      if (Mr)
        this.draw(L, Mr.layer(Mr.index(lt, { rate: 1.05 })), 0, Mr.place(190 + 100 * lt, 272), cL);
      else {
        const E = this.fig('charge', 190);
        this.draw(L, E, 0, this.at(E, 190 + 100 * lt, 270 + bob(t), 1, 0.05), cL, {
          warp: wind(E, t, 2.5),
        });
      }
      // theirs, marching left, in lockstep
      Rb.set(this.paper);
      const cR = cam(240 - 40 * lt - inL * -1, 135, z, 0);
      this.draw(Rb, this.L('stair'), 0, null, cR, { par: 0.5 });
      const Mm = this.motion('march', 184);
      if (Mm) {
        // the drill: every soldier on the same drawing, a step a beat
        const i = Mm.index(lt, { rate: Mm.n / 12 / (2 * BEAT) });
        for (let k = 2; k >= 0; k--)
          this.draw(
            Rb,
            Mm.layer(i),
            0,
            Mm.place(400 - 70 * lt + k * 56, 272 - k * 10, 1 - k * 0.12),
            cR,
          );
      } else {
        const M = this.fig('march', 180, { flip: true });
        const stomp = -Math.abs(Math.sin((Math.PI * onTwos(lt)) / BEAT)) * 2;
        for (let k = 2; k >= 0; k--)
          this.draw(
            Rb,
            M,
            0,
            this.at(M, 400 - 70 * lt + k * 56, 272 - k * 10 + stomp, 1 - k * 0.12),
            cR,
          );
      }
      const xt = 300;
      const xb = 196;
      copyPanel(
        f,
        L,
        W,
        H,
        [
          [0, 0],
          [xt - 5, 0],
          [xb - 5, H],
          [0, H],
        ],
        2,
      );
      copyPanel(
        f,
        Rb,
        W,
        H,
        [
          [xt + 5, 0],
          [W, 0],
          [W, H],
          [xb + 5, H],
        ],
        2,
      );
      // the Thread is the line between them, taut and humming
      const hum = Math.sin(t * 60) * 1.2 * smooth(0, 0.8, k);
      threadPath(f, W, H, wavePts(xt + hum, -4, xb - hum, H + 4, t * 4, 1.5, 6, 80), 1, {
        spark: false,
      });
    });

    // --- 42: the clash --------------------------------------------------------------
    const clashHits = [at(42), at(42, 2.5), at(42, 3)];
    shot('clash', at(42), at(42, 3), (f, t) => {
      const lt = t - at(42);
      fill(f, hexToRgb('#16131e'));
      const [sx, sy, sr] = shake(
        t,
        clashHits.map((h, i) => [h, i ? 0.5 : 1]),
        9,
        0.14,
        0.02,
      );
      const c = cam(240 + sx, 135 + sy, 1 + 0.05 * easeOut(lt / 0.8), sr);
      focusLines(f, W, H, 244 + sx, 150 + sy, twos(t), {
        inner: 60,
        amount: 0.8,
        color: RGB.graphite,
        width: 7,
        aspect: 1.2,
      });
      let [kx, ky] = [246, 170];
      const Mc = this.motion('clash', 262);
      if (Mc) {
        // the generated exchange: the lunge, blade on spear shaft, the strain
        const i = Mc.index(lt, { mode: 'once', rate: 2.1 });
        const xf = { x: 240, y: 290, ax: Mc.w * 0.53, ay: Mc.h, scale: 1 };
        this.draw(f, Mc.layer(i), 0, xf, c, {
          rim: { ...GOLD_RIM, dir: [0, -1], color: RGB.paperHi },
        });
        [kx, ky] = toScreen(xf, c, Mc.w * 0.53, Mc.h * 0.28);
      } else {
        const push = 10 * smooth(at(42, 2.5), at(42, 2.8), t);
        const E = this.fig('charge', 240);
        this.draw(f, E, 0, this.at(E, 160 - push, 296, 1, 0.14), c, {
          warp: wind(E, t, 3),
          rim: { ...GOLD_RIM, dir: [1, -0.3], color: RGB.paperHi },
        });
        const M = this.fig('march', 250, { flip: true });
        this.draw(f, M, 0, this.at(M, 334 + push, 300, 1, -0.1), c, {
          rim: { ...GOLD_RIM, dir: [-1, -0.3], color: RGB.paperHi },
        });
      }
      sparks(f, W, H, kx, ky, t, at(42) + 0.12, { count: 60, speed: 300, seed: 3 });
      sparks(f, W, H, kx, ky, t, at(42, 2.5), { count: 30, speed: 220, seed: 4 });
      // the shockwave
      const r = 300 * lt;
      if (lt < 0.25)
        for (let a = 0; a < 720; a++) {
          const th = (a / 720) * Math.PI * 2;
          put(f, W, H, kx + Math.cos(th) * r, ky + Math.sin(th) * r * 0.6, RGB.paperHi);
        }
      if (lt < 1 / 24) flash(f, W, H, 1);
      else if (lt < 3 / 24) impact(f, W, H, { mode: 'neg' });
    });

    // --- 42.3: the Hollow Sun opens -------------------------------------------------
    shot('sun', at(42, 3), at(43), (f, t) => {
      const lt = t - at(42, 3);
      const k = lt / 0.8;
      const c = cam(240, 135 - 20 * easeInOut(k), 1 + 0.05 * k, 0.04 * easeInOut(k));
      this.draw(f, this.L('sky'), 0, null, c);
      drain(f, W, H, 0.35 * k);
      const r = 40 + 45 * easeIn(k);
      hollowSunRays(f, W, H, 240, 118, r, t, 0.4 + 0.6 * k);
      hollowSun(f, W, H, 240, 118, r, t, 1);
    });

    // --- 43.1: Edric alone against it -----------------------------------------------
    shot('alone', at(43), at(43, 3), (f, t) => {
      const lt = t - at(43);
      const k = lt / 0.8;
      this.draw(f, this.L('sky'), 0, null, cam(240, 120, 1 + 0.12 * k, 0));
      drain(f, W, H, 0.4);
      const r = 96 + 26 * k; // the dolly: the sun grows, he doesn't
      hollowSunRays(f, W, H, 240, 112, r, t, 0.8);
      hollowSun(f, W, H, 240, 112, r, t, 1);
      ground(f, 238, RGB.ink, 5, 6);
      const Mst = this.motion('edric_stand', 200);
      const sil = { silhouette: RGB.ink, rim: { dir: [0, -1], w: 2, color: RGB.goldHi } };
      if (Mst)
        this.draw(f, Mst.layer(Mst.index(lt + 0.4)), 0, Mst.place(240, 262), cam(240, 135), sil);
      else {
        const E = this.fig('standing', 196);
        this.draw(f, E, 0, this.at(E, 240, 262, 1), cam(240, 135), {
          ...sil,
          warp: wind(E, t, 2, 0.45),
        });
      }
    });

    // --- 43.3: struck; he falls in slow motion --------------------------------------
    const h43 = at(43, 3);
    const jolts = local('snare', 43, 44).filter((x) => x > h43);
    shot('struck', at(43, 3), at(44), (f, t) => {
      const lt = t - h43;
      const [sx, sy] = shake(t, [[h43, 1], ...jolts.map((j) => [j, 0.35])], 6, 0.08);
      const c = cam(240 + sx, 120 + sy, 1.12, 0);
      this.draw(f, this.L('sky'), 0, null, c);
      drain(f, W, H, 0.45);
      hollowSunRays(f, W, H, 240, 112, 124, t, 0.9);
      hollowSun(f, W, H, 240, 112, 124, t, 1);
      speedLines(f, W, H, t, {
        vertical: true,
        density: 0.25,
        speed: -700,
        color: RGB.graphite,
        len: 50,
      });
      ground(f, 244, RGB.ink, 5, 6);
      const Mt = this.motion('edric_tumble', 214);
      if (Mt) {
        // the generated fall: he twists, arms flung out, and lands on his back just as
        // the frame freezes
        const i = Mt.index(lt, { mode: 'once', rate: Mt.n / Mt.meta.fps / 0.78 });
        const xf = Mt.place(236, 264);
        const c2 = cam(240 + sx, 135 + sy);
        if (lt < 0.3) drawSmear(f, W, H, this.paper, Mt.layer(i), 0, xf, c2, {}, 6, -8, 3);
        this.draw(f, Mt.layer(i), 0, xf, c2, { rim: { dir: [0.3, -1], w: 2, color: RGB.goldHi } });
        slash(f, W, H, 380, 40, 110, 230, clamp(lt / (2 / 24)), 22, 7);
        if (lt < 2 / 24) impact(f, W, H, { mode: 'neg', light: RGB.crimson });
        return;
      }
      const Fl = this.fig('falls', 200);
      const v = easeOut(lt / 0.8);
      // pivot at the waist, so he topples where he stood
      const xf = {
        x: 250 - 26 * v,
        y: 150 + 70 * v * v,
        ax: Fl.st.w / 2,
        ay: Fl.st.h * 0.55,
        scale: 1,
        rot: -1.2 * v,
      };
      if (lt < 0.3)
        drawSmear(f, W, H, this.paper, Fl, 0, xf, cam(240 + sx, 135 + sy), {}, 6, -8, 3);
      this.draw(f, Fl, 0, xf, cam(240 + sx, 135 + sy), {
        rim: { dir: [0.3, -1], w: 2, color: RGB.goldHi },
      });
      slash(f, W, H, 380, 40, 110, 230, clamp(lt / (2 / 24)), 22, 7);
      if (lt < 2 / 24) impact(f, W, H, { mode: 'neg', light: RGB.crimson });
    });

    // --- 44: the frame freezes on the hit and cracks --------------------------------
    shot('crack', at(44), at(45), (f, t) => {
      const lt = t - at(44);
      const frozen = this.snapshot('struck', at(44) - 1 / 24);
      const under = this.bufs[3];
      under.set(this.paper);
      drain(under, W, H, 0.5);
      const crack = easeOut((lt - 1 / 24) / 0.35);
      const fall = Math.max(0, t - at(44, 3));
      shatter(f, frozen, under, W, H, 232, 196, crack, fall * 1.4);
      drain(f, W, H, 0.3 + 0.3 * smooth(0, 1.2, lt));
      if (lt < 1 / 24) flash(f, W, H, 1);
    });

    // --- 45: the hymn -----------------------------------------------------------------
    const CARDS = [
      ['charge', at(29, 3)],
      ['ford', at(33, 3.4)],
      ['bridge', at(34, 2.9)],
      ['fens', at(35, 3.4)],
      ['stair', at(36, 2.4)],
      ['army', at(38)],
    ];
    shot('hymn', at(45), at(47), (f, t) => {
      const lt = t - at(45);
      const c = cam(240, 135, 1 + 0.06 * (lt / (2 * BAR)), 0);
      const s = 3 * (1 - step(prog(t, at(45), at(45, 3)), 8));
      this.draw(f, this.L('hymn'), s, null, c);
      const Mk = this.motion('sera_kneel', 156, { tint: [0.84, 0.8, 0.96] });
      let hand;
      if (Mk) {
        // the generated hymn: her hair and robe stir, and her hands rise to hold the thread
        const i = Mk.index(lt, { mode: 'once', rate: Mk.n / Mk.meta.fps / (2 * BAR) });
        const xf = Mk.place(240, 262);
        this.draw(f, Mk.layer(i), Math.max(0, s - 0.5), xf, c);
        const e = Mk.extreme(i, 'right', 0.3, 0.62) || [Mk.w * 0.6, Mk.h * 0.42];
        hand = toScreen(xf, c, e[0] - 2, e[1]);
      } else {
        const Sk = this.fig('seraKneel', 150, { tint: [0.84, 0.8, 0.96] });
        this.draw(f, Sk, Math.max(0, s - 0.5), this.at(Sk, 240, 262, 1), c);
        hand = scr(240 + 0.1 * Sk.st.w, 262 - 0.58 * Sk.st.h, c);
      }
      // the future's pages drift backwards past her
      CARDS.forEach(([name, st], i) => {
        const l = this.snapLayer(name, st, 70 + i);
        const sp = 0.8 + hash(i, 1, 9) * 0.6;
        const x = 420 + i * 120 - lt * 150 * sp;
        const y = 40 + (i % 3) * 70 + Math.sin(lt * 0.9 + i) * 6 - lt * 8;
        const sc = 0.24 + hash(i, 2, 9) * 0.12;
        const xf = { x, y, ax: W / 2, ay: H / 2, scale: sc, rot: Math.sin(lt * 0.5 + i) * 0.12 };
        const stage = 1 + 0.6 * clamp(lt / 3);
        this.draw(f, l, stage, xf, c, { par: 0.7 + sc });
        cardEdge(f, l, xf, parallax(c, 0.7 + sc, W, H));
      });
      drain(f, W, H, 0.45);
      // the thread, from her hands
      const [hx, hy] = hand;
      const p = prog(t, at(45, 2), at(46, 3));
      threadPath(f, W, H, wavePts(hx, hy, -12, 96, t, 8, 1.2), p);
      threadPath(f, W, H, wavePts(hx, hy, 492, 74, t, 8, 1.3, 60, 1.5), p);
      glow(f, W, H, hx, hy, 22, 0.55 + 0.2 * Math.sin(t * 3));
      ash(f, W, H, t, { count: 45, fall: 14, drift: -4, seed: 33 });
    });

    // --- 47: her hands mend the thread ---------------------------------------------
    shot('hands', at(47), at(49), (f, t) => {
      const lt = t - at(47);
      const c = cam(240, 135, 1 + 0.05 * (lt / (2 * BAR)), 0);
      const Mh = this.motion('hands_mend', 270);
      if (Mh) {
        // the generated mend: the loose fibres knot and pull back into one strand, then
        // the hands draw it taut; hold the whole thread and let the light build
        const i = Mh.index(t - at(47, 2), {
          mode: 'once',
          rate: Mh.n / Mh.meta.fps / (at(48, 4) - at(47, 2)),
        });
        this.draw(f, Mh.layer(i), 0, Mh.fill(W, H), c);
        drain(f, W, H, 0.3);
        const taut = smooth(at(48, 3), at(48, 4.5), t);
        glow(f, W, H, 240, 140, 40 + 170 * taut, 0.2 + 0.8 * taut);
        if (taut > 0) star(f, W, H, 240, 140, 6 + 30 * taut, RGB.goldWhite);
        flash(f, W, H, smooth(at(48, 4), at(49), t), RGB.goldWhite);
        return;
      }
      const s2 = 3 * step(prog(t, at(47, 3), at(48)), 8);
      const s1 = 3 * step(prog(t, at(48), at(48, 3)), 8);
      if (t < at(48, 3)) this.draw(f, this.L('hands1'), 0, null, c);
      if (t >= at(48)) this.draw(f, this.L('hands0'), 0, null, c);
      if (t < at(48, 3)) this.draw(f, this.L('hands1'), s1, null, c);
      if (t < at(48)) this.draw(f, this.L('hands2'), s2, null, c);
      drain(f, W, H, 0.35);
      const [ax, ay] = scr(72, 133, c);
      const [bx, by] = scr(404, 133, c);
      if (t < at(48)) {
        // loose fibres drifting where it frayed
        const [fx, fy] = scr(221, 133, c);
        for (let k = 0; k < 10; k++)
          star(
            f,
            W,
            H,
            fx + (hash(k, 1, 5) - 0.5) * 60,
            fy + (hash(k, 2, 5) - 0.5) * 20,
            hash(k, twos(t), 6) < 0.5 ? 1.5 : 0.5,
            RGB.goldHi,
          );
      } else {
        const p = prog(t, at(48), at(48, 3));
        const taut = smooth(at(48, 3), at(48, 4.5), t);
        threadPath(f, W, H, wavePts(ax, ay, bx, by, t, 2 * (1 - taut), 1), p);
        glow(f, W, H, (ax + bx) / 2, ay, 40 + 160 * taut, 0.25 + 0.75 * taut);
      }
      flash(f, W, H, smooth(at(48, 4), at(49), t), RGB.goldWhite);
    });

    // --- 49: the rewind: the book riffles back to the camp --------------------------
    // each page plays its shot BACKWARDS from this moment, faster page by page: Edric
    // gets up from his falls and runs back, the snapped thread rejoins, the army
    // un-gathers, and the book turns back to the camp
    const PAGES = [
      ['hands', at(48, 3.5)],
      ['stair', at(36, 4.5)],
      ['fens', at(35, 4.5)],
      ['bridge', at(34, 4.5)],
      ['ford', at(33, 4.5)],
      ['army', at(38, 4.5)],
      ['run', at(32, 3.8)],
      ['fray', at(31, 4.9)],
      ['eye', at(30, 4.9)],
      ['hilt', at(30, 2.9)],
      ['charge', at(29, 4.9)],
      ['seraEyes', at(28, 2.9)],
      ['camp', at(51)],
    ];
    const SLOTS = [1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    shot('rewind', at(49), at(51), (f, t) => {
      let t0 = at(49);
      let k = 0;
      while (k < SLOTS.length - 1 && t >= t0 + SLOTS[k] * BEAT) t0 += SLOTS[k++] * BEAT;
      const dur = SLOTS[k] * BEAT;
      const u = (t - t0) / dur;
      // page j, `tau` s after it came up: its shot running in reverse, losing its paint
      const page = (j, buf, tau) => {
        const [name, ref] = PAGES[j];
        const idx = this.shots.findIndex((sh) => sh.name === name);
        const sh = this.shots[idx];
        const rate = 1.2 + 0.4 * j;
        const tt = name === 'camp' ? ref : Math.max(sh.from, ref - rate * Math.max(0, tau));
        this.drawShot(buf, idx, tt);
        if (name !== 'camp')
          stripLive(
            buf,
            this.paper,
            W,
            H,
            Math.min(0.9, 0.06 * j + 0.25 * clamp(tau / 0.8)),
            7 + j,
          );
      };
      const A = this.bufs[2];
      const B = this.bufs[3];
      page(k, A, t - t0);
      const jolt = t - t0 < 1 / 24 ? 2 : 0;
      if (u < 0.3) f.set(A);
      else {
        page(k + 1, B, 0);
        pageTurn(f, A, B, W, H, easeInOut((u - 0.3) / 0.7), { dir: 'back', tilt: 0.28 });
      }
      if (jolt) f.copyWithin(0, W * 4 * jolt);
      flakes(f, W, H, A, t, t0, t0 + dur, { count: 70, vx: -300, vy: -40, seed: 12 + k });
    });

    // --- 51: the camp, stripped back to paper ---------------------------------------
    shot('camp', at(51), at(52), (f, t) => this.camp(f, t));

    // --- 52: bare paper; the last shot inks itself in -------------------------------
    shot('inkin', at(52), at(53), (f, t) => {
      thread(f, W, H, -10, 490, 118, 10, t, 1, 0.3);
      const u = step(prog(t, at(52, 1.5), at(52, 4.5)), 6);
      const Mf = this.motion('edric_looks_up', 270);
      if (t >= at(52, 1.5)) {
        if (Mf) this.draw(f, Mf.layer(0), 3 - 2 * u, Mf.fill(W, H));
        else this.draw(f, this.L('final'), 3 - 2 * u);
      }
    });

    // --- 53: full colour, on the downbeat: Edric looks up ---------------------------
    shot('final', at(53), at(55), (f, t) => {
      const lt = t - at(53);
      const c = cam(
        240,
        135,
        1 + 0.04 * easeOut(lt / (2 * BAR)) + 0.03 * pulse(t, [at(53)], 0.2),
        0,
      );
      const Mf = this.motion('edric_looks_up', 270);
      // the generated shot: he lifts his eyes to the camera; firelight and embers move
      if (Mf)
        this.draw(
          f,
          Mf.layer(Mf.index(lt, { mode: 'once', rate: Mf.n / Mf.meta.fps / (2 * BAR) })),
          0,
          Mf.fill(W, H),
          c,
        );
      else this.draw(f, this.L('final'), 0, null, c);
      fireLight(f, W, H, 240, 300, 170, 0.35, t);
      embers(f, W, H, 250, 285, t, { count: 45, spread: 260, rise: 42, period: 0.06, life: 4 });
      if (lt < 1 / 24) flash(f, W, H, 0.6);
    });

    // --- 55: the Hollow Sun; ROGUE DAWN ---------------------------------------------
    shot('title', at(55), DURATION, (f, t) => {
      this.draw(f, this.L('titleSky'), 0);
      const t0 = at(55);
      hollowSun(f, W, H, 330, 84, 38, t, smooth(t0, t0 + BEAT, t));
      drawTitle(f, W, H, this.title, 172, 152, prog(t, at(55, 2), at(56, 1)));
      const Ms = this.motion('edric_stand', 294, { tint: [0.78, 0.74, 0.88] });
      if (Ms) this.draw(f, Ms.layer(Ms.index(t - at(55))), 0, Ms.place(62, 300));
      else {
        const E = this.fig('standing', 290, { tint: [0.78, 0.74, 0.88] });
        this.draw(f, E, 0, this.at(E, 78, 300, 1), null, { warp: wind(E, t, 1.5) });
      }
      thread(f, W, H, 172, 490, 204, 4, t, prog(t, at(56, 1), at(56, 4)), 1.2);
    });

    return S;
  }

  // ------------------------------------------------------------------ shot bodies

  panelLayer(i) {
    return this.plate(`panel${i}`, this.img.fray, {
      w: 160,
      h: 282,
      crop: { x: i * 512, y: 40, w: 512, h: 900 },
      seed: 50 + i,
      skin: true,
    });
  }

  /** One of Edric's falls. Each is painted over the ink of the ones before. */
  fall(f, t, F, ALL) {
    const t0 = at(F.bar);
    const lt = t - t0;
    const hit = F.hitT;
    const end = at(F.bar + 1);
    const [sx, sy, sr] = shake(
      t,
      [[hit, F.big ? 1 : 0.6]],
      F.big ? 9 : 5,
      0.16,
      F.big ? 0.02 : 0.01,
    );
    const z = F.z + 0.04 * (lt / BAR) + (F.big ? 0.1 * pulse(t, [hit], 0.2) : 0);
    const c = cam(240 + sx, 135 + sy, z, F.rot + sr);
    // the paint goes on over the old drawing, then comes off again after the blow
    let s = 1 - step(lt / 0.18, 3);
    const lift = Math.max(hit + 0.25, end - BEAT);
    if (t > lift) s = step((t - lift) / (end - lift), 4);
    this.draw(f, this.L(F.name), s, null, c);
    for (const g of F.ghosts)
      this.draw(f, this.snapLayer(g.name, g.hitT + 0.25, 90), 1, null, c, {
        inkOnly: true,
        opacity: 0.22,
      });
    // Edric
    const [x0, y0, s0] = F.from;
    const [x1, y1, s1] = F.to;
    const cs = cam(240 + sx, 135 + sy, 1 + (z - F.z), sr); // figures don't take the plate's build zoom
    if (t < hit) {
      const u = clamp((t - t0) / (hit - t0));
      const Mr = this.motion('edric_run', 152);
      if (Mr) {
        const i = Mr.index(lt + F.bar * 0.13, { rate: 1.05 });
        this.draw(
          f,
          Mr.layer(i),
          0,
          Mr.place(lerp(x0, x1, u), lerp(y0, y1, u) + 2, lerp(s0, s1, u), 0.02),
          cs,
        );
      } else {
        const E = this.fig('charge', 150);
        const xf = this.at(
          E,
          lerp(x0, x1, u),
          lerp(y0, y1, u) + bob(t, BEAT, 3),
          lerp(s0, s1, u),
          0.05,
        );
        this.draw(f, E, 0, xf, cs, { warp: wind(E, t, 2) });
      }
      if (F.fx === 'water')
        for (let i = 0; i < 4; i++)
          splash(
            f,
            W,
            H,
            lerp(x0, x1, clamp(i * 0.3)) - 10,
            lerp(y0, y1, clamp(i * 0.3)),
            t,
            t0 + i * BEAT,
            { count: 18, speed: 90, seed: i + F.bar, spread: 0.7, life: 0.6 },
          );
    } else {
      const v = t - hit;
      const Mf = this.motion('edric_fall', 156);
      if (Mf) {
        // the generated fall: he staggers, his legs go, he drops to his knees
        const i = Mf.index(v, { mode: 'once', rate: 2.2 });
        const xf = Mf.place(x1 - 6, y1 + 2, s1);
        if (v < 0.2) drawSmear(f, W, H, this.paper, Mf.layer(i), 0, xf, cs, {}, -8, 4, 3);
        this.draw(f, Mf.layer(i), 0, xf, cs);
      } else {
        const k = easeOut(v / 0.9);
        const Fl = this.fig('falls', 150);
        const xf = this.at(Fl, x1 - 28 * k, y1 + 6 * k, s1, -0.7 * k);
        if (v < 0.25) drawSmear(f, W, H, this.paper, Fl, 0, xf, cs, {}, -8, 5, 3);
        this.draw(f, Fl, 0, xf, cs);
      }
      slash(f, W, H, x1 + 120, y1 - 190 * s1, x1 - 90, y1 - 10, clamp(v / (2 / 24)), 18, F.bar);
      if (F.fx === 'water')
        splash(f, W, H, x1 - 30, y1, t, hit + 0.45, { count: 60, speed: 160, seed: F.bar * 3 });
      if (F.fx === 'dust')
        splash(f, W, H, x1 - 30, y1, t, hit + 0.4, {
          count: 40,
          speed: 110,
          seed: F.bar * 3,
          colors: [RGB.graphite, hexToRgb('#a09e9f')],
          gravity: 200,
        });
      if (F.big && v < 0.45)
        focusLines(f, W, H, x1, y1 - 70, twos(t), {
          inner: 90,
          amount: 0.8,
          width: 7,
          aspect: 1.3,
        });
      if (v < (F.big ? 3 : 2) / 24) impact(f, W, H, { mode: 'neg', light: RGB.crimson });
    }
    if (F.fx === 'ash') ash(f, W, H, t, { count: 60, drift: -40, fall: 30, seed: F.bar });
    if (lt < 1 / 24) flash(f, W, H, 0.4);
    // stair: on the drum fill, every fall at once
    if (F.echo) {
      const fills = local('snare', F.bar, F.bar + 1).filter((x) => x >= at(F.bar, 4));
      fills.forEach((h, i) => {
        if (t >= h && t < h + 2 / 24) {
          // the frozen moment of each earlier fall, one after another
          const g = ALL[i % ALL.length];
          f.set(this.snapshot(g.name, g.hitT + 0.25));
          if (t < h + 1 / 24) flash(f, W, H, 0.35);
        }
      });
    }
  }

  /** The camp at the fire (the night before), stripped to paper beat by beat. */
  camp(f, t) {
    const t0 = at(51);
    const b = Math.floor((t - t0) / BEAT);
    const fr = ((t - t0) / BEAT) % 1;
    const stepAt = (lead, beats) =>
      t < t0 ? 0 : clamp((b - lead + smooth(0, 0.3, fr)) / beats) * 3;
    const sFig = stepAt(1, 2);
    const sPlate = stepAt(1, 3);
    const oy = t >= t0 && fr < 0.12 && b > 0 ? 2 : 0;
    const c = cam(240, 135 + oy, 1, 0);
    this.draw(f, this.L('camp'), sPlate, null, c);
    const figs = [
      ['seraCamp', 124, 106, false],
      ['edricCamp', 124, 317, false],
      ['kiraCamp', 134, 422, true],
    ];
    for (const [n, h, x, flip] of figs) {
      const l = this.fig(n, h, { flip, tint: NIGHT });
      this.draw(f, l, sFig, this.at(l, x, 268, 1), c);
    }
    const lit = 1 - clamp(sPlate / 1.2);
    fireLight(f, W, H, 228, 164 - oy, 95, 0.55 * lit, t);
    if (lit > 0) embers(f, W, H, 228, 150 - oy, t, { count: 30 * lit });
    const bare = clamp((sPlate - 1.8) / 1.2);
    if (bare > 0) thread(f, W, H, -10, 490, 118, 10, t, bare, 0.3);
  }
}

export const SHOTS_OF = (p) => p.shots.map((s) => ({ name: s.name, from: s.from, to: s.to }));
