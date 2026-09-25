// Dev-only review page for the procedural terrain (served by Vite:
//   npm run dev -> /docs/art-direction/build/terrain/preview.html).
// Renders real generated battles (the game's generateBattle, seeded) with
// real unit sprites, faction rings, HP bars and the movement / danger
// overlays at phone scale, next to the current weathered atlases.
// ?bench=1 runs the performance benchmark on load (used for the README).
import { generateBattle } from '../../../../src/engine/MapGenerator.js';
import { mulberry32 } from '../../../../src/art/terrain/noise.js';
import { renderBattlefieldTerrain, PAINTED_TERRAIN } from '../../../../src/art/terrain/index.js';
import { renderTerrainSliced } from '../../../../src/art/terrain/async.js';
import {
  paintTerrainCanvasAsync,
  putResult,
  repaintTerrainCanvas,
  createShimmerOverlay,
} from '../../../../src/art/terrain/canvas.js';
import { drawWeatheredTile, loadWeatheredArt } from '../../../../src/ui/WeatheredTerrain.js';
import { softenGrassTexture } from '../../../../src/ui/BattleContrast.js';

const ROOT = '../../../../';
const DATA_FILES = [
  'terrain',
  'lords',
  'classes',
  'weapons',
  'skills',
  'mapSizes',
  'mapTemplates',
  'enemies',
  'consumables',
  'lootTables',
  'recruits',
  'metaUpgrades',
  'accessories',
  'whetstones',
  'turnBonus',
  'blessings',
  'difficulty',
  'affixes',
  'weaponArts',
  'colosseum',
  'traits',
  'imbues',
];
const PLAYER_SPRITES = [
  'lordedric',
  'sera',
  'cavalier',
  'archer',
  'knight',
  'cleric',
  'mage',
  'myrmidon',
];
const $ = (id) => document.getElementById(id);
const ui = {
  template: $('template'),
  seed: $('seed'),
  cell: $('cell'),
  units: $('units'),
  danger: $('danger'),
  move: $('move'),
  grid: $('grid'),
  shimmer: $('shimmer'),
  smooth: $('smooth'),
  mode: $('mode'),
  brush: $('brush'),
  stats: $('stats'),
  proc: $('proc'),
  weathered: $('weathered'),
  bench: $('bench'),
};

let data = null,
  art = null,
  battle = null,
  proc = null, // { canvas, result }
  shimmer = null,
  weatheredCanvas = null,
  lastRepaint = null,
  paintToken = 0;
const images = new Map();

function loadImage(src) {
  if (!images.has(src))
    images.set(
      src,
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      }),
    );
  return images.get(src);
}

async function loadData() {
  const entries = await Promise.all(
    DATA_FILES.map(async (name) => {
      const res = await fetch(`${ROOT}data/${name}.json`);
      return [name, res.ok ? await res.json() : null];
    }),
  );
  return Object.fromEntries(entries);
}

function templateList() {
  const out = [];
  for (const [objective, list] of Object.entries(data.mapTemplates))
    for (const t of list)
      out.push({ id: t.id, objective, act: t.acts?.[0] || 'act2', biome: t.biome || 'grassland' });
  return out;
}

function generate(spec, seed) {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return generateBattle(
      { act: spec.act, objective: spec.objective, templateId: spec.id, difficultyId: 'hard' },
      data,
    );
  } finally {
    Math.random = original;
  }
}

function paintWeathered(cfg) {
  const S = 48;
  const canvas = document.createElement('canvas');
  canvas.width = cfg.cols * S;
  canvas.height = cfg.rows * S;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#263e40';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < cfg.rows; r++)
    for (let c = 0; c < cfg.cols; c++) paintWeatheredCell(cfg, canvas, c, r);
  return canvas;
}

function paintWeatheredCell(cfg, canvas, c, r) {
  const S = 48;
  const at = (col, row) => data.terrain[cfg.mapLayout[row]?.[col]]?.name;
  const tile = document.createElement('canvas');
  tile.width = tile.height = S;
  const tctx = tile.getContext('2d');
  const drawn = drawWeatheredTile(tctx, art, at, c, r, { biome: cfg.biome });
  if (drawn && at(c, r) === 'Plain') softenGrassTexture(tctx, S);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#263e40';
  ctx.fillRect(c * S, r * S, S, S);
  ctx.drawImage(tile, c * S, r * S);
}

