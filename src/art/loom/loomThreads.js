// loomThreads.js — canvas renderer for the Loom route map (approved study:
// docs/art-direction/board/loom). DOM buttons carry the nodes (focus, aria, 44px hit
// areas); this module only paints what sits under them:
//   weave layer (static, redrawn on layout/selection change): vellum ground, warp
//     lanes, threads (woven rope, live glow, quiet futures, frayed cuts), the elite
//     fracture, the future dissolve dither, the row ruler and the Hollow Sun corona.
//   fx layer (animated, cheap): glints travelling toward each choice, the taut core of
//     the selected thread, and Sera's vision dashes toward an inspected future.
// Pure Canvas2D, no DOM lookups; palette values are art ramps (ART_BIBLE.md).

export const LOOM_RAMP = Object.freeze({
  ink0: '#07060b',
  ink1: '#0e0c14',
  ink3: '#211d2b',
  ink4: '#2e293a',
  ink6: '#58505e',
  ink7: '#766b77',
  gold0: '#2a170e',
  gold1: '#4f2c16',
  gold2: '#80461f',
  gold3: '#b3702c',
  gold4: '#dca044',
  gold5: '#f3cb6c',
  gold6: '#fff0bd',
  blood3: '#9e2632',
  blood4: '#cc4038',
});
const C = LOOM_RAMP;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hashString = (s) =>
  [...String(s)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

const hexRgb = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/**
 * Sample a horizontal-tangent S-curve between two node centres, trimmed at the medal
 * rims. Each sample carries its arc length `s`, unit tangent and normal.
 */
export function samplePath(a, b, ra, rb, samples = 64) {
  const mx = (b.x - a.x) * 0.52;
  const p1 = { x: a.x + mx, y: a.y };
  const p2 = { x: b.x - mx, y: b.y };
  const pts = [];
  for (let i = 0; i <= samples; i++) pts.push(bezier(a, p1, p2, b, i / samples));
  const kept = pts.filter(
    (p) => Math.hypot(p.x - a.x, p.y - a.y) > ra && Math.hypot(p.x - b.x, p.y - b.y) > rb,
  );
  let s = 0;
  return kept.map((p, i) => {
    if (i) s += Math.hypot(p.x - kept[i - 1].x, p.y - kept[i - 1].y);
    const q = kept[Math.min(i + 1, kept.length - 1)];
    const r = kept[Math.max(i - 1, 0)];
    const tx = q.x - r.x;
    const ty = q.y - r.y;
    const len = Math.hypot(tx, ty) || 1;
    return { x: p.x, y: p.y, s, nx: -ty / len, ny: tx / len, tx: tx / len, ty: ty / len };
  });
}

export function pathLength(pts) {
  return pts.length ? pts[pts.length - 1].s : 0;
}

export function pointAt(pts, s) {
  for (let i = 1; i < pts.length; i++)
    if (pts[i].s >= s) {
      const a = pts[i - 1];
      const b = pts[i];
      const k = (s - a.s) / (b.s - a.s || 1);
      return {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        tx: b.tx,
        ty: b.ty,
        nx: b.nx,
        ny: b.ny,
      };
    }
  return pts[pts.length - 1];
}

function strand(ctx, pts, offset, from = 0, to = Infinity) {
  ctx.beginPath();
  let started = false;
  for (const p of pts) {
    if (p.s < from || p.s > to) continue;
    const o = offset(p.s);
    const x = p.x + p.nx * o;
    const y = p.y + p.ny * o;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// A plied rope: dark underlay, body, diagonal ply hatch and a thin sheen.
function rope(ctx, pts, o) {
  if (pts.length < 2) return;
  const len = pathLength(pts);
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = o.under;
  ctx.lineWidth = o.w + 2;
  strand(ctx, pts, () => 0);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = o.body;
  ctx.lineWidth = o.w;
  strand(ctx, pts, () => 0);
  ctx.strokeStyle = o.hatch;
  ctx.lineWidth = 1;
  const h = o.w / 2 - 0.2;
  for (let s = 1.5; s < len - 1; s += 3) {
    const p = pointAt(pts, s);
    ctx.beginPath();
    ctx.moveTo(p.x + p.nx * h - p.tx * 1.1, p.y + p.ny * h - p.ty * 1.1);
    ctx.lineTo(p.x - p.nx * h + p.tx * 1.1, p.y - p.ny * h + p.ty * 1.1);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = o.sheen;
  ctx.lineWidth = 0.7;
  strand(ctx, pts, () => -h * 0.55);
  ctx.restore();
}

// The Lieutenant's mark: a clean break just before an elite medal, bridged by one
// crimson kink.
function fracture(ctx, pts) {
  if (pts.length < 2) return;
  const len = pathLength(pts);
  const s0 = Math.max(0, len - 15);
  const s1 = Math.max(0, len - 5);
  const a = pointAt(pts, s0);
  const b = pointAt(pts, s1);
  ctx.save();
  ctx.strokeStyle = C.ink1;
  ctx.lineWidth = 6;
  ctx.lineCap = 'butt';
  strand(ctx, pts, () => 0, s0, s1);
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.blood4;
  ctx.lineWidth = 1.4;
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(m.x + a.nx * 2.6 - a.tx, m.y + a.ny * 2.6 - a.ty);
  ctx.lineTo(m.x - a.nx * 2.6 + a.tx, m.y - a.ny * 2.6 + a.ty);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

const FRAY_DASHES = [
  [3.2, 2],
  [2.4, 2.4],
  [1.6, 2.8],
  [0.9, 3.2],
];

function drawThread(ctx, kind, pts, { seedKey, fade = 1, elite = false }) {
  const r = mulberry32(hashString(seedKey));
  const ph = r() * 6.28;
  const len = pathLength(pts);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'woven') {
    // Settled gold: a plied rope, no glow.
    rope(ctx, pts, { under: C.ink0, body: C.gold1, hatch: C.gold3, sheen: C.gold4, w: 3.4 });
    return;
  }
  if (kind === 'live') {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = C.gold4;
    ctx.shadowColor = C.gold4;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 5;
    strand(ctx, pts, () => 0);
    ctx.restore();
    rope(ctx, pts, { under: C.gold0, body: C.gold3, hatch: C.gold5, sheen: C.gold6, w: 3 });
    if (elite) fracture(ctx, pts);
    return;
  }
  if (kind === 'future') {
    // Undyed possibility: one thin grey thread with a faint body.
    const wob = (s) => 0.5 * Math.sin(s * 0.16 + ph);
    ctx.globalAlpha = 0.55 * fade;
    ctx.strokeStyle = C.ink3;
    ctx.lineWidth = 3;
    strand(ctx, pts, wob);
    ctx.globalAlpha = 0.72 * fade;
    ctx.strokeStyle = C.ink7;
    ctx.lineWidth = 1.1;
    strand(ctx, pts, wob);
    ctx.globalAlpha = 1;
    return;
  }
  // Cut: the thread frays into shortening fibres and parts in the middle.
  const mid = len * (0.42 + r() * 0.16);
  const gap = 4 + r() * 3;
  const wob = (s) => 0.6 * Math.sin(s * 0.2 + ph);
  ctx.strokeStyle = C.ink6;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.8 * fade;
  const reach = FRAY_DASHES.reduce((t, [d, g]) => t + d + g, 0);
  const sL = mid - gap / 2;
  const sR = mid + gap / 2;
  strand(ctx, pts, wob, 0, sL - reach);
  strand(ctx, pts, wob, sR + reach, Infinity);
  let a = sL - reach;
  let b = sR + reach;
  for (const [d, g] of FRAY_DASHES) {
    strand(ctx, pts, wob, a + g, a + g + d);
    strand(ctx, pts, wob, b - g - d, b - g);
    a += d + g;
    b -= d + g;
  }
  ctx.globalAlpha = 1;
}

function pixelLayer(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(c.width, c.height);
  paint(img.data, c.width, c.height);
  ctx.putImageData(img, 0, 0);
  return c;
}

const radiusOf = (node, medal) => (node?.type === 'boss' ? medal + 8 : medal) / 2 + 5;

/**
 * Paint the static weave. Returns the sampled thread paths for the fx layer.
 * @param {CanvasRenderingContext2D} ctx  sized to innerW x height at `dpr`
 */
export function drawLoomWeave(ctx, { model, layout, positions, dpr = 1, seed = 1, fontReady }) {
  const W = layout.innerW;
  const H = layout.height;
  const { medal } = layout;
  const byId = model.byId;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);

  // 1. vellum ground with a faint ember pool where the party stands
  ctx.fillStyle = C.ink1;
  ctx.fillRect(0, 0, W, H);
  const startPos = positions.get(model.startId) || { x: layout.padL, y: layout.y(2) };
  const here = model.current
    ? positions.get(model.current)
    : { x: layout.padL - 30, y: startPos.y };
  const pool = ctx.createRadialGradient(
    here.x,
    here.y,
    0,
    here.x,
    here.y,
    Math.max(220, layout.dx * 3.2),
  );
  pool.addColorStop(0, 'rgba(128,70,31,0.16)');
  pool.addColorStop(0.45, 'rgba(79,44,22,0.07)');
  pool.addColorStop(1, 'rgba(14,12,20,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, W, H);

  // 2. star/vellum grain at 1 CSS px
  const rand = mulberry32(seed * 7919);
  const t3 = hexRgb(C.ink3);
  const t4 = hexRgb(C.ink4);
  const t6 = hexRgb(C.ink6);
  ctx.drawImage(
    pixelLayer(Math.ceil(W), Math.ceil(H), (d, w, h) => {
      for (let i = 0; i < w * h; i++) {
        const v = rand();
        const col = v < 0.0009 ? t6 : v < 0.006 ? t4 : v < 0.03 ? t3 : null;
        if (!col) continue;
        d[i * 4] = col[0];
        d[i * 4 + 1] = col[1];
        d[i * 4 + 2] = col[2];
        d[i * 4 + 3] = v < 0.0009 ? 200 : 150;
      }
    }),
    0,
    0,
    Math.ceil(W),
    Math.ceil(H),
  );

  // 3. warp: the generator lanes are the loom's standing threads
  ctx.strokeStyle = C.ink3;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.9;
  ctx.setLineDash([3, 2]);
  for (let lane = 0; lane < 5; lane++) {
    const y = Math.round(layout.y(lane)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(6, y);
    ctx.lineTo(W - 6, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // 4. threads — fraying first, gold last so the player's path always sits on top
  const order = { cut: 0, future: 1, woven: 2, live: 3 };
  const paths = new Map();
  const sorted = [...model.edges].sort((p, q) => order[p.kind] - order[q.kind]);
  for (const e of sorted) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    const pts = samplePath(
      positions.get(e.from),
      positions.get(e.to),
      radiusOf(a, medal),
      radiusOf(b, medal),
    );
    paths.set(`${e.from}>${e.to}`, pts);
  }
  const edgeStyle = (e) => ({
    seedKey: e.from + e.to,
    fade: model.rowFade(byId.get(e.to).row),
    elite: byId.get(e.to)?.type === 'battle' && !!byId.get(e.to)?.battleParams?.isElite,
  });
  for (const e of sorted)
    if (e.kind !== 'live') drawThread(ctx, e.kind, paths.get(`${e.from}>${e.to}`), edgeStyle(e));
  const leadPts = model.startId
    ? samplePath({ x: -8, y: startPos.y }, startPos, 0, radiusOf(byId.get(model.startId), medal))
    : [];
  if (leadPts.length)
    drawThread(ctx, model.leadKind, leadPts, {
      seedKey: `lead${model.startId}`,
      elite: !!byId.get(model.startId)?.battleParams?.isElite,
    });
  for (const e of sorted)
    if (e.kind === 'live') drawThread(ctx, 'live', paths.get(`${e.from}>${e.to}`), edgeStyle(e));

  // 5. the far end dissolves (ordered dither + soft gradient)
  const x0 = layout.x(model.dissolveRow) - layout.dx * 0.5;
  if (x0 < W) {
    const ink0 = hexRgb(C.ink0);
    ctx.drawImage(
      pixelLayer(Math.ceil(W), Math.ceil(H), (d, w, h) => {
        for (let y = 0; y < h; y++)
          for (let x = Math.max(0, Math.floor(x0)); x < w; x++) {
            const k = Math.min(0.62, ((x - x0) / Math.max(80, w - x0)) * 0.8);
            if (k * 64 > BAYER8[(x & 7) + (y & 7) * 8]) {
              const i = (y * w + x) * 4;
              d[i] = ink0[0];
              d[i + 1] = ink0[1];
              d[i + 2] = ink0[2];
              d[i + 3] = 255;
            }
          }
      }),
      0,
      0,
      Math.ceil(W),
      Math.ceil(H),
    );
    const g = ctx.createLinearGradient(Math.max(0, x0), 0, W, 0);
    g.addColorStop(0, 'rgba(7,6,11,0)');
    g.addColorStop(1, 'rgba(7,6,11,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(Math.max(0, x0), 0, W - Math.max(0, x0), H);
  }

  // 6. heddle ruler: row numerals above the dissolve so progress stays legible
  if (fontReady !== false) {
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let row = 0; row < model.rows; row++) {
      const x = layout.x(row);
      const doneRow = row <= model.frontierRow;
      const nextRow = row === model.frontierRow + 1;
      ctx.fillStyle = nextRow ? C.gold5 : doneRow ? C.gold2 : C.ink6;
      ctx.globalAlpha = nextRow || doneRow ? 1 : Math.max(0.5, model.rowFade(row));
      ctx.fillText(ROMAN[row] || String(row + 1), x, layout.numeralY);
      ctx.fillRect(Math.round(x) - 0.5, layout.tickY, 1, nextRow ? 4 : 2);
    }
    ctx.globalAlpha = 1;
  }

  // 7. the Hollow Sun: black eclipse with a gold corona at the act's end
  const boss = model.bossId ? positions.get(model.bossId) : null;
  if (boss) {
    const k = (medal + 8) / 48;
    const r0 = 22 * k;
    const r1 = 27 * k;
    const rMax = 78 * k;
    const cor = ctx.createRadialGradient(boss.x, boss.y, r0, boss.x, boss.y, rMax);
    cor.addColorStop(0, 'rgba(255,240,189,0.45)');
    cor.addColorStop(0.08, 'rgba(243,203,108,0.26)');
    cor.addColorStop(0.3, 'rgba(179,112,44,0.13)');
    cor.addColorStop(0.65, 'rgba(79,44,22,0.05)');
    cor.addColorStop(1, 'rgba(7,6,11,0)');
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.arc(boss.x, boss.y, rMax, 0, Math.PI * 2);
    ctx.fill();
    const rr = mulberry32(hashString(model.bossId));
    ctx.lineCap = 'round';
    for (let i = 0; i < 36; i++) {
      const ang = (i / 36) * Math.PI * 2 + rr() * 0.08;
      const r2 = (34 + rr() * (i % 3 ? 10 : 22)) * k;
      ctx.strokeStyle = i % 3 ? C.gold3 : C.gold4;
      ctx.globalAlpha = i % 3 ? 0.16 : 0.26;
      ctx.lineWidth = i % 3 ? 0.8 : 1;
      ctx.beginPath();
      ctx.moveTo(boss.x + Math.cos(ang) * r1, boss.y + Math.sin(ang) * r1);
      ctx.lineTo(boss.x + Math.cos(ang) * r2, boss.y + Math.sin(ang) * r2);
      ctx.stroke();
    }
    // two crimson fractures across the corona
    ctx.strokeStyle = C.blood3;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    for (const base of [-0.9, 2.3]) {
      ctx.beginPath();
      let rad = r1;
      let ang = base;
      ctx.moveTo(boss.x + Math.cos(ang) * rad, boss.y + Math.sin(ang) * rad);
      for (let s = 0; s < 4; s++) {
        rad += (4 + rr() * 4) * k;
        ang += (s % 2 ? 1 : -1) * (0.06 + rr() * 0.06);
        ctx.lineTo(boss.x + Math.cos(ang) * rad, boss.y + Math.sin(ang) * rad);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  return { paths, leadPts };
}

/**
 * Paint one frame of the fx layer. `timeMs` is ignored under reduced motion (a single
 * static glint per thread and still dashes).
 */
export function drawLoomFx(
  ctx,
  { model, layout, paths, leadPts, selectedId, dpr = 1, timeMs = 0, reduced = false },
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.innerW, layout.height);
  const t = reduced ? 0 : timeMs / 1000;

  // Vision: every thread on a route from the party to the inspected future.
  const vision = selectedId ? model.visionEdges(selectedId) : [];
  if (vision.length) {
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.lineDashOffset = reduced ? 0 : -t * 9;
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.gold5;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.5;
    for (const e of vision) {
      const pts = paths.get(`${e.from}>${e.to}`);
      if (pts?.length) strand(ctx, pts, () => 0);
    }
    ctx.restore();
  }

  // Glints travel from the party toward each reachable choice.
  const glints = model.edges
    .filter((e) => e.kind === 'live')
    .map((e) => ({ pts: paths.get(`${e.from}>${e.to}`), selected: e.to === selectedId }));
  if (model.leadKind === 'live' && leadPts?.length)
    glints.push({ pts: leadPts, selected: selectedId === model.startId });
  glints.forEach((g, i) => {
    if (!g.pts?.length) return;
    const len = pathLength(g.pts);
    if (g.selected) {
      // the chosen thread is pulled taut: a bright core
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = C.gold6;
      ctx.lineWidth = 1;
      strand(ctx, g.pts, () => 0);
    }
    const period = g.selected ? 1.9 : 2.8;
    const count = g.selected ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const u = reduced ? 0.55 : (((t / period + i * 0.37 + k / count) % 1) + 1) % 1;
      const p = pointAt(g.pts, u * len);
      const a = Math.sin(Math.PI * u);
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7);
      grd.addColorStop(0, `rgba(255,240,189,${0.9 * a})`);
      grd.addColorStop(0.35, `rgba(243,203,108,${0.35 * a})`);
      grd.addColorStop(1, 'rgba(243,203,108,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 7, 3, Math.atan2(p.ty, p.tx), 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.globalAlpha = 1;
}

/** True when the fx layer has anything that moves (live glints or a vision trace). */
export function loomFxAnimates(model, selectedId) {
  return (
    model.leadKind === 'live' ||
    model.edges.some((e) => e.kind === 'live') ||
    (selectedId != null && model.visionEdges(selectedId).length > 0)
  );
}
