/* The Loom — node-map redesign mockup.
 * Renders window.LOOM_DATA (a real NodeMapGenerator graph, see gen/generate-graph.mjs).
 * Canvas draws the weave (backdrop + threads); DOM buttons carry the nodes, exactly as
 * RouteGraph.js does today, so hit-testing, focus and aria stay in the DOM.
 *
 * Query params: ?state=start|choice|mid|future|cut  ?sel=<nodeId>  ?frame=desktop  ?motion=0
 */
(function () {
  'use strict';
  const D = window.LOOM_DATA;
  const qs = new URLSearchParams(location.search);
  const stateKey = D.states[qs.get('state')] ? qs.get('state') : 'choice';
  const S = D.states[stateKey];
  const desktop = qs.get('frame') === 'desktop';
  const reduceMotion =
    qs.get('motion') === '0' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const C = {
    ink0: '#07060b',
    ink1: '#0e0c14',
    ink2: '#16131e',
    ink3: '#211d2b',
    ink4: '#2e293a',
    ink5: '#403949',
    ink6: '#58505e',
    ink7: '#766b77',
    ink8: '#978b94',
    ink9: '#bdb0aa',
    gold0: '#2a170e',
    gold1: '#4f2c16',
    gold2: '#80461f',
    gold3: '#b3702c',
    gold4: '#dca044',
    gold5: '#f3cb6c',
    gold6: '#fff0bd',
    blood1: '#44111c',
    blood2: '#6e1a28',
    blood3: '#9e2632',
    blood4: '#cc4038',
    blood5: '#ec7a5c',
  };

  // ── Real node art: NodeArt.js atlas rects (source px on the 1254² sheet). The mockup
  // ships a 1/3-scale copy of weathered-nodes.png; background-size maps it back 1:1.
  const NODE_ART_RECTS = [
    [40, 96, 350, 326],
    [444, 76, 370, 354],
    [849, 48, 370, 382],
    [28, 474, 384, 332],
    [438, 472, 378, 334],
    [858, 536, 354, 270],
    [25, 879, 389, 322],
    [445, 857, 376, 344],
    [827, 806, 404, 416],
  ];
  const FRAMES = { battle: 0, church: 1, boss: 2, shop: 3, ruins: 4, recruit: 5, colosseum: 6 };
  const frameOf = (n) =>
    n.type === 'boss' && D.actId === 'finalBoss' ? 8 : n.elite ? 7 : (FRAMES[n.type] ?? 0);
  function nodeArt(index, size) {
    const [x, y, w, h] = NODE_ART_RECTS[index] || NODE_ART_RECTS[0];
    const k = size / Math.max(w, h);
    const el = document.createElement('span');
    el.className = 'icon';
    el.style.width = `${w * k}px`;
    el.style.height = `${h * k}px`;
    el.style.backgroundSize = `${1254 * k}px ${1254 * k}px`;
    el.style.backgroundPosition = `${-x * k}px ${-y * k}px`;
    return el;
  }

  // ── Topology: derived exactly like RunManager.getAvailableNodes + a forward BFS.
  const byId = Object.fromEntries(D.nodes.map((n) => [n.id, n]));
  const completed = new Set(S.completed);
  const current = S.current;
  const available = new Set(current == null ? [D.startNodeId] : byId[current].edges);
  const steps = new Map(); // node id -> steps from the party (1 = next)
  {
    let frontier = [...available];
    let d = 1;
    while (frontier.length) {
      const next = [];
      for (const id of frontier) {
        if (steps.has(id)) continue;
        steps.set(id, d);
        next.push(...byId[id].edges);
      }
      frontier = next;
      d++;
    }
  }
  const frontierRow = current == null ? -1 : byId[current].row;
  function nodeState(n) {
    if (n.id === current) return 'current';
    if (completed.has(n.id)) return 'done';
    if (available.has(n.id)) return 'live';
    if (steps.has(n.id)) return 'future';
    return 'cut';
  }
  function edgeKind(a, b) {
    if (completed.has(a.id) && completed.has(b.id)) return 'woven';
    if (a.id === current && available.has(b.id)) return 'live';
    if ((available.has(a.id) || steps.has(a.id)) && steps.has(b.id)) return 'future';
    return 'cut';
  }
  const edges = [];
  for (const a of D.nodes)
    for (const id of a.edges) edges.push({ a, b: byId[id], kind: edgeKind(a, byId[id]) });

  // Which nodes can reach `target` (for the vision preview of a future selection).
  function canReach(target) {
    const set = new Set([target]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of D.nodes)
        if (!set.has(n.id) && n.edges.some((e) => set.has(e))) {
          set.add(n.id);
          grew = true;
        }
    }
    return set;
  }

  // ── DOM refs
  const $ = (id) => document.getElementById(id);
  const screen = $('screen');
  const wrap = $('loom-wrap');
  const loom = $('loom');
  const inner = $('loom-inner');
  const weave = $('weave');
  const fx = $('fx');
  if (desktop) screen.classList.add('is-desktop');

  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  // Proposed display titles (Cinzel). act1 uses the lore-guide canon "border quarries";
  // the others read regions.json. See README → "maps to real data".
  const ACT_TITLES = {
    act1: 'The Border Quarries',
    act2: 'The Old Kingdom Roads',
    act3: 'The Imperial Heartland',
    act4: 'The Ashen Frontier',
    finalBoss: 'The Imperial Seat',
  };
  $('act-title').innerHTML =
    `<span class="act">Act ${ROMAN[D.actIndex]}</span><span class="dot">·</span>${ACT_TITLES[D.actId] || D.region}`;
  const rowNow = current == null ? 1 : Math.min(D.rows, byId[current].row + 2);
  $('act-sub').textContent = `${D.region.toUpperCase()} · ROW ${rowNow} OF ${D.rows}`;
  const MOCK = {
    start: { gold: 200, hp: [20, 18] },
    choice: { gold: 385, hp: [16, 18] },
    mid: { gold: 1240, hp: [21, 12], max: [22, 19] },
  };
  const mock = MOCK[stateKey] || MOCK.mid;
  $('gold').textContent = `${mock.gold.toLocaleString('en-US')} G`;

  // ── Layout
  let L = null;
  function layout() {
    const W = loom.clientWidth;
    const H = loom.clientHeight;
    const padL = 40;
    const padR = 50;
    const padT = 42;
    const padB = 30;
    const minDx = desktop ? 48 : 52;
    const span = D.rows - 1;
    let dx = Math.max(minDx, (W - padL - padR) / span);
    dx = Math.min(dx, 96);
    const innerW = Math.max(W, padL + padR + dx * span);
    const offX = innerW > padL + padR + dx * span ? (innerW - (padL + padR + dx * span)) / 2 : 0;
    const dy = (H - padT - padB) / 4;
    const pos = new Map(
      D.nodes.map((n) => [n.id, { x: offX + padL + n.row * dx, y: padT + n.col * dy }]),
    );
    L = { W, H, innerW, dx, dy, padL: offX + padL, padT, pos };
  }

  // ── Geometry helpers for threads
  function bez(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  }
  // Sample a horizontal-tangent S-curve between two node centres, trimmed at the medals.
  function samplePath(a, b, ra, rb) {
    const mx = (b.x - a.x) * 0.52;
    const p1 = { x: a.x + mx, y: a.y };
    const p2 = { x: b.x - mx, y: b.y };
    const pts = [];
    const N = 64;
    for (let i = 0; i <= N; i++) pts.push(bez(a, p1, p2, b, i / N));
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
  function pointAt(pts, s) {
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
  const radiusOf = (n) => (n.type === 'boss' ? 29 : 25);
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hashStr = (s) =>
    [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

  // Distance fade: futures dissolve two rows past the frontier.
  const dissolveRow = frontierRow + 2.6;
  function rowFade(row) {
    const d = row - dissolveRow;
    return d <= 0 ? 1 : Math.max(0.28, 1 - d * 0.24);
  }

  // ── Thread styles
  function drawThread(ctx, e, pts) {
    const seed = hashStr(e.a.id + e.b.id);
    const r = rng(seed);
    const ph = r() * 6.28;
    const len = pts.length ? pts[pts.length - 1].s : 0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (e.kind === 'woven') {
      // Steady woven gold: a plied rope, no glow — this part of the thread is settled.
      rope(ctx, pts, {
        under: C.ink0,
        body: C.gold1,
        hatch: C.gold3,
        sheen: C.gold4,
        w: 3.4,
        alpha: 1,
      });
      return;
    }
    if (e.kind === 'live') {
      // Available: warm glow + a bright plied rope. Glints are animated on the fx layer.
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = C.gold4;
      ctx.shadowColor = C.gold4;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 5;
      strand(ctx, pts, () => 0);
      ctx.restore();
      rope(ctx, pts, {
        under: C.gold0,
        body: C.gold3,
        hatch: C.gold5,
        sheen: C.gold6,
        w: 3,
        alpha: 1,
      });
      if (e.b.elite) fracture(ctx, pts, len, true);
      return;
    }
    const fade = rowFade(e.b.row);
    if (e.kind === 'future') {
      // Possible futures: two loose, untwisted fibres. Thin and desaturated.
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = C.ink8;
      ctx.globalAlpha = 0.62 * fade;
      strand(ctx, pts, (s) => 0.7 * Math.sin(s * 0.19 + ph));
      ctx.strokeStyle = C.ink6;
      ctx.globalAlpha = 0.7 * fade;
      ctx.lineWidth = 0.9;
      strand(ctx, pts, (s) => -0.9 * Math.sin(s * 0.13 + ph * 1.7) + 0.5);
      ctx.globalAlpha = 1;
      if (e.b.elite) fracture(ctx, pts, len, false, fade);
      return;
    }
    // Cut: the thread frays out into broken fibres and parts where the choice was made.
    const mid = len * (0.42 + r() * 0.16);
    const gap = 4 + r() * 3;
    ctx.strokeStyle = C.ink5;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.85 * fade;
    const wob = (s) => 0.6 * Math.sin(s * 0.2 + ph);
    const sL = mid - gap / 2;
    const sR = mid + gap / 2;
    const DASHES = [
      [3.2, 2],
      [2.4, 2.4],
      [1.6, 2.8],
      [0.9, 3.2],
    ];
    const reach = DASHES.reduce((t, [d, g]) => t + d + g, 0);
    strand(ctx, pts, wob, 0, sL - reach);
    strand(ctx, pts, wob, sR + reach, Infinity);
    let a = sL - reach;
    let b = sR + reach;
    for (const [d, g] of DASHES) {
      strand(ctx, pts, wob, a + g, a + g + d); // walking right toward the break
      strand(ctx, pts, wob, b - g - d, b - g); // walking left toward the break
      a += d + g;
      b -= d + g;
    }
    ctx.globalAlpha = 1;
  }
  function rope(ctx, pts, o) {
    if (pts.length < 2) return;
    const len = pts[pts.length - 1].s;
    ctx.save();
    ctx.globalAlpha = 0.8 * o.alpha;
    ctx.strokeStyle = o.under;
    ctx.lineWidth = o.w + 2;
    strand(ctx, pts, () => 0);
    ctx.globalAlpha = o.alpha;
    ctx.strokeStyle = o.body;
    ctx.lineWidth = o.w;
    strand(ctx, pts, () => 0);
    // ply: short diagonal strokes read as a twisted thread
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
    ctx.globalAlpha = 0.55 * o.alpha;
    ctx.strokeStyle = o.sheen;
    ctx.lineWidth = 0.7;
    strand(ctx, pts, () => -h * 0.55);
    ctx.restore();
  }
  // The Lieutenant's mark: the thread cracks crimson just before an elite node.
  function fracture(ctx, pts, len, live, fade = 1) {
    // a clean break 5–15px before the medal, bridged by one crimson kink
    const s0 = Math.max(0, len - 15);
    const s1 = Math.max(0, len - 5);
    const a = pointAt(pts, s0);
    const b = pointAt(pts, s1);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = C.ink1;
    ctx.lineWidth = live ? 6 : 3.5;
    ctx.lineCap = 'butt';
    strand(ctx, pts, () => 0, s0, s1);
    ctx.lineCap = 'round';
    ctx.strokeStyle = live ? C.blood4 : C.blood3;
    ctx.lineWidth = live ? 1.4 : 1.1;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(m.x + a.nx * 2.6 - a.tx * 1, m.y + a.ny * 2.6 - a.ty * 1);
    ctx.lineTo(m.x - a.nx * 2.6 + a.tx * 1, m.y - a.ny * 2.6 + a.ty * 1);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  // ── Backdrop pieces
  const BAYER = [
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60,
    28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47,
    7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
  ];
  function pixelLayer(w, h, paint) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    paint(img.data, w, h);
    ctx.putImageData(img, 0, 0);
    return c;
  }
  const hex = (h) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];

  function drawWeave() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const { innerW: W, H, pos } = L;
    for (const c of [weave, fx]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
    }
    inner.style.width = `${W}px`;
    const ctx = weave.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // 1. vellum ground with a faint warm pool of light at the party's position
    ctx.fillStyle = C.ink1;
    ctx.fillRect(0, 0, W, H);
    const here = current ? pos.get(current) : { x: L.padL - 30, y: pos.get(D.startNodeId).y };
    const pool = ctx.createRadialGradient(
      here.x,
      here.y,
      0,
      here.x,
      here.y,
      Math.max(220, L.dx * 3.2),
    );
    pool.addColorStop(0, 'rgba(128,70,31,0.16)');
    pool.addColorStop(0.45, 'rgba(79,44,22,0.07)');
    pool.addColorStop(1, 'rgba(14,12,20,0)');
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, W, H);

    // 2. dithered star/vellum texture (1 CSS px grain)
    const rand = rng(D.seed * 7919);
    const t3 = hex(C.ink3);
    const t4 = hex(C.ink4);
    const t6 = hex(C.ink6);
    const tex = pixelLayer(Math.ceil(W), Math.ceil(H), (d, w, h) => {
      for (let i = 0; i < w * h; i++) {
        const v = rand();
        const col = v < 0.0009 ? t6 : v < 0.006 ? t4 : v < 0.03 ? t3 : null;
        if (!col) continue;
        d[i * 4] = col[0];
        d[i * 4 + 1] = col[1];
        d[i * 4 + 2] = col[2];
        d[i * 4 + 3] = v < 0.0009 ? 200 : 150;
      }
    });
    ctx.drawImage(tex, 0, 0);

    // 3. warp: the five lanes are the loom's standing threads
    const laneTop = L.padT;
    for (let lane = 0; lane < 5; lane++) {
      const y = Math.round(laneTop + lane * L.dy) + 0.5;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = C.ink3;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(6, y);
      ctx.lineTo(W - 6, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // 4. heddle ruler: row numerals along the top beam
    ctx.font = '8px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let row = 0; row < D.rows; row++) {
      const x = L.padL + row * L.dx;
      const doneRow = row <= frontierRow;
      const nextRow = row === frontierRow + 1;
      ctx.fillStyle = nextRow ? C.gold5 : doneRow ? C.gold2 : C.ink6;
      ctx.globalAlpha = nextRow || doneRow ? 1 : rowFade(row) * 0.9;
      ctx.fillText(ROMAN[row], x, 15);
      ctx.fillRect(Math.round(x) - 0.5, 20, 1, nextRow ? 4 : 2);
    }
    ctx.globalAlpha = 1;

    // 5. threads — fraying first, gold last so the player's path always sits on top
    const order = { cut: 0, future: 1, woven: 2, live: 3 };
    L.paths = new Map();
    const lead = pos.get(D.startNodeId);
    const leadPts = samplePath({ x: -8, y: lead.y }, lead, 0, radiusOf(byId[D.startNodeId]));
    for (const e of [...edges].sort((p, q) => order[p.kind] - order[q.kind])) {
      const pts = samplePath(pos.get(e.a.id), pos.get(e.b.id), radiusOf(e.a), radiusOf(e.b));
      L.paths.set(`${e.a.id}>${e.b.id}`, pts);
      if (e.kind === 'live') continue; // after the lead thread
      drawThread(ctx, e, pts);
    }
    // The run's thread arrives from the left beam: woven once the first knot is tied.
    const leadEdge = {
      a: { id: 'lead', row: -1 },
      b: byId[D.startNodeId],
      kind: current ? 'woven' : 'live',
    };
    drawThread(ctx, leadEdge, leadPts);
    L.leadPts = leadPts;
    for (const e of edges)
      if (e.kind === 'live') drawThread(ctx, e, L.paths.get(`${e.a.id}>${e.b.id}`));

    // 6. the far end dissolves into darkness (ordered dither + soft gradient)
    const x0 = L.padL + dissolveRow * L.dx - L.dx * 0.5;
    if (x0 < W) {
      const ink0 = hex(C.ink0);
      const dither = pixelLayer(Math.ceil(W), Math.ceil(H), (d, w, h) => {
        for (let y = 0; y < h; y++)
          for (let x = Math.max(0, Math.floor(x0)); x < w; x++) {
            const k = Math.min(0.62, ((x - x0) / Math.max(80, w - x0)) * 0.8);
            if (k * 64 > BAYER[(x & 7) + (y & 7) * 8]) {
              const i = (y * w + x) * 4;
              d[i] = ink0[0];
              d[i + 1] = ink0[1];
              d[i + 2] = ink0[2];
              d[i + 3] = 255;
            }
          }
      });
      ctx.drawImage(dither, 0, 0);
      const g = ctx.createLinearGradient(x0, 0, W, 0);
      g.addColorStop(0, 'rgba(7,6,11,0)');
      g.addColorStop(1, 'rgba(7,6,11,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, 0, W - x0, H);
    }

    // 7. the Hollow Sun: a black eclipse with a gold corona at the act's end
    const boss = byId[D.bossNodeId];
    const b = pos.get(boss.id);
    const cor = ctx.createRadialGradient(b.x, b.y, 22, b.x, b.y, 78);
    cor.addColorStop(0, 'rgba(255,240,189,0.55)');
    cor.addColorStop(0.08, 'rgba(243,203,108,0.34)');
    cor.addColorStop(0.3, 'rgba(179,112,44,0.13)');
    cor.addColorStop(0.65, 'rgba(79,44,22,0.05)');
    cor.addColorStop(1, 'rgba(7,6,11,0)');
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 78, 0, Math.PI * 2);
    ctx.fill();
    const rr = rng(hashStr(boss.id));
    ctx.lineCap = 'round';
    for (let i = 0; i < 36; i++) {
      const ang = (i / 36) * Math.PI * 2 + rr() * 0.08;
      const r1 = 27;
      const r2 = 34 + rr() * (i % 3 ? 10 : 22);
      ctx.strokeStyle = i % 3 ? C.gold3 : C.gold4;
      ctx.globalAlpha = i % 3 ? 0.22 : 0.34;
      ctx.lineWidth = i % 3 ? 0.8 : 1;
      ctx.beginPath();
      ctx.moveTo(b.x + Math.cos(ang) * r1, b.y + Math.sin(ang) * r1);
      ctx.lineTo(b.x + Math.cos(ang) * r2, b.y + Math.sin(ang) * r2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // two crimson fractures across the corona
    for (const base of [-0.9, 2.3]) {
      ctx.strokeStyle = C.blood3;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1;
      ctx.beginPath();
      let rad = 27;
      let ang = base;
      ctx.moveTo(b.x + Math.cos(ang) * rad, b.y + Math.sin(ang) * rad);
      for (let k = 0; k < 4; k++) {
        rad += 4 + rr() * 4;
        ang += (k % 2 ? 1 : -1) * (0.06 + rr() * 0.06);
        ctx.lineTo(b.x + Math.cos(ang) * rad, b.y + Math.sin(ang) * rad);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── fx layer: glints on available threads, Sera's vision toward a future selection
  let raf = 0;
  function drawFx(time) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const ctx = fx.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L.innerW, L.H);
    const sel = byId[selected];
    const selState = sel ? nodeState(sel) : null;
    const t = reduceMotion ? 0 : time / 1000;

    // Vision: every future thread on a route from the party to the selected node.
    if (sel && selState === 'future') {
      const reach = canReach(sel.id);
      ctx.save();
      ctx.setLineDash([2, 3.5]);
      ctx.lineDashOffset = reduceMotion ? 0 : -t * 9;
      ctx.lineCap = 'round';
      for (const e of edges) {
        if (e.kind !== 'future' && e.kind !== 'live') continue;
        if (!reach.has(e.b.id)) continue;
        if (e.kind === 'future' && !steps.has(e.a.id)) continue;
        const pts = L.paths.get(`${e.a.id}>${e.b.id}`);
        ctx.strokeStyle = C.gold5;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1.3;
        strand(ctx, pts, () => 0);
      }
      ctx.restore();
    }

    // Glints travel from the party toward each reachable choice.
    const liveEdges = edges.filter((e) => e.kind === 'live');
    const glintPaths = liveEdges.map((e) => ({
      pts: L.paths.get(`${e.a.id}>${e.b.id}`),
      selected: e.b.id === selected,
      id: e.b.id,
    }));
    if (current == null)
      glintPaths.push({ pts: L.leadPts, selected: selected === D.startNodeId, id: 'lead' });
    glintPaths.forEach((g, i) => {
      const len = g.pts[g.pts.length - 1].s;
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
        const u = reduceMotion ? 0.55 : (((t / period + i * 0.37 + k / count) % 1) + 1) % 1;
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
    if (!reduceMotion) raf = requestAnimationFrame(drawFx);
  }

  // ── Nodes (DOM)
  const LABEL = {
    battle: 'Battle',
    church: 'Church',
    boss: 'Boss battle',
    shop: 'Village',
    ruins: 'Ruins',
    recruit: 'Recruit',
    colosseum: 'Colosseum',
  };
  const labelOf = (n) => (n.elite ? 'Elite battle' : LABEL[n.type] || n.type);
  const SHORT = {
    battle: 'BATTLE',
    church: 'CHURCH',
    boss: 'BOSS',
    shop: 'VILLAGE',
    ruins: 'RUINS',
    recruit: 'RECRUIT',
    colosseum: 'COLOSSEUM',
  };
  let selected = qs.get('sel') || S.selected;
  const buttons = new Map();

  function crackSvg() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'crack');
    svg.setAttribute('viewBox', '0 0 46 46');
    svg.innerHTML =
      '<path d="M35.5 5.5 L32.2 10.4 L35.4 12.6 L31.4 17.8" fill="none" stroke="#07060b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M35.5 5.5 L32.2 10.4 L35.4 12.6 L31.4 17.8" fill="none" stroke="#cc4038" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M8.2 33.5 L11.6 32.6 L12.4 35.6" fill="none" stroke="#9e2632" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>';
    return svg;
  }

  function buildNodes() {
    for (const b of buttons.values()) b.remove();
    buttons.clear();
    for (const n of D.nodes) {
      const st = nodeState(n);
      const p = L.pos.get(n.id);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `node is-${st}`;
      if (st === 'current') b.classList.add('is-done');
      if (n.elite) b.classList.add('is-elite');
      if (n.type === 'boss') b.classList.add('is-boss');
      b.dataset.node = n.id;
      b.style.left = `${p.x}px`;
      b.style.top = `${p.y}px`;
      const stateText = {
        current: 'You are here',
        done: 'Completed',
        live: 'Available',
        future: 'Future',
        cut: 'Unreachable',
      }[st];
      b.setAttribute(
        'aria-label',
        `${labelOf(n)} · ${stateText} · row ${n.row + 1} lane ${n.col + 1}`,
      );
      const medal = document.createElement('span');
      medal.className = 'medal';
      medal.append(nodeArt(frameOf(n), n.type === 'boss' ? 34 : 29));
      b.append(medal);
      if (n.elite) b.append(crackSvg());
      if (st === 'current') {
        const here = document.createElement('span');
        here.className = 'here';
        b.append(here);
      }
      if (st === 'live') {
        const lab = document.createElement('span');
        lab.className = 'label';
        lab.textContent = n.elite ? 'ELITE' : SHORT[n.type];
        b.append(lab);
      }
      if (st === 'future' || st === 'cut') {
        const fade = n.type === 'boss' ? 1 : rowFade(n.row);
        b.style.opacity = String(st === 'cut' ? Math.min(0.75, fade) : Math.max(0.55, fade));
      }
      b.addEventListener('click', () => select(n.id));
      inner.append(b);
      buttons.set(n.id, b);
    }
  }

  // ── Inspect pane
  const OBJECTIVE = {
    rout: ['ROUT', 'Defeat all enemies on the map.'],
    seize: ['SEIZE', 'Take the throne once its guard falls.'],
    escape: ['ESCAPE', 'Get every lord to an escape square. Pursuers never stop.'],
  };
  const SERVICE = {
    shop: 'Buy, sell and forge equipment.',
    church: 'Heal, revive allies and promote units.',
    ruins: 'Supplies and services among the ruins.',
    colosseum: 'Arena and mercenary board.',
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  function renderInspect() {
    const n = byId[selected];
    const box = document.getElementById('inspect');
    box.replaceChildren();
    if (!n) return;
    const st = nodeState(n);
    const threadColor = {
      live: C.gold4,
      current: C.gold3,
      done: C.gold2,
      future: C.ink6,
      cut: C.blood2,
    }[st];
    box.style.setProperty('--card-thread', n.elite && st === 'live' ? C.blood4 : threadColor);

    const head = el('div', 'insp-head');
    const medal = el('span', 'insp-medal');
    const art = nodeArt(frameOf(n), 22);
    if (st === 'cut') art.style.filter = 'grayscale(1) brightness(.6)';
    else if (st === 'future') art.style.filter = 'grayscale(.4) brightness(.85)';
    medal.append(art);
    const titles = el('div');
    const kind = el('div', 'insp-kind');
    const obj = n.objective ? OBJECTIVE[n.objective] : null;
    if (n.elite) kind.append(el('span', 'elite', 'ELITE'));
    else kind.append(document.createTextNode(SHORT[n.type]));
    if (obj && n.type !== 'recruit') kind.append(el('span', 'muted', ` · ${obj[0]}`));
    titles.append(kind);
    const place = n.template ? n.template.name : n.type === 'recruit' ? 'A potential ally' : null;
    if (place) titles.append(el('div', 'insp-place', place));
    head.append(medal, titles);
    box.append(head);

    const tags = el('div', 'insp-tags');
    if (n.levelRange) {
      const [lo, hi] = n.levelRange;
      tags.append(el('span', 'tag', lo === hi ? `Lv ${lo}` : `Lv ${lo}–${hi}`));
    }
    if (n.fog) tags.append(el('span', 'tag warn', 'Fog'));
    if (n.village) tags.append(el('span', 'tag good', 'Village'));
    if (n.caravan) tags.append(el('span', 'tag good', 'Caravan'));
    if (n.elite) tags.append(el('span', 'tag bad', 'Elite spoils'));
    if (tags.childElementCount) box.append(tags);

    const text =
      n.type === 'recruit'
        ? 'Battle with a potential ally.'
        : SERVICE[n.type] || (obj ? obj[1] : '');
    if (text) box.append(el('p', 'insp-text', text));
    if (n.flavor && st !== 'cut') box.append(el('p', 'insp-flavor', `“${n.flavor}”`));

    const d = steps.get(n.id);
    const line = {
      live: ['', 'Within reach · the next knot'],
      current: ['done', 'The party rests here'],
      done: ['done', 'Woven · already walked'],
      future: ['future', `A possible future · ${d} steps out`],
      cut: ['cut', 'A frayed thread · out of reach'],
    }[st];
    box.append(el('p', `insp-state ${line[0]}`, line[1]));

    const travel = document.getElementById('travel');
    travel.replaceChildren();
    travel.disabled = st !== 'live';
    travel.append(el('span', null, 'TRAVEL'));
    if (st === 'live') travel.append(el('span', 'arrow'));
    travel.setAttribute(
      'aria-label',
      st === 'live' ? `Travel to ${labelOf(n)}` : 'Travel (select a gold thread)',
    );
  }

  function renderParty() {
    const party = document.getElementById('party');
    party.replaceChildren();
    D.party.forEach((u, i) => {
      const max = (mock.max && mock.max[i]) || u.maxHP;
      const hp = Math.min(max, mock.hp[i]);
      const chip = el('button', 'chip');
      chip.type = 'button';
      chip.setAttribute('aria-label', `${u.name}, ${hp} of ${max} HP. Open roster`);
      const img = el('img');
      img.src = `img/lord_${u.name.toLowerCase()}.png`;
      img.alt = '';
      const info = el('span', 'chip-info');
      const name = el('span', 'chip-name');
      name.append(el('span', null, u.name), el('span', 'hp', `${hp}/${max}`));
      info.append(name, el('span', 'chip-class', u.className));
      const bar = el('span', `bar${hp / max < 0.5 ? ' mid' : ''}`);
      const fill = el('i');
      fill.style.width = `${Math.round((hp / max) * 100)}%`;
      bar.append(fill);
      info.append(bar);
      chip.append(img, info);
      party.append(chip);
    });
  }

  function select(id) {
    selected = id;
    for (const [nid, b] of buttons) {
      b.classList.toggle('is-selected', nid === id);
      b.setAttribute('aria-pressed', String(nid === id));
    }
    renderInspect();
    if (reduceMotion) drawFx(0);
  }

  function updateScrollHints() {
    wrap.classList.toggle('more-left', loom.scrollLeft > 2);
    wrap.classList.toggle('more-right', loom.scrollLeft + loom.clientWidth < loom.scrollWidth - 2);
  }

  function render() {
    layout();
    drawWeave();
    buildNodes();
    select(selected);
    // Anchor on the frontier, leaving the next two rows visible (as NodeMapMenu does).
    const anchor = L.pos.get([...available][0]);
    loom.scrollLeft = Math.max(0, anchor.x - L.dx * 1.4);
    updateScrollHints();
    cancelAnimationFrame(raf);
    if (reduceMotion) drawFx(0);
    else raf = requestAnimationFrame(drawFx);
  }

  loom.addEventListener('scroll', updateScrollHints, { passive: true });
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 60);
  });
  renderParty();
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    render();
    document.documentElement.dataset.ready = '1';
  });
})();