function diamond(col, row, reach) {
  const out = [];
  for (let r = row - reach; r <= row + reach; r++)
    for (let c = col - reach; c <= col + reach; c++)
      if (
        c >= 0 &&
        r >= 0 &&
        c < battle.cols &&
        r < battle.rows &&
        Math.abs(c - col) + Math.abs(r - row) <= reach
      )
        out.push([c, r]);
  return out;
}

function unitList() {
  const players = (battle.playerSpawns || []).map((u, k) => ({
    ...u,
    faction: 'player',
    src: `${ROOT}assets/sprites/characters/${PLAYER_SPRITES[k % PLAYER_SPRITES.length]}.png`,
  }));
  const enemies = (battle.enemySpawns || []).map((u) => ({
    ...u,
    faction: 'enemy',
    src: `${ROOT}assets/sprites/enemies/${(u.className || 'fighter').toLowerCase().replace(/ /g, '_')}.png`,
  }));
  return [...players, ...enemies];
}

async function drawPanel(canvas, terrainCanvas, overlay) {
  const T = Math.max(8, Number(ui.cell.value) || 34);
  const dpr = window.devicePixelRatio || 1;
  const W = battle.cols * T,
    H = battle.rows * T;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = ui.smooth.checked;
  ctx.drawImage(terrainCanvas, 0, 0, W, H);
  if (overlay) ctx.drawImage(overlay, 0, 0, W, H);
  const k = T / 32,
    inset = (T - 31 * k) / 2;
  if (ui.grid.checked) {
    ctx.fillStyle = 'rgba(244,236,219,0.22)';
    for (let c = 1; c < battle.cols; c++) ctx.fillRect(c * T - 0.5, 0, 1, H);
    for (let r = 1; r < battle.rows; r++) ctx.fillRect(0, r * T - 0.5, W, 1);
  }
  const units = unitList();
  if (ui.danger.checked) {
    const count = new Map();
    for (const u of units.filter((x) => x.faction === 'enemy'))
      for (const [c, r] of diamond(u.col, u.row, 5))
        count.set(`${c},${r}`, (count.get(`${c},${r}`) || 0) + 1);
    for (const [key, n] of count) {
      const [c, r] = key.split(',').map(Number);
      ctx.fillStyle = `rgba(232,164,74,${n >= 3 ? 0.42 : n === 2 ? 0.3 : 0.18})`;
      ctx.fillRect(c * T + inset, r * T + inset, 31 * k, 31 * k);
    }
  }
  if (ui.move.checked) {
    const p = units.find((u) => u.faction === 'player');
    if (p) {
      ctx.fillStyle = 'rgba(51,102,204,0.4)';
      for (const [c, r] of diamond(p.col, p.row, 5))
        ctx.fillRect(c * T + inset, r * T + inset, 31 * k, 31 * k);
    }
  }
  if (!ui.units.checked) return;
  const ordered = [...units].sort((a, b) => a.row - b.row);
  ctx.lineWidth = 2 * k;
  for (const u of ordered) {
    ctx.strokeStyle = u.faction === 'player' ? 'rgba(51,102,204,0.7)' : 'rgba(204,51,51,0.7)';
    ctx.beginPath();
    ctx.ellipse((u.col + 0.5) * T, (u.row + 0.5) * T + 6 * k, 12 * k, 6 * k, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.imageSmoothingEnabled = true;
  for (const u of ordered) {
    const img = await loadImage(u.src);
    const fallback = img || (await loadImage(`${ROOT}assets/sprites/enemies/fighter.png`));
    if (!fallback) continue;
    const h = 1.15 * T,
      w = (fallback.width * h) / fallback.height;
    const cx = (u.col + 0.5) * T,
      cy = (u.row + 0.5) * T;
    ctx.drawImage(fallback, cx - w / 2, cy - h / 2, w, h);
    const bw = 26 * k,
      bh = Math.max(2, 3 * k);
    ctx.fillStyle = u.faction === 'player' ? '#0f1e3d' : '#3d0f0f';
    ctx.fillRect(cx - bw / 2, cy + 12 * k - bh / 2, bw, bh);
    ctx.fillStyle = u.faction === 'enemy' ? '#cc4444' : '#44cc44';
    ctx.fillRect(cx - bw / 2, cy + 12 * k - bh / 2, bw * 0.8, bh);
  }
}

async function redraw() {
  if (!battle || !proc) return;
  await drawPanel(ui.proc, proc.canvas, ui.shimmer.checked ? shimmer?.canvas : null);
  if (weatheredCanvas) await drawPanel(ui.weathered, weatheredCanvas, null);
}

function describe() {
  const st = proc?.result?.stats || {};
  const lines = [
    `${battle.templateId}  ${battle.cols}x${battle.rows}  biome=${proc.result.biome}  seed=${ui.seed.value}`,
    `paint: ${st.mode}  work ${st.workMs?.toFixed(1)} ms  wall ${st.wallMs?.toFixed(1)} ms` +
      (st.maxSliceMs != null
        ? `  slices ${st.slices}  longest slice ${st.maxSliceMs.toFixed(1)} ms`
        : ''),
    `shimmer: ${shimmer ? `${shimmer.count} animated px` : 'off (reduced motion or nothing animates)'}`,
  ];
  if (lastRepaint) lines.push(`last repaint: ${lastRepaint}`);
  ui.stats.textContent = lines.join('\n');
}

async function rebuild() {
  const token = ++paintToken;
  const spec = templateList().find((t) => t.id === ui.template.value);
  const seed = Number(ui.seed.value) || 1;
  battle = generate(spec, seed);
  const opts = {
    mapLayout: battle.mapLayout,
    terrainData: data.terrain,
    biome: battle.biome,
    seed: seed * 1000 + 7,
  };
  const painted = await paintTerrainCanvasAsync(opts, { mode: ui.mode.value });
  if (token !== paintToken) return;
  shimmer?.destroy();
  proc = painted;
  lastRepaint = null;
  shimmer = createShimmerOverlay(proc.result, { onFrame: () => ui.shimmer.checked && redraw() });
  shimmer?.start();
  weatheredCanvas = art ? paintWeathered(battle) : null;
  describe();
  await redraw();
}

function onClick(event) {
  if (!proc) return;
  const T = Number(ui.cell.value) || 34;
  const rect = ui.proc.getBoundingClientRect();
  const col = Math.floor((event.clientX - rect.left) / T),
    row = Math.floor((event.clientY - rect.top) / T);
  if (col < 0 || row < 0 || col >= battle.cols || row >= battle.rows) return;
  const index = data.terrain.findIndex((t) => t.name === ui.brush.value);
  if (index < 0) return;
  battle.mapLayout[row][col] = index;
  const t0 = performance.now();
  const rects = repaintTerrainCanvas(proc.canvas, proc.result, [{ col, row }], {
    mapLayout: battle.mapLayout,
    terrainData: data.terrain,
  });
  const ms = performance.now() - t0;
  shimmer?.refresh();
  for (let r = row - 1; r <= row + 1; r++)
    for (let c = col - 1; c <= col + 1; c++)
      if (weatheredCanvas && c >= 0 && r >= 0 && c < battle.cols && r < battle.rows)
        paintWeatheredCell(battle, weatheredCanvas, c, r);
  lastRepaint = `${ui.brush.value} at ${col},${row}: ${ms.toFixed(2)} ms, ${rects.length} rect(s) ${rects
    .map((r) => `${r.width}x${r.height}`)
    .join(' ')}`;
  describe();
  redraw();
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function runBench() {
  ui.bench.textContent = 'benchmarking…';
  const specs = templateList();
  const pick = (id) => specs.find((s) => s.id === id);
  const cases = [
    ['synthetic-20x13', 'Largest mapSizes entry, every terrain mixed'],
    ['eldritch_sanctum', 'Final boss arena (void)'],
    ['act4_boss_intent_bastion', 'Act 4 boss (tundra)'],
    ['eruption_point', 'Act 4 volcano'],
    ['great_hall', 'Castle hall'],
    ['river_crossing', 'River crossing'],
    ['mire_crossing', 'Mire crossing'],
  ];
  const rows = [];
  for (const [id, label] of cases) {
    let opts;
    if (id === 'synthetic-20x13') {
      const rng = mulberry32(20);
      const names = Array.from({ length: 13 }, () =>
        Array.from(
          { length: 20 },
          () => PAINTED_TERRAIN[Math.floor(rng() * PAINTED_TERRAIN.length)],
        ),
      );
      opts = { names, biome: 'grassland', seed: 99 };
    } else {
      const spec = pick(id);
      if (!spec) continue;
      const cfg = generate({ ...spec, act: id === 'river_crossing' ? 'act3' : spec.act }, 3);
      opts = { mapLayout: cfg.mapLayout, terrainData: data.terrain, biome: cfg.biome, seed: 99 };
    }
    renderBattlefieldTerrain(opts); // warm-up
    // Minimums are the best estimate of CPU cost on a busy machine (any
    // wall-clock sample can include time the OS gave to other processes).
    const sync = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      renderBattlefieldTerrain(opts);
      sync.push(performance.now() - t0);
    }
    const slicedRuns = [];
    for (let i = 0; i < 3; i++) slicedRuns.push(await renderTerrainSliced(opts, { budgetMs: 8 }));
    const sliced = slicedRuns.reduce((a, b) => (b.stats.maxSliceMs < a.stats.maxSliceMs ? b : a));
    let worker;
    try {
      await paintTerrainCanvasAsync(opts, { mode: 'worker' }); // warm the shared worker
      const runs = [];
      for (let i = 0; i < 3; i++)
        runs.push((await paintTerrainCanvasAsync(opts, { mode: 'worker' })).result.stats);
      worker = runs.reduce((a, b) => (b.wallMs < a.wallMs ? b : a));
    } catch (e) {
      worker = { error: e.message };
    }
    const res = sliced;
    const canvas = document.createElement('canvas');
    canvas.width = res.width;
    canvas.height = res.height;
    const up = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      putResult(canvas, res);
      up.push(performance.now() - t0);
    }
    const rng = mulberry32(5);
    const rep = [];
    for (let i = 0; i < 12; i++) {
      const col = Math.floor(rng() * res.cols),
        row = Math.floor(rng() * res.rows);
      const name = PAINTED_TERRAIN[Math.floor(rng() * PAINTED_TERRAIN.length)];
      const t0 = performance.now();
      repaintTerrainCanvas(canvas, res, [{ col, row, name }]);
      rep.push(performance.now() - t0);
    }
    const ov = createShimmerOverlay(res, { reducedMotion: false });
    const sh = [];
    if (ov)
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        ov.frame(i * 125);
        sh.push(performance.now() - t0);
      }
    rows.push({
      label: `${label} (${id})`,
      size: `${res.cols}x${res.rows}`,
      syncMinMs: Math.min(...sync),
      syncMedianMs: median(sync),
      slicedMaxSliceMs: sliced.stats.maxSliceMs,
      slicedP95SliceMs: sliced.stats.p95SliceMs,
      slicedSlices: sliced.stats.slices,
      slicedWallMs: sliced.stats.wallMs,
      workerWallMs: worker.wallMs ?? NaN,
      workerWorkMs: worker.workMs ?? NaN,
      uploadMs: median(up),
      repaintMinMs: Math.min(...rep),
      repaintMedianMs: median(rep),
      shimmerPx: ov ? ov.count : 0,
      shimmerFrameMs: sh.length ? median(sh) : 0,
    });
    ov?.destroy();
  }
  window.__terrainBench = rows;
  const keys = Object.keys(rows[0] || {});
  const fmt = (v) => (typeof v === 'number' ? v.toFixed(1) : v);
  ui.bench.innerHTML = `<table><tr>${keys.map((k) => `<th>${k}</th>`).join('')}</tr>${rows
    .map((r) => `<tr>${keys.map((k) => `<td>${fmt(r[k])}</td>`).join('')}</tr>`)
    .join('')}</table>`;
  return rows;
}

async function main() {
  data = await loadData();
  try {
    art = await loadWeatheredArt(`${ROOT}assets/terrain/weathered`);
  } catch (e) {
    console.warn(e);
  }
  const params = new URLSearchParams(location.search);
  for (const t of templateList()) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = `${t.id} (${t.biome}, ${t.objective})`;
    ui.template.append(o);
  }
  for (const name of PAINTED_TERRAIN.filter((n) => n !== 'River')) {
    const o = document.createElement('option');
    o.value = o.textContent = name;
    ui.brush.append(o);
  }
  ui.template.value = params.get('template') || 'river_crossing';
  if (params.get('seed')) ui.seed.value = params.get('seed');
  if (params.get('cell')) ui.cell.value = params.get('cell');
  for (const el of [ui.template, ui.seed, ui.mode]) el.addEventListener('change', rebuild);
  for (const el of [ui.cell, ui.units, ui.danger, ui.move, ui.grid, ui.shimmer, ui.smooth])
    el.addEventListener('change', redraw);
  ui.proc.addEventListener('click', onClick);
  $('bench-btn').addEventListener('click', runBench);
  await rebuild();
  window.__terrainReady = true;
  if (params.get('bench') === '1') await runBench();
}

main().catch((e) => {
  ui.stats.textContent = `error: ${e.stack || e}`;
  console.error(e);
});
